import { Controller, Get, HttpCode, HttpStatus, Inject, Query, Res } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { type Response } from 'express'
import { type IpnResponse } from 'vnpay'
import { Public } from '../../auth/public.decorator'
import { HandleVnpayIpnUseCase } from '../application/handle-vnpay-ipn.use-case'
import { HandleVnpayReturnUseCase } from '../application/handle-vnpay-return.use-case'
import { VnpayIpnResponseDto, VnpayReturnResponseDto } from './dto/order-response.dto'

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(HandleVnpayReturnUseCase)
    private readonly handleVnpayReturnUseCase: HandleVnpayReturnUseCase,
    @Inject(HandleVnpayIpnUseCase)
    private readonly handleVnpayIpnUseCase: HandleVnpayIpnUseCase,
  ) {}

  @Get('vnpay/return')
  @Public()
  @ApiOperation({ summary: 'Verify a VNPay return URL payload and redirect to the storefront' })
  @ApiOkResponse({ type: VnpayReturnResponseDto })
  async getVnpayReturn(
    @Query() query: Record<string, string | string[] | undefined>,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.handleVnpayReturnUseCase.execute(normalizeQueryRecord(query))
    response.redirect(result.redirectUrl)
  }

  @Get('vnpay/ipn')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle a VNPay IPN callback' })
  @ApiOkResponse({ type: VnpayIpnResponseDto })
  handleVnpayIpn(
    @Query() query: Record<string, string | string[] | undefined>,
  ): Promise<IpnResponse> {
    return this.handleVnpayIpnUseCase.execute(normalizeQueryRecord(query))
  }
}

function normalizeQueryRecord(
  query: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.entries(query).reduce<Record<string, string>>((result, [key, value]) => {
    if (typeof value === 'string') {
      result[key] = value
    } else if (Array.isArray(value) && value.length > 0) {
      result[key] = value[0] ?? ''
    }

    return result
  }, {})
}
