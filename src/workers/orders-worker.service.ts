import { Inject, Injectable, Logger } from '@nestjs/common'
import { SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda'
import { systemAuditMutationContext } from '../audit/audit-actor'
import { GetOwnedCartUseCase } from '../carts/application/get-owned-cart.use-case'
import { GetCartItemsUseCase } from '../carts/application/get-cart-items.use-case'
import { MarkCartExpiredUseCase } from '../carts/application/mark-cart-expired.use-case'
import { CartStatus } from '../carts/domain/cart-status.enum'
import { ExpireReservationAndReleaseInventoryIfUnpaidUseCase } from '../orders/application/expire-reservation-and-release-inventory-if-unpaid.use-case'
import { FindExpiredReservedOrdersUseCase } from '../orders/application/find-expired-reserved-orders.use-case'
import { FindOrderItemsUseCase } from '../orders/application/find-order-items.use-case'
import { GetOrderByIdUseCase } from '../orders/application/get-order-by-id.use-case'
import { MarkFailedUseCase } from '../orders/application/mark-failed.use-case'
import { ReserveOrderCheckoutItemsUseCase } from '../orders/application/reserve-order-checkout-items.use-case'
import { OrderStatus } from '../orders/domain/order-status.enum'
import { PlaceOrderMessage } from '../orders/domain/order.entity'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class OrdersWorkerService {
  private readonly logger = new Logger(OrdersWorkerService.name)
  private readonly placeOrderDelayMs: number

  constructor(
    @Inject(GetOwnedCartUseCase)
    private readonly getOwnedCartUseCase: GetOwnedCartUseCase,
    @Inject(GetCartItemsUseCase)
    private readonly getCartItemsUseCase: GetCartItemsUseCase,
    @Inject(MarkCartExpiredUseCase)
    private readonly markCartExpiredUseCase: MarkCartExpiredUseCase,
    @Inject(GetOrderByIdUseCase)
    private readonly getOrderByIdUseCase: GetOrderByIdUseCase,
    @Inject(FindOrderItemsUseCase)
    private readonly findOrderItemsUseCase: FindOrderItemsUseCase,
    @Inject(FindExpiredReservedOrdersUseCase)
    private readonly findExpiredReservedOrdersUseCase: FindExpiredReservedOrdersUseCase,
    @Inject(MarkFailedUseCase)
    private readonly markFailedUseCase: MarkFailedUseCase,
    @Inject(ReserveOrderCheckoutItemsUseCase)
    private readonly reserveOrderCheckoutItemsUseCase: ReserveOrderCheckoutItemsUseCase,
    @Inject(ExpireReservationAndReleaseInventoryIfUnpaidUseCase)
    private readonly expireReservationAndReleaseInventoryIfUnpaidUseCase: ExpireReservationAndReleaseInventoryIfUnpaidUseCase,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
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

    const { reservationSucceeded } = await this.reserveOrderCheckoutItemsUseCase.execute({
      orderId: order.orderId,
      cartItems: cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      actorId: 'place-order-worker',
    })

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
