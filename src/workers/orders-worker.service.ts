import { Inject, Injectable, Logger } from '@nestjs/common'
import { SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda'
import { systemAuditMutationContext } from '../audit/audit-actor'
import { GetOwnedCartUseCase } from '../carts/application/get-owned-cart.use-case'
import { GetCartItemsUseCase } from '../carts/application/get-cart-items.use-case'
import { MarkCartExpiredUseCase } from '../carts/application/mark-cart-expired.use-case'
import { CartStatus } from '../carts/domain/cart-status.enum'
import { FindExpiredReservedOrdersUseCase } from '../orders/application/find-expired-reserved-orders.use-case'
import { ReleaseExpiredOrderReservationUseCase } from '../orders/application/release-expired-order-reservation.use-case'
import { ReserveOrderCheckoutItemsUseCase } from '../orders/application/reserve-order-checkout-items.use-case'
import { OrderStatus } from '../orders/domain/order-status.enum'
import { PlaceOrderMessage } from '../orders/domain/order.entity'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../orders/domain/order.repository.port'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class OrdersWorkerService {
  private readonly logger = new Logger(OrdersWorkerService.name)
  private readonly placeOrderDelayMs: number

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(GetOwnedCartUseCase)
    private readonly getOwnedCartUseCase: GetOwnedCartUseCase,
    @Inject(GetCartItemsUseCase)
    private readonly getCartItemsUseCase: GetCartItemsUseCase,
    @Inject(MarkCartExpiredUseCase)
    private readonly markCartExpiredUseCase: MarkCartExpiredUseCase,
    @Inject(FindExpiredReservedOrdersUseCase)
    private readonly findExpiredReservedOrdersUseCase: FindExpiredReservedOrdersUseCase,
    @Inject(ReleaseExpiredOrderReservationUseCase)
    private readonly releaseExpiredOrderReservationUseCase: ReleaseExpiredOrderReservationUseCase,
    @Inject(ReserveOrderCheckoutItemsUseCase)
    private readonly reserveOrderCheckoutItemsUseCase: ReserveOrderCheckoutItemsUseCase,
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
        const released = await this.releaseExpiredOrderReservationUseCase.execute(order)
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
    const order = await this.orderRepository.findById(message.orderId)
    if (!order) {
      this.logger.warn(`Order ${message.orderId} not found; skipping.`)
      return
    }

    if (order.status !== OrderStatus.PENDING) {
      return
    }

    await wait(this.placeOrderDelayMs)

    const cart = await this.getOwnedCartUseCase.execute(message.customerId, message.cartId)
    if (cart.status === CartStatus.EXPIRED || cart.expiresAt <= Math.floor(Date.now() / 1000)) {
      await this.markCartExpiredUseCase.execute(cart)
      const actor = systemAuditMutationContext('place-order-worker', 'Cart expired before checkout.')
      order.failAsExpired('Cart expired before checkout.', new Date().toISOString())
      order.withAudit(actor)
      await this.orderRepository.save(order)
      return
    }

    const cartItems = await this.getCartItemsUseCase.execute(cart.cartId)
    if (cartItems.length === 0) {
      const actor = systemAuditMutationContext('place-order-worker', 'Cart has no items.')
      order.fail('Cart has no items.', new Date().toISOString())
      order.withAudit(actor)
      await this.orderRepository.save(order)
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
