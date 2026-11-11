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
  it('returns a new Product with INACTIVE status', () => {
    const product = makeProduct({ status: 'ACTIVE' })
    const deactivated = product.deactivate('2024-06-01T00:00:00.000Z')
    expect(deactivated.status).toBe('INACTIVE')
    expect(deactivated.updatedAt).toBe('2024-06-01T00:00:00.000Z')
  })

  it('throws InvalidInputError when product is INACTIVE', () => {
    expect(() => makeProduct({ status: 'INACTIVE' }).deactivate('2024-06-01T00:00:00.000Z')).toThrow(InvalidInputError)
  })

  it('throws InvalidInputError when product is DELETED', () => {
    expect(() => makeProduct({ status: 'DELETED' }).deactivate('2024-06-01T00:00:00.000Z')).toThrow(InvalidInputError)
  })
})

describe('Product.activate()', () => {
  it('returns a new Product with ACTIVE status', () => {
    const product = makeProduct({ status: 'INACTIVE' })
    const activated = product.activate('2024-06-01T00:00:00.000Z')
    expect(activated.status).toBe('ACTIVE')
    expect(activated.updatedAt).toBe('2024-06-01T00:00:00.000Z')
  })

  it('throws InvalidInputError when product is ACTIVE', () => {
    expect(() => makeProduct({ status: 'ACTIVE' }).activate('2024-06-01T00:00:00.000Z')).toThrow(InvalidInputError)
  })

  it('throws InvalidInputError when product is DELETED', () => {
    expect(() => makeProduct({ status: 'DELETED' }).activate('2024-06-01T00:00:00.000Z')).toThrow(InvalidInputError)
  })
})

describe('Product.delete()', () => {
  it('returns a new Product with DELETED status', () => {
    const product = makeProduct({ status: 'ACTIVE' })
    const deleted = product.delete('2024-06-01T00:00:00.000Z')
    expect(deleted.status).toBe('DELETED')
    expect(deleted.deletedAt).toBe('2024-06-01T00:00:00.000Z')
    expect(deleted.updatedAt).toBe('2024-06-01T00:00:00.000Z')
  })

  it('does not throw when product is INACTIVE', () => {
    const product = makeProduct({ status: 'INACTIVE' })
    const deleted = product.delete('2024-06-01T00:00:00.000Z')
    expect(deleted.status).toBe('DELETED')
  })

  it('throws InvalidInputError when product is already DELETED', () => {
    expect(() => makeProduct({ status: 'DELETED' }).delete('2024-06-01T00:00:00.000Z')).toThrow(InvalidInputError)
  })
})
