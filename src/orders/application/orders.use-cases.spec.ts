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
import { CartStatus } from '../../carts/domain/cart-status.enum'
import { Cart, CartItem } from '../../carts/domain/cart.entity'
import { GetCartItemsUseCase } from '../../carts/application/get-cart-items.use-case'
import { GetOwnedCartUseCase } from '../../carts/application/get-owned-cart.use-case'
import { MarkCartExpiredUseCase } from '../../carts/application/mark-cart-expired.use-case'
import {
  ConflictError,
  ForbiddenDomainError,
  InvalidInputError,
  NotFoundError,
} from '../../common/domain-error'
import { ReserveInventoryUseCase } from '../../inventory/application/reserve-inventory.use-case'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { SesMailService } from '../../mail/ses-mail.service'
import { FindOneProductUseCase } from '../../products/application/find-one-product.use-case'
import { Product } from '../../products/domain/product.entity'
import { ProductStatus } from '../../products/domain/product-status.enum'
import { FindCustomerProfileByUsernameUseCase } from '../../users/application/find-customer-profile-by-username.use-case'
import { Order, OrderItem } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { OrderRepositoryPort } from '../domain/order.repository.port'
import { PaymentStatus } from '../domain/payment-status.enum'
import { OrderEventsPublisher } from '../infrastructure/order-events.publisher'
import { VnpayService } from '../infrastructure/vnpay.service'
import { CancelConfirmedPaidOrderUseCase } from './cancel-confirmed-paid-order.use-case'
import { CreateOrderRequestUseCase } from './create-order-request.use-case'
import { ExpireReservationAndReleaseInventoryIfUnpaidUseCase } from './expire-reservation-and-release-inventory-if-unpaid.use-case'
import { FailPendingOrderAndReleaseReservationUseCase } from './fail-pending-order-and-release-reservation.use-case'
import { FindExpiredReservedOrdersUseCase } from './find-expired-reserved-orders.use-case'
import { FindOneOrderUseCase } from './find-one-order.use-case'
import { FindOrderItemsUseCase } from './find-order-items.use-case'
import { FindOrdersUseCase } from './find-orders.use-case'
import { GetOrderByIdUseCase } from './get-order-by-id.use-case'
import { GetOrderEmailStatisticsUseCase } from './get-order-email-statistics.use-case'
import { GetOrderEmailTrackingUseCase } from './get-order-email-tracking.use-case'
import { HandleVnpayIpnUseCase } from './handle-vnpay-ipn.use-case'
import { HandleVnpayReturnUseCase } from './handle-vnpay-return.use-case'
import { MarkExpiredPaymentRefundedUseCase } from './mark-expired-payment-refunded.use-case'
import { MarkFailedUseCase } from './mark-failed.use-case'
import { MarkOrderShippedUseCase } from './mark-order-shipped.use-case'
import { MarkPaymentFailedUseCase } from './mark-payment-failed.use-case'
import { MarkPaymentSucceededUseCase } from './mark-payment-succeeded.use-case'
import { MarkReservedUseCase } from './mark-reserved.use-case'
import { ReconcileVerifiedGatewayResultUseCase } from './reconcile-verified-gateway-result.use-case'
import { ReleaseExpiredOrderReservationUseCase } from './release-expired-order-reservation.use-case'
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
    createOrderItems: jest.fn(),
    findOrderItems: jest.fn(),
    findById: jest.fn(),
    findMany: jest.fn(),
    findExpiredReserved: jest.fn(),
    markReserved: jest.fn(),
    markFailed: jest.fn(),
    markShipped: jest.fn(),
    cancelConfirmedPaidOrder: jest.fn(),
    startPayment: jest.fn(),
    markPaymentSucceeded: jest.fn(),
    markPaymentFailed: jest.fn(),
    markExpiredPaymentRefunded: jest.fn(),
    failPendingOrderAndReleaseReservation: jest.fn(),
    expireReservationAndReleaseInventoryIfUnpaid: jest.fn(),
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

describe('GetOrderByIdUseCase', () => {
  it('returns the order when it exists', async () => {
    const repository = createOrderRepositoryMock()
    repository.findById.mockResolvedValue(baseOrder)
    const useCase = new GetOrderByIdUseCase(repository)

    await expect(useCase.execute(baseOrder.orderId)).resolves.toEqual(baseOrder)
  })

  it('throws NotFoundError when the repository returns null', async () => {
    const repository = createOrderRepositoryMock()
    repository.findById.mockResolvedValue(null)
    const useCase = new GetOrderByIdUseCase(repository)

    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('FindOrderItemsUseCase', () => {
  it('delegates to the repository', async () => {
    const repository = createOrderRepositoryMock()
    repository.findOrderItems.mockResolvedValue([baseOrderItem])
    const useCase = new FindOrderItemsUseCase(repository)

    await expect(useCase.execute(baseOrder.orderId)).resolves.toEqual([baseOrderItem])
    expect(repository.findOrderItems).toHaveBeenCalledWith(baseOrder.orderId)
  })
})

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

describe('MarkFailedUseCase', () => {
  it('delegates to the repository with a default system actor', async () => {
    const repository = createOrderRepositoryMock()
    const useCase = new MarkFailedUseCase(repository)

    await useCase.execute(baseOrder.orderId, OrderStatus.FAILED, 'Cart has no items.')

    expect(repository.markFailed).toHaveBeenCalledWith(
      baseOrder.orderId,
      OrderStatus.FAILED,
      'Cart has no items.',
      expect.objectContaining({ actorType: 'system', reason: 'Cart has no items.' }),
    )
  })

  it('uses the explicit actor when provided', async () => {
    const repository = createOrderRepositoryMock()
    const useCase = new MarkFailedUseCase(repository)
    const actor: AuditMutationContext = { actorType: 'admin', actorId: 'admin-1', reason: 'manual' }

    await useCase.execute(baseOrder.orderId, OrderStatus.FAILED, 'manual', actor)

    expect(repository.markFailed).toHaveBeenCalledWith(
      baseOrder.orderId,
      OrderStatus.FAILED,
      'manual',
      actor,
    )
  })
})

describe('MarkReservedUseCase', () => {
  it('computes paymentExpiresAt from the configured timeout and delegates', async () => {
    const repository = createOrderRepositoryMock()
    const configService = createConfigServiceMock(60)
    const useCase = new MarkReservedUseCase(repository, configService as never)

    const before = Math.floor(Date.now() / 1000)
    await useCase.execute(baseOrder.orderId, 200000)
    const after = Math.floor(Date.now() / 1000)

    expect(configService.getOrThrow).toHaveBeenCalledWith('PAYMENT_CONFIRMATION_SECONDS_TIMEOUT')
    const call = repository.markReserved.mock.calls[0]
    expect(call[0]).toBe(baseOrder.orderId)
    expect(call[1]).toBe(200000)
    expect(call[2]).toBeGreaterThanOrEqual(before + 60)
    expect(call[2]).toBeLessThanOrEqual(after + 60)
    expect(call[3]).toEqual(
      expect.objectContaining({ actorType: 'system', reason: 'Order reserved' }),
    )
  })
})

describe('FailPendingOrderAndReleaseReservationUseCase', () => {
  it('delegates to the repository with a default system actor', async () => {
    const repository = createOrderRepositoryMock()
    const useCase = new FailPendingOrderAndReleaseReservationUseCase(repository)
    const items = [{ productId: 'p1', quantity: 2 }]

    await useCase.execute(baseOrder.orderId, 'Insufficient inventory', items)

    expect(repository.failPendingOrderAndReleaseReservation).toHaveBeenCalledWith(
      baseOrder.orderId,
      'Insufficient inventory',
      items,
      expect.objectContaining({ actorType: 'system', reason: 'Insufficient inventory' }),
    )
  })
})

describe('ExpireReservationAndReleaseInventoryIfUnpaidUseCase', () => {
  it('delegates to the repository with a default system actor', async () => {
    const repository = createOrderRepositoryMock()
    repository.expireReservationAndReleaseInventoryIfUnpaid.mockResolvedValue(true)
    const useCase = new ExpireReservationAndReleaseInventoryIfUnpaidUseCase(repository)
    const items = [{ productId: 'p1', quantity: 2 }]

    const result = await useCase.execute(baseOrder, items)

    expect(result).toBe(true)
    expect(repository.expireReservationAndReleaseInventoryIfUnpaid).toHaveBeenCalledWith(
      baseOrder,
      items,
      expect.objectContaining({ actorType: 'system', reason: 'Payment expired' }),
    )
  })
})

describe('MarkPaymentSucceededUseCase', () => {
  it('delegates to the repository with a default system actor', async () => {
    const repository = createOrderRepositoryMock()
    const useCase = new MarkPaymentSucceededUseCase(repository)

    await useCase.execute(baseOrder.orderId, 'attempt-1', 'txn-1')

    expect(repository.markPaymentSucceeded).toHaveBeenCalledWith(
      baseOrder.orderId,
      'attempt-1',
      'txn-1',
      expect.objectContaining({ actorType: 'system', reason: 'Payment confirmed' }),
    )
  })

  it('propagates ConflictError raised by the repository', async () => {
    const repository = createOrderRepositoryMock()
    repository.markPaymentSucceeded.mockRejectedValue(new ConflictError('stale attempt'))
    const useCase = new MarkPaymentSucceededUseCase(repository)

    await expect(useCase.execute(baseOrder.orderId, 'attempt-1', 'txn-1')).rejects.toBeInstanceOf(
      ConflictError,
    )
  })
})

describe('MarkPaymentFailedUseCase', () => {
  it('delegates to the repository with a default system actor', async () => {
    const repository = createOrderRepositoryMock()
    const useCase = new MarkPaymentFailedUseCase(repository)

    await useCase.execute(baseOrder.orderId, 'attempt-1', 'Card declined')

    expect(repository.markPaymentFailed).toHaveBeenCalledWith(
      baseOrder.orderId,
      'attempt-1',
      'Card declined',
      expect.objectContaining({ actorType: 'system', reason: 'Card declined' }),
    )
  })
})

describe('MarkExpiredPaymentRefundedUseCase', () => {
  it('delegates to the repository with a default system actor', async () => {
    const repository = createOrderRepositoryMock()
    const useCase = new MarkExpiredPaymentRefundedUseCase(repository)

    await useCase.execute(baseOrder.orderId, 'txn-1', 'Refunded automatically')

    expect(repository.markExpiredPaymentRefunded).toHaveBeenCalledWith(
      baseOrder.orderId,
      'txn-1',
      'Refunded automatically',
      expect.objectContaining({ actorType: 'system', reason: 'Refunded automatically' }),
    )
  })
})

describe('ReleaseExpiredOrderReservationUseCase', () => {
  it('is a no-op when the order is not RESERVED', async () => {
    const findOrderItemsUseCase = mockUseCase<FindOrderItemsUseCase>()
    const expireUseCase = mockUseCase<ExpireReservationAndReleaseInventoryIfUnpaidUseCase>()
    const useCase = new ReleaseExpiredOrderReservationUseCase(findOrderItemsUseCase, expireUseCase)

    await useCase.execute(Order.fromRecord({ ...baseOrder, status: OrderStatus.CONFIRMED }))

    expect(findOrderItemsUseCase.execute).not.toHaveBeenCalled()
    expect(expireUseCase.execute).not.toHaveBeenCalled()
  })

  it('is a no-op when the order has no items', async () => {
    const findOrderItemsUseCase = mockUseCase<FindOrderItemsUseCase>()
    findOrderItemsUseCase.execute.mockResolvedValue([])
    const expireUseCase = mockUseCase<ExpireReservationAndReleaseInventoryIfUnpaidUseCase>()
    const expiredOrder = Order.fromRecord({ ...baseOrder, paymentExpiresAt: Math.floor(Date.now() / 1000) - 10 })
    const useCase = new ReleaseExpiredOrderReservationUseCase(findOrderItemsUseCase, expireUseCase)

    await useCase.execute(expiredOrder)

    expect(expireUseCase.execute).not.toHaveBeenCalled()
  })

  it('releases inventory for an expired reservation with items', async () => {
    const findOrderItemsUseCase = mockUseCase<FindOrderItemsUseCase>()
    findOrderItemsUseCase.execute.mockResolvedValue([baseOrderItem])
    const expireUseCase = mockUseCase<ExpireReservationAndReleaseInventoryIfUnpaidUseCase>()
    const expiredOrder = Order.fromRecord({ ...baseOrder, paymentExpiresAt: Math.floor(Date.now() / 1000) - 10 })
    const useCase = new ReleaseExpiredOrderReservationUseCase(findOrderItemsUseCase, expireUseCase)

    await useCase.execute(expiredOrder)

    expect(expireUseCase.execute).toHaveBeenCalledWith(expiredOrder, [
      { productId: baseOrderItem.productId, quantity: baseOrderItem.quantity },
    ])
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
    repository.findById.mockResolvedValue(null)
    const useCase = new FindOneOrderUseCase(repository)

    await expect(useCase.execute(customerUser, 'missing')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ForbiddenDomainError when a customer requests another customer order', async () => {
    const repository = createOrderRepositoryMock()
    repository.findById.mockResolvedValue(Order.fromRecord({ ...baseOrder, customerId: 'someone-else' }))
    const useCase = new FindOneOrderUseCase(repository)

    await expect(useCase.execute(customerUser, baseOrder.orderId)).rejects.toBeInstanceOf(
      ForbiddenDomainError,
    )
  })

  it('returns the order combined with its items', async () => {
    const repository = createOrderRepositoryMock()
    repository.findById.mockResolvedValue(baseOrder)
    repository.findOrderItems.mockResolvedValue([baseOrderItem])
    const useCase = new FindOneOrderUseCase(repository)

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
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute.mockResolvedValue(baseOrder)
    const emailTrackingService = createEmailTrackingServiceMock()
    emailTrackingService.findByContext.mockResolvedValue([])
    const useCase = new GetOrderEmailTrackingUseCase(
      getOrderByIdUseCase,
      emailTrackingService as never,
    )

    await useCase.execute(baseOrder.orderId)

    expect(getOrderByIdUseCase.execute).toHaveBeenCalledWith(baseOrder.orderId)
    expect(emailTrackingService.findByContext).toHaveBeenCalledWith('ORDER', baseOrder.orderId, [
      'ORDER_CONFIRMATION',
      'SHIPPED_ORDER_NOTIFICATION',
      'CANCELLED_ORDER_NOTIFICATION',
    ])
  })

  it('propagates NotFoundError when the order does not exist', async () => {
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute.mockRejectedValue(new NotFoundError('Order missing was not found.'))
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new GetOrderEmailTrackingUseCase(
      getOrderByIdUseCase,
      emailTrackingService as never,
    )

    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(NotFoundError)
    expect(emailTrackingService.findByContext).not.toHaveBeenCalled()
  })
})

describe('ResendFailedOrderEmailUseCase', () => {
  it('throws InvalidInputError for an unsupported email type', async () => {
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    const findOrderItemsUseCase = mockUseCase<FindOrderItemsUseCase>()
    const emailTrackingService = createEmailTrackingServiceMock()
    const sesMailService = createSesMailServiceMock()
    const useCase = new ResendFailedOrderEmailUseCase(
      getOrderByIdUseCase,
      findOrderItemsUseCase,
      emailTrackingService as never,
      sesMailService as never,
    )

    await expect(
      useCase.execute(baseOrder.orderId, 'WELCOME_NEW_CUSTOMER', 'a@example.com'),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('throws InvalidInputError when recipientEmail is blank', async () => {
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute.mockResolvedValue(baseOrder)
    const findOrderItemsUseCase = mockUseCase<FindOrderItemsUseCase>()
    const emailTrackingService = createEmailTrackingServiceMock()
    const sesMailService = createSesMailServiceMock()
    const useCase = new ResendFailedOrderEmailUseCase(
      getOrderByIdUseCase,
      findOrderItemsUseCase,
      emailTrackingService as never,
      sesMailService as never,
    )

    await expect(
      useCase.execute(baseOrder.orderId, 'ORDER_CONFIRMATION', '   '),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('returns SKIPPED when there is no retryable recipient', async () => {
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute.mockResolvedValue(baseOrder)
    const findOrderItemsUseCase = mockUseCase<FindOrderItemsUseCase>()
    const emailTrackingService = createEmailTrackingServiceMock()
    emailTrackingService.findLatestRetryableForRecipient.mockResolvedValue(null as never)
    const sesMailService = createSesMailServiceMock()
    const useCase = new ResendFailedOrderEmailUseCase(
      getOrderByIdUseCase,
      findOrderItemsUseCase,
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
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute.mockResolvedValue(baseOrder)
    const findOrderItemsUseCase = mockUseCase<FindOrderItemsUseCase>()
    findOrderItemsUseCase.execute.mockResolvedValue([baseOrderItem])
    const emailTrackingService = createEmailTrackingServiceMock()
    emailTrackingService.findLatestRetryableForRecipient.mockResolvedValue({
      emailId: 'email-1',
    } as never)
    const sesMailService = createSesMailServiceMock()
    const useCase = new ResendFailedOrderEmailUseCase(
      getOrderByIdUseCase,
      findOrderItemsUseCase,
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

describe('MarkOrderShippedUseCase', () => {
  const actor: AuditMutationContext = {
    actorType: 'admin',
    actorId: adminUser.sub,
    reason: 'Manual status update',
  }

  it('is a no-op when the order is already SHIPPED', async () => {
    const repository = createOrderRepositoryMock()
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({ ...baseOrder, status: OrderStatus.SHIPPED }))
    const publisher = createEventsPublisherMock()
    const useCase = new MarkOrderShippedUseCase(repository, getOrderByIdUseCase, publisher)

    await useCase.execute(baseOrder.orderId, actor)

    expect(repository.markShipped).not.toHaveBeenCalled()
  })

  it('throws InvalidInputError when the order is not a paid, confirmed order', async () => {
    const repository = createOrderRepositoryMock()
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute.mockResolvedValue(baseOrder)
    const publisher = createEventsPublisherMock()
    const useCase = new MarkOrderShippedUseCase(repository, getOrderByIdUseCase, publisher)

    await expect(useCase.execute(baseOrder.orderId, actor)).rejects.toBeInstanceOf(
      InvalidInputError,
    )
    expect(repository.markShipped).not.toHaveBeenCalled()
  })

  it('marks the order shipped and publishes the shipped event', async () => {
    const repository = createOrderRepositoryMock()
    const confirmedPaidOrder = Order.fromRecord({
      ...baseOrder,
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
    })
    const shippedOrder = Order.fromRecord({ ...confirmedPaidOrder, status: OrderStatus.SHIPPED })
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute
      .mockResolvedValueOnce(confirmedPaidOrder)
      .mockResolvedValueOnce(shippedOrder)
    const publisher = createEventsPublisherMock()
    const useCase = new MarkOrderShippedUseCase(repository, getOrderByIdUseCase, publisher)

    const result = await useCase.execute(baseOrder.orderId, actor)

    expect(repository.markShipped).toHaveBeenCalledWith(
      baseOrder.orderId,
      expect.any(String),
      actor,
    )
    expect(publisher.publishOrderShipped).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: baseOrder.orderId }),
    )
    expect(result).toEqual(shippedOrder)
  })

  it('propagates ConflictError raised by the repository', async () => {
    const repository = createOrderRepositoryMock()
    repository.markShipped.mockRejectedValue(
      new ConflictError('Order cannot be marked as shipped.'),
    )
    const confirmedPaidOrder = Order.fromRecord({
      ...baseOrder,
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
    })
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute.mockResolvedValue(confirmedPaidOrder)
    const publisher = createEventsPublisherMock()
    const useCase = new MarkOrderShippedUseCase(repository, getOrderByIdUseCase, publisher)

    await expect(useCase.execute(baseOrder.orderId, actor)).rejects.toBeInstanceOf(ConflictError)
    expect(publisher.publishOrderShipped).not.toHaveBeenCalled()
  })
})

describe('CancelConfirmedPaidOrderUseCase', () => {
  const actor: AuditMutationContext = {
    actorType: 'admin',
    actorId: adminUser.sub,
    reason: 'Manual status update',
  }

  it('is a no-op when the order is already CANCELLED', async () => {
    const repository = createOrderRepositoryMock()
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({ ...baseOrder, status: OrderStatus.CANCELLED }))
    const findOrderItemsUseCase = mockUseCase<FindOrderItemsUseCase>()
    const publisher = createEventsPublisherMock()
    const useCase = new CancelConfirmedPaidOrderUseCase(
      repository,
      getOrderByIdUseCase,
      findOrderItemsUseCase,
      publisher,
    )

    await useCase.execute(baseOrder.orderId, actor)

    expect(repository.cancelConfirmedPaidOrder).not.toHaveBeenCalled()
  })

  it('throws InvalidInputError when the order is not a paid, confirmed order', async () => {
    const repository = createOrderRepositoryMock()
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute.mockResolvedValue(baseOrder)
    const findOrderItemsUseCase = mockUseCase<FindOrderItemsUseCase>()
    const publisher = createEventsPublisherMock()
    const useCase = new CancelConfirmedPaidOrderUseCase(
      repository,
      getOrderByIdUseCase,
      findOrderItemsUseCase,
      publisher,
    )

    await expect(useCase.execute(baseOrder.orderId, actor)).rejects.toBeInstanceOf(
      InvalidInputError,
    )
  })

  it('cancels the order, releases inventory and publishes the cancelled event', async () => {
    const repository = createOrderRepositoryMock()
    const confirmedPaidOrder = Order.fromRecord({
      ...baseOrder,
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
    })
    const cancelledOrder = Order.fromRecord({ ...confirmedPaidOrder, status: OrderStatus.CANCELLED })
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    getOrderByIdUseCase.execute
      .mockResolvedValueOnce(confirmedPaidOrder)
      .mockResolvedValueOnce(cancelledOrder)
    const findOrderItemsUseCase = mockUseCase<FindOrderItemsUseCase>()
    findOrderItemsUseCase.execute.mockResolvedValue([baseOrderItem])
    const publisher = createEventsPublisherMock()
    const useCase = new CancelConfirmedPaidOrderUseCase(
      repository,
      getOrderByIdUseCase,
      findOrderItemsUseCase,
      publisher,
    )

    const result = await useCase.execute(baseOrder.orderId, actor)

    expect(repository.cancelConfirmedPaidOrder).toHaveBeenCalledWith(
      baseOrder.orderId,
      expect.any(String),
      [{ productId: baseOrderItem.productId, quantity: baseOrderItem.quantity }],
      actor,
    )
    expect(publisher.publishOrderCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: baseOrder.orderId }),
    )
    expect(result).toEqual(cancelledOrder)
  })
})

describe('UpdateOrderStatusUseCase', () => {
  it('dispatches SHIPPED updates to MarkOrderShippedUseCase', async () => {
    const markOrderShippedUseCase = mockUseCase<MarkOrderShippedUseCase>()
    markOrderShippedUseCase.execute.mockResolvedValue(baseOrder)
    const cancelConfirmedPaidOrderUseCase = mockUseCase<CancelConfirmedPaidOrderUseCase>()
    const useCase = new UpdateOrderStatusUseCase(
      markOrderShippedUseCase,
      cancelConfirmedPaidOrderUseCase,
    )

    await useCase.execute(adminUser, baseOrder.orderId, OrderStatus.SHIPPED)

    expect(markOrderShippedUseCase.execute).toHaveBeenCalledWith(
      baseOrder.orderId,
      expect.objectContaining({ actorType: 'admin', reason: 'Manual status update' }),
    )
    expect(cancelConfirmedPaidOrderUseCase.execute).not.toHaveBeenCalled()
  })

  it('dispatches CANCELLED updates to CancelConfirmedPaidOrderUseCase', async () => {
    const markOrderShippedUseCase = mockUseCase<MarkOrderShippedUseCase>()
    const cancelConfirmedPaidOrderUseCase = mockUseCase<CancelConfirmedPaidOrderUseCase>()
    cancelConfirmedPaidOrderUseCase.execute.mockResolvedValue(baseOrder)
    const useCase = new UpdateOrderStatusUseCase(
      markOrderShippedUseCase,
      cancelConfirmedPaidOrderUseCase,
    )

    await useCase.execute(adminUser, baseOrder.orderId, OrderStatus.CANCELLED)

    expect(cancelConfirmedPaidOrderUseCase.execute).toHaveBeenCalled()
    expect(markOrderShippedUseCase.execute).not.toHaveBeenCalled()
  })

  it('throws InvalidInputError for any other status', () => {
    const markOrderShippedUseCase = mockUseCase<MarkOrderShippedUseCase>()
    const cancelConfirmedPaidOrderUseCase = mockUseCase<CancelConfirmedPaidOrderUseCase>()
    const useCase = new UpdateOrderStatusUseCase(
      markOrderShippedUseCase,
      cancelConfirmedPaidOrderUseCase,
    )

    expect(() => useCase.execute(adminUser, baseOrder.orderId, OrderStatus.CONFIRMED)).toThrow(
      InvalidInputError,
    )
  })
})

describe('TriggerPaymentUseCase', () => {
  function createDeps() {
    const repository = createOrderRepositoryMock()
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    const releaseExpiredOrderReservationUseCase =
      mockUseCase<ReleaseExpiredOrderReservationUseCase>()
    const vnpayService = createVnpayServiceMock()
    const useCase = new TriggerPaymentUseCase(
      repository,
      getOrderByIdUseCase,
      releaseExpiredOrderReservationUseCase,
      vnpayService as never,
    )
    return {
      repository,
      getOrderByIdUseCase,
      releaseExpiredOrderReservationUseCase,
      vnpayService,
      useCase,
    }
  }

  it('throws ForbiddenDomainError when a different customer requests payment', async () => {
    const { getOrderByIdUseCase, useCase } = createDeps()
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({ ...baseOrder, customerId: 'someone-else' }))

    await expect(
      useCase.execute(customerUser, baseOrder.orderId, '127.0.0.1'),
    ).rejects.toBeInstanceOf(ForbiddenDomainError)
  })

  it('throws InvalidInputError when the order is not RESERVED', async () => {
    const { getOrderByIdUseCase, useCase } = createDeps()
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({ ...baseOrder, status: OrderStatus.PENDING }))

    await expect(
      useCase.execute(customerUser, baseOrder.orderId, '127.0.0.1'),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('throws InvalidInputError when the order is already paid', async () => {
    const { getOrderByIdUseCase, useCase } = createDeps()
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({
      ...baseOrder,
      paymentStatus: PaymentStatus.PAID,
    }))

    await expect(
      useCase.execute(customerUser, baseOrder.orderId, '127.0.0.1'),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('throws InvalidInputError when the order has no payable amount', async () => {
    const { getOrderByIdUseCase, useCase } = createDeps()
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({ ...baseOrder, totalAmount: undefined }))

    await expect(
      useCase.execute(customerUser, baseOrder.orderId, '127.0.0.1'),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('releases the reservation and throws ConflictError when the payment window has expired', async () => {
    const { getOrderByIdUseCase, releaseExpiredOrderReservationUseCase, useCase } = createDeps()
    const expiredOrder = Order.fromRecord({ ...baseOrder, paymentExpiresAt: Math.floor(Date.now() / 1000) - 10 })
    getOrderByIdUseCase.execute.mockResolvedValue(expiredOrder)

    await expect(
      useCase.execute(customerUser, baseOrder.orderId, '127.0.0.1'),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(releaseExpiredOrderReservationUseCase.execute).toHaveBeenCalledWith(expiredOrder)
  })

  it('builds a payment url and starts the payment for a valid reserved order', async () => {
    const { repository, getOrderByIdUseCase, vnpayService, useCase } = createDeps()
    getOrderByIdUseCase.execute.mockResolvedValue(baseOrder)

    const result = await useCase.execute(customerUser, baseOrder.orderId, '203.0.113.5')

    expect(vnpayService.buildOrderPaymentUrl).toHaveBeenCalledWith(
      expect.objectContaining({ amount: baseOrder.totalAmount, clientIp: '203.0.113.5' }),
    )
    expect(repository.startPayment).toHaveBeenCalled()
    expect(result).toMatchObject({
      orderId: baseOrder.orderId,
      paymentStatus: PaymentStatus.PROCESSING,
      paymentUrl: 'https://vnpay.example/pay',
    })
  })

  it('re-checks expiry and retries as a conflict when starting payment fails', async () => {
    const { repository, getOrderByIdUseCase, releaseExpiredOrderReservationUseCase, useCase } =
      createDeps()
    getOrderByIdUseCase.execute.mockResolvedValueOnce(baseOrder)
    repository.startPayment.mockRejectedValue(new ConflictError('conflict'))
    const expiredLatestOrder = Order.fromRecord({
      ...baseOrder,
      paymentExpiresAt: Math.floor(Date.now() / 1000) - 10,
    })
    getOrderByIdUseCase.execute.mockResolvedValueOnce(expiredLatestOrder)

    await expect(
      useCase.execute(customerUser, baseOrder.orderId, '203.0.113.5'),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(releaseExpiredOrderReservationUseCase.execute).toHaveBeenCalledWith(expiredLatestOrder)
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

  function createDeps() {
    const repository = createOrderRepositoryMock()
    const getOwnedCartUseCase = mockUseCase<GetOwnedCartUseCase>()
    const getCartItemsUseCase = mockUseCase<GetCartItemsUseCase>()
    const markCartExpiredUseCase = mockUseCase<MarkCartExpiredUseCase>()
    const reserveInventoryUseCase = mockUseCase<ReserveInventoryUseCase>()
    const findOneProductUseCase = mockUseCase<FindOneProductUseCase>()
    const findCustomerProfileByUsernameUseCase = mockUseCase<FindCustomerProfileByUsernameUseCase>()
    const markReservedUseCase = mockUseCase<MarkReservedUseCase>()
    const markFailedUseCase = mockUseCase<MarkFailedUseCase>()
    const failPendingOrderAndReleaseReservationUseCase =
      mockUseCase<FailPendingOrderAndReleaseReservationUseCase>()
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()

    const reserveOrderCheckoutItemsUseCase = new ReserveOrderCheckoutItemsUseCase(
      repository,
      reserveInventoryUseCase,
      findOneProductUseCase,
      markReservedUseCase,
      markFailedUseCase,
      failPendingOrderAndReleaseReservationUseCase,
    )

    const useCase = new CreateOrderRequestUseCase(
      repository,
      getOwnedCartUseCase,
      getCartItemsUseCase,
      markCartExpiredUseCase,
      findCustomerProfileByUsernameUseCase,
      markFailedUseCase,
      reserveOrderCheckoutItemsUseCase,
      getOrderByIdUseCase,
    )

    return {
      repository,
      getOwnedCartUseCase,
      getCartItemsUseCase,
      markCartExpiredUseCase,
      reserveInventoryUseCase,
      findOneProductUseCase,
      findCustomerProfileByUsernameUseCase,
      markReservedUseCase,
      markFailedUseCase,
      failPendingOrderAndReleaseReservationUseCase,
      getOrderByIdUseCase,
      reserveOrderCheckoutItemsUseCase,
      useCase,
    }
  }

  it('throws InvalidInputError when the cart has expired', async () => {
    const { getOwnedCartUseCase, useCase } = createDeps()
    getOwnedCartUseCase.execute.mockResolvedValue(Cart.fromRecord({ ...activeCart, status: CartStatus.EXPIRED }))

    await expect(
      useCase.execute(customerUser, { cartId: activeCart.cartId }),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('marks the order FAILED and returns it when the cart has no items', async () => {
    const {
      getOwnedCartUseCase,
      getCartItemsUseCase,
      markFailedUseCase,
      getOrderByIdUseCase,
      repository,
      useCase,
    } = createDeps()
    getOwnedCartUseCase.execute.mockResolvedValue(activeCart)
    getCartItemsUseCase.execute.mockResolvedValue([])
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({ ...baseOrder, status: OrderStatus.FAILED }))

    const result = await useCase.execute(customerUser, { cartId: activeCart.cartId })

    expect(repository.create).toHaveBeenCalled()
    expect(markFailedUseCase.execute).toHaveBeenCalledWith(
      expect.any(String),
      OrderStatus.FAILED,
      'Cart has no items.',
    )
    expect(result.status).toBe(OrderStatus.FAILED)
  })

  it('reserves inventory, creates order items and marks the order RESERVED', async () => {
    const {
      getOwnedCartUseCase,
      getCartItemsUseCase,
      findOneProductUseCase,
      reserveInventoryUseCase,
      markReservedUseCase,
      markCartExpiredUseCase,
      getOrderByIdUseCase,
      repository,
      useCase,
    } = createDeps()
    getOwnedCartUseCase.execute.mockResolvedValue(activeCart)
    getCartItemsUseCase.execute.mockResolvedValue([cartItem])
    findOneProductUseCase.execute.mockResolvedValue(product)
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({ ...baseOrder, status: OrderStatus.RESERVED }))

    const result = await useCase.execute(customerUser, { cartId: activeCart.cartId })

    expect(reserveInventoryUseCase.execute).toHaveBeenCalledWith(
      cartItem.productId,
      cartItem.quantity,
    )
    expect(repository.createOrderItems).toHaveBeenCalledWith([
      expect.objectContaining({
        productId: product.productId,
        quantity: cartItem.quantity,
        lineTotal: 200000,
      }),
    ])
    expect(markReservedUseCase.execute).toHaveBeenCalledWith(expect.any(String), 200000)
    expect(markCartExpiredUseCase.execute).toHaveBeenCalledWith(activeCart)
    expect(result.status).toBe(OrderStatus.RESERVED)
  })

  it('releases any reserved inventory and rethrows when reservation fails partway through', async () => {
    const {
      getOwnedCartUseCase,
      getCartItemsUseCase,
      findOneProductUseCase,
      reserveInventoryUseCase,
      failPendingOrderAndReleaseReservationUseCase,
      markCartExpiredUseCase,
      useCase,
    } = createDeps()
    const secondCartItem: CartItem = { ...cartItem, productId: 'p2' }
    getOwnedCartUseCase.execute.mockResolvedValue(activeCart)
    getCartItemsUseCase.execute.mockResolvedValue([cartItem, secondCartItem])
    findOneProductUseCase.execute.mockResolvedValue(product)
    reserveInventoryUseCase.execute
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Insufficient inventory for product p2.'))
    failPendingOrderAndReleaseReservationUseCase.execute.mockResolvedValue(undefined)

    await expect(useCase.execute(customerUser, { cartId: activeCart.cartId })).rejects.toThrow(
      'Insufficient inventory for product p2.',
    )
    expect(failPendingOrderAndReleaseReservationUseCase.execute).toHaveBeenCalledWith(
      expect.any(String),
      'Insufficient inventory for product p2.',
      [{ productId: cartItem.productId, quantity: cartItem.quantity }],
    )
    expect(markCartExpiredUseCase.execute).not.toHaveBeenCalled()
  })

  it('swallows a ConflictError from insufficient inventory and returns the order marked FAILED, without rethrowing', async () => {
    const {
      getOwnedCartUseCase,
      getCartItemsUseCase,
      findOneProductUseCase,
      reserveInventoryUseCase,
      markFailedUseCase,
      markCartExpiredUseCase,
      getOrderByIdUseCase,
      useCase,
    } = createDeps()
    getOwnedCartUseCase.execute.mockResolvedValue(activeCart)
    getCartItemsUseCase.execute.mockResolvedValue([cartItem])
    findOneProductUseCase.execute.mockResolvedValue(product)
    reserveInventoryUseCase.execute.mockRejectedValue(
      new ConflictError(`Insufficient inventory for product ${cartItem.productId}.`),
    )
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({ ...baseOrder, status: OrderStatus.FAILED }))

    const result = await useCase.execute(customerUser, { cartId: activeCart.cartId })

    expect(markFailedUseCase.execute).toHaveBeenCalledWith(
      expect.any(String),
      OrderStatus.FAILED,
      `Insufficient inventory for product ${cartItem.productId}.`,
    )
    expect(markCartExpiredUseCase.execute).not.toHaveBeenCalled()
    expect(result.status).toBe(OrderStatus.FAILED)
  })
})

describe('ReconcileVerifiedGatewayResultUseCase', () => {
  function createDeps() {
    const getOrderByIdUseCase = mockUseCase<GetOrderByIdUseCase>()
    const findOrderItemsUseCase = mockUseCase<FindOrderItemsUseCase>()
    findOrderItemsUseCase.execute.mockResolvedValue([baseOrderItem])
    const markPaymentSucceededUseCase = mockUseCase<MarkPaymentSucceededUseCase>()
    const markPaymentFailedUseCase = mockUseCase<MarkPaymentFailedUseCase>()
    const markExpiredPaymentRefundedUseCase = mockUseCase<MarkExpiredPaymentRefundedUseCase>()
    const releaseExpiredOrderReservationUseCase =
      mockUseCase<ReleaseExpiredOrderReservationUseCase>()
    const emailTrackingService = createEmailTrackingServiceMock()
    const sesMailService = createSesMailServiceMock()
    const vnpayService = createVnpayServiceMock()

    const useCase = new ReconcileVerifiedGatewayResultUseCase(
      getOrderByIdUseCase,
      findOrderItemsUseCase,
      markPaymentSucceededUseCase,
      markPaymentFailedUseCase,
      markExpiredPaymentRefundedUseCase,
      releaseExpiredOrderReservationUseCase,
      emailTrackingService as never,
      sesMailService as never,
      vnpayService as never,
    )

    return {
      getOrderByIdUseCase,
      findOrderItemsUseCase,
      markPaymentSucceededUseCase,
      markPaymentFailedUseCase,
      markExpiredPaymentRefundedUseCase,
      releaseExpiredOrderReservationUseCase,
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
    const { getOrderByIdUseCase, useCase } = createDeps()
    getOrderByIdUseCase.execute.mockRejectedValue(new NotFoundError('Order order-1 was not found.'))

    await expect(useCase.execute(verify, 'ipn')).resolves.toBe(IpnOrderNotFound)
  })

  it('returns IpnInvalidAmount on an amount mismatch', async () => {
    const { getOrderByIdUseCase, useCase } = createDeps()
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({ ...baseOrder, totalAmount: 1 }))

    await expect(useCase.execute(verify, 'ipn')).resolves.toBe(IpnInvalidAmount)
  })

  it('returns InpOrderAlreadyConfirmed and best-effort sends the confirmation email when already paid', async () => {
    const { getOrderByIdUseCase, sesMailService, useCase } = createDeps()
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({
      ...baseOrder,
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
    }))

    await expect(useCase.execute(verify, 'ipn')).resolves.toBe(InpOrderAlreadyConfirmed)
    expect(sesMailService.sendOrderConfirmationEmail).toHaveBeenCalled()
  })

  it('returns IpnSuccess for a duplicate auto-refund notification', async () => {
    const { getOrderByIdUseCase, useCase } = createDeps()
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({
      ...baseOrder,
      status: OrderStatus.EXPIRED,
      paymentStatus: PaymentStatus.FAILED,
      paymentTransactionId: '123456',
      paymentFailureReason:
        'Payment arrived after reservation expiry. Amount refunded automatically.',
    }))

    await expect(useCase.execute(verify, 'ipn')).resolves.toBe(IpnSuccess)
  })

  it('delegates failed verifications to the payment-failed flow', async () => {
    const { getOrderByIdUseCase, markPaymentFailedUseCase, useCase } = createDeps()
    getOrderByIdUseCase.execute.mockResolvedValue(Order.fromRecord({
      ...baseOrder,
      status: OrderStatus.RESERVED,
      paymentStatus: PaymentStatus.PROCESSING,
      paymentAttemptId: 'attempt-1',
    }))

    const result = await useCase.execute({ ...verify, isSuccess: false }, 'ipn')

    expect(markPaymentFailedUseCase.execute).toHaveBeenCalledWith(
      baseOrder.orderId,
      'attempt-1',
      verify.message,
      expect.anything(),
    )
    expect(result).toBe(IpnSuccess)
  })

  it('confirms the payment and sends the confirmation email on a successful reconciliation', async () => {
    const { getOrderByIdUseCase, markPaymentSucceededUseCase, sesMailService, useCase } =
      createDeps()
    const reservedOrder = Order.fromRecord({
      ...baseOrder,
      status: OrderStatus.RESERVED,
      paymentStatus: PaymentStatus.PROCESSING,
      paymentAttemptId: 'attempt-1',
    })
    getOrderByIdUseCase.execute.mockResolvedValueOnce(reservedOrder).mockResolvedValueOnce(
      Order.fromRecord({
        ...reservedOrder,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      }),
    )

    const result = await useCase.execute(verify, 'ipn')

    expect(markPaymentSucceededUseCase.execute).toHaveBeenCalledWith(
      baseOrder.orderId,
      'attempt-1',
      '123456',
      expect.anything(),
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
    const reconcileUseCase = mockUseCase<ReconcileVerifiedGatewayResultUseCase>()
    reconcileUseCase.execute.mockResolvedValue(IpnSuccess)
    const useCase = new HandleVnpayReturnUseCase(vnpayService as never, reconcileUseCase)

    const result = await useCase.execute({ vnp_TxnRef: baseOrder.orderId })

    expect(reconcileUseCase.execute).toHaveBeenCalledWith(expect.anything(), 'return')
    expect(result.redirectUrl).toBe('https://storefront.example/return')
  })

  it('redirects with an invalid payload message when verification throws', async () => {
    const vnpayService = createVnpayServiceMock()
    vnpayService.verifyReturnQuery.mockRejectedValue(new Error('bad signature'))
    const reconcileUseCase = mockUseCase<ReconcileVerifiedGatewayResultUseCase>()
    const useCase = new HandleVnpayReturnUseCase(vnpayService as never, reconcileUseCase)

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
    const reconcileUseCase = mockUseCase<ReconcileVerifiedGatewayResultUseCase>()
    const useCase = new HandleVnpayIpnUseCase(vnpayService as never, reconcileUseCase)

    await expect(useCase.execute({})).resolves.toBe(IpnFailChecksum)
    expect(reconcileUseCase.execute).not.toHaveBeenCalled()
  })

  it('returns IpnFailChecksum when the callback is not verified', async () => {
    const vnpayService = createVnpayServiceMock()
    vnpayService.verifyIpnQuery.mockResolvedValue({ isVerified: false } as never)
    const reconcileUseCase = mockUseCase<ReconcileVerifiedGatewayResultUseCase>()
    const useCase = new HandleVnpayIpnUseCase(vnpayService as never, reconcileUseCase)

    await expect(useCase.execute({})).resolves.toBe(IpnFailChecksum)
    expect(reconcileUseCase.execute).not.toHaveBeenCalled()
  })

  it('delegates verified callbacks to the reconcile use-case', async () => {
    const vnpayService = createVnpayServiceMock()
    const verify = { isVerified: true } as never
    vnpayService.verifyIpnQuery.mockResolvedValue(verify)
    const reconcileUseCase = mockUseCase<ReconcileVerifiedGatewayResultUseCase>()
    reconcileUseCase.execute.mockResolvedValue(IpnSuccess)
    const useCase = new HandleVnpayIpnUseCase(vnpayService as never, reconcileUseCase)

    await expect(useCase.execute({})).resolves.toBe(IpnSuccess)
    expect(reconcileUseCase.execute).toHaveBeenCalledWith(verify, 'ipn')
  })
})
