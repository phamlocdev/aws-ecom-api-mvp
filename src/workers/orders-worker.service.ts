import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common'
import { SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'
import { systemAuditMutationContext } from '../audit/audit-actor'
import { GetOwnedCartUseCase } from '../carts/application/get-owned-cart.use-case'
import { GetCartItemsUseCase } from '../carts/application/get-cart-items.use-case'
import { MarkCartExpiredUseCase } from '../carts/application/mark-cart-expired.use-case'
import { CartStatus } from '../carts/domain/cart-status.enum'
import { InventoryService } from '../inventory/inventory.service'
import { ReservedInventoryItem } from '../inventory/inventory.types'
import { FindOneProductUseCase } from '../products/application/find-one-product.use-case'
import { Product } from '../products/domain/product.entity'
import { ExpireReservationAndReleaseInventoryIfUnpaidUseCase } from '../orders/application/expire-reservation-and-release-inventory-if-unpaid.use-case'
import { FailPendingOrderAndReleaseReservationUseCase } from '../orders/application/fail-pending-order-and-release-reservation.use-case'
import { FindExpiredReservedOrdersUseCase } from '../orders/application/find-expired-reserved-orders.use-case'
import { FindOrderItemsUseCase } from '../orders/application/find-order-items.use-case'
import { GetOrderByIdUseCase } from '../orders/application/get-order-by-id.use-case'
import { MarkFailedUseCase } from '../orders/application/mark-failed.use-case'
import { MarkReservedUseCase } from '../orders/application/mark-reserved.use-case'
import { OrderStatus } from '../orders/domain/order-status.enum'
import { OrderItem, PlaceOrderMessage } from '../orders/domain/order.entity'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class OrdersWorkerService {
  private readonly logger = new Logger(OrdersWorkerService.name)
  private readonly orderItemsTableName: string
  private readonly placeOrderDelayMs: number

  constructor(
    @Inject(GetOwnedCartUseCase)
    private readonly getOwnedCartUseCase: GetOwnedCartUseCase,
    @Inject(GetCartItemsUseCase)
    private readonly getCartItemsUseCase: GetCartItemsUseCase,
    @Inject(MarkCartExpiredUseCase)
    private readonly markCartExpiredUseCase: MarkCartExpiredUseCase,
    @Inject(InventoryService)
    private readonly inventoryService: InventoryService,
    @Inject(FindOneProductUseCase)
    private readonly findOneProductUseCase: FindOneProductUseCase,
    @Inject(GetOrderByIdUseCase)
    private readonly getOrderByIdUseCase: GetOrderByIdUseCase,
    @Inject(FindOrderItemsUseCase)
    private readonly findOrderItemsUseCase: FindOrderItemsUseCase,
    @Inject(FindExpiredReservedOrdersUseCase)
    private readonly findExpiredReservedOrdersUseCase: FindExpiredReservedOrdersUseCase,
    @Inject(MarkFailedUseCase)
    private readonly markFailedUseCase: MarkFailedUseCase,
    @Inject(MarkReservedUseCase)
    private readonly markReservedUseCase: MarkReservedUseCase,
    @Inject(FailPendingOrderAndReleaseReservationUseCase)
    private readonly failPendingOrderAndReleaseReservationUseCase: FailPendingOrderAndReleaseReservationUseCase,
    @Inject(ExpireReservationAndReleaseInventoryIfUnpaidUseCase)
    private readonly expireReservationAndReleaseInventoryIfUnpaidUseCase: ExpireReservationAndReleaseInventoryIfUnpaidUseCase,
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(ConfigService)
    configService: ConfigService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    this.orderItemsTableName = dynamoTables.orderItems
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
      const response = await this.findExpiredReservedOrdersUseCase.execute(
        nowEpochSeconds,
        25,
        exclusiveStartKey,
      )

      expiredOrdersFound += response.items.length

      for (const order of response.items) {
        const items = await this.findOrderItemsUseCase.execute(order.orderId)
        if (items.length === 0) {
          this.logger.warn(`Expired reserved order ${order.orderId} has no order items.`)
          continue
        }

        const released = await this.expireReservationAndReleaseInventoryIfUnpaidUseCase.execute(
          order,
          items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
          systemAuditMutationContext('reservation-expiry-poller', 'Payment expired'),
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
    const order = await this.getOrderByIdUseCase.execute(message.orderId)

    if (order.status !== OrderStatus.PENDING) {
      return
    }

    await wait(this.placeOrderDelayMs)

    const cart = await this.getOwnedCartUseCase.execute(message.customerId, message.cartId)
    if (cart.status === CartStatus.EXPIRED || cart.expiresAt <= Math.floor(Date.now() / 1000)) {
      await this.markCartExpiredUseCase.execute(cart)
      await this.markFailedUseCase.execute(
        order.orderId,
        OrderStatus.EXPIRED,
        'Cart expired before checkout.',
        systemAuditMutationContext('place-order-worker', 'Cart expired before checkout.'),
      )
      return
    }

    const cartItems = await this.getCartItemsUseCase.execute(cart.cartId)
    if (cartItems.length === 0) {
      await this.markFailedUseCase.execute(
        order.orderId,
        OrderStatus.FAILED,
        'Cart has no items.',
        systemAuditMutationContext('place-order-worker', 'Cart has no items.'),
      )
      return
    }

    const reservedItems: ReservedInventoryItem[] = []
    let reservationSucceeded = false

    try {
      const productSnapshots: Array<{ item: (typeof cartItems)[number]; product: Product }> = []
      for (const item of cartItems) {
        const product = await this.findOneProductUseCase.execute(item.productId)

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
      await this.markReservedUseCase.execute(
        order.orderId,
        totalAmount,
        systemAuditMutationContext('place-order-worker', 'Order reserved'),
      )
      reservationSucceeded = true
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Failed to process order.'

      if (reservedItems.length > 0) {
        await this.failPendingOrderAndReleaseReservationUseCase.execute(
          order.orderId,
          failureReason,
          reservedItems,
          systemAuditMutationContext('place-order-worker', failureReason),
        )
      } else {
        await this.markFailedUseCase.execute(
          order.orderId,
          OrderStatus.FAILED,
          failureReason,
          systemAuditMutationContext('place-order-worker', failureReason),
        )
      }

      // Only rethrow the error if it's not a ConflictException, which indicates insufficient inventory.
      if (!(error instanceof ConflictException)) {
        throw error
      }
    }

    if (reservationSucceeded) {
      await this.markCartExpiredUseCase.execute(cart)
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
