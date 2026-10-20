import { mockClient } from 'aws-sdk-client-mock'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { ConfigService } from '@nestjs/config'
import { IpnInvalidAmount, IpnOrderNotFound, IpnSuccess, type VerifyIpnCall } from 'vnpay'
import {
  ConflictError,
  ForbiddenDomainError,
  InvalidInputError,
  NotFoundError,
} from '../common/domain-error'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { Role } from '../auth/roles.enum'
import { AuthenticatedUser } from '../auth/auth.types'
import { CartStatus } from '../carts/domain/cart-status.enum'
import { Cart, CartItem } from '../carts/domain/cart.entity'
import { GetOwnedCartUseCase } from '../carts/application/get-owned-cart.use-case'
import { GetCartItemsUseCase } from '../carts/application/get-cart-items.use-case'
import { MarkCartExpiredUseCase } from '../carts/application/mark-cart-expired.use-case'
import { InventoryService } from '../inventory/inventory.service'
import { EmailTrackingService } from '../mail/email-tracking.service'
import { SesMailService } from '../mail/ses-mail.service'
import { FindOneProductUseCase } from '../products/application/find-one-product.use-case'
import { Product } from '../products/domain/product.entity'
import { ProductStatus } from '../products/domain/product-status.enum'
import { UsersService } from '../users/users.service'
import { OrderStatus } from './domain/order-status.enum'
import { PaymentStatus } from './domain/payment-status.enum'
import { Order, OrderItem } from './domain/order.entity'
import { OrderRepositoryPort } from './domain/order.repository.port'
import { DynamoDbOrderRepository } from './infrastructure/dynamodb-order.repository'
import { OrderEventsPublisher } from './infrastructure/order-events.publisher'
import { VnpayService } from './infrastructure/vnpay.service'
import { CancelConfirmedPaidOrderUseCase } from './application/cancel-confirmed-paid-order.use-case'
import { CreateOrderRequestUseCase } from './application/create-order-request.use-case'
import { ExpireReservationAndReleaseInventoryIfUnpaidUseCase } from './application/expire-reservation-and-release-inventory-if-unpaid.use-case'
import { FailPendingOrderAndReleaseReservationUseCase } from './application/fail-pending-order-and-release-reservation.use-case'
import { FindExpiredReservedOrdersUseCase } from './application/find-expired-reserved-orders.use-case'
import { FindOneOrderUseCase } from './application/find-one-order.use-case'
import { FindOrderItemsUseCase } from './application/find-order-items.use-case'
import { FindOrdersUseCase } from './application/find-orders.use-case'
import { GetOrderByIdUseCase } from './application/get-order-by-id.use-case'
import { GetOrderEmailStatisticsUseCase } from './application/get-order-email-statistics.use-case'
import { GetOrderEmailTrackingUseCase } from './application/get-order-email-tracking.use-case'
import { HandleVnpayIpnUseCase } from './application/handle-vnpay-ipn.use-case'
import { HandleVnpayReturnUseCase } from './application/handle-vnpay-return.use-case'
import { MarkExpiredPaymentRefundedUseCase } from './application/mark-expired-payment-refunded.use-case'
import { MarkFailedUseCase } from './application/mark-failed.use-case'
import { MarkOrderShippedUseCase } from './application/mark-order-shipped.use-case'
import { MarkPaymentFailedUseCase } from './application/mark-payment-failed.use-case'
import { MarkPaymentSucceededUseCase } from './application/mark-payment-succeeded.use-case'
import { MarkReservedUseCase } from './application/mark-reserved.use-case'
import { ReconcileVerifiedGatewayResultUseCase } from './application/reconcile-verified-gateway-result.use-case'
import { ReleaseExpiredOrderReservationUseCase } from './application/release-expired-order-reservation.use-case'
import { ResendFailedOrderEmailUseCase } from './application/resend-failed-order-email.use-case'
import { TriggerPaymentUseCase } from './application/trigger-payment.use-case'
import { UpdateOrderStatusUseCase } from './application/update-order-status.use-case'

// Integration baseline for `orders`: drives the real use-cases wired to the
// real DynamoDbOrderRepository (DynamoDB calls intercepted by aws-sdk-client-mock)
// to confirm the DynamoDB contract (table names, condition/transact expressions,
// error mapping) and business behavior. Collaborators owned by other modules
// (carts/products/users/inventory/mail) and the external VNPay gateway are
// mocked, since they are outside this module's boundary.
describe('orders use-cases (integration)', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient)
  let repository: OrderRepositoryPort

  let getOwnedCartUseCase: jest.Mocked<Pick<GetOwnedCartUseCase, 'execute'>>
  let getCartItemsUseCase: jest.Mocked<Pick<GetCartItemsUseCase, 'execute'>>
  let markCartExpiredUseCase: jest.Mocked<Pick<MarkCartExpiredUseCase, 'execute'>>
  let inventoryService: jest.Mocked<Pick<InventoryService, 'reserve'>>
  let findOneProductUseCase: jest.Mocked<Pick<FindOneProductUseCase, 'execute'>>
  let usersService: jest.Mocked<Pick<UsersService, 'findCustomerProfileByUsername'>>
  let emailTrackingService: jest.Mocked<
    Pick<
      EmailTrackingService,
      | 'getStatistics'
      | 'findByContext'
      | 'findLatestRetryableForRecipient'
      | 'hasActiveOrderConfirmationTracking'
      | 'hasActiveTracking'
    >
  >
  let sesMailService: jest.Mocked<
    Pick<
      SesMailService,
      | 'sendOrderConfirmationEmail'
      | 'sendShippedOrderNotificationEmail'
      | 'sendCancelledOrderNotificationEmail'
    >
  >
  let vnpayService: jest.Mocked<
    Pick<
      VnpayService,
      | 'buildOrderPaymentUrl'
      | 'verifyReturnQuery'
      | 'verifyIpnQuery'
      | 'queryOrderPayment'
      | 'refundOrderPayment'
      | 'getApiIpAddress'
      | 'logIpnResponse'
      | 'buildFrontendPaymentReturnUrl'
    >
  >
  let orderEventsPublisher: jest.Mocked<OrderEventsPublisher>

  let getOrderByIdUseCase: GetOrderByIdUseCase
  let findOrderItemsUseCase: FindOrderItemsUseCase
  let findOrdersUseCase: FindOrdersUseCase
  let findOneOrderUseCase: FindOneOrderUseCase
  let findExpiredReservedOrdersUseCase: FindExpiredReservedOrdersUseCase
  let markFailedUseCase: MarkFailedUseCase
  let markReservedUseCase: MarkReservedUseCase
  let failPendingOrderAndReleaseReservationUseCase: FailPendingOrderAndReleaseReservationUseCase
  let expireReservationAndReleaseInventoryIfUnpaidUseCase: ExpireReservationAndReleaseInventoryIfUnpaidUseCase
  let releaseExpiredOrderReservationUseCase: ReleaseExpiredOrderReservationUseCase
  let createOrderRequestUseCase: CreateOrderRequestUseCase
  let markOrderShippedUseCase: MarkOrderShippedUseCase
  let cancelConfirmedPaidOrderUseCase: CancelConfirmedPaidOrderUseCase
  let updateOrderStatusUseCase: UpdateOrderStatusUseCase
  let triggerPaymentUseCase: TriggerPaymentUseCase
  let markPaymentSucceededUseCase: MarkPaymentSucceededUseCase
  let markPaymentFailedUseCase: MarkPaymentFailedUseCase
  let markExpiredPaymentRefundedUseCase: MarkExpiredPaymentRefundedUseCase
  let reconcileVerifiedGatewayResultUseCase: ReconcileVerifiedGatewayResultUseCase
  let handleVnpayReturnUseCase: HandleVnpayReturnUseCase
  let handleVnpayIpnUseCase: HandleVnpayIpnUseCase
  let getOrderEmailStatisticsUseCase: GetOrderEmailStatisticsUseCase
  let getOrderEmailTrackingUseCase: GetOrderEmailTrackingUseCase
  let resendFailedOrderEmailUseCase: ResendFailedOrderEmailUseCase

  const customerUser: AuthenticatedUser = {
    sub: 'customer-1',
    username: 'customer',
    email: 'customer@example.com',
    name: 'Customer One',
    groups: [Role.CUSTOMER],
    permissions: [],
    tokenUse: 'access',
    clientId: 'test-client',
  }

  const adminUser: AuthenticatedUser = {
    sub: 'admin-1',
    username: 'admin',
    email: 'admin@example.com',
    name: 'Admin One',
    groups: [Role.ADMIN],
    permissions: [],
    tokenUse: 'access',
    clientId: 'test-client',
  }

  const activeCart: Cart = {
    customerId: customerUser.sub,
    cartId: 'cart-1',
    status: CartStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }

  const cartItem: CartItem = {
    cartId: activeCart.cartId,
    customerId: customerUser.sub,
    productId: 'p1',
    quantity: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  const product: Product = {
    productId: 'p1',
    name: 'Headphones',
    description: 'Wireless headphones',
    categoryId: 'electronics',
    price: 100000,
    currency: 'VND',
    status: ProductStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  const reservedOrder: Order = {
    orderId: 'order-1',
    customerId: customerUser.sub,
    customerEmail: customerUser.email,
    customerName: customerUser.name,
    cartId: activeCart.cartId,
    status: OrderStatus.RESERVED,
    entityType: 'ORDER',
    deduplicationKey: 'dedup-1',
    paymentStatus: PaymentStatus.NOT_STARTED,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalAmount: 200000,
    paymentExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  }

  const reservedOrderItem: OrderItem = {
    orderId: reservedOrder.orderId,
    lineId: '001-abcdefgh',
    productId: product.productId,
    productName: product.name,
    unitPrice: product.price,
    quantity: 2,
    lineTotal: 200000,
    createdAt: '2026-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    ddbMock.reset()

    const dynamoDbService = {
      documentClient: ddbMock as unknown as DynamoDBDocumentClient,
    } as unknown as DynamoDbService

    const dynamoTables = {
      orders: 'orders-test',
      orderItems: 'order-items-test',
      inventory: 'inventory-test',
    } as unknown as DynamoTablesService

    repository = new DynamoDbOrderRepository(dynamoDbService, dynamoTables)

    getOwnedCartUseCase = { execute: jest.fn() }
    getCartItemsUseCase = { execute: jest.fn() }
    markCartExpiredUseCase = { execute: jest.fn().mockResolvedValue(undefined) }
    inventoryService = { reserve: jest.fn().mockResolvedValue(undefined) }
    findOneProductUseCase = { execute: jest.fn() }
    usersService = { findCustomerProfileByUsername: jest.fn() }
    emailTrackingService = {
      getStatistics: jest.fn(),
      findByContext: jest.fn(),
      findLatestRetryableForRecipient: jest.fn(),
      hasActiveOrderConfirmationTracking: jest.fn().mockResolvedValue(false),
      hasActiveTracking: jest.fn().mockResolvedValue(false),
    }
    sesMailService = {
      sendOrderConfirmationEmail: jest.fn().mockResolvedValue({ status: 'SENT' }),
      sendShippedOrderNotificationEmail: jest.fn().mockResolvedValue({ status: 'SENT' }),
      sendCancelledOrderNotificationEmail: jest.fn().mockResolvedValue({ status: 'SENT' }),
    }
    vnpayService = {
      buildOrderPaymentUrl: jest.fn().mockResolvedValue('https://vnpay.example/pay'),
      verifyReturnQuery: jest.fn(),
      verifyIpnQuery: jest.fn(),
      queryOrderPayment: jest.fn(),
      refundOrderPayment: jest.fn(),
      getApiIpAddress: jest.fn().mockReturnValue('127.0.0.1'),
      logIpnResponse: jest.fn(),
      buildFrontendPaymentReturnUrl: jest.fn().mockReturnValue('https://storefront.example/return'),
    }
    orderEventsPublisher = {
      publishOrderShipped: jest.fn().mockResolvedValue(undefined),
      publishOrderCancelled: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OrderEventsPublisher>

    const configService = {
      getOrThrow: jest.fn().mockReturnValue(3600),
    } as unknown as ConfigService

    getOrderByIdUseCase = new GetOrderByIdUseCase(repository)
    findOrderItemsUseCase = new FindOrderItemsUseCase(repository)
    findOrdersUseCase = new FindOrdersUseCase(repository)
    findOneOrderUseCase = new FindOneOrderUseCase(repository)
    findExpiredReservedOrdersUseCase = new FindExpiredReservedOrdersUseCase(repository)
    markFailedUseCase = new MarkFailedUseCase(repository)
    markReservedUseCase = new MarkReservedUseCase(repository, configService)
    failPendingOrderAndReleaseReservationUseCase = new FailPendingOrderAndReleaseReservationUseCase(
      repository,
    )
    expireReservationAndReleaseInventoryIfUnpaidUseCase =
      new ExpireReservationAndReleaseInventoryIfUnpaidUseCase(repository)
    releaseExpiredOrderReservationUseCase = new ReleaseExpiredOrderReservationUseCase(
      findOrderItemsUseCase,
      expireReservationAndReleaseInventoryIfUnpaidUseCase,
    )

    createOrderRequestUseCase = new CreateOrderRequestUseCase(
      repository,
      getOwnedCartUseCase as unknown as GetOwnedCartUseCase,
      getCartItemsUseCase as unknown as GetCartItemsUseCase,
      markCartExpiredUseCase as unknown as MarkCartExpiredUseCase,
      inventoryService as unknown as InventoryService,
      findOneProductUseCase as unknown as FindOneProductUseCase,
      usersService as unknown as UsersService,
      markReservedUseCase,
      markFailedUseCase,
      failPendingOrderAndReleaseReservationUseCase,
      getOrderByIdUseCase,
    )

    markOrderShippedUseCase = new MarkOrderShippedUseCase(
      repository,
      getOrderByIdUseCase,
      orderEventsPublisher,
    )
    cancelConfirmedPaidOrderUseCase = new CancelConfirmedPaidOrderUseCase(
      repository,
      getOrderByIdUseCase,
      findOrderItemsUseCase,
      orderEventsPublisher,
    )
    updateOrderStatusUseCase = new UpdateOrderStatusUseCase(
      markOrderShippedUseCase,
      cancelConfirmedPaidOrderUseCase,
    )

    triggerPaymentUseCase = new TriggerPaymentUseCase(
      repository,
      getOrderByIdUseCase,
      releaseExpiredOrderReservationUseCase,
      vnpayService as unknown as VnpayService,
    )

    markPaymentSucceededUseCase = new MarkPaymentSucceededUseCase(repository)
    markPaymentFailedUseCase = new MarkPaymentFailedUseCase(repository)
    markExpiredPaymentRefundedUseCase = new MarkExpiredPaymentRefundedUseCase(repository)
    reconcileVerifiedGatewayResultUseCase = new ReconcileVerifiedGatewayResultUseCase(
      getOrderByIdUseCase,
      findOrderItemsUseCase,
      markPaymentSucceededUseCase,
      markPaymentFailedUseCase,
      markExpiredPaymentRefundedUseCase,
      releaseExpiredOrderReservationUseCase,
      emailTrackingService as unknown as EmailTrackingService,
      sesMailService as unknown as SesMailService,
      vnpayService as unknown as VnpayService,
    )
    handleVnpayReturnUseCase = new HandleVnpayReturnUseCase(
      vnpayService as unknown as VnpayService,
      reconcileVerifiedGatewayResultUseCase,
    )
    handleVnpayIpnUseCase = new HandleVnpayIpnUseCase(
      vnpayService as unknown as VnpayService,
      reconcileVerifiedGatewayResultUseCase,
    )

    getOrderEmailStatisticsUseCase = new GetOrderEmailStatisticsUseCase(
      emailTrackingService as unknown as EmailTrackingService,
    )
    getOrderEmailTrackingUseCase = new GetOrderEmailTrackingUseCase(
      getOrderByIdUseCase,
      emailTrackingService as unknown as EmailTrackingService,
    )
    resendFailedOrderEmailUseCase = new ResendFailedOrderEmailUseCase(
      getOrderByIdUseCase,
      findOrderItemsUseCase,
      emailTrackingService as unknown as EmailTrackingService,
      sesMailService as unknown as SesMailService,
    )
  })

  describe('CreateOrderRequestUseCase', () => {
    it('throws InvalidInputError when the cart has expired, without writing anything', async () => {
      getOwnedCartUseCase.execute.mockResolvedValue({ ...activeCart, status: CartStatus.EXPIRED })

      await expect(
        createOrderRequestUseCase.execute(customerUser, { cartId: activeCart.cartId }),
      ).rejects.toBeInstanceOf(InvalidInputError)
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
    })

    it('creates the order, reserves inventory, writes order items and marks the order RESERVED', async () => {
      getOwnedCartUseCase.execute.mockResolvedValue(activeCart)
      getCartItemsUseCase.execute.mockResolvedValue([cartItem])
      findOneProductUseCase.execute.mockResolvedValue(product)
      ddbMock.on(PutCommand).resolves({})
      ddbMock.on(UpdateCommand).resolves({})
      ddbMock.on(GetCommand).resolves({ Item: { ...reservedOrder, status: OrderStatus.RESERVED } })

      const order = await createOrderRequestUseCase.execute(customerUser, {
        cartId: activeCart.cartId,
      })

      const putCalls = ddbMock.commandCalls(PutCommand)
      expect(putCalls[0].args[0].input.TableName).toBe('orders-test')
      expect(putCalls[1].args[0].input.TableName).toBe('order-items-test')
      expect(putCalls[1].args[0].input.Item).toMatchObject({
        productId: product.productId,
        quantity: cartItem.quantity,
        lineTotal: 200000,
      })

      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls).toHaveLength(1)
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ':status': OrderStatus.RESERVED,
        ':totalAmount': 200000,
      })
      expect(inventoryService.reserve).toHaveBeenCalledWith(cartItem.productId, cartItem.quantity)
      expect(markCartExpiredUseCase.execute).toHaveBeenCalledWith(activeCart)
      expect(order.status).toBe(OrderStatus.RESERVED)
    })

    it('marks the order FAILED when the cart has no items', async () => {
      getOwnedCartUseCase.execute.mockResolvedValue(activeCart)
      getCartItemsUseCase.execute.mockResolvedValue([])
      ddbMock.on(PutCommand).resolves({})
      ddbMock.on(UpdateCommand).resolves({})
      ddbMock.on(GetCommand).resolves({ Item: { ...reservedOrder, status: OrderStatus.FAILED } })

      const order = await createOrderRequestUseCase.execute(customerUser, {
        cartId: activeCart.cartId,
      })

      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ':status': OrderStatus.FAILED,
        ':failureReason': 'Cart has no items.',
      })
      expect(order.status).toBe(OrderStatus.FAILED)
    })

    it('releases reserved inventory and rethrows when a later item fails to reserve', async () => {
      const secondCartItem: CartItem = { ...cartItem, productId: 'p2' }
      getOwnedCartUseCase.execute.mockResolvedValue(activeCart)
      getCartItemsUseCase.execute.mockResolvedValue([cartItem, secondCartItem])
      findOneProductUseCase.execute.mockResolvedValue(product)
      inventoryService.reserve
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Insufficient inventory for product p2.'))
      ddbMock.on(PutCommand).resolves({})
      ddbMock.on(TransactWriteCommand).resolves({})

      await expect(
        createOrderRequestUseCase.execute(customerUser, { cartId: activeCart.cartId }),
      ).rejects.toThrow('Insufficient inventory for product p2.')

      const transactCalls = ddbMock.commandCalls(TransactWriteCommand)
      expect(transactCalls).toHaveLength(1)
      const transactItems = transactCalls[0].args[0].input.TransactItems ?? []
      expect(transactItems[0].Update?.TableName).toBe('orders-test')
      expect(transactItems[1].Update?.TableName).toBe('inventory-test')
      expect(markCartExpiredUseCase.execute).not.toHaveBeenCalled()
    })
  })

  describe('FindOrdersUseCase', () => {
    it('queries the customer GSI for a regular customer', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrder] })

      const page = await findOrdersUseCase.execute(customerUser, {})

      const queryCalls = ddbMock.commandCalls(QueryCommand)
      expect(queryCalls[0].args[0].input.IndexName).toBe('GSI_CustomerOrders')
      expect(page.items).toEqual([reservedOrder])
    })

    it('queries the entity-type GSI for staff with no filters', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] })

      await findOrdersUseCase.execute(adminUser, {})

      const queryCalls = ddbMock.commandCalls(QueryCommand)
      expect(queryCalls[0].args[0].input.IndexName).toBe('GSI_OrderCreatedAt')
    })
  })

  describe('FindOneOrderUseCase', () => {
    it('throws NotFoundError when the order does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined })

      await expect(findOneOrderUseCase.execute(customerUser, 'missing')).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })

    it('throws ForbiddenDomainError when a different customer requests the order', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { ...reservedOrder, customerId: 'someone-else' } })

      await expect(
        findOneOrderUseCase.execute(customerUser, reservedOrder.orderId),
      ).rejects.toBeInstanceOf(ForbiddenDomainError)
    })

    it('returns the order combined with its items', async () => {
      ddbMock.on(GetCommand).resolves({ Item: reservedOrder })
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrderItem] })

      const details = await findOneOrderUseCase.execute(customerUser, reservedOrder.orderId)

      expect(details.items).toEqual([reservedOrderItem])
    })
  })

  describe('MarkOrderShippedUseCase', () => {
    const actor = {
      actorType: 'admin' as const,
      actorId: adminUser.sub,
      reason: 'Manual status update',
    }

    it('throws InvalidInputError when the order is not a paid, confirmed order', async () => {
      ddbMock.on(GetCommand).resolves({ Item: reservedOrder })

      await expect(
        markOrderShippedUseCase.execute(reservedOrder.orderId, actor),
      ).rejects.toBeInstanceOf(InvalidInputError)
    })

    it('throws ConflictError when the conditional update fails', async () => {
      const confirmedPaidOrder = {
        ...reservedOrder,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      }
      ddbMock.on(GetCommand).resolves({ Item: confirmedPaidOrder })
      ddbMock.on(UpdateCommand).rejects(
        Object.assign(new Error('conditional check failed'), {
          name: 'ConditionalCheckFailedException',
        }),
      )

      await expect(
        markOrderShippedUseCase.execute(reservedOrder.orderId, actor),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    it('marks the order SHIPPED and publishes the shipped event', async () => {
      const confirmedPaidOrder = {
        ...reservedOrder,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      }
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: confirmedPaidOrder })
        .resolves({ Item: { ...confirmedPaidOrder, status: OrderStatus.SHIPPED } })
      ddbMock.on(UpdateCommand).resolves({})

      const order = await markOrderShippedUseCase.execute(reservedOrder.orderId, actor)

      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls[0].args[0].input.ConditionExpression).toContain('#status = :confirmed')
      expect(orderEventsPublisher.publishOrderShipped).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: reservedOrder.orderId }),
      )
      expect(order.status).toBe(OrderStatus.SHIPPED)
    })
  })

  describe('CancelConfirmedPaidOrderUseCase', () => {
    const actor = {
      actorType: 'admin' as const,
      actorId: adminUser.sub,
      reason: 'Manual status update',
    }
    const confirmedPaidOrder = {
      ...reservedOrder,
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
    }

    it('throws ConflictError when the transaction is cancelled', async () => {
      ddbMock.on(GetCommand).resolves({ Item: confirmedPaidOrder })
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrderItem] })
      ddbMock
        .on(TransactWriteCommand)
        .rejects(Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' }))

      await expect(
        cancelConfirmedPaidOrderUseCase.execute(reservedOrder.orderId, actor),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    it('cancels the order, releases inventory in one transaction and publishes the cancelled event', async () => {
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: confirmedPaidOrder })
        .resolves({ Item: { ...confirmedPaidOrder, status: OrderStatus.CANCELLED } })
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrderItem] })
      ddbMock.on(TransactWriteCommand).resolves({})

      const order = await cancelConfirmedPaidOrderUseCase.execute(reservedOrder.orderId, actor)

      const transactCalls = ddbMock.commandCalls(TransactWriteCommand)
      const transactItems = transactCalls[0].args[0].input.TransactItems ?? []
      expect(transactItems[0].Update?.TableName).toBe('orders-test')
      expect(transactItems[1].Update?.TableName).toBe('inventory-test')
      expect(transactItems[1].Update?.Key).toEqual({ productId: reservedOrderItem.productId })
      expect(orderEventsPublisher.publishOrderCancelled).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: reservedOrder.orderId }),
      )
      expect(order.status).toBe(OrderStatus.CANCELLED)
    })
  })

  describe('UpdateOrderStatusUseCase', () => {
    it('throws InvalidInputError for an unsupported target status', () => {
      expect(() =>
        updateOrderStatusUseCase.execute(adminUser, reservedOrder.orderId, OrderStatus.CONFIRMED),
      ).toThrow(InvalidInputError)
    })

    it('dispatches SHIPPED to the real MarkOrderShippedUseCase wired to DynamoDB', async () => {
      const confirmedPaidOrder = {
        ...reservedOrder,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      }
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: confirmedPaidOrder })
        .resolves({ Item: { ...confirmedPaidOrder, status: OrderStatus.SHIPPED } })
      ddbMock.on(UpdateCommand).resolves({})

      const order = await updateOrderStatusUseCase.execute(
        adminUser,
        reservedOrder.orderId,
        OrderStatus.SHIPPED,
      )

      expect(order.status).toBe(OrderStatus.SHIPPED)
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1)
    })
  })

  describe('TriggerPaymentUseCase', () => {
    it('throws ForbiddenDomainError when a different customer requests payment', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { ...reservedOrder, customerId: 'someone-else' } })

      await expect(
        triggerPaymentUseCase.execute(customerUser, reservedOrder.orderId, '127.0.0.1'),
      ).rejects.toBeInstanceOf(ForbiddenDomainError)
    })

    it('releases the reservation and throws ConflictError once the payment window has expired', async () => {
      const expiredOrder = {
        ...reservedOrder,
        paymentExpiresAt: Math.floor(Date.now() / 1000) - 10,
      }
      ddbMock.on(GetCommand).resolves({ Item: expiredOrder })
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrderItem] })
      ddbMock.on(TransactWriteCommand).resolves({})

      await expect(
        triggerPaymentUseCase.execute(customerUser, reservedOrder.orderId, '127.0.0.1'),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1)
    })

    it('builds a VNPay payment url and starts the payment', async () => {
      ddbMock.on(GetCommand).resolves({ Item: reservedOrder })
      ddbMock.on(UpdateCommand).resolves({})

      const result = await triggerPaymentUseCase.execute(
        customerUser,
        reservedOrder.orderId,
        '203.0.113.5',
      )

      expect(vnpayService.buildOrderPaymentUrl).toHaveBeenCalledWith(
        expect.objectContaining({ amount: reservedOrder.totalAmount, clientIp: '203.0.113.5' }),
      )
      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ':paymentStatus': PaymentStatus.PROCESSING,
      })
      expect(result).toMatchObject({
        paymentStatus: PaymentStatus.PROCESSING,
        paymentUrl: 'https://vnpay.example/pay',
      })
    })
  })

  describe('ReconcileVerifiedGatewayResultUseCase (via HandleVnpayIpnUseCase)', () => {
    const verify: VerifyIpnCall = {
      isSuccess: true,
      isVerified: true,
      message: 'Success',
      vnp_TxnRef: reservedOrder.orderId,
      vnp_Amount: reservedOrder.totalAmount as number,
      vnp_OrderInfo: 'Thanh toan don hang order-1',
      vnp_TransactionNo: 123456,
    } as unknown as VerifyIpnCall

    it('returns IpnOrderNotFound when the order does not exist', async () => {
      vnpayService.verifyIpnQuery.mockResolvedValue(verify)
      ddbMock.on(GetCommand).resolves({ Item: undefined })

      await expect(handleVnpayIpnUseCase.execute({})).resolves.toBe(IpnOrderNotFound)
    })

    it('returns IpnInvalidAmount on an amount mismatch', async () => {
      vnpayService.verifyIpnQuery.mockResolvedValue(verify)
      ddbMock.on(GetCommand).resolves({ Item: { ...reservedOrder, totalAmount: 1 } })

      await expect(handleVnpayIpnUseCase.execute({})).resolves.toBe(IpnInvalidAmount)
    })

    it('confirms the payment via a real conditional UpdateCommand and sends the confirmation email', async () => {
      vnpayService.verifyIpnQuery.mockResolvedValue(verify)
      const processingOrder = {
        ...reservedOrder,
        paymentStatus: PaymentStatus.PROCESSING,
        paymentAttemptId: 'attempt-1',
      }
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: processingOrder })
        .resolves({
          Item: {
            ...processingOrder,
            status: OrderStatus.CONFIRMED,
            paymentStatus: PaymentStatus.PAID,
          },
        })
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrderItem] })
      ddbMock.on(UpdateCommand).resolves({})

      const result = await handleVnpayIpnUseCase.execute({})

      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ':status': OrderStatus.CONFIRMED,
        ':paymentStatus': PaymentStatus.PAID,
        ':paymentTransactionId': '123456',
      })
      expect(sesMailService.sendOrderConfirmationEmail).toHaveBeenCalled()
      expect(result).toBe(IpnSuccess)
    })
  })

  describe('FindExpiredReservedOrdersUseCase', () => {
    it('queries the payment-expiry GSI for RESERVED orders', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrder] })

      const page = await findExpiredReservedOrdersUseCase.execute(1000, 25)

      const queryCalls = ddbMock.commandCalls(QueryCommand)
      expect(queryCalls[0].args[0].input.IndexName).toBe('GSI_OrderStatusPaymentExpiresAt')
      expect(page.items).toEqual([reservedOrder])
    })
  })

  describe('ExpireReservationAndReleaseInventoryIfUnpaidUseCase', () => {
    it('releases inventory for an expired reservation in one transaction', async () => {
      ddbMock.on(TransactWriteCommand).resolves({})

      const released = await expireReservationAndReleaseInventoryIfUnpaidUseCase.execute(
        reservedOrder,
        [{ productId: reservedOrderItem.productId, quantity: reservedOrderItem.quantity }],
      )

      expect(released).toBe(true)
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1)
    })

    it('returns false instead of throwing when the conditions no longer match', async () => {
      ddbMock
        .on(TransactWriteCommand)
        .rejects(Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' }))

      const released = await expireReservationAndReleaseInventoryIfUnpaidUseCase.execute(
        reservedOrder,
        [{ productId: reservedOrderItem.productId, quantity: reservedOrderItem.quantity }],
      )

      expect(released).toBe(false)
    })
  })

  describe('ResendFailedOrderEmailUseCase', () => {
    it('returns SKIPPED when there is no retryable recipient', async () => {
      ddbMock.on(GetCommand).resolves({ Item: reservedOrder })
      emailTrackingService.findLatestRetryableForRecipient.mockResolvedValue(null as never)

      const result = await resendFailedOrderEmailUseCase.execute(
        reservedOrder.orderId,
        'ORDER_CONFIRMATION',
        'a@example.com',
      )

      expect(result.status).toBe('SKIPPED')
      expect(sesMailService.sendOrderConfirmationEmail).not.toHaveBeenCalled()
    })

    it('resends the order confirmation email for a retryable recipient', async () => {
      ddbMock.on(GetCommand).resolves({ Item: reservedOrder })
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrderItem] })
      emailTrackingService.findLatestRetryableForRecipient.mockResolvedValue({
        emailId: 'email-1',
      } as never)

      const result = await resendFailedOrderEmailUseCase.execute(
        reservedOrder.orderId,
        'ORDER_CONFIRMATION',
        'a@example.com',
      )

      expect(sesMailService.sendOrderConfirmationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmails: ['a@example.com'], resendOfEmailId: 'email-1' }),
      )
      expect(result.resentCount).toBe(1)
    })
  })

  describe('GetOrderEmailStatisticsUseCase / GetOrderEmailTrackingUseCase', () => {
    it('delegates statistics to the email tracking service', async () => {
      emailTrackingService.getStatistics.mockResolvedValue({} as never)

      await getOrderEmailStatisticsUseCase.execute()

      expect(emailTrackingService.getStatistics).toHaveBeenCalled()
    })

    it('verifies the order exists before returning its email tracking history', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined })

      await expect(getOrderEmailTrackingUseCase.execute('missing')).rejects.toBeInstanceOf(
        NotFoundError,
      )
      expect(emailTrackingService.findByContext).not.toHaveBeenCalled()
    })
  })

  describe('HandleVnpayReturnUseCase', () => {
    it('reconciles a verified return against the real repository and redirects to the storefront', async () => {
      vnpayService.verifyReturnQuery.mockResolvedValue({
        isVerified: true,
        isSuccess: true,
        message: 'Success',
        vnp_TxnRef: reservedOrder.orderId,
      } as never)
      ddbMock.on(GetCommand).resolves({ Item: undefined })

      const result = await handleVnpayReturnUseCase.execute({ vnp_TxnRef: reservedOrder.orderId })

      expect(result.redirectUrl).toBe('https://storefront.example/return')
    })
  })
})
