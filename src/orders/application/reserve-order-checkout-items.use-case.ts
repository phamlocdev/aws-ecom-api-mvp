import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { ConfigService } from '@nestjs/config'
import {
  systemAuditMutationContext,
  toAuditMutationAttributes,
} from '../../audit/audit-actor'
import { ConflictError } from '../../common/domain-error'
import { ReserveInventoryUseCase } from '../../inventory/application/reserve-inventory.use-case'
import { ReservedInventoryItem } from '../../inventory/domain/inventory.entity'
import { FindOneProductUseCase } from '../../products/application/find-one-product.use-case'
import { Product } from '../../products/domain/product.entity'
import { Order, OrderItem } from '../domain/order.entity'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { toEpochSeconds } from '../domain/order.rules'
import { NotFoundError } from '../../common/domain-error'

export type ReserveOrderCheckoutItemsInput = {
  orderId: string
  cartItems: ReservedInventoryItem[]
  /**
   * When provided, builds a `system` audit actor with this id for every
   * mutation this use-case performs (success and failure alike).
   * When omitted, falls back to a default system actor.
   */
  actorId?: string
}

export type ReserveOrderCheckoutItemsResult = {
  reservationSucceeded: boolean
}

/**
 * Shared reservation flow used by both the synchronous checkout path
 * (`CreateOrderRequestUseCase`) and the async SQS place-order worker
 * (`OrdersWorkerService`): reserve inventory per cart item, persist order
 * items, mark the order RESERVED on success. On failure, release any
 * already-reserved items and mark the order FAILED — but only swallow the
 * error (so the caller does not treat it as an unexpected failure) when it
 * is an inventory `ConflictError` (insufficient stock).
 */
@Injectable()
export class ReserveOrderCheckoutItemsUseCase {
  private readonly logger = new Logger(ReserveOrderCheckoutItemsUseCase.name)
  private readonly paymentConfirmationTimeoutSeconds: number

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(ReserveInventoryUseCase)
    private readonly reserveInventoryUseCase: ReserveInventoryUseCase,
    @Inject(FindOneProductUseCase)
    private readonly findOneProductUseCase: FindOneProductUseCase,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
    this.paymentConfirmationTimeoutSeconds = Number(
      configService.getOrThrow<number>('PAYMENT_CONFIRMATION_SECONDS_TIMEOUT'),
    )
  }

  async execute(input: ReserveOrderCheckoutItemsInput): Promise<ReserveOrderCheckoutItemsResult> {
    const reservedItems: ReservedInventoryItem[] = []
    const actor = systemAuditMutationContext(
      input.actorId ?? 'orders-service',
      'Order reserved',
    )

    try {
      const productSnapshots: Array<{ item: ReservedInventoryItem; product: Product }> = []
      for (const item of input.cartItems) {
        const product = await this.findOneProductUseCase.execute(item.productId)

        await this.reserveInventoryUseCase.execute(item.productId, item.quantity)
        reservedItems.push({ productId: item.productId, quantity: item.quantity })
        productSnapshots.push({ item, product })
      }

      const createdAt = new Date().toISOString()
      const orderItems = productSnapshots.map(({ item, product }, index) =>
        OrderItem.create({
          orderId: input.orderId,
          lineId: `${String(index + 1).padStart(3, '0')}-${randomUUID().slice(0, 8)}`,
          productId: product.productId,
          productName: product.name,
          imageUrl: product.imageUrl,
          unitPrice: product.price,
          quantity: item.quantity,
          lineTotal: product.price * item.quantity,
          createdAt,
        }),
      )

      await this.orderRepository.createOrderItems(orderItems)

      const totalAmount = Order.computeTotal(orderItems)
      const paymentExpiresAt = toEpochSeconds(Date.now()) + this.paymentConfirmationTimeoutSeconds

      const order = await this.orderRepository.findById(input.orderId)
      if (!order) throw new NotFoundError(`Order ${input.orderId} was not found.`)

      order.reserve(totalAmount, paymentExpiresAt, createdAt)
      order.withAudit(systemAuditMutationContext(input.actorId ?? 'orders-service', 'Order reserved'))
      await this.orderRepository.save(order)

      this.logger.log(
        `>>>>>> [SUCCESS]: Order ${input.orderId} reserved successfully with ${orderItems.length} items and totalAmount=${totalAmount}.`,
      )

      return { reservationSucceeded: true }
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Failed to process order.'
      const failActor = systemAuditMutationContext(
        input.actorId ?? 'orders-service',
        failureReason,
      )

      if (reservedItems.length > 0) {
        await this.orderRepository.failWithInventoryRelease(
          input.orderId,
          failureReason,
          reservedItems,
          failActor,
        )
      } else {
        const order = await this.orderRepository.findById(input.orderId)
        if (order) {
          order.fail(failureReason, new Date().toISOString())
          order.withAudit(failActor)
          await this.orderRepository.save(order)
        }
      }

      if (error instanceof ConflictError) {
        this.logger.warn(
          `>>>>>> [FAIL]: Order ${input.orderId} failed during reservation: ${failureReason}`,
        )
        return { reservationSucceeded: false }
      }

      this.logger.error(`>>>>>> [ERROR]: Order ${input.orderId} failed during processing.`, error)
      throw error
    }
  }
}
