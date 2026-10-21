import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { systemAuditMutationContext } from '../../audit/audit-actor'
import { ConflictError } from '../../common/domain-error'
import { InventoryService } from '../../inventory/inventory.service'
import { ReservedInventoryItem } from '../../inventory/inventory.types'
import { FindOneProductUseCase } from '../../products/application/find-one-product.use-case'
import { Product } from '../../products/domain/product.entity'
import { OrderItem } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { FailPendingOrderAndReleaseReservationUseCase } from './fail-pending-order-and-release-reservation.use-case'
import { MarkFailedUseCase } from './mark-failed.use-case'
import { MarkReservedUseCase } from './mark-reserved.use-case'

export type ReserveOrderCheckoutItemsInput = {
  orderId: string
  cartItems: ReservedInventoryItem[]
  /**
   * When provided, builds a `system` audit actor with this id for every
   * mutation this use-case performs (success and failure alike), using
   * `systemAuditMutationContext(actorId, reason)` with a reason matching
   * what each branch used to pass directly (e.g. the place-order worker).
   * When omitted, each downstream use-case falls back to its own default
   * actor (e.g. the synchronous checkout path, which never passed one).
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
 * is an inventory `ConflictError` (insufficient stock), which is an expected
 * business outcome, not an infrastructure error.
 */
@Injectable()
export class ReserveOrderCheckoutItemsUseCase {
  private readonly logger = new Logger(ReserveOrderCheckoutItemsUseCase.name)

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(InventoryService)
    private readonly inventoryService: InventoryService,
    @Inject(FindOneProductUseCase)
    private readonly findOneProductUseCase: FindOneProductUseCase,
    @Inject(MarkReservedUseCase)
    private readonly markReservedUseCase: MarkReservedUseCase,
    @Inject(MarkFailedUseCase)
    private readonly markFailedUseCase: MarkFailedUseCase,
    @Inject(FailPendingOrderAndReleaseReservationUseCase)
    private readonly failPendingOrderAndReleaseReservationUseCase: FailPendingOrderAndReleaseReservationUseCase,
  ) {}

  async execute(input: ReserveOrderCheckoutItemsInput): Promise<ReserveOrderCheckoutItemsResult> {
    const reservedItems: ReservedInventoryItem[] = []

    try {
      const productSnapshots: Array<{ item: ReservedInventoryItem; product: Product }> = []
      for (const item of input.cartItems) {
        const product = await this.findOneProductUseCase.execute(item.productId)

        await this.inventoryService.reserve(item.productId, item.quantity)
        reservedItems.push({ productId: item.productId, quantity: item.quantity })
        productSnapshots.push({ item, product })
      }

      const createdAt = new Date().toISOString()
      const orderItems: OrderItem[] = productSnapshots.map(({ item, product }, index) => ({
        orderId: input.orderId,
        lineId: `${String(index + 1).padStart(3, '0')}-${randomUUID().slice(0, 8)}`,
        productId: product.productId,
        productName: product.name,
        imageUrl: product.imageUrl,
        unitPrice: product.price,
        quantity: item.quantity,
        lineTotal: product.price * item.quantity,
        createdAt,
      }))

      await this.orderRepository.createOrderItems(orderItems)

      const totalAmount = orderItems.reduce((total, item) => total + item.lineTotal, 0)
      if (input.actorId) {
        await this.markReservedUseCase.execute(
          input.orderId,
          totalAmount,
          systemAuditMutationContext(input.actorId, 'Order reserved'),
        )
      } else {
        await this.markReservedUseCase.execute(input.orderId, totalAmount)
      }

      this.logger.log(
        `>>>>>> [SUCCESS]: Order ${input.orderId} reserved successfully with ${orderItems.length} items and totalAmount=${totalAmount}.`,
      )

      return { reservationSucceeded: true }
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Failed to process order.'

      if (reservedItems.length > 0) {
        if (input.actorId) {
          await this.failPendingOrderAndReleaseReservationUseCase.execute(
            input.orderId,
            failureReason,
            reservedItems,
            systemAuditMutationContext(input.actorId, failureReason),
          )
        } else {
          await this.failPendingOrderAndReleaseReservationUseCase.execute(
            input.orderId,
            failureReason,
            reservedItems,
          )
        }
      } else if (input.actorId) {
        await this.markFailedUseCase.execute(
          input.orderId,
          OrderStatus.FAILED,
          failureReason,
          systemAuditMutationContext(input.actorId, failureReason),
        )
      } else {
        await this.markFailedUseCase.execute(input.orderId, OrderStatus.FAILED, failureReason)
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
