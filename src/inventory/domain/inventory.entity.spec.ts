import { InventoryRecord } from './inventory.entity'
import { ConflictError, InvalidInputError } from '../../common/domain-error'

function makeInventory(overrides: Record<string, unknown> = {}): InventoryRecord {
  return InventoryRecord.fromRecord({
    productId: 'p1',
    availableQuantity: 10,
    reservedQuantity: 2,
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

describe('InventoryRecord.isOutOfStock', () => {
  it('returns true when availableQuantity is 0', () => {
    expect(makeInventory({ availableQuantity: 0 }).isOutOfStock).toBe(true)
  })

  it('returns true when availableQuantity is negative', () => {
    expect(makeInventory({ availableQuantity: -1 }).isOutOfStock).toBe(true)
  })

  it('returns false when availableQuantity is positive', () => {
    expect(makeInventory({ availableQuantity: 5 }).isOutOfStock).toBe(false)
  })
})

describe('InventoryRecord.totalQuantity', () => {
  it('returns sum of availableQuantity and reservedQuantity', () => {
    expect(makeInventory({ availableQuantity: 8, reservedQuantity: 3 }).totalQuantity).toBe(11)
  })

  it('returns 0 when both are 0', () => {
    expect(makeInventory({ availableQuantity: 0, reservedQuantity: 0 }).totalQuantity).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Domain methods
// ---------------------------------------------------------------------------

describe('InventoryRecord.reserve()', () => {
  it('does not throw when quantity is within available stock', () => {
    const inv = makeInventory({ availableQuantity: 10 })
    expect(() => inv.reserve(3)).not.toThrow()
  })

  it('does not throw when quantity equals available stock', () => {
    const inv = makeInventory({ availableQuantity: 5 })
    expect(() => inv.reserve(5)).not.toThrow()
  })

  it('throws ConflictError when quantity exceeds available stock', () => {
    const inv = makeInventory({ availableQuantity: 2 })
    expect(() => inv.reserve(5)).toThrow(ConflictError)
  })

  it('throws InvalidInputError when quantity is 0', () => {
    const inv = makeInventory()
    expect(() => inv.reserve(0)).toThrow(InvalidInputError)
  })

  it('throws InvalidInputError when quantity is negative', () => {
    const inv = makeInventory()
    expect(() => inv.reserve(-1)).toThrow(InvalidInputError)
  })
})

describe('InventoryRecord.release()', () => {
  it('does not throw for a valid quantity', () => {
    const inv = makeInventory({ reservedQuantity: 5 })
    expect(() => inv.release(3)).not.toThrow()
  })

  it('throws InvalidInputError when quantity is 0', () => {
    const inv = makeInventory()
    expect(() => inv.release(0)).toThrow(InvalidInputError)
  })

  it('throws InvalidInputError when quantity is negative', () => {
    const inv = makeInventory()
    expect(() => inv.release(-2)).toThrow(InvalidInputError)
  })
})
