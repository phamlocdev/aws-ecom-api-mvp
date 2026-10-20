import { Inject, Injectable } from '@nestjs/common'
import { IpnFailChecksum, type IpnResponse, type VerifyIpnCall } from 'vnpay'
import { VnpayService } from '../infrastructure/vnpay.service'
import { ReconcileVerifiedGatewayResultUseCase } from './reconcile-verified-gateway-result.use-case'

@Injectable()
export class HandleVnpayIpnUseCase {
  constructor(
    @Inject(VnpayService)
    private readonly vnpayService: VnpayService,
    @Inject(ReconcileVerifiedGatewayResultUseCase)
    private readonly reconcileVerifiedGatewayResultUseCase: ReconcileVerifiedGatewayResultUseCase,
  ) {}

  async execute(query: Record<string, string>): Promise<IpnResponse> {
    let verify: VerifyIpnCall

    try {
      verify = await this.vnpayService.verifyIpnQuery(query)
    } catch {
      return IpnFailChecksum
    }

    if (!verify.isVerified) {
      return IpnFailChecksum
    }

    return this.reconcileVerifiedGatewayResultUseCase.execute(verify, 'ipn')
  }
}
