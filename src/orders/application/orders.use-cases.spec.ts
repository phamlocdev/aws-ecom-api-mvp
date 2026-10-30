import {
  InpOrderAlreadyConfirmed,
  IpnFailChecksum,
  IpnInvalidAmount,
  IpnOrderNotFound,
  IpnSuccess,
  type VerifyIpnCall,
} from 'vnpay'
import { AuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { Role } from '../../auth/roles.enum'
import { CartRepositoryPort } from '../../carts/domain/cart.repository.port'
import { CartStatus } from '../../carts/domain/cart-status.enum'
import { Cart } from '../../carts/domain/cart.entity'
import {
  ConflictError,
  ForbiddenDomainError,
  InvalidInputError,
  NotFoundError,
} from '../../common/domain-error'
import { InventoryRepositoryPort } from '../../inventory/domain/inventory.repository.port'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { Product } from '../../products/domain/product.entity'
import { ProductRepositoryPort } from '../../products/domain/product.repository.port'
import { SesMailService } from '../../mail/ses-mail.service'
import { CognitoUserPort } from '../../users/domain/cognito-user.port'
import { Order, OrderItem } from '../domain/order.entity'
import { OrderItemRepositoryPort } from '../domain/order-item.repository.port'
import { OrderStatus } from '../domain/order-status.enum'
import { OrderRepositoryPort } from '../domain/order.repository.port'
import { PaymentStatus } from '../domain/payment-status.enum'
import { OrderEventsPublisher } from '../infrastructure/order-events.publisher'
import { VnpayService } from '../infrastructure/vnpay.service'
import { CreateOrderRequestUseCase } from './create-order-request.use-case'
import { FindExpiredReservedOrdersUseCase } from './find-expired-reserved-orders.use-case'
import { FindOneOrderUseCase } from './find-one-order.use-case'
import { FindOrdersUseCase } from './find-orders.use-case'
import { GetOrderEmailStatisticsUseCase } from './get-order-email-statistics.use-case'
import { GetOrderEmailTrackingUseCase } from './get-order-email-tracking.use-case'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { HandleVnpayIpnUseCase } from './handle-vnpay-ipn.use-case'
import { HandleVnpayReturnUseCase } from './handle-vnpay-return.use-case'
import { ReleaseExpiredOrderReservationUseCase } from './release-expired-order-reservation.use-case'
import { VnpayReconcileService } from './vnpay-reconcile.service'
import { ResendFailedOrderEmailUseCase } from './resend-failed-order-email.use-case'
import { ReserveOrderCheckoutItemsUseCase } from './reserve-order-checkout-items.use-case'
import { TriggerPaymentUseCase } from './trigger-payment.use-case'
import { UpdateOrderStatusUseCase } from './update-order-status.use-case'

// Unit tests for the orders use-cases: exercised against a mocked
// OrderRepositoryPort and mocked collaborators (cart/product/inventory/mail/
// vnpay use-cases and services), no AWS SDK or VNPay SDK involved.

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

const baseOrder = Order.fromRecord({
  orderId: 'order-1',
  customerId: customerUser.sub,
  customerEmail: customerUser.email,
  customerName: customerUser.name,
  cartId: 'cart-1',
  status: OrderStatus.RESERVED,
  entityType: 'ORDER',
  deduplicationKey: 'dedup-1',
  paymentStatus: PaymentStatus.NOT_STARTED,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  totalAmount: 200000,
  paymentExpiresAt: Math.floor(Date.now() / 1000) + 3600,
})

const baseOrderItem = OrderItem.fromRecord({
  orderId: baseOrder.orderId,
  lineId: '001-abcdefgh',
  productId: 'p1',
  productName: 'Headphones',
  unitPrice: 100000,
  quantity: 2,
  lineTotal: 200000,
  createdAt: '2026-01-01T00:00:00.000Z',
})

function createOrderRepositoryMock(): jest.Mocked<OrderRepositoryPort> {
  return {
    create: jest.fn(),
    save: jest.fn(),
    findById: jest.fn(),
    findMany: jest.fn(),
    findExpiredReserved: jest.fn(),
    executeTransaction: jest.fn().mockResolvedValue(undefined),
  }
}

function createDynamoTablesMock() {
  return { orders: 'orders-test', inventory: 'inventory-test' } as unknown as DynamoTablesService
}

function createOrderItemRepositoryMock(): jest.Mocked<OrderItemRepositoryPort> {
  return {
    createMany: jest.fn(),
    findByOrderId: jest.fn(),
  }
}

function createInventoryRepositoryMock(): jest.Mocked<InventoryRepositoryPort> {
  return {
    ensureRecord: jest.fn(),
    findOne: jest.fn(),
    findOneSummary: jest.fn(),
    findSummariesByProductIds: jest.fn(),
    findAllSummaries: jest.fn(),
    updateAvailableQuantity: jest.fn(),
    reserve: jest.fn(),
    release: jest.fn(),
  }
}

function createProductRepositoryMock(): jest.Mocked<ProductRepositoryPort> {
  return {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  }
}

function createCartRepositoryMock(): jest.Mocked<CartRepositoryPort> {
  return {
    create: jest.fn(),
    findAllByCustomer: jest.fn(),
    findOne: jest.fn(),
    findItems: jest.fn(),
    putItem: jest.fn(),
    updateItemQuantity: jest.fn(),
    removeItem: jest.fn(),
    updateStatus: jest.fn(),
  }
}

function createCognitoUserRepositoryMock(): jest.Mocked<CognitoUserPort> {
  return {
    listAllUsers: jest.fn(),
    getUserGroups: jest.fn(),
    getUserByUsername: jest.fn(),
    createUser: jest.fn(),
    addUserToGroup: jest.fn(),
    updateUserAttributes: jest.fn(),
    enableUser: jest.fn(),
    disableUser: jest.fn(),
    setUserPassword: jest.fn(),
    findUserByEmail: jest.fn(),
  }
}

function mockUseCase<T extends { execute: (...args: never[]) => unknown }>(): jest.Mocked<T> {
  return { execute: jest.fn() } as unknown as jest.Mocked<T>
}

function createConfigServiceMock(value = 60) {
  return { getOrThrow: jest.fn().mockReturnValue(value) }
}

function createEventsPublisherMock(): jest.Mocked<OrderEventsPublisher> {
  return {
    publishOrderShipped: jest.fn().mockResolvedValue(undefined),
    publishOrderCancelled: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<OrderEventsPublisher>
}

function createEmailTrackingServiceMock(): jest.Mocked<
  Pick<
    EmailTrackingService,
    | 'getStatistics'
    | 'findByContext'
    | 'findLatestRetryableForRecipient'
    | 'hasActiveOrderConfirmationTracking'
    | 'hasActiveTracking'
  >
> {
  return {
    getStatistics: jest.fn(),
    findByContext: jest.fn(),
    findLatestRetryableForRecipient: jest.fn(),
    hasActiveOrderConfirmationTracking: jest.fn().mockResolvedValue(false),
    hasActiveTracking: jest.fn().mockResolvedValue(false),
  }
}

function createSesMailServiceMock(): jest.Mocked<
  Pick<
    SesMailService,
    | 'sendOrderConfirmationEmail'
    | 'sendShippedOrderNotificationEmail'
    | 'sendCancelledOrderNotificationEmail'
  >
> {
  return {
    sendOrderConfirmationEmail: jest.fn().mockResolvedValue({ status: 'SENT' }),
    sendShippedOrderNotificationEmail: jest.fn().mockResolvedValue({ status: 'SENT' }),
    sendCancelledOrderNotificationEmail: jest.fn().mockResolvedValue({ status: 'SENT' }),
  }
}

function createVnpayServiceMock(): jest.Mocked<
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
> {
  return {
    buildOrderPaymentUrl: jest.fn().mockResolvedValue('https://vnpay.example/pay'),
    verifyReturnQuery: jest.fn(),
    verifyIpnQuery: jest.fn(),
    queryOrderPayment: jest.fn(),
    refundOrderPayment: jest.fn(),
    getApiIpAddress: jest.fn().mockReturnValue('127.0.0.1'),
    logIpnResponse: jest.fn(),
    buildFrontendPaymentReturnUrl: jest.fn().mockReturnValue('https://storefront.example/return'),
  }
}

describe('FindExpiredReservedOrdersUseCase', () => {
  it('delegates to the repository', async () => {
    const repository = createOrderRepositoryMock()
    repository.findExpiredReserved.mockResolvedValue({ items: [baseOrder] })
    const useCase = new FindExpiredReservedOrdersUseCase(repository)

    const result = await useCase.execute(1000, 25, { orderId: 'cursor' })

    expect(repository.findExpiredReserved).toHaveBeenCalledWith(1000, 25, { orderId: 'cursor' })
    expect(result.items).toEqual([baseOrder])
  })
})

describe('ReleaseExpiredOrderReservationUseCase', () => {
  it('is a no-op when the order cannot expire its reservation', async () => {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    const inventoryRepository = createInventoryRepositoryMock()
    const dynamoTables = createDynamoTablesMock()
    const useCase = new ReleaseExpiredOrderReservationUseCase(repository, orderItemRepository, inventoryRepository, dynamoTables)

    await useCase.execute(Order.fromRecord({ ...baseOrder, status: OrderStatus.CONFIRMED }))

    expect(orderItemRepository.findByOrderId).not.toHaveBeenCalled()
    expect(repository.executeTransaction).not.toHaveBeenCalled()
  })

  it('is a no-op when the order has no items', async () => {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    orderItemRepository.findByOrderId.mockResolvedValue([])
    const inventoryRepository = createInventoryRepositoryMock()
    const dynamoTables = createDynamoTablesMock()
    const useCase = new ReleaseExpiredOrderReservationUseCase(repository, orderItemRepository, inventoryRepository, dynamoTables)
    const expiredOrder = Order.fromRecord({
      ...baseOrder,
      paymentExpiresAt: Math.floor(Date.now() / 1000) - 10,
    })

    await useCase.execute(expiredOrder)

    expect(orderItemRepository.findByOrderId).toHaveBeenCalledWith(expiredOrder.orderId)
    expect(repository.executeTransaction).not.toHaveBeenCalled()
  })

  it('releases inventory for an expired reservation with items', async () => {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    orderItemRepository.findByOrderId.mockResolvedValue([baseOrderItem])
    const inventoryRepository = createInventoryRepositoryMock()
    const dynamoTables = createDynamoTablesMock()
    const useCase = new ReleaseExpiredOrderReservationUseCase(repository, orderItemRepository, inventoryRepository, dynamoTables)
    const expiredOrder = Order.fromRecord({
      ...baseOrder,
      paymentExpiresAt: Math.floor(Date.now() / 1000) - 10,
    })

    await useCase.execute(expiredOrder)

    expect(repository.executeTransaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ Update: expect.objectContaining({ TableName: 'orders-test' }) }),
      ]),
    )
  })
})

describe('FindOrdersUseCase', () => {
  it('queries with the staff scope for admins/managers', async () => {
    const repository = createOrderRepositoryMock()
    repository.findMany.mockResolvedValue({ items: [baseOrder] })
    const useCase = new FindOrdersUseCase(repository)

    const result = await useCase.execute(adminUser, {})

    expect(repository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ isAdminOrManager: true, requestingCustomerId: adminUser.sub }),
      10,
      undefined,
    )
    expect(result.items).toEqual([baseOrder])
  })

  it('queries with the customer scope for regular customers', async () => {
    const repository = createOrderRepositoryMock()
    repository.findMany.mockResolvedValue({ items: [baseOrder] })
    const useCase = new FindOrdersUseCase(repository)

    await useCase.execute(customerUser, {})

    expect(repository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ isAdminOrManager: false, requestingCustomerId: customerUser.sub }),
      10,
      undefined,
    )
  })
})

describe('FindOneOrderUseCase', () => {
  it('throws NotFoundError when the order does not exist', async () => {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    repository.findById.mockResolvedValue(null)
    const useCase = new FindOneOrderUseCase(repository, orderItemRepository)

    await expect(useCase.execute(customerUser, 'missing')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ForbiddenDomainError when a customer requests another customer order', async () => {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    repository.findById.mockResolvedValue(Order.fromRecord({ ...baseOrder, customerId: 'someone-else' }))
    const useCase = new FindOneOrderUseCase(repository, orderItemRepository)

    await expect(useCase.execute(customerUser, baseOrder.orderId)).rejects.toBeInstanceOf(
      ForbiddenDomainError,
    )
  })

  it('returns the order combined with its items', async () => {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    repository.findById.mockResolvedValue(baseOrder)
    orderItemRepository.findByOrderId.mockResolvedValue([baseOrderItem])
    const useCase = new FindOneOrderUseCase(repository, orderItemRepository)

    const result = await useCase.execute(customerUser, baseOrder.orderId)

    expect(result.items).toEqual([baseOrderItem])
  })
})

describe('GetOrderEmailStatisticsUseCase', () => {
  it('delegates to the email tracking service', async () => {
    const emailTrackingService = createEmailTrackingServiceMock()
    emailTrackingService.getStatistics.mockResolvedValue({} as never)
    const useCase = new GetOrderEmailStatisticsUseCase(emailTrackingService as never)

    await useCase.execute()

    expect(emailTrackingService.getStatistics).toHaveBeenCalledWith([
      'ORDER_CONFIRMATION',
      'SHIPPED_ORDER_NOTIFICATION',
      'CANCELLED_ORDER_NOTIFICATION',
    ])
  })
})

describe('GetOrderEmailTrackingUseCase', () => {
  it('verifies the order exists before delegating to the email tracking service', async () => {
    const repository = createOrderRepositoryMock()
    repository.findById.mockResolvedValue(baseOrder)
    const emailTrackingService = createEmailTrackingServiceMock()
    emailTrackingService.findByContext.mockResolvedValue([])
    const useCase = new GetOrderEmailTrackingUseCase(
      repository,
      emailTrackingService as never,
    )

    await useCase.execute(baseOrder.orderId)

    expect(repository.findById).toHaveBeenCalledWith(baseOrder.orderId)
    expect(emailTrackingService.findByContext).toHaveBeenCalledWith('ORDER', baseOrder.orderId, [
      'ORDER_CONFIRMATION',
      'SHIPPED_ORDER_NOTIFICATION',
      'CANCELLED_ORDER_NOTIFICATION',
    ])
  })

  it('propagates NotFoundError when the order does not exist', async () => {
    const repository = createOrderRepositoryMock()
    repository.findById.mockResolvedValue(null)
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new GetOrderEmailTrackingUseCase(
      repository,
      emailTrackingService as never,
    )

    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(NotFoundError)
    expect(emailTrackingService.findByContext).not.toHaveBeenCalled()
  })
})

describe('ResendFailedOrderEmailUseCase', () => {
  it('throws InvalidInputError for an unsupported email type', async () => {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const sesMailService = createSesMailServiceMock()
    const useCase = new ResendFailedOrderEmailUseCase(
      repository,
      orderItemRepository,
      emailTrackingService as never,
      sesMailService as never,
    )

    await expect(
      useCase.execute(baseOrder.orderId, 'WELCOME_NEW_CUSTOMER', 'a@example.com'),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('throws InvalidInputError when recipientEmail is blank', async () => {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    repository.findById.mockResolvedValue(baseOrder)
    const emailTrackingService = createEmailTrackingServiceMock()
    const sesMailService = createSesMailServiceMock()
    const useCase = new ResendFailedOrderEmailUseCase(
      repository,
      orderItemRepository,
      emailTrackingService as never,
      sesMailService as never,
    )

    await expect(
      useCase.execute(baseOrder.orderId, 'ORDER_CONFIRMATION', '   '),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('returns SKIPPED when there is no retryable recipient', async () => {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    repository.findById.mockResolvedValue(baseOrder)
    const emailTrackingService = createEmailTrackingServiceMock()
    emailTrackingService.findLatestRetryableForRecipient.mockResolvedValue(null as never)
    const sesMailService = createSesMailServiceMock()
    const useCase = new ResendFailedOrderEmailUseCase(
      repository,
      orderItemRepository,
      emailTrackingService as never,
      sesMailService as never,
    )

    const result = await useCase.execute(baseOrder.orderId, 'ORDER_CONFIRMATION', 'a@example.com')

    expect(result).toMatchObject({
      status: 'SKIPPED',
      reason: 'no-retryable-recipients',
      resentCount: 0,
    })
    expect(sesMailService.sendOrderConfirmationEmail).not.toHaveBeenCalled()
  })

  it('resends the order confirmation email for a retryable recipient', async () => {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    repository.findById.mockResolvedValue(baseOrder)
    orderItemRepository.findByOrderId.mockResolvedValue([baseOrderItem])
    const emailTrackingService = createEmailTrackingServiceMock()
    emailTrackingService.findLatestRetryableForRecipient.mockResolvedValue({
      emailId: 'email-1',
    } as never)
    const sesMailService = createSesMailServiceMock()
    const useCase = new ResendFailedOrderEmailUseCase(
      repository,
      orderItemRepository,
      emailTrackingService as never,
      sesMailService as never,
    )

    const result = await useCase.execute(baseOrder.orderId, 'ORDER_CONFIRMATION', 'A@Example.com')

    expect(sesMailService.sendOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmails: ['a@example.com'], resendOfEmailId: 'email-1' }),
    )
    expect(result.resentCount).toBe(1)
    expect(result.status).toBe('SENT')
  })
})

describe('UpdateOrderStatusUseCase', () => {
  const actor: AuditMutationContext = {
    actorType: 'admin',
    actorId: adminUser.sub,
    reason: 'Manual status update',
  }

  it('is a no-op when shipping an already-SHIPPED order', async () => {
    const repository = createOrderRepositoryMock()
    repository.findById.mockResolvedValue(
      Order.fromRecord({ ...baseOrder, status: OrderStatus.SHIPPED }),
    )
    const orderItemRepository = createOrderItemRepositoryMock()
    const inventoryRepository = createInventoryRepositoryMock()
    const publisher = createEventsPublisherMock()
    const useCase = new UpdateOrderStatusUseCase(repository, orderItemRepository, inventoryRepository, createDynamoTablesMock(), publisher)

    await useCase.execute(adminUser, baseOrder.orderId, OrderStatus.SHIPPED)

    expect(repository.save).not.toHaveBeenCalled()
    expect(publisher.publishOrderShipped).not.toHaveBeenCalled()
  })

  it('throws InvalidInputError when shipping an order that is not a paid confirmed order', async () => {
    const repository = createOrderRepositoryMock()
    repository.findById.mockResolvedValue(baseOrder) // RESERVED, not CONFIRMED+PAID
    const orderItemRepository = createOrderItemRepositoryMock()
    const inventoryRepository = createInventoryRepositoryMock()
    const publisher = createEventsPublisherMock()
    const useCase = new UpdateOrderStatusUseCase(repository, orderItemRepository, inventoryRepository, createDynamoTablesMock(), publisher)

    await expect(
      useCase.execute(adminUser, baseOrder.orderId, OrderStatus.SHIPPED),
    ).rejects.toBeInstanceOf(InvalidInputError)
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('ships a paid confirmed order, saves it and publishes the shipped event', async () => {
    const repository = createOrderRepositoryMock()
    const confirmedPaidOrder = Order.fromRecord({
      ...baseOrder,
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
    })
    const shippedOrder = Order.fromRecord({ ...confirmedPaidOrder, status: OrderStatus.SHIPPED })
    repository.findById
      .mockResolvedValueOnce(confirmedPaidOrder)
      .mockResolvedValueOnce(shippedOrder)
    const orderItemRepository = createOrderItemRepositoryMock()
    const inventoryRepository = createInventoryRepositoryMock()
    const publisher = createEventsPublisherMock()
    const dynamoTables = createDynamoTablesMock()
    const useCase = new UpdateOrderStatusUseCase(repository, orderItemRepository, inventoryRepository, dynamoTables, publisher)

    const result = await useCase.execute(adminUser, baseOrder.orderId, OrderStatus.SHIPPED)

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.SHIPPED }),
    )
    expect(publisher.publishOrderShipped).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: baseOrder.orderId }),
    )
    expect(result).toEqual(shippedOrder)
  })

  it('is a no-op when cancelling an already-CANCELLED order', async () => {
    const repository = createOrderRepositoryMock()
    repository.findById.mockResolvedValue(
      Order.fromRecord({ ...baseOrder, status: OrderStatus.CANCELLED }),
    )
    const orderItemRepository = createOrderItemRepositoryMock()
    const inventoryRepository = createInventoryRepositoryMock()
    const publisher = createEventsPublisherMock()
    const dynamoTables = createDynamoTablesMock()
    const useCase = new UpdateOrderStatusUseCase(repository, orderItemRepository, inventoryRepository, dynamoTables, publisher)

    await useCase.execute(adminUser, baseOrder.orderId, OrderStatus.CANCELLED)

    expect(repository.executeTransaction).not.toHaveBeenCalled()
    expect(publisher.publishOrderCancelled).not.toHaveBeenCalled()
  })

  it('throws InvalidInputError when cancelling an order that is not a paid confirmed order', async () => {
    const repository = createOrderRepositoryMock()
    repository.findById.mockResolvedValue(baseOrder) // RESERVED, not CONFIRMED+PAID
    const orderItemRepository = createOrderItemRepositoryMock()
    const inventoryRepository = createInventoryRepositoryMock()
    const publisher = createEventsPublisherMock()
    const dynamoTables = createDynamoTablesMock()
    const useCase = new UpdateOrderStatusUseCase(repository, orderItemRepository, inventoryRepository, dynamoTables, publisher)

    await expect(
      useCase.execute(adminUser, baseOrder.orderId, OrderStatus.CANCELLED),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('cancels a paid confirmed order, releases inventory and publishes the cancelled event', async () => {
    const repository = createOrderRepositoryMock()
    const confirmedPaidOrder = Order.fromRecord({
      ...baseOrder,
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
    })
    const cancelledOrder = Order.fromRecord({
      ...confirmedPaidOrder,
      status: OrderStatus.CANCELLED,
    })
    repository.findById
      .mockResolvedValueOnce(confirmedPaidOrder)
      .mockResolvedValueOnce(cancelledOrder)
    const orderItemRepository = createOrderItemRepositoryMock()
    orderItemRepository.findByOrderId.mockResolvedValue([baseOrderItem])
    const inventoryRepository = createInventoryRepositoryMock()
    const publisher = createEventsPublisherMock()
    const dynamoTables = createDynamoTablesMock()
    const useCase = new UpdateOrderStatusUseCase(repository, orderItemRepository, inventoryRepository, dynamoTables, publisher)

    const result = await useCase.execute(adminUser, baseOrder.orderId, OrderStatus.CANCELLED)

    expect(repository.executeTransaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ Update: expect.objectContaining({ TableName: 'orders-test' }) }),
      ]),
    )
    expect(publisher.publishOrderCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: baseOrder.orderId }),
    )
    expect(result).toEqual(cancelledOrder)
  })

  it('throws InvalidInputError for any other status', () => {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    const inventoryRepository = createInventoryRepositoryMock()
    const publisher = createEventsPublisherMock()
    const dynamoTables = createDynamoTablesMock()
    const useCase = new UpdateOrderStatusUseCase(repository, orderItemRepository, inventoryRepository, dynamoTables, publisher)

    expect(() =>
      useCase.execute(adminUser, baseOrder.orderId, OrderStatus.CONFIRMED),
    ).toThrow(InvalidInputError)
  })
})

describe('TriggerPaymentUseCase', () => {
  function createDeps() {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    const dynamoTables = createDynamoTablesMock()
    const vnpayService = createVnpayServiceMock()
    const useCase = new TriggerPaymentUseCase(
      repository,
      orderItemRepository,
      dynamoTables,
      vnpayService as never,
    )
    return {
      repository,
      orderItemRepository,
      dynamoTables,
      vnpayService,
      useCase,
    }
  }

  it('throws ForbiddenDomainError when a different customer requests payment', async () => {
    const { repository, useCase } = createDeps()
    repository.findById.mockResolvedValue(
      Order.fromRecord({ ...baseOrder, customerId: 'someone-else' }),
    )

    await expect(
      useCase.execute(customerUser, baseOrder.orderId, '127.0.0.1'),
    ).rejects.toBeInstanceOf(ForbiddenDomainError)
  })

  it('throws InvalidInputError when the order is not RESERVED', async () => {
    const { repository, useCase } = createDeps()
    repository.findById.mockResolvedValue(
      Order.fromRecord({ ...baseOrder, status: OrderStatus.PENDING }),
    )

    await expect(
      useCase.execute(customerUser, baseOrder.orderId, '127.0.0.1'),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('throws InvalidInputError when the order is already paid', async () => {
    const { repository, useCase } = createDeps()
    repository.findById.mockResolvedValue(
      Order.fromRecord({ ...baseOrder, paymentStatus: PaymentStatus.PAID }),
    )

    await expect(
      useCase.execute(customerUser, baseOrder.orderId, '127.0.0.1'),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('throws InvalidInputError when the order has no payable amount', async () => {
    const { repository, useCase } = createDeps()
    repository.findById.mockResolvedValue(
      Order.fromRecord({ ...baseOrder, totalAmount: undefined }),
    )

    await expect(
      useCase.execute(customerUser, baseOrder.orderId, '127.0.0.1'),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('releases the reservation and throws ConflictError when the payment window has expired', async () => {
    const { repository, orderItemRepository, useCase } = createDeps()
    const expiredOrder = Order.fromRecord({
      ...baseOrder,
      paymentExpiresAt: Math.floor(Date.now() / 1000) - 10,
    })
    repository.findById.mockResolvedValue(expiredOrder)
    orderItemRepository.findByOrderId.mockResolvedValue([])

    await expect(
      useCase.execute(customerUser, baseOrder.orderId, '127.0.0.1'),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(orderItemRepository.findByOrderId).toHaveBeenCalledWith(expiredOrder.orderId)
  })

  it('builds a payment url and saves the order with PROCESSING status for a valid reserved order', async () => {
    const { repository, vnpayService, useCase } = createDeps()
    repository.findById.mockResolvedValue(baseOrder)

    const result = await useCase.execute(customerUser, baseOrder.orderId, '203.0.113.5')

    expect(vnpayService.buildOrderPaymentUrl).toHaveBeenCalledWith(
      expect.objectContaining({ amount: baseOrder.totalAmount, clientIp: '203.0.113.5' }),
    )
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ paymentStatus: PaymentStatus.PROCESSING }),
    )
    expect(result).toMatchObject({
      orderId: baseOrder.orderId,
      paymentStatus: PaymentStatus.PROCESSING,
      paymentUrl: 'https://vnpay.example/pay',
    })
  })
})

describe('CreateOrderRequestUseCase', () => {
  const activeCart = Cart.fromRecord({
    customerId: customerUser.sub,
    cartId: 'cart-1',
    status: CartStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })

  const cartItemFixture = {
    cartId: activeCart.cartId,
    customerId: customerUser.sub,
    productId: 'p1',
    quantity: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  const cartProductFixture = Product.fromRecord({
    productId: 'p1',
    name: 'Headphones',
    description: 'Wireless headphones',
    categoryId: 'electronics',
    price: 100000,
    currency: 'VND',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  function createDeps() {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    const cartRepository = createCartRepositoryMock()
    const inventoryRepository = createInventoryRepositoryMock()
    const productRepository = createProductRepositoryMock()
    const cognitoUserRepository = createCognitoUserRepositoryMock()
    const dynamoTables = createDynamoTablesMock()
    const configService = createConfigServiceMock()

    // Default: cart found and active
    cartRepository.findOne.mockResolvedValue(activeCart)

    const useCase = new CreateOrderRequestUseCase(
      repository,
      orderItemRepository,
      cartRepository,
      inventoryRepository,
      productRepository,
      cognitoUserRepository,
      dynamoTables,
      configService as never,
    )

    return {
      repository,
      orderItemRepository,
      cartRepository,
      inventoryRepository,
      productRepository,
      cognitoUserRepository,
      useCase,
    }
  }

  it('throws InvalidInputError when the cart has expired', async () => {
    const { cartRepository, useCase } = createDeps()
    cartRepository.findOne.mockResolvedValue(
      Cart.fromRecord({ ...activeCart, status: CartStatus.EXPIRED }),
    )

    await expect(
      useCase.execute(customerUser, { cartId: activeCart.cartId }),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('creates the order, marks it FAILED and saves it when the cart has no items', async () => {
    const { repository, cartRepository, useCase } = createDeps()
    cartRepository.findItems.mockResolvedValue([])

    await useCase.execute(customerUser, { cartId: activeCart.cartId })

    expect(repository.create).toHaveBeenCalled()
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.FAILED }),
    )
  })

  it('reserves inventory and marks the order RESERVED on success', async () => {
    const { repository, cartRepository, orderItemRepository, inventoryRepository, productRepository, useCase } = createDeps()
    const pendingOrder = Order.fromRecord({ ...baseOrder, status: OrderStatus.PENDING, paymentStatus: 'NOT_STARTED' as never })
    cartRepository.findItems.mockResolvedValue([cartItemFixture as never])
    productRepository.findOne.mockResolvedValue(cartProductFixture)
    inventoryRepository.reserve.mockResolvedValue(undefined)
    orderItemRepository.createMany.mockResolvedValue(undefined)
    repository.findById
      .mockResolvedValueOnce(pendingOrder)
      .mockResolvedValue(Order.fromRecord({ ...baseOrder, status: OrderStatus.RESERVED }))

    const result = await useCase.execute(customerUser, { cartId: activeCart.cartId })

    expect(inventoryRepository.reserve).toHaveBeenCalled()
    expect(orderItemRepository.createMany).toHaveBeenCalled()
    expect(cartRepository.updateStatus).toHaveBeenCalledWith(
      activeCart.customerId,
      activeCart.cartId,
      CartStatus.EXPIRED,
      expect.any(String),
    )
    expect(result.status).toBe(OrderStatus.RESERVED)
  })

  it('does not expire the cart when inventory reservation fails with ConflictError', async () => {
    const { repository, cartRepository, inventoryRepository, productRepository, useCase } = createDeps()
    cartRepository.findItems.mockResolvedValue([cartItemFixture as never])
    productRepository.findOne.mockResolvedValue(cartProductFixture)
    inventoryRepository.reserve.mockRejectedValue(new ConflictError('Insufficient stock.'))
    repository.findById
      .mockResolvedValueOnce(baseOrder)
      .mockResolvedValue(Order.fromRecord({ ...baseOrder, status: OrderStatus.FAILED }))

    const result = await useCase.execute(customerUser, { cartId: activeCart.cartId })

    expect(cartRepository.updateStatus).not.toHaveBeenCalled()
    expect(result.status).toBe(OrderStatus.FAILED)
  })

  it('rethrows when an unexpected error occurs during reservation', async () => {
    const { cartRepository, productRepository, useCase } = createDeps()
    cartRepository.findItems.mockResolvedValue([cartItemFixture as never])
    productRepository.findOne.mockRejectedValue(new Error('Unexpected product error.'))

    await expect(
      useCase.execute(customerUser, { cartId: activeCart.cartId }),
    ).rejects.toThrow('Unexpected product error.')
  })
})

describe('VnpayReconcileService', () => {
  function createDeps() {
    const repository = createOrderRepositoryMock()
    const orderItemRepository = createOrderItemRepositoryMock()
    orderItemRepository.findByOrderId.mockResolvedValue([baseOrderItem])
    const dynamoTables = createDynamoTablesMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const sesMailService = createSesMailServiceMock()
    const vnpayService = createVnpayServiceMock()

    const useCase = new VnpayReconcileService(
      repository,
      orderItemRepository,
      dynamoTables,
      emailTrackingService as never,
      sesMailService as never,
      vnpayService as never,
    )

    return {
      repository,
      orderItemRepository,
      dynamoTables,
      emailTrackingService,
      sesMailService,
      vnpayService,
      useCase,
    }
  }

  const verify: VerifyIpnCall = {
    isSuccess: true,
    isVerified: true,
    message: 'Success',
    vnp_TxnRef: baseOrder.orderId,
    vnp_Amount: baseOrder.totalAmount as number,
    vnp_OrderInfo: 'Thanh toan don hang order-1',
    vnp_TransactionNo: 123456,
  } as unknown as VerifyIpnCall

  it('returns IpnOrderNotFound when the order does not exist', async () => {
    const { repository, useCase } = createDeps()
    repository.findById.mockResolvedValue(null)

    await expect(useCase.execute(verify, 'ipn')).resolves.toBe(IpnOrderNotFound)
  })

  it('returns IpnInvalidAmount on an amount mismatch', async () => {
    const { repository, useCase } = createDeps()
    repository.findById.mockResolvedValue(
      Order.fromRecord({ ...baseOrder, totalAmount: 1 }),
    )

    await expect(useCase.execute(verify, 'ipn')).resolves.toBe(IpnInvalidAmount)
  })

  it('returns InpOrderAlreadyConfirmed and best-effort sends the confirmation email when already paid', async () => {
    const { repository, sesMailService, useCase } = createDeps()
    repository.findById.mockResolvedValue(
      Order.fromRecord({
        ...baseOrder,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      }),
    )

    await expect(useCase.execute(verify, 'ipn')).resolves.toBe(InpOrderAlreadyConfirmed)
    expect(sesMailService.sendOrderConfirmationEmail).toHaveBeenCalled()
  })

  it('returns IpnSuccess for a duplicate auto-refund notification', async () => {
    const { repository, useCase } = createDeps()
    repository.findById.mockResolvedValue(
      Order.fromRecord({
        ...baseOrder,
        status: OrderStatus.EXPIRED,
        paymentStatus: PaymentStatus.FAILED,
        paymentTransactionId: '123456',
        paymentFailureReason:
          'Payment arrived after reservation expiry. Amount refunded automatically.',
      }),
    )

    await expect(useCase.execute(verify, 'ipn')).resolves.toBe(IpnSuccess)
  })

  it('saves the order with FAILED payment status for a failed verification', async () => {
    const { repository, useCase } = createDeps()
    repository.findById.mockResolvedValue(
      Order.fromRecord({
        ...baseOrder,
        status: OrderStatus.RESERVED,
        paymentStatus: PaymentStatus.PROCESSING,
        paymentAttemptId: 'attempt-1',
      }),
    )

    const result = await useCase.execute({ ...verify, isSuccess: false }, 'ipn')

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ paymentStatus: PaymentStatus.FAILED }),
    )
    expect(result).toBe(IpnSuccess)
  })

  it('confirms the payment, saves the order and sends the confirmation email on a successful reconciliation', async () => {
    const { repository, sesMailService, useCase } = createDeps()
    const reservedOrder = Order.fromRecord({
      ...baseOrder,
      status: OrderStatus.RESERVED,
      paymentStatus: PaymentStatus.PROCESSING,
      paymentAttemptId: 'attempt-1',
    })
    repository.findById
      .mockResolvedValueOnce(reservedOrder)
      .mockResolvedValueOnce(
        Order.fromRecord({
          ...reservedOrder,
          status: OrderStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PAID,
        }),
      )

    const result = await useCase.execute(verify, 'ipn')

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      }),
    )
    expect(sesMailService.sendOrderConfirmationEmail).toHaveBeenCalled()
    expect(result).toBe(IpnSuccess)
  })
})

describe('HandleVnpayReturnUseCase', () => {
  it('reconciles a verified return and builds the storefront redirect url', async () => {
    const vnpayService = createVnpayServiceMock()
    vnpayService.verifyReturnQuery.mockResolvedValue({
      isVerified: true,
      isSuccess: true,
      message: 'Success',
      vnp_TxnRef: baseOrder.orderId,
    } as never)
    const reconcileService = mockUseCase<VnpayReconcileService>()
    reconcileService.execute.mockResolvedValue(IpnSuccess)
    const useCase = new HandleVnpayReturnUseCase(vnpayService as never, reconcileService)

    const result = await useCase.execute({ vnp_TxnRef: baseOrder.orderId })

    expect(reconcileService.execute).toHaveBeenCalledWith(expect.anything(), 'return')
    expect(result.redirectUrl).toBe('https://storefront.example/return')
  })

  it('redirects with an invalid payload message when verification throws', async () => {
    const vnpayService = createVnpayServiceMock()
    vnpayService.verifyReturnQuery.mockRejectedValue(new Error('bad signature'))
    const reconcileService = mockUseCase<VnpayReconcileService>()
    const useCase = new HandleVnpayReturnUseCase(vnpayService as never, reconcileService)

    const result = await useCase.execute({})

    expect(vnpayService.buildFrontendPaymentReturnUrl).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ isVerified: false, message: 'Invalid VNPay return payload.' }),
    )
    expect(result.redirectUrl).toBe('https://storefront.example/return')
  })
})

describe('HandleVnpayIpnUseCase', () => {
  it('returns IpnFailChecksum when verification throws', async () => {
    const vnpayService = createVnpayServiceMock()
    vnpayService.verifyIpnQuery.mockRejectedValue(new Error('bad signature'))
    const reconcileService = mockUseCase<VnpayReconcileService>()
    const useCase = new HandleVnpayIpnUseCase(vnpayService as never, reconcileService)

    await expect(useCase.execute({})).resolves.toBe(IpnFailChecksum)
    expect(reconcileService.execute).not.toHaveBeenCalled()
  })

  it('returns IpnFailChecksum when the callback is not verified', async () => {
    const vnpayService = createVnpayServiceMock()
    vnpayService.verifyIpnQuery.mockResolvedValue({ isVerified: false } as never)
    const reconcileService = mockUseCase<VnpayReconcileService>()
    const useCase = new HandleVnpayIpnUseCase(vnpayService as never, reconcileService)

    await expect(useCase.execute({})).resolves.toBe(IpnFailChecksum)
    expect(reconcileService.execute).not.toHaveBeenCalled()
  })

  it('delegates verified callbacks to the reconcile service', async () => {
    const vnpayService = createVnpayServiceMock()
    const verifyResult = { isVerified: true } as never
    vnpayService.verifyIpnQuery.mockResolvedValue(verifyResult)
    const reconcileService = mockUseCase<VnpayReconcileService>()
    reconcileService.execute.mockResolvedValue(IpnSuccess)
    const useCase = new HandleVnpayIpnUseCase(vnpayService as never, reconcileService)

    await expect(useCase.execute({})).resolves.toBe(IpnSuccess)
    expect(reconcileService.execute).toHaveBeenCalledWith(verifyResult, 'ipn')
  })
})
