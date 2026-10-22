import { InvalidInputError } from '../common/domain-error'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from './pagination-query.dto'
import { resolvePaginationState, toPaginatedResponse } from './pagination.util'

const VALID_LIMIT = PAGE_SIZE_OPTIONS[0]

function encodeCursor(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

describe('resolvePaginationState', () => {
  it('returns default state with no cursor on the first page', () => {
    const state = resolvePaginationState('categories', {})

    expect(state.startKey).toBeNull()
    expect(state.history).toEqual([])
    expect(state.limit).toBe(DEFAULT_PAGE_SIZE)
    expect(state.scope).toEqual({})
  })

  it('uses the limit from the query when provided', () => {
    const state = resolvePaginationState('categories', { limit: VALID_LIMIT })

    expect(state.limit).toBe(VALID_LIMIT)
  })

  it('decodes a valid cursor and restores startKey and history', () => {
    const startKey = { categoryId: 'electronics' }
    const cursor = encodeCursor({
      resource: 'categories',
      limit: VALID_LIMIT,
      startKey,
      history: [null],
    })

    const state = resolvePaginationState('categories', { limit: VALID_LIMIT, cursor })

    expect(state.startKey).toEqual(startKey)
    expect(state.history).toEqual([null])
  })

  it('throws InvalidInputError when the cursor belongs to a different resource', () => {
    const cursor = encodeCursor({
      resource: 'products',
      limit: VALID_LIMIT,
      startKey: null,
      history: [],
    })

    expect(() =>
      resolvePaginationState('categories', { limit: VALID_LIMIT, cursor }),
    ).toThrow(InvalidInputError)
  })

  it('throws InvalidInputError when the cursor limit differs from the query limit', () => {
    const cursorLimit = PAGE_SIZE_OPTIONS[0]
    const queryLimit = PAGE_SIZE_OPTIONS[PAGE_SIZE_OPTIONS.length - 1]
    if (cursorLimit === queryLimit) {
      return
    }
    const cursor = encodeCursor({
      resource: 'categories',
      limit: cursorLimit,
      startKey: null,
      history: [],
    })

    expect(() =>
      resolvePaginationState('categories', { limit: queryLimit, cursor }),
    ).toThrow(InvalidInputError)
  })

  it('throws InvalidInputError when cursor scope does not match the requested scope', () => {
    const cursor = encodeCursor({
      resource: 'products',
      limit: VALID_LIMIT,
      startKey: null,
      history: [],
      scope: { status: 'ACTIVE' },
    })

    expect(() =>
      resolvePaginationState('products', { limit: VALID_LIMIT, cursor }, { status: 'DELETED' }),
    ).toThrow(InvalidInputError)
  })

  it('throws InvalidInputError when the cursor string is malformed', () => {
    expect(() =>
      resolvePaginationState('categories', { cursor: 'not-valid-base64url-json!!' }),
    ).toThrow(InvalidInputError)
  })

  it('propagates scope into the returned state', () => {
    const state = resolvePaginationState('products', {}, { status: 'ACTIVE' })

    expect(state.scope).toEqual({ status: 'ACTIVE' })
  })
})

describe('toPaginatedResponse', () => {
  const baseState = {
    limit: VALID_LIMIT,
    startKey: null as Record<string, unknown> | null,
    history: [] as (Record<string, unknown> | null)[],
    scope: {},
  }

  it('returns null previousCursor and null nextCursor on a single page with no more results', () => {
    const result = toPaginatedResponse('categories', baseState, ['item1'], undefined)

    expect(result.previousCursor).toBeNull()
    expect(result.nextCursor).toBeNull()
    expect(result.currentPage).toBe(1)
    expect(result.items).toEqual(['item1'])
    expect(result.limit).toBe(VALID_LIMIT)
  })

  it('returns a non-null nextCursor when lastEvaluatedKey is present', () => {
    const result = toPaginatedResponse('categories', baseState, [], { categoryId: 'z' })

    expect(result.nextCursor).not.toBeNull()
    expect(result.previousCursor).toBeNull()
  })

  it('returns a non-null previousCursor when history has entries', () => {
    const stateOnPage2 = {
      ...baseState,
      startKey: { categoryId: 'b' },
      history: [null],
    }

    const result = toPaginatedResponse('categories', stateOnPage2, [], undefined)

    expect(result.previousCursor).not.toBeNull()
    expect(result.currentPage).toBe(2)
  })

  it('encodes a decodable nextCursor that round-trips back to the same startKey', () => {
    const lastKey = { categoryId: 'z-last' }
    const result = toPaginatedResponse('categories', baseState, [], lastKey)

    const decoded = JSON.parse(
      Buffer.from(result.nextCursor!, 'base64url').toString('utf8'),
    )

    expect(decoded.startKey).toEqual(lastKey)
    expect(decoded.resource).toBe('categories')
    expect(decoded.limit).toBe(VALID_LIMIT)
  })
})
