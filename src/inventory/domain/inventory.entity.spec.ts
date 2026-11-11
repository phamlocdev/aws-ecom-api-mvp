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
  it('returns updated quantities', () => {
    const inv = makeInventory({ availableQuantity: 10, reservedQuantity: 2 })
    const updated = inv.reserve(3)
    expect(updated.availableQuantity).toBe(7)
    expect(updated.reservedQuantity).toBe(5)
  })

  it('allows reserving exactly the available stock', () => {
    const inv = makeInventory({ availableQuantity: 5, reservedQuantity: 0 })
    const updated = inv.reserve(5)
    expect(updated.availableQuantity).toBe(0)
    expect(updated.reservedQuantity).toBe(5)
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
  it('returns updated quantities', () => {
    const inv = makeInventory({ availableQuantity: 5, reservedQuantity: 5 })
    const updated = inv.release(3)
    expect(updated.availableQuantity).toBe(8)
    expect(updated.reservedQuantity).toBe(2)
  })

  it('clamps reservedQuantity to 0 if release exceeds reserved', () => {
    const inv = makeInventory({ availableQuantity: 5, reservedQuantity: 1 })
    const updated = inv.release(5)
    expect(updated.availableQuantity).toBe(10)
    expect(updated.reservedQuantity).toBe(0)
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
