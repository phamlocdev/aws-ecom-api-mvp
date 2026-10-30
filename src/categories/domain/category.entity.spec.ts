import { Category } from './category.entity'
import { InvalidInputError } from '../../common/domain-error'

function makeCategory(overrides: Record<string, unknown> = {}): Category {
  return Category.fromRecord({
    categoryId: 'cat1',
    name: 'Test Category',
    status: 'ACTIVE',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

describe('Category.isActive', () => {
  it('returns true when status is ACTIVE', () => {
    expect(makeCategory({ status: 'ACTIVE' }).isActive).toBe(true)
  })

  it('returns false when status is DELETED', () => {
    expect(makeCategory({ status: 'DELETED' }).isActive).toBe(false)
  })
})

describe('Category.isDeleted', () => {
  it('returns true when status is DELETED', () => {
    expect(makeCategory({ status: 'DELETED' }).isDeleted).toBe(true)
  })

  it('returns false when status is ACTIVE', () => {
    expect(makeCategory({ status: 'ACTIVE' }).isDeleted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// State transition methods
// ---------------------------------------------------------------------------

describe('Category.delete()', () => {
  it('returns a new Category with DELETED status', () => {
    const category = makeCategory({ status: 'ACTIVE' })
    const deleted = category.delete('2024-06-01T00:00:00.000Z')
    expect(deleted.status).toBe('DELETED')
    expect(deleted.deletedAt).toBe('2024-06-01T00:00:00.000Z')
    expect(deleted.updatedAt).toBe('2024-06-01T00:00:00.000Z')
  })

  it('preserves other fields', () => {
    const category = makeCategory({ status: 'ACTIVE', name: 'Electronics', categoryId: 'cat-42' })
    const deleted = category.delete('2024-06-01T00:00:00.000Z')
    expect(deleted.name).toBe('Electronics')
    expect(deleted.categoryId).toBe('cat-42')
  })

  it('throws InvalidInputError when category is already DELETED', () => {
    const category = makeCategory({ status: 'DELETED' })
    expect(() => category.delete('2024-06-01T00:00:00.000Z')).toThrow(InvalidInputError)
  })
})
