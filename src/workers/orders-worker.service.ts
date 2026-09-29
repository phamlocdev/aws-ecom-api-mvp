import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common'
import { SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'
import { CartsService } from '../carts/carts.service'
import { CartStatus } from '../carts/cart-status.enum'
import { InventoryService } from '../inventory/inventory.service'
import { ReservedInventoryItem } from '../inventory/inventory.types'
import { ProductsService } from '../products/products.service'
import { Product } from '../products/product.types'
import { OrderStatus } from '../orders/order-status.enum'
import { OrdersService } from '../orders/orders.service'
import { OrderItem, OrderMutationContext, PlaceOrderMessage } from '../orders/orders.types'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class OrdersWorkerService {
  private readonly logger = new Logger(OrdersWorkerService.name)
  private readonly orderItemsTableName: string
  private readonly placeOrderDelayMs: number

  constructor(
    @Inject(CartsService)
    private readonly cartsService: CartsService,
    @Inject(InventoryService)
    private readonly inventoryService: InventoryService,
    @Inject(ProductsService)
    private readonly productsService: ProductsService,
    @Inject(OrdersService)
    private readonly ordersService: OrdersService,
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
    this.orderItemsTableName = configService.get<string>('ORDER_ITEMS_TABLE') ?? 'order-items'
    this.placeOrderDelayMs = Number(configService.get<string>('PLACE_ORDER_DELAY_MS') ?? 0)
  }

  async handlePlaceOrderBatch(event: SQSEvent): Promise<SQSBatchResponse> {
    const failures: { itemIdentifier: string }[] = []

    for (let index = 0; index < event.Records.length; index += 1) {
      const record = event.Records[index]

      try {
        await this.handlePlaceOrderRecord(record)
      } catch (error) {
        this.logger.error(`Failed place-order record ${record.messageId}`, error)
        for (let failedIndex = index; failedIndex < event.Records.length; failedIndex += 1) {
          failures.push({ itemIdentifier: event.Records[failedIndex].messageId })
        }
        break
      }
    }

    return {
      batchItemFailures: failures,
    }
  }

  async handleReservationExpirySweep(): Promise<void> {
    const nowEpochSeconds = toEpochSeconds(Date.now())
    let exclusiveStartKey: Record<string, unknown> | undefined
    let expiredOrdersFound = 0
    let reservationsReleased = 0

    do {
      const response = await this.ordersService.findExpiredReservedOrders(
        nowEpochSeconds,
        25,
        exclusiveStartKey,
      )

      expiredOrdersFound += response.items.length

      for (const order of response.items) {
        const items = await this.ordersService.findOrderItems(order.orderId)
        if (items.length === 0) {
          this.logger.warn(`Expired reserved order ${order.orderId} has no order items.`)
          continue
        }

        const released = await this.ordersService.expireReservationAndReleaseInventoryIfUnpaid(
          order,
          items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
          systemOrderMutationContext('reservation-expiry-poller', 'Payment expired'),
        )
        if (released) {
          reservationsReleased += 1
        } else {
          this.logger.warn(
            `Skipped releasing expired reservation for order ${order.orderId}; order or inventory conditions changed.`,
          )
        }
      }

      exclusiveStartKey = response.lastEvaluatedKey
    } while (exclusiveStartKey)

    this.logger.log(
      `Reservation expiry sweep completed. expiredOrdersFound=${expiredOrdersFound}, reservationsReleased=${reservationsReleased}`,
    )
  }

  private async handlePlaceOrderRecord(record: SQSRecord): Promise<void> {
    const message = parseJson<PlaceOrderMessage>(record.body)
    const order = await this.ordersService.getById(message.orderId)

    if (order.status !== OrderStatus.PENDING) {
      return
    }

    await wait(this.placeOrderDelayMs)

    const cart = await this.cartsService.getOwnedCartOrThrow(message.customerId, message.cartId)
    if (cart.status === CartStatus.EXPIRED || cart.expiresAt <= Math.floor(Date.now() / 1000)) {
      await this.cartsService.markExpired(cart)
      await this.ordersService.markFailed(
        order.orderId,
        OrderStatus.EXPIRED,
        'Cart expired before checkout.',
        systemOrderMutationContext('place-order-worker', 'Cart expired before checkout.'),
      )
      return
    }

    const cartItems = await this.cartsService.getCartItems(cart.cartId)
    if (cartItems.length === 0) {
      await this.ordersService.markFailed(
        order.orderId,
        OrderStatus.FAILED,
        'Cart has no items.',
        systemOrderMutationContext('place-order-worker', 'Cart has no items.'),
      )
      return
    }

    const reservedItems: ReservedInventoryItem[] = []
    let reservationSucceeded = false

    try {
      const productSnapshots: Array<{ item: (typeof cartItems)[number]; product: Product }> = []
      for (const item of cartItems) {
        const product = await this.productsService.findOne(item.productId)

        await this.inventoryService.reserve(item.productId, item.quantity)
        reservedItems.push({ productId: item.productId, quantity: item.quantity })
        productSnapshots.push({ item, product })
      }

      const createdAt = new Date().toISOString()
      const orderItems: OrderItem[] = productSnapshots.map(({ item, product }, index) => ({
        orderId: order.orderId,
        lineId: `${String(index + 1).padStart(3, '0')}-${randomUUID().slice(0, 8)}`,
        productId: product.productId,
        productName: product.name,
        imageUrl: product.imageUrl,
        unitPrice: product.price,
        quantity: item.quantity,
        lineTotal: product.price * item.quantity,
        createdAt,
      }))

      for (const orderItem of orderItems) {
        await this.dynamoDbService.documentClient.send(
          new PutCommand({
            TableName: this.orderItemsTableName,
            Item: orderItem,
          }),
        )
      }

      const totalAmount = orderItems.reduce((total, item) => total + item.lineTotal, 0)
      await this.ordersService.markReserved(
        order.orderId,
        totalAmount,
        systemOrderMutationContext('place-order-worker', 'Order reserved'),
      )
      reservationSucceeded = true
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Failed to process order.'

      if (reservedItems.length > 0) {
        await this.ordersService.failPendingOrderAndReleaseReservation(
          order.orderId,
          failureReason,
          reservedItems,
          systemOrderMutationContext('place-order-worker', failureReason),
        )
      } else {
        await this.ordersService.markFailed(
          order.orderId,
          OrderStatus.FAILED,
          failureReason,
          systemOrderMutationContext('place-order-worker', failureReason),
        )
      }

      // Only rethrow the error if it's not a ConflictException, which indicates insufficient inventory.
      if (!(error instanceof ConflictException)) {
        throw error
      }
    }

    if (reservationSucceeded) {
      await this.cartsService.markExpired(cart)
    }
  }
}

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function toEpochSeconds(timestampMs: number): number {
  return Math.floor(timestampMs / 1000)
}

function systemOrderMutationContext(actorId: string, reason: string): OrderMutationContext {
  return {
    actorType: 'system',
    actorId,
    reason,
  }
}
