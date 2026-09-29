import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger'
import { type Request } from 'express'
import { CurrentUser } from '../auth/current-user.decorator'
import { AuthenticatedUser } from '../auth/auth.types'
import { Permission } from '../auth/permissions'
import { RequirePermissions } from '../auth/permissions.decorator'
import { Role } from '../auth/roles.enum'
import { Roles } from '../auth/roles.decorator'
import { ResendEmailRecipientDto } from '../mail/dto/resend-email-recipient.dto'
import { EmailDeliveryStatistics } from '../mail/mail.types'
import { EmailType } from '../mail/mail.types'
import { PaginatedResponse } from '../pagination/pagination.types'
import { DtoValidationPipe } from '../validation/dto-validation.pipe'
import { CreateOrderDto } from './dto/create-order.dto'
import { ListOrdersQueryDto } from './dto/list-orders-query.dto'
import {
  OrderDetailsResponseDto,
  OrderResponseDto,
  PaginatedOrderResponseDto,
  PlaceOrderResponseDto,
  TriggerPaymentResponseDto,
} from './dto/order-response.dto'
import { UpdateOrderStatusDto } from './dto/update-order-status.dto'
import { OrdersService } from './orders.service'
import { Order, OrderDetails, ResendOrderEmailResult } from './orders.types'

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Create an async order request from a cart' })
  @ApiAcceptedResponse({ type: PlaceOrderResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new DtoValidationPipe(CreateOrderDto)) dto: CreateOrderDto,
  ): Promise<PlaceOrderResponseDto> {
    const order = await this.ordersService.createOrderRequest(user, dto)
    return {
      orderId: order.orderId,
      status: order.status,
    }
  }

  @Get()
  @ApiOperation({ summary: 'List orders for the current user or for staff filters' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'customerEmail', required: false })
  @ApiOkResponse({ type: PaginatedOrderResponseDto })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new DtoValidationPipe(ListOrdersQueryDto)) query: ListOrdersQueryDto,
  ): Promise<PaginatedResponse<Order>> {
    const page = await this.ordersService.findAll(user, query)
    return {
      ...page,
      items: page.items.map(stripOrderMutationContext),
    }
  }

  @Get('email-statistics')
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.ORDERS_EMAIL_READ)
  @ApiOperation({ summary: 'Get order email delivery statistics' })
  @ApiOkResponse({ description: 'Returns counts by order email type and delivery status.' })
  getEmailStatistics() {
    return this.ordersService.getEmailStatistics()
  }

  @Get(':orderId/email-tracking')
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.ORDERS_EMAIL_READ)
  @ApiOperation({ summary: 'Get email tracking attempts for one order' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOkResponse({ description: 'Returns order email tracking attempts.' })
  getEmailTracking(@Param('orderId') orderId: string) {
    return this.ordersService.getEmailTracking(orderId)
  }

  @Get(':orderId')
  @ApiOperation({ summary: 'Get one order' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOkResponse({ type: OrderDetailsResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
  ): Promise<OrderDetails> {
    const order = await this.ordersService.findOne(user, orderId)
    return stripOrderMutationContext(order) as OrderDetails
  }

  @Patch(':orderId/status')
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.ORDERS_UPDATE)
  @ApiOperation({ summary: 'Update an order status' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOkResponse({ type: OrderResponseDto })
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body(new DtoValidationPipe(UpdateOrderStatusDto)) dto: UpdateOrderStatusDto,
  ): Promise<Order> {
    const order = await this.ordersService.updateOrderStatus(user, orderId, dto.status)
    return stripOrderMutationContext(order)
  }

  @Post(':orderId/emails/:emailType/resend-failed')
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.ORDERS_EMAIL_RESEND)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend retryable failed order email recipients' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiParam({
    name: 'emailType',
    enum: ['ORDER_CONFIRMATION', 'SHIPPED_ORDER_NOTIFICATION', 'CANCELLED_ORDER_NOTIFICATION'],
  })
  @ApiOkResponse({ description: 'Returns resend result for retryable recipients.' })
  resendFailedOrderEmail(
    @Param('orderId') orderId: string,
    @Param('emailType') emailType: EmailType,
    @Body(new DtoValidationPipe(ResendEmailRecipientDto)) dto: ResendEmailRecipientDto,
  ): Promise<ResendOrderEmailResult> {
    return this.ordersService.resendFailedOrderEmail(orderId, emailType, dto.recipientEmail)
  }

  @Post(':orderId/pay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a VNPay payment URL for a reserved order' })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiOkResponse({ type: TriggerPaymentResponseDto })
  async pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Req() request: Request,
  ): Promise<TriggerPaymentResponseDto> {
    return this.ordersService.triggerPayment(user, orderId, resolveClientIp(request))
  }
}

function resolveClientIp(request: Request): string {
  const forwardedFor = request.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]?.trim() ?? '127.0.0.1'
  }

  const apiGatewaySourceIp = (
    request as Request & {
      apiGateway?: { event?: { requestContext?: { http?: { sourceIp?: string } } } }
    }
  ).apiGateway?.event?.requestContext?.http?.sourceIp
  if (apiGatewaySourceIp) {
    return apiGatewaySourceIp
  }

  return request.ip || '127.0.0.1'
}

function stripOrderMutationContext<T extends Order>(order: T): T {
  const {
    lastModifiedByType: _lastModifiedByType,
    lastModifiedById: _lastModifiedById,
    lastModifiedByEmail: _lastModifiedByEmail,
    lastModifiedReason: _lastModifiedReason,
    ...publicOrder
  } = order

  return publicOrder as T
}
