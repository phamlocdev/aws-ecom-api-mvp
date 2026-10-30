import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { ConfigService } from '@nestjs/config'
import { systemAuditMutationContext } from '../../audit/audit-actor'
import { ConflictError, NotFoundError } from '../../common/domain-error'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { INVENTORY_REPOSITORY, InventoryRepositoryPort } from '../../inventory/domain/inventory.repository.port'
import { ReservedInventoryItem } from '../../inventory/domain/inventory.entity'
import { buildInventoryReleaseTransactItems } from '../../inventory/infrastructure/inventory-transact-items'
import { PRODUCT_REPOSITORY, ProductRepositoryPort } from '../../products/domain/product.repository.port'
import { Product } from '../../products/domain/product.entity'
import { Order, OrderItem } from '../domain/order.entity'
import { ORDER_ITEM_REPOSITORY, OrderItemRepositoryPort } from '../domain/order-item.repository.port'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { aggregateReservedQuantities, toEpochSeconds } from '../domain/order.rules'
import { buildOrderFailTransactItem } from '../infrastructure/order-transact-items'

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
 * Shared reservation flow used by the async SQS place-order worker
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
    @Inject(ORDER_ITEM_REPOSITORY)
    private readonly orderItemRepository: OrderItemRepositoryPort,
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: ProductRepositoryPort,
    @Inject(DynamoTablesService)
    private readonly dynamoTables: DynamoTablesService,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
    this.paymentConfirmationTimeoutSeconds = Number(
      configService.getOrThrow<number>('PAYMENT_CONFIRMATION_SECONDS_TIMEOUT'),
    )
  }

  async execute(input: ReserveOrderCheckoutItemsInput): Promise<ReserveOrderCheckoutItemsResult> {
    const reservedItems: ReservedInventoryItem[] = []
    const actor = systemAuditMutationContext(input.actorId ?? 'orders-service', 'Order reserved')

    try {
      const productSnapshots: Array<{ item: ReservedInventoryItem; product: Product }> = []
      for (const item of input.cartItems) {
        const product = await this.productRepository.findOne(item.productId)
        if (!product) throw new NotFoundError(`Product ${item.productId} was not found.`)

        await this.inventoryRepository.reserve(item.productId, item.quantity, actor)
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

      await this.orderItemRepository.createMany(orderItems)

      const totalAmount = Order.computeTotal(orderItems)
      const paymentExpiresAt = toEpochSeconds(Date.now()) + this.paymentConfirmationTimeoutSeconds

      const order = await this.orderRepository.findById(input.orderId)
      if (!order) throw new NotFoundError(`Order ${input.orderId} was not found.`)

      const reserved = order.reserve(totalAmount, paymentExpiresAt, createdAt).withAudit(
        systemAuditMutationContext(input.actorId ?? 'orders-service', 'Order reserved'),
      )
      await this.orderRepository.save(reserved)

      this.logger.log(
        `>>>>>> [SUCCESS]: Order ${input.orderId} reserved successfully with ${orderItems.length} items and totalAmount=${totalAmount}.`,
      )

      return { reservationSucceeded: true }
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Failed to process order.'
      const failActor = systemAuditMutationContext(input.actorId ?? 'orders-service', failureReason)

      if (reservedItems.length > 0) {
        const aggregatedItems = aggregateReservedQuantities(reservedItems)
        const failTimestamp = new Date().toISOString()
        const inventoryTransactItems = buildInventoryReleaseTransactItems(
          this.dynamoTables.inventory,
          aggregatedItems,
          failTimestamp,
          failActor,
        )
        const orderTransactItem = buildOrderFailTransactItem(
          this.dynamoTables.orders,
          input.orderId,
          failureReason,
          failActor,
        )
        await this.orderRepository.executeTransaction([orderTransactItem, ...inventoryTransactItems])
      } else {
        const order = await this.orderRepository.findById(input.orderId)
        if (order) {
          const failed = order.fail(failureReason, new Date().toISOString()).withAudit(failActor)
          await this.orderRepository.save(failed)
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
