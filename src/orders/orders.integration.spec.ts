import { mockClient } from 'aws-sdk-client-mock'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
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
import { ReserveInventoryUseCase } from '../inventory/application/reserve-inventory.use-case'
import { EmailTrackingService } from '../mail/email-tracking.service'
import { SesMailService } from '../mail/ses-mail.service'
import { FindOneProductUseCase } from '../products/application/find-one-product.use-case'
import { Product } from '../products/domain/product.entity'
import { ProductStatus } from '../products/domain/product-status.enum'
import { FindCustomerProfileByUsernameUseCase } from '../users/application/find-customer-profile-by-username.use-case'
import { OrderStatus } from './domain/order-status.enum'
import { PaymentStatus } from './domain/payment-status.enum'
import { Order, OrderItem } from './domain/order.entity'
import { OrderRepositoryPort } from './domain/order.repository.port'
import { DynamoDbOrderRepository } from './infrastructure/dynamodb-order.repository'
import { OrderEventsPublisher } from './infrastructure/order-events.publisher'
import { VnpayService } from './infrastructure/vnpay.service'
import { CreateOrderRequestUseCase } from './application/create-order-request.use-case'
import { FindExpiredReservedOrdersUseCase } from './application/find-expired-reserved-orders.use-case'
import { FindOneOrderUseCase } from './application/find-one-order.use-case'
import { FindOrdersUseCase } from './application/find-orders.use-case'
import { GetOrderEmailStatisticsUseCase } from './application/get-order-email-statistics.use-case'
import { GetOrderEmailTrackingUseCase } from './application/get-order-email-tracking.use-case'
import { HandleVnpayIpnUseCase } from './application/handle-vnpay-ipn.use-case'
import { HandleVnpayReturnUseCase } from './application/handle-vnpay-return.use-case'
import { ReconcileVerifiedGatewayResultUseCase } from './application/reconcile-verified-gateway-result.use-case'
import { ReleaseExpiredOrderReservationUseCase } from './application/release-expired-order-reservation.use-case'
import { ResendFailedOrderEmailUseCase } from './application/resend-failed-order-email.use-case'
import { ReserveOrderCheckoutItemsUseCase } from './application/reserve-order-checkout-items.use-case'
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
  let reserveInventoryUseCase: jest.Mocked<Pick<ReserveInventoryUseCase, 'execute'>>
  let findOneProductUseCase: jest.Mocked<Pick<FindOneProductUseCase, 'execute'>>
  let findCustomerProfileByUsernameUseCase: jest.Mocked<
    Pick<FindCustomerProfileByUsernameUseCase, 'execute'>
  >
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

  let findOrdersUseCase: FindOrdersUseCase
  let findOneOrderUseCase: FindOneOrderUseCase
  let findExpiredReservedOrdersUseCase: FindExpiredReservedOrdersUseCase
  let releaseExpiredOrderReservationUseCase: ReleaseExpiredOrderReservationUseCase
  let createOrderRequestUseCase: CreateOrderRequestUseCase
  let reserveOrderCheckoutItemsUseCase: ReserveOrderCheckoutItemsUseCase
  let updateOrderStatusUseCase: UpdateOrderStatusUseCase
  let triggerPaymentUseCase: TriggerPaymentUseCase
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

  const activeCart = Cart.fromRecord({
    customerId: customerUser.sub,
    cartId: 'cart-1',
    status: CartStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })

  const cartItem: CartItem = {
    cartId: activeCart.cartId,
    customerId: customerUser.sub,
    productId: 'p1',
    quantity: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  const product = Product.fromRecord({
    productId: 'p1',
    name: 'Headphones',
    description: 'Wireless headphones',
    categoryId: 'electronics',
    price: 100000,
    currency: 'VND',
    status: ProductStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  const reservedOrder = Order.fromRecord({
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
  })

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
    reserveInventoryUseCase = { execute: jest.fn().mockResolvedValue(undefined) }
    findOneProductUseCase = { execute: jest.fn() }
    findCustomerProfileByUsernameUseCase = { execute: jest.fn() }
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

    findOrdersUseCase = new FindOrdersUseCase(repository)
    findOneOrderUseCase = new FindOneOrderUseCase(repository)
    findExpiredReservedOrdersUseCase = new FindExpiredReservedOrdersUseCase(repository)
    releaseExpiredOrderReservationUseCase = new ReleaseExpiredOrderReservationUseCase(repository)

    reserveOrderCheckoutItemsUseCase = new ReserveOrderCheckoutItemsUseCase(
      repository,
      reserveInventoryUseCase as unknown as ReserveInventoryUseCase,
      findOneProductUseCase as unknown as FindOneProductUseCase,
      configService,
    )

    createOrderRequestUseCase = new CreateOrderRequestUseCase(
      repository,
      getOwnedCartUseCase as unknown as GetOwnedCartUseCase,
      getCartItemsUseCase as unknown as GetCartItemsUseCase,
      markCartExpiredUseCase as unknown as MarkCartExpiredUseCase,
      findCustomerProfileByUsernameUseCase as unknown as FindCustomerProfileByUsernameUseCase,
      reserveOrderCheckoutItemsUseCase,
    )

    updateOrderStatusUseCase = new UpdateOrderStatusUseCase(
      repository,
      orderEventsPublisher,
    )

    triggerPaymentUseCase = new TriggerPaymentUseCase(
      repository,
      releaseExpiredOrderReservationUseCase,
      vnpayService as unknown as VnpayService,
    )

    reconcileVerifiedGatewayResultUseCase = new ReconcileVerifiedGatewayResultUseCase(
      repository,
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
      repository,
      emailTrackingService as unknown as EmailTrackingService,
    )
    resendFailedOrderEmailUseCase = new ResendFailedOrderEmailUseCase(
      repository,
      emailTrackingService as unknown as EmailTrackingService,
      sesMailService as unknown as SesMailService,
    )
  })

  describe('CreateOrderRequestUseCase', () => {
    it('throws InvalidInputError when the cart has expired, without writing anything', async () => {
      getOwnedCartUseCase.execute.mockResolvedValue(
        Cart.fromRecord({ ...activeCart, status: CartStatus.EXPIRED }),
      )

      await expect(
        createOrderRequestUseCase.execute(customerUser, { cartId: activeCart.cartId }),
      ).rejects.toBeInstanceOf(InvalidInputError)
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
    })

    it('creates the order, reserves inventory, writes order items and saves the order as RESERVED', async () => {
      getOwnedCartUseCase.execute.mockResolvedValue(activeCart)
      getCartItemsUseCase.execute.mockResolvedValue([cartItem])
      findOneProductUseCase.execute.mockResolvedValue(product)
      ddbMock.on(PutCommand).resolves({})
      ddbMock.on(GetCommand).resolves({ Item: { ...reservedOrder, status: OrderStatus.RESERVED } })

      const order = await createOrderRequestUseCase.execute(customerUser, {
        cartId: activeCart.cartId,
      })

      const putCalls = ddbMock.commandCalls(PutCommand)
      // First PutCommand: create the initial order
      expect(putCalls[0].args[0].input.TableName).toBe('orders-test')
      // Second PutCommand: createOrderItems
      expect(putCalls[1].args[0].input.TableName).toBe('order-items-test')
      expect(putCalls[1].args[0].input.Item).toMatchObject({
        productId: product.productId,
        quantity: cartItem.quantity,
        lineTotal: 200000,
      })
      // Third PutCommand: save reserved order
      expect(putCalls[2].args[0].input.TableName).toBe('orders-test')
      expect(putCalls[2].args[0].input.Item).toMatchObject({
        status: OrderStatus.RESERVED,
        totalAmount: 200000,
      })

      expect(reserveInventoryUseCase.execute).toHaveBeenCalledWith(
        cartItem.productId,
        cartItem.quantity,
      )
      expect(markCartExpiredUseCase.execute).toHaveBeenCalledWith(activeCart)
      expect(order.status).toBe(OrderStatus.RESERVED)
    })

    it('marks the order FAILED when the cart has no items', async () => {
      getOwnedCartUseCase.execute.mockResolvedValue(activeCart)
      getCartItemsUseCase.execute.mockResolvedValue([])
      ddbMock.on(PutCommand).resolves({})

      const order = await createOrderRequestUseCase.execute(customerUser, {
        cartId: activeCart.cartId,
      })

      const putCalls = ddbMock.commandCalls(PutCommand)
      // Second PutCommand: save failed order
      expect(putCalls[1].args[0].input.Item).toMatchObject({
        status: OrderStatus.FAILED,
      })
      expect(order.status).toBe(OrderStatus.FAILED)
    })

    it('releases reserved inventory and rethrows when a later item fails to reserve', async () => {
      const secondCartItem: CartItem = { ...cartItem, productId: 'p2' }
      getOwnedCartUseCase.execute.mockResolvedValue(activeCart)
      getCartItemsUseCase.execute.mockResolvedValue([cartItem, secondCartItem])
      findOneProductUseCase.execute.mockResolvedValue(product)
      reserveInventoryUseCase.execute
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
      ddbMock
        .on(GetCommand)
        .resolves({ Item: { ...reservedOrder, customerId: 'someone-else' } })

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

  describe('UpdateOrderStatusUseCase', () => {
    const actor = {
      actorType: 'admin' as const,
      actorId: adminUser.sub,
      reason: 'Manual status update',
    }

    it('throws InvalidInputError for an unsupported target status', () => {
      expect(() =>
        updateOrderStatusUseCase.execute(adminUser, reservedOrder.orderId, OrderStatus.CONFIRMED),
      ).toThrow(InvalidInputError)
    })

    it('throws InvalidInputError when shipping an order that is not paid and confirmed', async () => {
      ddbMock.on(GetCommand).resolves({ Item: reservedOrder })

      await expect(
        updateOrderStatusUseCase.execute(adminUser, reservedOrder.orderId, OrderStatus.SHIPPED),
      ).rejects.toBeInstanceOf(InvalidInputError)
    })

    it('ships the order via PutCommand and publishes the shipped event', async () => {
      const confirmedPaidOrder = {
        ...reservedOrder,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      }
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: confirmedPaidOrder })
        .resolves({ Item: { ...confirmedPaidOrder, status: OrderStatus.SHIPPED } })
      ddbMock.on(PutCommand).resolves({})

      const order = await updateOrderStatusUseCase.execute(
        adminUser,
        reservedOrder.orderId,
        OrderStatus.SHIPPED,
      )

      const putCalls = ddbMock.commandCalls(PutCommand)
      expect(putCalls[0].args[0].input.TableName).toBe('orders-test')
      expect(putCalls[0].args[0].input.Item).toMatchObject({ status: OrderStatus.SHIPPED })
      expect(orderEventsPublisher.publishOrderShipped).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: reservedOrder.orderId }),
      )
      expect(order.status).toBe(OrderStatus.SHIPPED)
    })

    it('throws ConflictError when the cancel transaction is rejected', async () => {
      const confirmedPaidOrder = {
        ...reservedOrder,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      }
      ddbMock.on(GetCommand).resolves({ Item: confirmedPaidOrder })
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrderItem] })
      ddbMock
        .on(TransactWriteCommand)
        .rejects(Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' }))

      await expect(
        updateOrderStatusUseCase.execute(adminUser, reservedOrder.orderId, OrderStatus.CANCELLED),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    it('cancels the order, releases inventory in one transaction and publishes the cancelled event', async () => {
      const confirmedPaidOrder = {
        ...reservedOrder,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      }
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: confirmedPaidOrder })
        .resolves({ Item: { ...confirmedPaidOrder, status: OrderStatus.CANCELLED } })
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrderItem] })
      ddbMock.on(TransactWriteCommand).resolves({})

      const order = await updateOrderStatusUseCase.execute(
        adminUser,
        reservedOrder.orderId,
        OrderStatus.CANCELLED,
      )

      const transactCalls = ddbMock.commandCalls(TransactWriteCommand)
      const transactItems = transactCalls[0].args[0].input.TransactItems ?? []
      // Order is written as Put (full overwrite via toRecord())
      expect(transactItems[0].Put?.TableName).toBe('orders-test')
      // Inventory is released via Update
      expect(transactItems[1].Update?.TableName).toBe('inventory-test')
      expect(transactItems[1].Update?.Key).toEqual({ productId: reservedOrderItem.productId })
      expect(orderEventsPublisher.publishOrderCancelled).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: reservedOrder.orderId }),
      )
      expect(order.status).toBe(OrderStatus.CANCELLED)
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

    it('builds a VNPay payment url and saves the order with PROCESSING status', async () => {
      ddbMock.on(GetCommand).resolves({ Item: reservedOrder })
      ddbMock.on(PutCommand).resolves({})

      const result = await triggerPaymentUseCase.execute(
        customerUser,
        reservedOrder.orderId,
        '203.0.113.5',
      )

      expect(vnpayService.buildOrderPaymentUrl).toHaveBeenCalledWith(
        expect.objectContaining({ amount: reservedOrder.totalAmount, clientIp: '203.0.113.5' }),
      )
      const putCalls = ddbMock.commandCalls(PutCommand)
      expect(putCalls[0].args[0].input.Item).toMatchObject({
        paymentStatus: PaymentStatus.PROCESSING,
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

    it('confirms the payment via PutCommand and sends the confirmation email', async () => {
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
      ddbMock.on(PutCommand).resolves({})

      const result = await handleVnpayIpnUseCase.execute({})

      const putCalls = ddbMock.commandCalls(PutCommand)
      expect(putCalls[0].args[0].input.TableName).toBe('orders-test')
      expect(putCalls[0].args[0].input.Item).toMatchObject({
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        paymentTransactionId: '123456',
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

  describe('ReleaseExpiredOrderReservationUseCase (expireWithInventoryRelease)', () => {
    it('releases inventory for an expired reservation in one transaction', async () => {
      ddbMock.on(GetCommand).resolves({ Item: reservedOrderItem })
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrderItem] })
      ddbMock.on(TransactWriteCommand).resolves({})

      const released = await releaseExpiredOrderReservationUseCase.execute(reservedOrder)

      expect(released).toBe(true)
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1)
    })

    it('returns false instead of throwing when the conditions no longer match', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [reservedOrderItem] })
      ddbMock
        .on(TransactWriteCommand)
        .rejects(Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' }))

      const released = await releaseExpiredOrderReservationUseCase.execute(reservedOrder)

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
