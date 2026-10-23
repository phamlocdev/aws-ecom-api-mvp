import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { Role } from '../../auth/roles.enum'
import { ConflictError, ForbiddenDomainError, InvalidInputError } from '../../common/domain-error'
import { TriggerPaymentResult } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { PAYMENT_WINDOW_EXPIRED_REASON } from '../domain/payment-reservation.config'
import { PaymentStatus } from '../domain/payment-status.enum'
import { toEpochSeconds } from '../domain/order.rules'
import { VnpayService } from '../infrastructure/vnpay.service'
import { buildPaymentOrderInfo } from './vnpay-order-info.util'
import { GetOrderByIdUseCase } from './get-order-by-id.use-case'
import { ReleaseExpiredOrderReservationUseCase } from './release-expired-order-reservation.use-case'

const VNPAY_PAYMENT_EXPIRY_SKEW_SECONDS = 5

@Injectable()
export class TriggerPaymentUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(GetOrderByIdUseCase)
    private readonly getOrderByIdUseCase: GetOrderByIdUseCase,
    @Inject(ReleaseExpiredOrderReservationUseCase)
    private readonly releaseExpiredOrderReservationUseCase: ReleaseExpiredOrderReservationUseCase,
    @Inject(VnpayService)
    private readonly vnpayService: VnpayService,
  ) {}

  async execute(
    user: AuthenticatedUser,
    orderId: string,
    clientIp: string,
  ): Promise<TriggerPaymentResult> {
    const order = await this.getOrderByIdUseCase.execute(orderId)
    const isAdminOrManager = user.groups.includes(Role.ADMIN) || user.groups.includes(Role.MANAGER)

    if (!isAdminOrManager && order.customerId !== user.sub) {
      throw new ForbiddenDomainError('You do not have access to this order.')
    }
    if (order.status !== OrderStatus.RESERVED) {
      throw new InvalidInputError(`Order ${orderId} is not ready for payment.`)
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new InvalidInputError(`Order ${orderId} is already paid.`)
    }
    if (order.totalAmount === undefined) {
      throw new InvalidInputError(`Order ${orderId} does not have a payable amount.`)
    }
    if (order.isPaymentExpired()) {
      await this.releaseExpiredOrderReservationUseCase.execute(order)
      throw new ConflictError(PAYMENT_WINDOW_EXPIRED_REASON)
    }
    if (!order.paymentExpiresAt) {
      throw new InvalidInputError(`Order ${orderId} does not have a payment deadline.`)
    }

    const paymentAttemptId = randomUUID()
    const requestedAt = new Date()
    const requestedAtIso = requestedAt.toISOString()
    const actor = buildUserAuditMutationContext(user, 'Payment requested')
    const nowEpochSeconds = toEpochSeconds(requestedAt.getTime())
    const paymentGatewayExpiresAt = order.paymentExpiresAt - VNPAY_PAYMENT_EXPIRY_SKEW_SECONDS
    if (paymentGatewayExpiresAt <= nowEpochSeconds) {
      throw new ConflictError('Payment window is about to expire. Please place the order again.')
    }
    const paymentUrl = await this.vnpayService.buildOrderPaymentUrl({
      amount: order.totalAmount,
      clientIp,
      createDate: requestedAt,
      expireDate: new Date(paymentGatewayExpiresAt * 1000),
      orderId,
      orderInfo: buildPaymentOrderInfo(orderId),
    })

    try {
      await this.orderRepository.startPayment(
        orderId,
        paymentAttemptId,
        requestedAtIso,
        nowEpochSeconds,
        actor,
      )
    } catch (error) {
      if (error instanceof ConflictError) {
        const latestOrder = await this.getOrderByIdUseCase.execute(orderId)
        if (latestOrder.isPaymentExpired()) {
          await this.releaseExpiredOrderReservationUseCase.execute(latestOrder)
          throw new ConflictError(PAYMENT_WINDOW_EXPIRED_REASON)
        }
        throw new ConflictError(`Order ${orderId} cannot start payment in its current state.`)
      }
      throw error
    }

    return {
      orderId,
      paymentStatus: PaymentStatus.PROCESSING,
      paymentUrl,
      paymentExpiresAt: order.paymentExpiresAt,
    }
  }
}
