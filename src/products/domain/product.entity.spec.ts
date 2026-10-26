import { Product } from './product.entity'
import { InvalidInputError } from '../../common/domain-error'

function makeProduct(overrides: Record<string, unknown> = {}): Product {
  return Product.fromRecord({
    productId: 'p1',
    name: 'Test Product',
    description: 'A test product',
    categoryId: 'cat1',
    price: 100000,
    currency: 'VND',
    status: 'ACTIVE',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

describe('Product.isActive', () => {
  it('returns true when status is ACTIVE', () => {
    expect(makeProduct({ status: 'ACTIVE' }).isActive).toBe(true)
  })

  it('returns false when status is INACTIVE', () => {
    expect(makeProduct({ status: 'INACTIVE' }).isActive).toBe(false)
  })

  it('returns false when status is DELETED', () => {
    expect(makeProduct({ status: 'DELETED' }).isActive).toBe(false)
  })
})

describe('Product.isDeleted', () => {
  it('returns true when status is DELETED', () => {
    expect(makeProduct({ status: 'DELETED' }).isDeleted).toBe(true)
  })

  it('returns false when status is ACTIVE', () => {
    expect(makeProduct({ status: 'ACTIVE' }).isDeleted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Domain methods
// ---------------------------------------------------------------------------

describe('Product.deactivate()', () => {
  it('does not throw when product is ACTIVE', () => {
    expect(() => makeProduct({ status: 'ACTIVE' }).deactivate()).not.toThrow()
  })

  it('throws InvalidInputError when product is INACTIVE', () => {
    expect(() => makeProduct({ status: 'INACTIVE' }).deactivate()).toThrow(InvalidInputError)
  })

  it('throws InvalidInputError when product is DELETED', () => {
    expect(() => makeProduct({ status: 'DELETED' }).deactivate()).toThrow(InvalidInputError)
  })
})

describe('Product.activate()', () => {
  it('does not throw when product is INACTIVE', () => {
    expect(() => makeProduct({ status: 'INACTIVE' }).activate()).not.toThrow()
  })

  it('throws InvalidInputError when product is ACTIVE', () => {
    expect(() => makeProduct({ status: 'ACTIVE' }).activate()).toThrow(InvalidInputError)
  })

  it('throws InvalidInputError when product is DELETED', () => {
    expect(() => makeProduct({ status: 'DELETED' }).activate()).toThrow(InvalidInputError)
  })
})

describe('Product.delete()', () => {
  it('does not throw when product is ACTIVE', () => {
    expect(() => makeProduct({ status: 'ACTIVE' }).delete()).not.toThrow()
  })

  it('does not throw when product is INACTIVE', () => {
    expect(() => makeProduct({ status: 'INACTIVE' }).delete()).not.toThrow()
  })

  it('throws InvalidInputError when product is already DELETED', () => {
    expect(() => makeProduct({ status: 'DELETED' }).delete()).toThrow(InvalidInputError)
  })
})
