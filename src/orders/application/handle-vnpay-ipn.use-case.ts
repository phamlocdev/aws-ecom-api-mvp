import { Inject, Injectable } from '@nestjs/common'
import { IpnFailChecksum, type IpnResponse, type VerifyIpnCall } from 'vnpay'
import { VnpayService } from '../infrastructure/vnpay.service'
import { VnpayReconcileService } from './vnpay-reconcile.service'

@Injectable()
export class HandleVnpayIpnUseCase {
  constructor(
    @Inject(VnpayService)
    private readonly vnpayService: VnpayService,
    @Inject(VnpayReconcileService)
    private readonly vnpayReconcileService: VnpayReconcileService,
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

    return this.vnpayReconcileService.execute(verify, 'ipn')
  }
}
