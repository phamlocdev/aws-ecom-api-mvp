import { Inject, Injectable, Logger } from '@nestjs/common'
import { VnpayReturnResult } from '../domain/order.entity'
import { VnpayService } from '../infrastructure/vnpay.service'
import { VnpayReconcileService } from './vnpay-reconcile.service'

@Injectable()
export class HandleVnpayReturnUseCase {
  private readonly logger = new Logger(HandleVnpayReturnUseCase.name)

  constructor(
    @Inject(VnpayService)
    private readonly vnpayService: VnpayService,
    @Inject(VnpayReconcileService)
    private readonly vnpayReconcileService: VnpayReconcileService,
  ) {}

  async execute(query: Record<string, string>): Promise<VnpayReturnResult> {
    try {
      const verify = await this.vnpayService.verifyReturnQuery(query)
      if (verify.isVerified) {
        try {
          await this.vnpayReconcileService.execute(verify, 'return')
        } catch (error) {
          this.logger.error(
            `Failed to reconcile VNPay return for order ${verify.vnp_TxnRef}.`,
            error,
          )
        }
      }

      return {
        redirectUrl: this.vnpayService.buildFrontendPaymentReturnUrl(query, {
          isVerified: verify.isVerified,
          message: verify.message,
        }),
      }
    } catch {
      return {
        redirectUrl: this.vnpayService.buildFrontendPaymentReturnUrl(query, {
          isVerified: false,
          message: 'Invalid VNPay return payload.',
        }),
      }
    }
  }
}
