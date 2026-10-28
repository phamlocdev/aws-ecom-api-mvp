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
import { ConflictError } from '../../common/domain-error'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { SesMailService } from '../../mail/ses-mail.service'
import { Order } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { PaymentStatus } from '../domain/payment-status.enum'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { VnpayService } from '../infrastructure/vnpay.service'
import { buildAutoRefundReason, buildPaymentOrderInfo } from './vnpay-order-info.util'
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
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
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

    const found = await this.orderRepository.findById(orderId)
    if (!found) return IpnOrderNotFound
    let order: Order = found

    if (order.totalAmount === undefined || transactionAmount !== order.totalAmount) {
      return IpnInvalidAmount
    }

    if (order.status === OrderStatus.CONFIRMED || order.isPaid) {
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
      const latestFound = await this.orderRepository.findById(orderId)
      const latestOrder = latestFound ?? order
      const latePaymentResult = await this.handleLatePaymentSuccess(latestOrder, verify, source)
      if (source === 'ipn') {
        this.vnpayService.logIpnResponse(orderId, latePaymentResult)
      }
      return latePaymentResult
    }

    if (!order.isReadyToProcessPayment()) {
      return InpOrderAlreadyConfirmed
    }

    if (!order.paymentAttemptId) {
      this.logger.error(`Order ${orderId} is missing paymentAttemptId while processing VNPay IPN.`)
      return IpnUnknownError
    }

    const actor = systemAuditMutationContext(
      source === 'ipn' ? 'payment-ipn' : 'payment-return',
      'Payment confirmed',
    )

    try {
      const paidAt = new Date().toISOString()
      order.confirmPayment(order.paymentAttemptId, transactionId, paidAt)
      order.withAudit(actor)
      await this.orderRepository.save(order)
      await this.sendOrderConfirmationEmailBestEffortByOrderId(orderId)
      this.logger.log(`VNPay ${source} confirmed payment for order ${orderId}.`)
      return IpnSuccess
    } catch (error) {
      if (error instanceof ConflictError) {
        const latestOrder = (await this.orderRepository.findById(orderId)) ?? order
        if (latestOrder.status === OrderStatus.CONFIRMED || latestOrder.isPaid) {
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
    if (!order.isReadyToProcessPayment()) {
      return IpnSuccess
    }

    if (!order.paymentAttemptId) {
      this.logger.error(
        `Order ${order.orderId} is missing paymentAttemptId while failing VNPay payment.`,
      )
      return IpnUnknownError
    }

    const actor = systemAuditMutationContext(
      source === 'ipn' ? 'payment-ipn' : 'payment-return',
      failureReason,
    )

    try {
      order.failPayment(order.paymentAttemptId, failureReason)
      order.withAudit(actor)
      await this.orderRepository.save(order)
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
      const actor = systemAuditMutationContext(
        source === 'ipn' ? 'payment-ipn' : 'payment-return',
        autoRefundReason,
      )
      order.refundExpiredPayment(String(verify.vnp_TransactionNo), autoRefundReason)
      order.withAudit(actor)
      await this.orderRepository.save(order)
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
    const order = await this.orderRepository.findById(orderId)
    if (order) await this.sendOrderConfirmationEmailBestEffort(order)
  }

  private async sendOrderConfirmationEmailBestEffort(order: Order): Promise<void> {
    if (order.status !== OrderStatus.CONFIRMED || !order.isPaid) {
      return
    }

    const hasActiveTracking = await this.emailTrackingService.hasActiveOrderConfirmationTracking(
      order.orderId,
    )
    if (hasActiveTracking) {
      return
    }

    try {
      const items = await this.orderRepository.findOrderItems(order.orderId)
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
