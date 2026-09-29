import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'
import { AuthenticatedUser } from '../auth/auth.types'
import { Role } from '../auth/roles.enum'
import { CartsService } from '../carts/carts.service'
import { CartStatus } from '../carts/cart-status.enum'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { InventoryService } from '../inventory/inventory.service'
import { ReservedInventoryItem } from '../inventory/inventory.types'
import { EmailTrackingService } from '../mail/email-tracking.service'
import { SesMailService } from '../mail/ses-mail.service'
import { EmailDeliveryStatistics, EmailTrackingView, EmailType } from '../mail/mail.types'
import { resolvePaginationState, toPaginatedResponse } from '../pagination/pagination.util'
import { PaginatedResponse } from '../pagination/pagination.types'
import { Product } from '../products/product.types'
import { ProductsService } from '../products/products.service'
import { UsersService } from '../users/users.service'
import { OrdersQueueService } from './orders.queue'
import { CreateOrderDto } from './dto/create-order.dto'
import { ListOrdersQueryDto } from './dto/list-orders-query.dto'
import { OrderEventsPublisher } from './order-events.publisher'
import { OrderStatus } from './order-status.enum'
import { PAYMENT_WINDOW_EXPIRED_REASON } from './payment-reservation.config'
import { PaymentStatus } from './payment-status.enum'
import {
  Order,
  OrderDetails,
  OrderItem,
  OrderMutationContext,
  ResendOrderEmailResult,
  TriggerPaymentResult,
  VnpayReturnResult,
} from './orders.types'
import { VnpayService } from './vnpay.service'
import {
  InpOrderAlreadyConfirmed,
  IpnFailChecksum,
  IpnInvalidAmount,
  IpnOrderNotFound,
  IpnSuccess,
  IpnUnknownError,
  type IpnResponse,
  type VerifyIpnCall,
} from 'vnpay'

const ORDERS_ENTITY_TYPE = 'ORDER'
const VNPAY_PAYMENT_EXPIRY_SKEW_SECONDS = 5
const AUTO_REFUND_CREATE_BY = 'system-auto-refund'
const AUTO_REFUND_REASON =
  'Payment arrived after reservation expiry. Amount refunded automatically.'
const ORDER_CONFIRMATION_EMAIL_SENT = 'SENT'
const ORDER_CONFIRMATION_EMAIL_SKIPPED = 'SKIPPED'
const ORDER_EMAIL_TYPES: EmailType[] = [
  'ORDER_CONFIRMATION',
  'SHIPPED_ORDER_NOTIFICATION',
  'CANCELLED_ORDER_NOTIFICATION',
]
const ORDER_AUDIT_ACTOR_FIELDS =
  '#lastModifiedByType = :lastModifiedByType, #lastModifiedById = :lastModifiedById, #lastModifiedByEmail = :lastModifiedByEmail, #lastModifiedReason = :lastModifiedReason'
const ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES = {
  '#lastModifiedByType': 'lastModifiedByType',
  '#lastModifiedById': 'lastModifiedById',
  '#lastModifiedByEmail': 'lastModifiedByEmail',
  '#lastModifiedReason': 'lastModifiedReason',
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name)
  private readonly ordersTableName: string
  private readonly orderItemsTableName: string
  private readonly inventoryTableName: string
  private readonly paymentConfirmationTimeoutSeconds: number

  constructor(
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(CartsService)
    private readonly cartsService: CartsService,
    @Inject(InventoryService)
    private readonly inventoryService: InventoryService,
    @Inject(ProductsService)
    private readonly productsService: ProductsService,
    @Inject(UsersService)
    private readonly usersService: UsersService,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
    @Inject(SesMailService)
    private readonly sesMailService: SesMailService,
    @Inject(OrdersQueueService)
    private readonly ordersQueueService: OrdersQueueService,
    @Inject(OrderEventsPublisher)
    private readonly orderEventsPublisher: OrderEventsPublisher,
    @Inject(VnpayService)
    private readonly vnpayService: VnpayService,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
    this.ordersTableName = configService.get<string>('ORDERS_TABLE') ?? 'orders'
    this.orderItemsTableName = configService.get<string>('ORDER_ITEMS_TABLE') ?? 'order-items'
    this.inventoryTableName = configService.get<string>('INVENTORY_TABLE') ?? 'inventory'
    this.paymentConfirmationTimeoutSeconds = Number(
      configService.getOrThrow<number>('PAYMENT_CONFIRMATION_SECONDS_TIMEOUT'),
    )
  }

  async createOrderRequest(user: AuthenticatedUser, dto: CreateOrderDto): Promise<Order> {
    const cart = await this.cartsService.getOwnedCartOrThrow(user.sub, dto.cartId)
    if (cart.status === CartStatus.EXPIRED || cart.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException(`Cart ${dto.cartId} has expired.`)
    }

    const profile =
      user.name && user.email
        ? { username: user.username, name: user.name, email: user.email, sub: user.sub }
        : await this.usersService.findCustomerProfileByUsername(user.username)

    const timestamp = new Date().toISOString()
    const createActor = buildUserOrderMutationContext(user, 'Order created')
    const order: Order = {
      orderId: randomUUID(),
      customerId: user.sub,
      customerEmail: user.email ?? profile.email,
      customerName: user.name ?? profile.name,
      additionalReceivingEmails: normalizeAdditionalReceivingEmails(dto.additionalReceivingEmails),
      cartId: dto.cartId,
      status: OrderStatus.PENDING,
      entityType: ORDERS_ENTITY_TYPE,
      deduplicationKey: randomUUID(),
      paymentStatus: PaymentStatus.NOT_STARTED,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...toOrderMutationAttributes(createActor),
    }

    await this.dynamoDbService.documentClient.send(
      new PutCommand({
        TableName: this.ordersTableName,
        Item: order,
        ConditionExpression: 'attribute_not_exists(#orderId)',
        ExpressionAttributeNames: { '#orderId': 'orderId' },
      }),
    )

    this.logger.log(
      `>>>>>> [START]: Processing order ${order.orderId} for cart ${order.cartId} and customer ${order.customerId}.`,
    )

    const cartItems = await this.cartsService.getCartItems(cart.cartId)
    if (cartItems.length === 0) {
      this.logger.warn(
        `>>>>>> [WARN]: Order ${order.orderId} failed because cart ${cart.cartId} has no items.`,
      )
      await this.markFailed(order.orderId, OrderStatus.FAILED, 'Cart has no items.')
      return this.getById(order.orderId)
    }

    const reservedItems: ReservedInventoryItem[] = []
    let reservationSucceeded = false

    try {
      const productSnapshots: Array<{ item: (typeof cartItems)[number]; product: Product }> = []
      for (const item of cartItems) {
        const product = await this.productsService.findOne(item.productId)

        await this.inventoryService.reserve(item.productId, item.quantity)
        reservedItems.push({ productId: item.productId, quantity: item.quantity })
        productSnapshots.push({ item, product })
      }

      const createdAt = new Date().toISOString()
      const orderItems: OrderItem[] = productSnapshots.map(({ item, product }, index) => ({
        orderId: order.orderId,
        lineId: `${String(index + 1).padStart(3, '0')}-${randomUUID().slice(0, 8)}`,
        productId: product.productId,
        productName: product.name,
        imageUrl: product.imageUrl,
        unitPrice: product.price,
        quantity: item.quantity,
        lineTotal: product.price * item.quantity,
        createdAt,
      }))

      for (const orderItem of orderItems) {
        await this.dynamoDbService.documentClient.send(
          new PutCommand({
            TableName: this.orderItemsTableName,
            Item: orderItem,
          }),
        )
      }

      const totalAmount = orderItems.reduce((total, item) => total + item.lineTotal, 0)
      await this.markReserved(order.orderId, totalAmount)
      reservationSucceeded = true
      this.logger.log(
        `>>>>>> [SUCCESS]: Order ${order.orderId} reserved successfully with ${orderItems.length} items and totalAmount=${totalAmount}.`,
      )
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Failed to process order.'

      if (reservedItems.length > 0) {
        await this.failPendingOrderAndReleaseReservation(
          order.orderId,
          failureReason,
          reservedItems,
        )
      } else {
        await this.markFailed(order.orderId, OrderStatus.FAILED, failureReason)
      }

      if (error instanceof ConflictException) {
        this.logger.warn(
          `>>>>>> [FAIL]: Order ${order.orderId} failed during reservation: ${failureReason}`,
        )
      } else {
        this.logger.error(`>>>>>> [ERROR]: Order ${order.orderId} failed during processing.`, error)
      }

      if (!(error instanceof ConflictException)) {
        throw error
      }
    }

    if (reservationSucceeded) {
      await this.cartsService.markExpired(cart)
    }

    return this.getById(order.orderId)
  }

  async findAll(
    user: AuthenticatedUser,
    query: ListOrdersQueryDto,
  ): Promise<PaginatedResponse<Order>> {
    const isAdminOrManager = user.groups.includes(Role.ADMIN) || user.groups.includes(Role.MANAGER)

    const scope = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.customerEmail ? { customerEmail: query.customerEmail } : {}),
      ...(isAdminOrManager ? { role: 'staff' } : { role: 'customer' }),
    }
    const pagination = resolvePaginationState('orders', query, scope)

    const queryInput = isAdminOrManager
      ? buildStaffOrderQuery(query, pagination.startKey ?? undefined)
      : buildCustomerOrderQuery(user.sub, pagination.startKey ?? undefined)

    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.ordersTableName,
        Limit: pagination.limit,
        ScanIndexForward: false,
        ...queryInput,
      }),
    )

    return toPaginatedResponse(
      'orders',
      pagination,
      (response.Items ?? []) as Order[],
      response.LastEvaluatedKey,
    )
  }

  async findOne(user: AuthenticatedUser, orderId: string): Promise<OrderDetails> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.ordersTableName,
        Key: { orderId },
      }),
    )

    if (!response.Item) {
      throw new NotFoundException(`Order ${orderId} was not found.`)
    }

    const order = response.Item as Order
    const isAdminOrManager = user.groups.includes(Role.ADMIN) || user.groups.includes(Role.MANAGER)
    if (!isAdminOrManager && order.customerId !== user.sub) {
      throw new ForbiddenException('You do not have access to this order.')
    }

    const items = await this.findOrderItems(order.orderId)
    return {
      ...order,
      items,
    }
  }

  async getById(orderId: string): Promise<Order> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.ordersTableName,
        Key: { orderId },
      }),
    )

    if (!response.Item) {
      throw new NotFoundException(`Order ${orderId} was not found.`)
    }

    return response.Item as Order
  }

  async getEmailStatistics(): Promise<EmailDeliveryStatistics> {
    return this.emailTrackingService.getStatistics(ORDER_EMAIL_TYPES)
  }

  async getEmailTracking(orderId: string): Promise<EmailTrackingView[]> {
    await this.getById(orderId)
    return this.emailTrackingService.findByContext('ORDER', orderId, ORDER_EMAIL_TYPES)
  }

  async resendFailedOrderEmail(
    orderId: string,
    emailType: EmailType,
    recipientEmail: string,
  ): Promise<ResendOrderEmailResult> {
    if (
      emailType !== 'ORDER_CONFIRMATION' &&
      emailType !== 'SHIPPED_ORDER_NOTIFICATION' &&
      emailType !== 'CANCELLED_ORDER_NOTIFICATION'
    ) {
      throw new BadRequestException(`Email type ${emailType} is not supported for order resend.`)
    }

    const order = await this.getById(orderId)
    const normalizedRecipientEmail = normalizeEmail(recipientEmail)
    if (!normalizedRecipientEmail) {
      throw new BadRequestException('recipientEmail is required.')
    }

    const retryableItem = await this.emailTrackingService.findLatestRetryableForRecipient({
      contextType: 'ORDER',
      contextId: orderId,
      emailType,
      recipientEmail: normalizedRecipientEmail,
    })

    if (!retryableItem) {
      return {
        orderId,
        emailType,
        recipientEmails: [],
        resentCount: 0,
        status: 'SKIPPED',
        reason: 'no-retryable-recipients',
      }
    }

    const items = await this.findOrderItems(orderId)
    const recipientEmails = [normalizedRecipientEmail]
    const result = await this.resendOrderEmailByType({
      order,
      items,
      emailType,
      recipientEmails,
      resendOfEmailId: retryableItem.emailId,
    })

    return {
      orderId,
      emailType,
      recipientEmails,
      resentCount: recipientEmails.length,
      status: result.status,
      reason: result.reason,
    }
  }

  private async resendOrderEmailByType(input: {
    order: Order
    items: OrderItem[]
    emailType: EmailType
    recipientEmails: string[]
    resendOfEmailId: string
  }) {
    if (input.emailType === 'ORDER_CONFIRMATION') {
      return this.sesMailService.sendOrderConfirmationEmail({
        order: input.order,
        items: input.items,
        recipientEmails: input.recipientEmails,
        resendOfEmailId: input.resendOfEmailId,
      })
    }

    if (input.emailType === 'SHIPPED_ORDER_NOTIFICATION') {
      return this.sesMailService.sendShippedOrderNotificationEmail({
        order: input.order,
        items: input.items,
        shippedAt: input.order.shippedAt ?? input.order.updatedAt,
        recipientEmails: input.recipientEmails,
        resendOfEmailId: input.resendOfEmailId,
      })
    }

    return this.sesMailService.sendCancelledOrderNotificationEmail({
      order: input.order,
      items: input.items,
      cancelledAt: input.order.cancelledAt ?? input.order.updatedAt,
      recipientEmails: input.recipientEmails,
      resendOfEmailId: input.resendOfEmailId,
    })
  }

  async updateOrderStatus(
    user: AuthenticatedUser,
    orderId: string,
    status: OrderStatus,
  ): Promise<Order> {
    const actor = buildUserOrderMutationContext(user, 'Manual status update')
    if (status === OrderStatus.SHIPPED) {
      return this.markOrderShipped(orderId, actor)
    }

    if (status === OrderStatus.CANCELLED) {
      return this.cancelConfirmedPaidOrder(orderId, actor)
    }

    throw new BadRequestException(
      `Only ${OrderStatus.SHIPPED} and ${OrderStatus.CANCELLED} status updates are supported.`,
    )
  }

  private async markOrderShipped(orderId: string, actor: OrderMutationContext): Promise<Order> {
    const order = await this.getById(orderId)
    if (order.status === OrderStatus.SHIPPED) {
      return order
    }

    if (order.status !== OrderStatus.CONFIRMED || order.paymentStatus !== PaymentStatus.PAID) {
      throw new BadRequestException('Only paid confirmed orders can be marked as shipped.')
    }

    const shippedAt = new Date().toISOString()
    try {
      await this.dynamoDbService.documentClient.send(
        new UpdateCommand({
          TableName: this.ordersTableName,
          Key: { orderId },
          UpdateExpression: `SET #status = :shipped, #shippedAt = :shippedAt, #updatedAt = :updatedAt, ${ORDER_AUDIT_ACTOR_FIELDS}`,
          ConditionExpression: '#status = :confirmed AND #paymentStatus = :paid',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#paymentStatus': 'paymentStatus',
            '#shippedAt': 'shippedAt',
            '#updatedAt': 'updatedAt',
            ...ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES,
          },
          ExpressionAttributeValues: {
            ':confirmed': OrderStatus.CONFIRMED,
            ':paid': PaymentStatus.PAID,
            ':shipped': OrderStatus.SHIPPED,
            ':shippedAt': shippedAt,
            ':updatedAt': shippedAt,
            ...toOrderMutationExpressionValues(actor),
          },
        }),
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        throw new ConflictException(`Order ${orderId} cannot be marked as shipped.`)
      }
      throw error
    }

    const updatedOrder = await this.getById(orderId)
    try {
      await this.orderEventsPublisher.publishOrderShipped({
        orderId: updatedOrder.orderId,
        shippedAt,
      })
    } catch (error) {
      this.logger.error(
        `Failed to publish shipped event for order ${updatedOrder.orderId} shippedAt=${shippedAt}.`,
        error,
      )
      throw error
    }
    return updatedOrder
  }

  private async cancelConfirmedPaidOrder(
    orderId: string,
    actor: OrderMutationContext,
  ): Promise<Order> {
    const order = await this.getById(orderId)
    if (order.status === OrderStatus.CANCELLED) {
      return order
    }

    if (order.status !== OrderStatus.CONFIRMED || order.paymentStatus !== PaymentStatus.PAID) {
      throw new BadRequestException('Only paid confirmed orders can be cancelled.')
    }

    const items = await this.findOrderItems(order.orderId)
    const inventoryItems = aggregateReservedItems(
      items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    )
    assertTransactionSize(inventoryItems)

    const cancelledAt = new Date().toISOString()
    try {
      await this.dynamoDbService.documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.ordersTableName,
                Key: { orderId },
                UpdateExpression: `SET #status = :cancelled, #cancelledAt = :cancelledAt, #updatedAt = :updatedAt, ${ORDER_AUDIT_ACTOR_FIELDS}`,
                ConditionExpression: '#status = :confirmed AND #paymentStatus = :paid',
                ExpressionAttributeNames: {
                  '#status': 'status',
                  '#paymentStatus': 'paymentStatus',
                  '#cancelledAt': 'cancelledAt',
                  '#updatedAt': 'updatedAt',
                  ...ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES,
                },
                ExpressionAttributeValues: {
                  ':confirmed': OrderStatus.CONFIRMED,
                  ':paid': PaymentStatus.PAID,
                  ':cancelled': OrderStatus.CANCELLED,
                  ':cancelledAt': cancelledAt,
                  ':updatedAt': cancelledAt,
                  ...toOrderMutationExpressionValues(actor),
                },
              },
            },
            ...buildReleaseInventoryTransactItems(
              this.inventoryTableName,
              inventoryItems,
              cancelledAt,
            ),
          ],
        }),
      )
    } catch (error) {
      if (isConditionalCheckFailure(error) || isTransactionCanceled(error)) {
        throw new ConflictException(`Order ${orderId} cannot be cancelled.`)
      }
      throw error
    }

    const updatedOrder = await this.getById(orderId)
    try {
      await this.orderEventsPublisher.publishOrderCancelled({
        orderId: updatedOrder.orderId,
        cancelledAt,
        totalAmount: updatedOrder.totalAmount ?? 0,
      })
    } catch (error) {
      this.logger.error(
        `Failed to publish cancelled event for order ${updatedOrder.orderId} cancelledAt=${cancelledAt}.`,
        error,
      )
      throw error
    }

    return updatedOrder
  }

  async triggerPayment(
    user: AuthenticatedUser,
    orderId: string,
    clientIp: string,
  ): Promise<TriggerPaymentResult> {
    const order = await this.getById(orderId)
    const isAdminOrManager = user.groups.includes(Role.ADMIN) || user.groups.includes(Role.MANAGER)

    if (!isAdminOrManager && order.customerId !== user.sub) {
      throw new ForbiddenException('You do not have access to this order.')
    }
    if (order.status !== OrderStatus.RESERVED) {
      throw new BadRequestException(`Order ${orderId} is not ready for payment.`)
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException(`Order ${orderId} is already paid.`)
    }
    if (order.totalAmount === undefined) {
      throw new BadRequestException(`Order ${orderId} does not have a payable amount.`)
    }
    if (this.isPaymentExpired(order)) {
      await this.releaseExpiredOrderReservation(order)
      throw new ConflictException(PAYMENT_WINDOW_EXPIRED_REASON)
    }
    if (!order.paymentExpiresAt) {
      throw new BadRequestException(`Order ${orderId} does not have a payment deadline.`)
    }

    const paymentAttemptId = randomUUID()
    const requestedAt = new Date()
    const requestedAtIso = requestedAt.toISOString()
    const actor = buildUserOrderMutationContext(user, 'Payment requested')
    const nowEpochSeconds = toEpochSeconds(requestedAt.getTime())
    const paymentGatewayExpiresAt = order.paymentExpiresAt - VNPAY_PAYMENT_EXPIRY_SKEW_SECONDS
    if (paymentGatewayExpiresAt <= nowEpochSeconds) {
      throw new ConflictException(
        'Payment window is about to expire. Please place the order again.',
      )
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
      await this.dynamoDbService.documentClient.send(
        new UpdateCommand({
          TableName: this.ordersTableName,
          Key: { orderId },
          UpdateExpression: `SET #paymentStatus = :paymentStatus, #paymentRequestedAt = :paymentRequestedAt, #paymentAttemptId = :paymentAttemptId, #updatedAt = :updatedAt, ${ORDER_AUDIT_ACTOR_FIELDS} REMOVE #paymentFailureReason, #paymentTransactionId, #paidAt`,
          ConditionExpression:
            '#status = :reserved AND (#paymentStatus = :notStarted OR #paymentStatus = :failed OR #paymentStatus = :processing) AND #paymentExpiresAt > :now',
          ExpressionAttributeNames: {
            '#paymentStatus': 'paymentStatus',
            '#status': 'status',
            '#paymentExpiresAt': 'paymentExpiresAt',
            '#paymentRequestedAt': 'paymentRequestedAt',
            '#paymentAttemptId': 'paymentAttemptId',
            '#paymentFailureReason': 'paymentFailureReason',
            '#paymentTransactionId': 'paymentTransactionId',
            '#paidAt': 'paidAt',
            '#updatedAt': 'updatedAt',
            ...ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES,
          },
          ExpressionAttributeValues: {
            ':reserved': OrderStatus.RESERVED,
            ':notStarted': PaymentStatus.NOT_STARTED,
            ':failed': PaymentStatus.FAILED,
            ':processing': PaymentStatus.PROCESSING,
            ':paymentStatus': PaymentStatus.PROCESSING,
            ':paymentRequestedAt': requestedAtIso,
            ':paymentAttemptId': paymentAttemptId,
            ':updatedAt': requestedAtIso,
            ':now': nowEpochSeconds,
            ...toOrderMutationExpressionValues(actor),
          },
        }),
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        const latestOrder = await this.getById(orderId)
        if (this.isPaymentExpired(latestOrder)) {
          await this.releaseExpiredOrderReservation(latestOrder)
          throw new ConflictException(PAYMENT_WINDOW_EXPIRED_REASON)
        }
        throw new ConflictException(`Order ${orderId} cannot start payment in its current state.`)
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

  async handleVnpayReturn(query: Record<string, string>): Promise<VnpayReturnResult> {
    try {
      const verify = await this.vnpayService.verifyReturnQuery(query)
      if (verify.isVerified) {
        try {
          await this.reconcileVerifiedGatewayResult(verify, 'return')
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

  async handleVnpayIpn(query: Record<string, string>): Promise<IpnResponse> {
    let verify: VerifyIpnCall

    try {
      verify = await this.vnpayService.verifyIpnQuery(query)
    } catch {
      return IpnFailChecksum
    }

    if (!verify.isVerified) {
      return IpnFailChecksum
    }

    return this.reconcileVerifiedGatewayResult(verify, 'ipn')
  }

  private async reconcileVerifiedGatewayResult(
    verify: VerifyIpnCall,
    source: 'ipn' | 'return',
  ): Promise<IpnResponse> {
    const orderId = verify.vnp_TxnRef
    const transactionId = String(verify.vnp_TransactionNo ?? '')
    const transactionAmount = Number(verify.vnp_Amount)

    let order: Order
    try {
      order = await this.getById(orderId)
    } catch (error) {
      if (error instanceof NotFoundException) {
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

    if (this.isPaymentExpired(order)) {
      await this.releaseExpiredOrderReservation(order)
      const latestOrder = await this.getById(orderId)
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
      await this.markPaymentSucceeded(
        orderId,
        order.paymentAttemptId,
        transactionId,
        systemOrderMutationContext(
          source === 'ipn' ? 'payment-ipn' : 'payment-return',
          'Payment confirmed',
        ),
      )
      await this.sendOrderConfirmationEmailBestEffortByOrderId(orderId)
      this.logger.log(`VNPay ${source} confirmed payment for order ${orderId}.`)
      return IpnSuccess
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        const latestOrder = await this.getById(orderId)
        if (
          latestOrder.status === OrderStatus.CONFIRMED ||
          latestOrder.paymentStatus === PaymentStatus.PAID
        ) {
          await this.sendOrderConfirmationEmailBestEffort(latestOrder)
          return InpOrderAlreadyConfirmed
        }
        if (this.isPaymentExpired(latestOrder) || latestOrder.status === OrderStatus.EXPIRED) {
          return this.handleLatePaymentSuccess(latestOrder, verify, source)
        }
      }
      throw error
    }
  }

  async markFailed(
    orderId: string,
    status: OrderStatus,
    failureReason: string,
    actor = systemOrderMutationContext('orders-service', failureReason),
  ): Promise<void> {
    await this.dynamoDbService.documentClient.send(
      new UpdateCommand({
        TableName: this.ordersTableName,
        Key: { orderId },
        UpdateExpression: `SET #status = :status, #failureReason = :failureReason, #updatedAt = :updatedAt, ${ORDER_AUDIT_ACTOR_FIELDS}`,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#failureReason': 'failureReason',
          '#updatedAt': 'updatedAt',
          ...ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES,
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':failureReason': failureReason,
          ':updatedAt': new Date().toISOString(),
          ...toOrderMutationExpressionValues(actor),
        },
      }),
    )
  }

  async markReserved(
    orderId: string,
    totalAmount: number,
    actor = systemOrderMutationContext('orders-service', 'Order reserved'),
  ): Promise<void> {
    const timestamp = new Date().toISOString()
    const paymentExpiresAt = toEpochSeconds(Date.now()) + this.paymentConfirmationTimeoutSeconds
    await this.dynamoDbService.documentClient.send(
      new UpdateCommand({
        TableName: this.ordersTableName,
        Key: { orderId },
        UpdateExpression: `SET #status = :status, #reservedAt = :reservedAt, #paymentExpiresAt = :paymentExpiresAt, #totalAmount = :totalAmount, #paymentStatus = :paymentStatus, #updatedAt = :updatedAt, ${ORDER_AUDIT_ACTOR_FIELDS}`,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#reservedAt': 'reservedAt',
          '#paymentExpiresAt': 'paymentExpiresAt',
          '#totalAmount': 'totalAmount',
          '#paymentStatus': 'paymentStatus',
          '#updatedAt': 'updatedAt',
          ...ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES,
        },
        ExpressionAttributeValues: {
          ':status': OrderStatus.RESERVED,
          ':reservedAt': timestamp,
          ':paymentExpiresAt': paymentExpiresAt,
          ':totalAmount': totalAmount,
          ':paymentStatus': PaymentStatus.NOT_STARTED,
          ':updatedAt': timestamp,
          ...toOrderMutationExpressionValues(actor),
        },
      }),
    )
  }

  async markPaymentSucceeded(
    orderId: string,
    paymentAttemptId: string,
    transactionId: string,
    actor = systemOrderMutationContext('payment-ipn', 'Payment confirmed'),
  ): Promise<void> {
    const paidAt = new Date().toISOString()
    await this.dynamoDbService.documentClient.send(
      new UpdateCommand({
        TableName: this.ordersTableName,
        Key: { orderId },
        UpdateExpression: `SET #status = :status, #paymentStatus = :paymentStatus, #paymentTransactionId = :paymentTransactionId, #paidAt = :paidAt, #updatedAt = :updatedAt, ${ORDER_AUDIT_ACTOR_FIELDS}`,
        ConditionExpression:
          '#status = :reserved AND #paymentStatus = :processing AND #paymentAttemptId = :paymentAttemptId',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#paymentStatus': 'paymentStatus',
          '#paymentTransactionId': 'paymentTransactionId',
          '#paymentAttemptId': 'paymentAttemptId',
          '#paidAt': 'paidAt',
          '#updatedAt': 'updatedAt',
          ...ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES,
        },
        ExpressionAttributeValues: {
          ':reserved': OrderStatus.RESERVED,
          ':processing': PaymentStatus.PROCESSING,
          ':paymentAttemptId': paymentAttemptId,
          ':status': OrderStatus.CONFIRMED,
          ':paymentStatus': PaymentStatus.PAID,
          ':paymentTransactionId': transactionId,
          ':paidAt': paidAt,
          ':updatedAt': paidAt,
          ...toOrderMutationExpressionValues(actor),
        },
      }),
    )
  }

  async markPaymentFailed(
    orderId: string,
    paymentAttemptId: string,
    failureReason: string,
    actor = systemOrderMutationContext('payment-ipn', failureReason),
  ): Promise<void> {
    await this.dynamoDbService.documentClient.send(
      new UpdateCommand({
        TableName: this.ordersTableName,
        Key: { orderId },
        UpdateExpression: `SET #paymentStatus = :paymentStatus, #paymentFailureReason = :paymentFailureReason, #updatedAt = :updatedAt, ${ORDER_AUDIT_ACTOR_FIELDS}`,
        ConditionExpression:
          '#status = :reserved AND #paymentStatus = :processing AND #paymentAttemptId = :paymentAttemptId',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#paymentStatus': 'paymentStatus',
          '#paymentFailureReason': 'paymentFailureReason',
          '#paymentAttemptId': 'paymentAttemptId',
          '#updatedAt': 'updatedAt',
          ...ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES,
        },
        ExpressionAttributeValues: {
          ':reserved': OrderStatus.RESERVED,
          ':processing': PaymentStatus.PROCESSING,
          ':paymentAttemptId': paymentAttemptId,
          ':paymentStatus': PaymentStatus.FAILED,
          ':paymentFailureReason': failureReason,
          ':updatedAt': new Date().toISOString(),
          ...toOrderMutationExpressionValues(actor),
        },
      }),
    )
  }

  async markExpiredPaymentRefunded(
    orderId: string,
    transactionId: string,
    failureReason: string,
    actor = systemOrderMutationContext('payment-ipn', failureReason),
  ): Promise<void> {
    await this.dynamoDbService.documentClient.send(
      new UpdateCommand({
        TableName: this.ordersTableName,
        Key: { orderId },
        UpdateExpression: `SET #status = :status, #paymentStatus = :paymentStatus, #paymentTransactionId = :paymentTransactionId, #paymentFailureReason = :paymentFailureReason, #failureReason = :failureReason, #updatedAt = :updatedAt, ${ORDER_AUDIT_ACTOR_FIELDS}`,
        ConditionExpression: '#status <> :confirmed AND #paymentStatus <> :paid',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#paymentStatus': 'paymentStatus',
          '#paymentTransactionId': 'paymentTransactionId',
          '#paymentFailureReason': 'paymentFailureReason',
          '#failureReason': 'failureReason',
          '#updatedAt': 'updatedAt',
          ...ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES,
        },
        ExpressionAttributeValues: {
          ':confirmed': OrderStatus.CONFIRMED,
          ':paid': PaymentStatus.PAID,
          ':status': OrderStatus.EXPIRED,
          ':paymentStatus': PaymentStatus.FAILED,
          ':paymentTransactionId': transactionId,
          ':paymentFailureReason': failureReason,
          ':failureReason': failureReason,
          ':updatedAt': new Date().toISOString(),
          ...toOrderMutationExpressionValues(actor),
        },
      }),
    )
  }

  async updateStatus(
    orderId: string,
    status: OrderStatus,
    failureReason?: string,
    actor = systemOrderMutationContext('orders-service', failureReason ?? 'Status updated'),
  ): Promise<void> {
    const names: Record<string, string> = {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      ...ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES,
    }
    const values: Record<string, unknown> = {
      ':status': status,
      ':updatedAt': new Date().toISOString(),
      ...toOrderMutationExpressionValues(actor),
    }

    let updateExpression = `SET #status = :status, #updatedAt = :updatedAt, ${ORDER_AUDIT_ACTOR_FIELDS}`
    if (failureReason) {
      names['#failureReason'] = 'failureReason'
      values[':failureReason'] = failureReason
      updateExpression += ', #failureReason = :failureReason'
    }

    await this.dynamoDbService.documentClient.send(
      new UpdateCommand({
        TableName: this.ordersTableName,
        Key: { orderId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    )
  }

  async findOrderItems(orderId: string): Promise<OrderItem[]> {
    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.orderItemsTableName,
        KeyConditionExpression: '#orderId = :orderId',
        ExpressionAttributeNames: { '#orderId': 'orderId' },
        ExpressionAttributeValues: { ':orderId': orderId },
      }),
    )

    return (response.Items ?? []) as OrderItem[]
  }

  async findExpiredReservedOrders(
    nowEpochSeconds: number,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<{ items: Order[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.ordersTableName,
        IndexName: 'GSI_OrderStatusPaymentExpiresAt',
        KeyConditionExpression: '#status = :status AND #paymentExpiresAt <= :paymentExpiresAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#paymentExpiresAt': 'paymentExpiresAt',
        },
        ExpressionAttributeValues: {
          ':status': OrderStatus.RESERVED,
          ':paymentExpiresAt': nowEpochSeconds,
        },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )

    return {
      items: (response.Items ?? []) as Order[],
      lastEvaluatedKey: response.LastEvaluatedKey as Record<string, unknown> | undefined,
    }
  }

  getPaymentConfirmationTimeoutSeconds(): number {
    return this.paymentConfirmationTimeoutSeconds
  }

  async failPendingOrderAndReleaseReservation(
    orderId: string,
    failureReason: string,
    items: ReservedInventoryItem[],
    actor = systemOrderMutationContext('orders-service', failureReason),
  ): Promise<void> {
    const inventoryItems = aggregateReservedItems(items)
    assertTransactionSize(inventoryItems)
    const timestamp = new Date().toISOString()

    await this.dynamoDbService.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.ordersTableName,
              Key: { orderId },
              UpdateExpression: `SET #status = :status, #failureReason = :failureReason, #updatedAt = :updatedAt, ${ORDER_AUDIT_ACTOR_FIELDS}`,
              ConditionExpression: '#status = :pending AND #paymentStatus = :notStarted',
              ExpressionAttributeNames: {
                '#status': 'status',
                '#paymentStatus': 'paymentStatus',
                '#failureReason': 'failureReason',
                '#updatedAt': 'updatedAt',
                ...ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES,
              },
              ExpressionAttributeValues: {
                ':pending': OrderStatus.PENDING,
                ':notStarted': PaymentStatus.NOT_STARTED,
                ':status': OrderStatus.FAILED,
                ':failureReason': failureReason,
                ':updatedAt': timestamp,
                ...toOrderMutationExpressionValues(actor),
              },
            },
          },
          ...buildReleaseInventoryTransactItems(this.inventoryTableName, inventoryItems, timestamp),
        ],
      }),
    )
  }

  async expireReservationAndReleaseInventoryIfUnpaid(
    order: Order,
    items: ReservedInventoryItem[],
    actor = systemOrderMutationContext('reservation-expiry-poller', 'Payment expired'),
  ): Promise<boolean> {
    if (!order.paymentExpiresAt) {
      return false
    }

    const inventoryItems = aggregateReservedItems(items)
    if (inventoryItems.length === 0) {
      return false
    }

    assertTransactionSize(inventoryItems)
    const timestamp = new Date().toISOString()

    try {
      await this.dynamoDbService.documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.ordersTableName,
                Key: { orderId: order.orderId },
                UpdateExpression: `SET #status = :status, #failureReason = :failureReason, #updatedAt = :updatedAt, ${ORDER_AUDIT_ACTOR_FIELDS}`,
                ConditionExpression:
                  '#status = :reserved AND #paymentStatus <> :paid AND #paymentExpiresAt = :paymentExpiresAt',
                ExpressionAttributeNames: {
                  '#status': 'status',
                  '#paymentStatus': 'paymentStatus',
                  '#paymentExpiresAt': 'paymentExpiresAt',
                  '#failureReason': 'failureReason',
                  '#updatedAt': 'updatedAt',
                  ...ORDER_AUDIT_ACTOR_ATTRIBUTE_NAMES,
                },
                ExpressionAttributeValues: {
                  ':reserved': OrderStatus.RESERVED,
                  ':paid': PaymentStatus.PAID,
                  ':paymentExpiresAt': order.paymentExpiresAt,
                  ':status': OrderStatus.EXPIRED,
                  ':failureReason': PAYMENT_WINDOW_EXPIRED_REASON,
                  ':updatedAt': timestamp,
                  ...toOrderMutationExpressionValues(actor),
                },
              },
            },
            ...buildReleaseInventoryTransactItems(
              this.inventoryTableName,
              inventoryItems,
              timestamp,
            ),
          ],
        }),
      )
      return true
    } catch (error) {
      if (isConditionalCheckFailure(error) || isTransactionCanceled(error)) {
        return false
      }
      throw error
    }
  }

  isPaymentExpired(order: Order): boolean {
    return Boolean(order.paymentExpiresAt && order.paymentExpiresAt <= toEpochSeconds(Date.now()))
  }

  async releaseExpiredOrderReservation(order: Order): Promise<void> {
    if (order.status !== OrderStatus.RESERVED || !this.isPaymentExpired(order)) {
      return
    }

    const items = await this.findOrderItems(order.orderId)
    if (items.length === 0) {
      return
    }

    await this.expireReservationAndReleaseInventoryIfUnpaid(
      order,
      items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    )
  }

  private async sendOrderConfirmationEmailBestEffortByOrderId(orderId: string): Promise<void> {
    const order = await this.getById(orderId)
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
      const items = await this.findOrderItems(order.orderId)
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

  private async sendShippedOrderNotificationBestEffort(
    order: Order,
    shippedAt: string,
  ): Promise<void> {
    if (order.status !== OrderStatus.SHIPPED || order.paymentStatus !== PaymentStatus.PAID) {
      return
    }

    const hasActiveTracking = await this.emailTrackingService.hasActiveTracking({
      contextType: 'ORDER',
      contextId: order.orderId,
      emailType: 'SHIPPED_ORDER_NOTIFICATION',
    })
    if (hasActiveTracking) {
      return
    }

    try {
      const items = await this.findOrderItems(order.orderId)
      const result = await this.sesMailService.sendShippedOrderNotificationEmail({
        order,
        items,
        shippedAt,
      })

      if (result.status === 'SKIPPED') {
        this.logger.warn(
          `Skipped shipped notification email for order ${order.orderId}: ${result.reason ?? 'unknown-reason'}.`,
        )
      }

      if (result.status === 'SENT') {
        this.logger.log(`Shipped notification email sent for order ${order.orderId}.`)
      }
    } catch (error) {
      this.logger.error(
        `Unexpected failure while processing shipped notification email for ${order.orderId}.`,
        error,
      )
    }
  }

  private async handleFailedIpn(
    order: Order,
    failureReason: string,
    source: 'ipn' | 'return',
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
      await this.markPaymentFailed(
        order.orderId,
        order.paymentAttemptId,
        failureReason,
        systemOrderMutationContext(
          source === 'ipn' ? 'payment-ipn' : 'payment-return',
          failureReason,
        ),
      )
      return IpnSuccess
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        return IpnSuccess
      }
      throw error
    }
  }

  private async handleLatePaymentSuccess(
    order: Order,
    verify: VerifyIpnCall,
    source: 'ipn' | 'return',
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
      await this.markExpiredPaymentRefunded(
        order.orderId,
        String(verify.vnp_TransactionNo),
        autoRefundReason,
        systemOrderMutationContext(
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
}

function buildUserOrderMutationContext(
  user: AuthenticatedUser,
  reason: string,
): OrderMutationContext {
  const actorType =
    user.groups.includes(Role.ADMIN) || user.groups.includes(Role.MANAGER) ? 'admin' : 'customer'

  return {
    actorType,
    actorId: user.sub,
    actorEmail: user.email,
    reason,
  }
}

function systemOrderMutationContext(actorId: string, reason: string): OrderMutationContext {
  return {
    actorType: 'system',
    actorId,
    reason,
  }
}

function toOrderMutationAttributes(actor: OrderMutationContext) {
  return {
    lastModifiedByType: actor.actorType,
    lastModifiedById: actor.actorId,
    lastModifiedByEmail: actor.actorEmail,
    lastModifiedReason: actor.reason,
  }
}

function toOrderMutationExpressionValues(actor: OrderMutationContext): Record<string, unknown> {
  return {
    ':lastModifiedByType': actor.actorType,
    ':lastModifiedById': actor.actorId ?? 'unknown',
    ':lastModifiedByEmail': actor.actorEmail ?? 'unknown',
    ':lastModifiedReason': actor.reason,
  }
}

function toEpochSeconds(timestampMs: number): number {
  return Math.floor(timestampMs / 1000)
}

function normalizeAdditionalReceivingEmails(emails: string[] | undefined): string[] | undefined {
  if (!emails) {
    return undefined
  }

  const normalizedEmails = Array.from(
    new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email.length > 0)),
  )

  return normalizedEmails.length > 0 ? normalizedEmails : undefined
}

function normalizeEmail(email: string | undefined): string | undefined {
  const normalizedEmail = email?.trim().toLowerCase()
  return normalizedEmail || undefined
}

function buildPaymentOrderInfo(orderId: string): string {
  return `Thanh toan don hang ${orderId}`
}

function buildAutoRefundReason(orderId: string): string {
  return `Hoan tien tu dong cho don hang ${orderId} do het han giu hang`
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConditionalCheckFailedException'
  )
}

function isTransactionCanceled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'TransactionCanceledException'
  )
}

function aggregateReservedItems(items: ReservedInventoryItem[]): ReservedInventoryItem[] {
  const quantityByProductId = new Map<string, number>()

  for (const item of items) {
    quantityByProductId.set(
      item.productId,
      (quantityByProductId.get(item.productId) ?? 0) + item.quantity,
    )
  }

  return [...quantityByProductId.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }))
}

function assertTransactionSize(items: ReservedInventoryItem[]): void {
  if (items.length > 99) {
    throw new BadRequestException(
      'Cannot release reservations for orders with more than 99 unique products.',
    )
  }
}

function buildReleaseInventoryTransactItems(
  inventoryTableName: string,
  items: ReservedInventoryItem[],
  timestamp: string,
) {
  return items.map((item) => ({
    Update: {
      TableName: inventoryTableName,
      Key: { productId: item.productId },
      UpdateExpression:
        'SET #availableQuantity = #availableQuantity + :quantity, #reservedQuantity = #reservedQuantity - :quantity, #updatedAt = :updatedAt',
      ConditionExpression: '#reservedQuantity >= :quantity',
      ExpressionAttributeNames: {
        '#availableQuantity': 'availableQuantity',
        '#reservedQuantity': 'reservedQuantity',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':quantity': item.quantity,
        ':updatedAt': timestamp,
      },
    },
  }))
}

function buildStaffOrderQuery(
  query: ListOrdersQueryDto,
  exclusiveStartKey?: Record<string, unknown>,
): Omit<QueryCommand['input'], 'TableName'> {
  if (query.customerEmail) {
    return {
      IndexName: 'GSI_CustomerEmailOrders',
      KeyConditionExpression: '#customerEmail = :customerEmail',
      ExpressionAttributeNames: { '#customerEmail': 'customerEmail' },
      ExpressionAttributeValues: { ':customerEmail': query.customerEmail },
      ExclusiveStartKey: exclusiveStartKey,
    }
  }

  if (query.customerId) {
    return {
      IndexName: 'GSI_CustomerOrders',
      KeyConditionExpression: '#customerId = :customerId',
      ExpressionAttributeNames: { '#customerId': 'customerId' },
      ExpressionAttributeValues: { ':customerId': query.customerId },
      ExclusiveStartKey: exclusiveStartKey,
    }
  }

  if (query.status) {
    return {
      IndexName: 'GSI_OrderStatusCreatedAt',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': query.status },
      ExclusiveStartKey: exclusiveStartKey,
    }
  }

  return {
    IndexName: 'GSI_OrderCreatedAt',
    KeyConditionExpression: '#entityType = :entityType',
    ExpressionAttributeNames: { '#entityType': 'entityType' },
    ExpressionAttributeValues: { ':entityType': ORDERS_ENTITY_TYPE },
    ExclusiveStartKey: exclusiveStartKey,
  }
}

function buildCustomerOrderQuery(
  customerId: string,
  exclusiveStartKey?: Record<string, unknown>,
): Omit<QueryCommand['input'], 'TableName'> {
  return {
    IndexName: 'GSI_CustomerOrders',
    KeyConditionExpression: '#customerId = :customerId',
    ExpressionAttributeNames: { '#customerId': 'customerId' },
    ExpressionAttributeValues: { ':customerId': customerId },
    ExclusiveStartKey: exclusiveStartKey,
  }
}
