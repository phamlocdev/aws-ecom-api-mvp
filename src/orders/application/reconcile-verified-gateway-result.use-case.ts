import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  InpOrderAlreadyConfirmed,
  IpnOrderNotFound,
  IpnInvalidAmount,
  IpnSuccess,
  IpnUnknownError,
  type IpnResponse,
  type VerifyIpnCall,
} from 'vnpay'
import { systemAuditMutationContext } from '../../audit/audit-actor'
import { ConflictError, NotFoundError } from '../../common/domain-error'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { SesMailService } from '../../mail/ses-mail.service'
import { Order } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { PaymentStatus } from '../domain/payment-status.enum'
import { VnpayService } from '../infrastructure/vnpay.service'
import { buildAutoRefundReason, buildPaymentOrderInfo } from './vnpay-order-info.util'
import { FindOrderItemsUseCase } from './find-order-items.use-case'
import { GetOrderByIdUseCase } from './get-order-by-id.use-case'
import { MarkExpiredPaymentRefundedUseCase } from './mark-expired-payment-refunded.use-case'
import { MarkPaymentFailedUseCase } from './mark-payment-failed.use-case'
import { MarkPaymentSucceededUseCase } from './mark-payment-succeeded.use-case'
import { ReleaseExpiredOrderReservationUseCase } from './release-expired-order-reservation.use-case'

const AUTO_REFUND_CREATE_BY = 'system-auto-refund'
const AUTO_REFUND_REASON =
  'Payment arrived after reservation expiry. Amount refunded automatically.'
const ORDER_CONFIRMATION_EMAIL_SENT = 'SENT'
const ORDER_CONFIRMATION_EMAIL_SKIPPED = 'SKIPPED'

export type GatewayReconcileSource = 'ipn' | 'return'

@Injectable()
export class ReconcileVerifiedGatewayResultUseCase {
  private readonly logger = new Logger(ReconcileVerifiedGatewayResultUseCase.name)

  constructor(
    @Inject(GetOrderByIdUseCase)
    private readonly getOrderByIdUseCase: GetOrderByIdUseCase,
    @Inject(FindOrderItemsUseCase)
    private readonly findOrderItemsUseCase: FindOrderItemsUseCase,
    @Inject(MarkPaymentSucceededUseCase)
    private readonly markPaymentSucceededUseCase: MarkPaymentSucceededUseCase,
    @Inject(MarkPaymentFailedUseCase)
    private readonly markPaymentFailedUseCase: MarkPaymentFailedUseCase,
    @Inject(MarkExpiredPaymentRefundedUseCase)
    private readonly markExpiredPaymentRefundedUseCase: MarkExpiredPaymentRefundedUseCase,
    @Inject(ReleaseExpiredOrderReservationUseCase)
    private readonly releaseExpiredOrderReservationUseCase: ReleaseExpiredOrderReservationUseCase,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
    @Inject(SesMailService)
    private readonly sesMailService: SesMailService,
    @Inject(VnpayService)
    private readonly vnpayService: VnpayService,
  ) {}

  async execute(verify: VerifyIpnCall, source: GatewayReconcileSource): Promise<IpnResponse> {
    const orderId = verify.vnp_TxnRef
    const transactionId = String(verify.vnp_TransactionNo ?? '')
    const transactionAmount = Number(verify.vnp_Amount)

    let order: Order
    try {
      order = await this.getOrderByIdUseCase.execute(orderId)
    } catch (error) {
      if (error instanceof NotFoundError) {
        return IpnOrderNotFound
      }
      throw error
    }

    if (order.totalAmount === undefined || transactionAmount !== order.totalAmount) {
      return IpnInvalidAmount
    }

    if (order.status === OrderStatus.CONFIRMED || order.paymentStatus === PaymentStatus.PAID) {
      await this.sendOrderConfirmationEmailBestEffort(order)
      return InpOrderAlreadyConfirmed
    }

    if (
      order.status === OrderStatus.EXPIRED &&
      order.paymentStatus === PaymentStatus.FAILED &&
      order.paymentTransactionId === transactionId &&
      order.paymentFailureReason?.startsWith(AUTO_REFUND_REASON)
    ) {
      return IpnSuccess
    }

    if (!verify.isSuccess) {
      return this.handleFailedIpn(order, verify.message, source)
    }

    if (order.isPaymentExpired()) {
      await this.releaseExpiredOrderReservationUseCase.execute(order)
      const latestOrder = await this.getOrderByIdUseCase.execute(orderId)
      const latePaymentResult = await this.handleLatePaymentSuccess(latestOrder, verify, source)
      if (source === 'ipn') {
        this.vnpayService.logIpnResponse(orderId, latePaymentResult)
      }
      return latePaymentResult
    }

    if (order.status !== OrderStatus.RESERVED || order.paymentStatus !== PaymentStatus.PROCESSING) {
      return InpOrderAlreadyConfirmed
    }

    if (!order.paymentAttemptId) {
      this.logger.error(`Order ${orderId} is missing paymentAttemptId while processing VNPay IPN.`)
      return IpnUnknownError
    }

    try {
      await this.markPaymentSucceededUseCase.execute(
        orderId,
        order.paymentAttemptId,
        transactionId,
        systemAuditMutationContext(
          source === 'ipn' ? 'payment-ipn' : 'payment-return',
          'Payment confirmed',
        ),
      )
      await this.sendOrderConfirmationEmailBestEffortByOrderId(orderId)
      this.logger.log(`VNPay ${source} confirmed payment for order ${orderId}.`)
      return IpnSuccess
    } catch (error) {
      if (error instanceof ConflictError) {
        const latestOrder = await this.getOrderByIdUseCase.execute(orderId)
        if (
          latestOrder.status === OrderStatus.CONFIRMED ||
          latestOrder.paymentStatus === PaymentStatus.PAID
        ) {
          await this.sendOrderConfirmationEmailBestEffort(latestOrder)
          return InpOrderAlreadyConfirmed
        }
        if (latestOrder.isPaymentExpired() || latestOrder.status === OrderStatus.EXPIRED) {
          return this.handleLatePaymentSuccess(latestOrder, verify, source)
        }
      }
      throw error
    }
  }

  private async handleFailedIpn(
    order: Order,
    failureReason: string,
    source: GatewayReconcileSource,
  ): Promise<IpnResponse> {
    if (order.status !== OrderStatus.RESERVED || order.paymentStatus !== PaymentStatus.PROCESSING) {
      return IpnSuccess
    }

    if (!order.paymentAttemptId) {
      this.logger.error(
        `Order ${order.orderId} is missing paymentAttemptId while failing VNPay payment.`,
      )
      return IpnUnknownError
    }

    try {
      await this.markPaymentFailedUseCase.execute(
        order.orderId,
        order.paymentAttemptId,
        failureReason,
        systemAuditMutationContext(
          source === 'ipn' ? 'payment-ipn' : 'payment-return',
          failureReason,
        ),
      )
      return IpnSuccess
    } catch (error) {
      if (error instanceof ConflictError) {
        return IpnSuccess
      }
      throw error
    }
  }

  private async handleLatePaymentSuccess(
    order: Order,
    verify: VerifyIpnCall,
    source: GatewayReconcileSource,
  ): Promise<IpnResponse> {
    const paymentRequestedAt = order.paymentRequestedAt
    const transactionNo = Number(verify.vnp_TransactionNo)

    if (!paymentRequestedAt || !Number.isFinite(transactionNo)) {
      this.logger.error(
        `Cannot auto-refund late VNPay payment for order ${order.orderId}: missing paymentRequestedAt or transactionNo.`,
      )
      return IpnUnknownError
    }

    const transactionDate = new Date(paymentRequestedAt)
    const orderInfo = buildPaymentOrderInfo(order.orderId)

    try {
      const queryResult = await this.vnpayService.queryOrderPayment({
        clientIp: this.vnpayService.getApiIpAddress(),
        createDate: transactionDate,
        orderId: order.orderId,
        orderInfo,
        transactionDate,
        transactionNo,
      })

      if (!queryResult.isVerified || !queryResult.isSuccess) {
        this.logger.error(
          `VNPay queryDr verification failed for expired order ${order.orderId}: ${queryResult.message}`,
        )
        return IpnUnknownError
      }

      const refundResult = await this.vnpayService.refundOrderPayment({
        amount: order.totalAmount ?? Number(verify.vnp_Amount),
        clientIp: this.vnpayService.getApiIpAddress(),
        createBy: AUTO_REFUND_CREATE_BY,
        createDate: transactionDate,
        orderId: order.orderId,
        orderInfo,
        refundReason: buildAutoRefundReason(order.orderId),
        transactionDate,
        transactionNo: Number(queryResult.vnp_TransactionNo ?? transactionNo),
      })

      if (!refundResult.isVerified || !refundResult.isSuccess) {
        this.logger.error(
          `VNPay refund failed for expired order ${order.orderId}: ${refundResult.message}`,
        )
        return IpnUnknownError
      }

      const autoRefundReason = `${AUTO_REFUND_REASON} Refund reference: ${refundResult.vnp_ResponseId}.`
      await this.markExpiredPaymentRefundedUseCase.execute(
        order.orderId,
        String(verify.vnp_TransactionNo),
        autoRefundReason,
        systemAuditMutationContext(
          source === 'ipn' ? 'payment-ipn' : 'payment-return',
          autoRefundReason,
        ),
      )
      return IpnSuccess
    } catch (error) {
      this.logger.error(
        `Failed to auto-refund late VNPay payment for order ${order.orderId}.`,
        error,
      )
      return IpnUnknownError
    }
  }

  private async sendOrderConfirmationEmailBestEffortByOrderId(orderId: string): Promise<void> {
    const order = await this.getOrderByIdUseCase.execute(orderId)
    await this.sendOrderConfirmationEmailBestEffort(order)
  }

  private async sendOrderConfirmationEmailBestEffort(order: Order): Promise<void> {
    if (order.status !== OrderStatus.CONFIRMED || order.paymentStatus !== PaymentStatus.PAID) {
      return
    }

    const hasActiveTracking = await this.emailTrackingService.hasActiveOrderConfirmationTracking(
      order.orderId,
    )
    if (hasActiveTracking) {
      return
    }

    try {
      const items = await this.findOrderItemsUseCase.execute(order.orderId)
      const result = await this.sesMailService.sendOrderConfirmationEmail({ order, items })

      if (result.status === ORDER_CONFIRMATION_EMAIL_SKIPPED) {
        this.logger.warn(
          `Skipped order confirmation email for order ${order.orderId}: ${result.reason ?? 'unknown-reason'}.`,
        )
      }

      if (result.status === ORDER_CONFIRMATION_EMAIL_SENT) {
        this.logger.log(`Order confirmation email sent for order ${order.orderId}.`)
      }
    } catch (error) {
      this.logger.error(
        `Unexpected failure while processing order confirmation email for ${order.orderId}.`,
        error,
      )
    }
  }
}
