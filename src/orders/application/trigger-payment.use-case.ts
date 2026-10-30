import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { buildUserAuditMutationContext, systemAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { Role } from '../../auth/roles.enum'
import { ConflictError, ForbiddenDomainError, InvalidInputError, NotFoundError } from '../../common/domain-error'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { buildInventoryReleaseTransactItems } from '../../inventory/infrastructure/inventory-transact-items'
import { Order, TriggerPaymentResult } from '../domain/order.entity'
import { ORDER_ITEM_REPOSITORY, OrderItemRepositoryPort } from '../domain/order-item.repository.port'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { PAYMENT_WINDOW_EXPIRED_REASON } from '../domain/payment-reservation.config'
import { PaymentStatus } from '../domain/payment-status.enum'
import { aggregateReservedQuantities, toEpochSeconds } from '../domain/order.rules'
import { buildOrderExpireTransactItem } from '../infrastructure/order-transact-items'
import { VnpayService } from '../infrastructure/vnpay.service'
import { buildPaymentOrderInfo } from './vnpay-order-info.util'

const VNPAY_PAYMENT_EXPIRY_SKEW_SECONDS = 5

@Injectable()
export class TriggerPaymentUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDER_ITEM_REPOSITORY)
    private readonly orderItemRepository: OrderItemRepositoryPort,
    @Inject(DynamoTablesService)
    private readonly dynamoTables: DynamoTablesService,
    @Inject(VnpayService)
    private readonly vnpayService: VnpayService,
  ) {}

  async execute(
    user: AuthenticatedUser,
    orderId: string,
    clientIp: string,
  ): Promise<TriggerPaymentResult> {
    const order = await this.orderRepository.findById(orderId)
    if (!order) throw new NotFoundError(`Order ${orderId} was not found.`)
    const isAdminOrManager = user.groups.includes(Role.ADMIN) || user.groups.includes(Role.MANAGER)

    if (!isAdminOrManager && order.customerId !== user.sub) {
      throw new ForbiddenDomainError('You do not have access to this order.')
    }
    if (order.isPaymentExpired()) {
      await this.releaseExpiredReservation(order)
      throw new ConflictError(PAYMENT_WINDOW_EXPIRED_REASON)
    }
    if (!order.canTriggerPayment()) {
      throw new InvalidInputError(`Order ${orderId} is not ready for payment.`)
    }

    const paymentAttemptId = randomUUID()
    const requestedAt = new Date()
    const requestedAtIso = requestedAt.toISOString()
    const actor = buildUserAuditMutationContext(user, 'Payment requested')
    const nowEpochSeconds = toEpochSeconds(requestedAt.getTime())
    // canTriggerPayment() guards ensure paymentExpiresAt and totalAmount are defined
    const paymentGatewayExpiresAt = order.paymentExpiresAt! - VNPAY_PAYMENT_EXPIRY_SKEW_SECONDS
    if (paymentGatewayExpiresAt <= nowEpochSeconds) {
      throw new ConflictError('Payment window is about to expire. Please place the order again.')
    }
    const paymentUrl = await this.vnpayService.buildOrderPaymentUrl({
      amount: order.totalAmount!,
      clientIp,
      createDate: requestedAt,
      expireDate: new Date(paymentGatewayExpiresAt * 1000),
      orderId,
      orderInfo: buildPaymentOrderInfo(orderId),
    })

    const updated = order.startPayment(paymentAttemptId, requestedAtIso).withAudit(actor)
    await this.orderRepository.save(updated)

    return {
      orderId,
      paymentStatus: PaymentStatus.PROCESSING,
      paymentUrl,
      paymentExpiresAt: updated.paymentExpiresAt,
    }
  }

  private async releaseExpiredReservation(order: Order): Promise<void> {
    if (!order.canExpireReservation()) return

    const items = await this.orderItemRepository.findByOrderId(order.orderId)
    if (items.length === 0) return

    const timestamp = new Date().toISOString()
    const actor = systemAuditMutationContext('trigger-payment', 'Payment expired')
    const aggregatedItems = aggregateReservedQuantities(
      items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    )
    const inventoryTransactItems = buildInventoryReleaseTransactItems(
      this.dynamoTables.inventory,
      aggregatedItems,
      timestamp,
      actor,
    )
    const orderTransactItem = buildOrderExpireTransactItem(this.dynamoTables.orders, order, actor)
    if (!orderTransactItem) return

    try {
      await this.orderRepository.executeTransaction([orderTransactItem, ...inventoryTransactItems])
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error
    }
  }
}
