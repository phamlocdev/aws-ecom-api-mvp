import { Order } from './order.entity'
import { OrderStatus } from './order-status.enum'
import { PaymentStatus } from './payment-status.enum'
import { InvalidInputError } from '../../common/domain-error'

const BASE = {
  orderId: 'o1',
  customerId: 'c1',
  cartId: 'cart1',
  entityType: 'ORDER',
  deduplicationKey: 'dk1',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
} as const

function makeOrder(overrides: Record<string, unknown> = {}): Order {
  return Order.fromRecord({
    ...BASE,
    status: 'PENDING',
    paymentStatus: 'NOT_STARTED',
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

describe('Order.isPaid', () => {
  it('returns true when paymentStatus is PAID', () => {
    expect(makeOrder({ paymentStatus: 'PAID' }).isPaid).toBe(true)
  })

  it('returns false when paymentStatus is NOT_STARTED', () => {
    expect(makeOrder().isPaid).toBe(false)
  })
})

describe('Order.isCancelled', () => {
  it('returns true when status is CANCELLED', () => {
    expect(makeOrder({ status: 'CANCELLED' }).isCancelled).toBe(true)
  })

  it('returns false when status is CONFIRMED', () => {
    expect(makeOrder({ status: 'CONFIRMED', paymentStatus: 'PAID' }).isCancelled).toBe(false)
  })
})

describe('Order.isShipped', () => {
  it('returns true when status is SHIPPED', () => {
    expect(makeOrder({ status: 'SHIPPED' }).isShipped).toBe(true)
  })

  it('returns false when status is CONFIRMED', () => {
    expect(makeOrder({ status: 'CONFIRMED', paymentStatus: 'PAID' }).isShipped).toBe(false)
  })
})

describe('Order.isInTerminalState', () => {
  it.each(['CANCELLED', 'FAILED', 'EXPIRED'])('returns true for %s', status => {
    expect(makeOrder({ status }).isInTerminalState).toBe(true)
  })

  it.each(['PENDING', 'RESERVED', 'CONFIRMED', 'SHIPPED'])('returns false for %s', status => {
    expect(makeOrder({ status, paymentStatus: 'PAID' }).isInTerminalState).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Guard methods
// ---------------------------------------------------------------------------

describe('Order.canBeShipped()', () => {
  it('returns true when CONFIRMED + PAID', () => {
    expect(makeOrder({ status: 'CONFIRMED', paymentStatus: 'PAID' }).canBeShipped()).toBe(true)
  })

  it('returns false when CONFIRMED but not PAID', () => {
    expect(makeOrder({ status: 'CONFIRMED', paymentStatus: 'PROCESSING' }).canBeShipped()).toBe(false)
  })

  it('returns false when RESERVED + PAID', () => {
    expect(makeOrder({ status: 'RESERVED', paymentStatus: 'PAID' }).canBeShipped()).toBe(false)
  })
})

describe('Order.canBeCancelled()', () => {
  it('returns true when CONFIRMED + PAID', () => {
    expect(makeOrder({ status: 'CONFIRMED', paymentStatus: 'PAID' }).canBeCancelled()).toBe(true)
  })

  it('returns false when not CONFIRMED', () => {
    expect(makeOrder({ status: 'RESERVED', paymentStatus: 'PAID' }).canBeCancelled()).toBe(false)
  })
})

describe('Order.canTriggerPayment()', () => {
  const futureExpiry = Math.floor(Date.now() / 1000) + 3600

  it('returns true when RESERVED, unpaid, has totalAmount+paymentExpiresAt, not expired', () => {
    const order = makeOrder({
      status: 'RESERVED',
      paymentStatus: 'NOT_STARTED',
      totalAmount: 100000,
      paymentExpiresAt: futureExpiry,
    })
    expect(order.canTriggerPayment()).toBe(true)
  })

  it('returns false when already PAID', () => {
    const order = makeOrder({
      status: 'RESERVED',
      paymentStatus: 'PAID',
      totalAmount: 100000,
      paymentExpiresAt: futureExpiry,
    })
    expect(order.canTriggerPayment()).toBe(false)
  })

  it('returns false when totalAmount is missing', () => {
    const order = makeOrder({
      status: 'RESERVED',
      paymentStatus: 'NOT_STARTED',
      paymentExpiresAt: futureExpiry,
    })
    expect(order.canTriggerPayment()).toBe(false)
  })

  it('returns false when payment is expired', () => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 1
    const order = makeOrder({
      status: 'RESERVED',
      paymentStatus: 'NOT_STARTED',
      totalAmount: 100000,
      paymentExpiresAt: pastExpiry,
    })
    expect(order.canTriggerPayment()).toBe(false)
  })
})

describe('Order.canExpireReservation()', () => {
  it('returns true when RESERVED and payment expired', () => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 1
    const order = makeOrder({ status: 'RESERVED', paymentExpiresAt: pastExpiry })
    expect(order.canExpireReservation()).toBe(true)
  })

  it('returns false when RESERVED but not expired', () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600
    const order = makeOrder({ status: 'RESERVED', paymentExpiresAt: futureExpiry })
    expect(order.canExpireReservation()).toBe(false)
  })

  it('returns false when not RESERVED', () => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 1
    const order = makeOrder({ status: 'CONFIRMED', paymentStatus: 'PAID', paymentExpiresAt: pastExpiry })
    expect(order.canExpireReservation()).toBe(false)
  })
})

describe('Order.isReadyToProcessPayment()', () => {
  it('returns true when RESERVED + PROCESSING', () => {
    expect(makeOrder({ status: 'RESERVED', paymentStatus: 'PROCESSING' }).isReadyToProcessPayment()).toBe(true)
  })

  it('returns false when RESERVED but NOT_STARTED', () => {
    expect(makeOrder({ status: 'RESERVED', paymentStatus: 'NOT_STARTED' }).isReadyToProcessPayment()).toBe(false)
  })

  it('returns false when CONFIRMED + PROCESSING', () => {
    expect(makeOrder({ status: 'CONFIRMED', paymentStatus: 'PROCESSING' }).isReadyToProcessPayment()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// State transition methods
// ---------------------------------------------------------------------------

describe('Order.reserve()', () => {
  it('returns a new Order with RESERVED status and updated fields', () => {
    const order = makeOrder({ status: 'PENDING' })
    const reserved = order.reserve(99000, 9999999999, '2024-06-01T00:00:00.000Z')
    expect(reserved.status).toBe(OrderStatus.RESERVED)
    expect(reserved.totalAmount).toBe(99000)
    expect(reserved.paymentExpiresAt).toBe(9999999999)
    expect(reserved.reservedAt).toBe('2024-06-01T00:00:00.000Z')
    expect(reserved.updatedAt).toBe('2024-06-01T00:00:00.000Z')
  })

  it('does not mutate the original order', () => {
    const order = makeOrder({ status: 'PENDING' })
    order.reserve(99000, 9999999999, '2024-06-01T00:00:00.000Z')
    expect(order.status).toBe(OrderStatus.PENDING)
  })

  it('throws InvalidInputError when status is not PENDING', () => {
    const order = makeOrder({ status: 'RESERVED' })
    expect(() => order.reserve(99000, 9999999999, '2024-06-01T00:00:00.000Z')).toThrow(InvalidInputError)
  })
})

describe('Order.fail()', () => {
  it('returns a new Order with FAILED status', () => {
    const order = makeOrder({ status: 'RESERVED' })
    const failed = order.fail('Out of stock', '2024-06-01T00:00:00.000Z')
    expect(failed.status).toBe(OrderStatus.FAILED)
    expect(failed.failureReason).toBe('Out of stock')
    expect(failed.updatedAt).toBe('2024-06-01T00:00:00.000Z')
  })

  it('throws when already in terminal state', () => {
    const order = makeOrder({ status: 'CANCELLED' })
    expect(() => order.fail('reason', '2024-06-01T00:00:00.000Z')).toThrow(InvalidInputError)
  })
})

describe('Order.ship()', () => {
  it('returns a new Order with SHIPPED status', () => {
    const order = makeOrder({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    const shipped = order.ship('2024-06-01T00:00:00.000Z')
    expect(shipped.status).toBe(OrderStatus.SHIPPED)
    expect(shipped.shippedAt).toBe('2024-06-01T00:00:00.000Z')
    expect(shipped.updatedAt).toBe('2024-06-01T00:00:00.000Z')
  })

  it('throws when canBeShipped() returns false', () => {
    const order = makeOrder({ status: 'RESERVED' })
    expect(() => order.ship('2024-06-01T00:00:00.000Z')).toThrow(InvalidInputError)
  })
})

describe('Order.cancelWithRefund()', () => {
  it('returns a new Order with CANCELLED status', () => {
    const order = makeOrder({ status: 'CONFIRMED', paymentStatus: 'PAID' })
    const cancelled = order.cancelWithRefund('2024-06-01T00:00:00.000Z')
    expect(cancelled.status).toBe(OrderStatus.CANCELLED)
    expect(cancelled.cancelledAt).toBe('2024-06-01T00:00:00.000Z')
    expect(cancelled.updatedAt).toBe('2024-06-01T00:00:00.000Z')
  })

  it('throws when canBeCancelled() returns false', () => {
    const order = makeOrder({ status: 'RESERVED' })
    expect(() => order.cancelWithRefund('2024-06-01T00:00:00.000Z')).toThrow(InvalidInputError)
  })
})

// ---------------------------------------------------------------------------
// Static helpers
// ---------------------------------------------------------------------------

describe('Order.computeTotal()', () => {
  it('sums lineTotal of all items', () => {
    expect(Order.computeTotal([{ lineTotal: 100 }, { lineTotal: 200 }, { lineTotal: 50 }])).toBe(350)
  })

  it('returns 0 for empty array', () => {
    expect(Order.computeTotal([])).toBe(0)
  })
})
