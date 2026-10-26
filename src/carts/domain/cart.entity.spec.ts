import { Cart } from './cart.entity'
import { CartStatus } from './cart-status.enum'
import { InvalidInputError } from '../../common/domain-error'

const FUTURE_EXPIRY = Math.floor(Date.now() / 1000) + 3600
const PAST_EXPIRY = Math.floor(Date.now() / 1000) - 1

function makeCart(overrides: Record<string, unknown> = {}): Cart {
  return Cart.fromRecord({
    customerId: 'c1',
    cartId: 'cart1',
    status: 'ACTIVE',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    expiresAt: FUTURE_EXPIRY,
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

describe('Cart.isExpired', () => {
  it('returns true when status is EXPIRED', () => {
    expect(makeCart({ status: 'EXPIRED' }).isExpired).toBe(true)
  })

  it('returns true when expiresAt is in the past', () => {
    expect(makeCart({ expiresAt: PAST_EXPIRY }).isExpired).toBe(true)
  })

  it('returns false when status is ACTIVE and not time-expired', () => {
    expect(makeCart({ expiresAt: FUTURE_EXPIRY }).isExpired).toBe(false)
  })
})

describe('Cart.isUsable', () => {
  it('returns true when cart is not expired', () => {
    expect(makeCart().isUsable).toBe(true)
  })

  it('returns false when cart is expired', () => {
    expect(makeCart({ status: 'EXPIRED' }).isUsable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Domain methods
// ---------------------------------------------------------------------------

describe('Cart.expire()', () => {
  it('does not throw when status is ACTIVE', () => {
    const cart = makeCart({ status: 'ACTIVE' })
    expect(() => cart.expire('2024-06-01T00:00:00.000Z')).not.toThrow()
  })

  it('throws InvalidInputError when status is already EXPIRED', () => {
    const cart = makeCart({ status: 'EXPIRED' })
    expect(() => cart.expire('2024-06-01T00:00:00.000Z')).toThrow(InvalidInputError)
  })
})

describe('Cart.ensureUsable()', () => {
  it('does not throw when cart is usable', () => {
    const cart = makeCart({ status: CartStatus.ACTIVE, expiresAt: FUTURE_EXPIRY })
    expect(() => cart.ensureUsable()).not.toThrow()
  })

  it('throws InvalidInputError when cart status is EXPIRED', () => {
    const cart = makeCart({ status: CartStatus.EXPIRED })
    expect(() => cart.ensureUsable()).toThrow(InvalidInputError)
  })

  it('throws InvalidInputError when cart is time-expired', () => {
    const cart = makeCart({ status: CartStatus.ACTIVE, expiresAt: PAST_EXPIRY })
    expect(() => cart.ensureUsable()).toThrow(InvalidInputError)
  })
})
