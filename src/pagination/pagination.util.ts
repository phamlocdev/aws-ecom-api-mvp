import { InvalidInputError } from '../common/domain-error'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  PageSize,
  PaginationQueryDto,
} from './pagination-query.dto'
import {
  CursorKey,
  CursorScope,
  PaginatedResponse,
  PaginationResource,
  PaginationState,
} from './pagination.types'

interface CursorPayload {
  resource: PaginationResource
  limit: PageSize
  startKey: CursorKey
  history: CursorKey[]
  scope?: CursorScope
}

export function resolvePaginationState(
  resource: PaginationResource,
  query: PaginationQueryDto,
  scope: CursorScope = {},
): PaginationState {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE

  if (!query.cursor) {
    return { limit, startKey: null, history: [], scope }
  }

  const payload = decodeCursor(query.cursor)
  if (payload.resource !== resource) {
    throw new InvalidInputError('Cursor does not belong to this resource.')
  }
  if (payload.limit !== limit) {
    throw new InvalidInputError('Cursor limit does not match the requested limit.')
  }
  if (!scopesMatch(payload.scope ?? {}, scope)) {
    throw new InvalidInputError('Cursor filters do not match the requested filters.')
  }

  return {
    limit,
    startKey: payload.startKey,
    history: payload.history,
    scope,
  }
}

export function toPaginatedResponse<T>(
  resource: PaginationResource,
  state: PaginationState,
  items: T[],
  lastEvaluatedKey?: Record<string, unknown>,
): PaginatedResponse<T> {
  return {
    items,
    previousCursor: createPreviousCursor(resource, state),
    nextCursor: createNextCursor(resource, state, lastEvaluatedKey),
    limit: state.limit,
    currentPage: state.history.length + 1,
  }
}

function createPreviousCursor(resource: PaginationResource, state: PaginationState): string | null {
  if (state.history.length === 0) {
    return null
  }

  const previousHistory = state.history.slice(0, -1)
  const previousStartKey = state.history[state.history.length - 1] ?? null

  return encodeCursor({
    resource,
    limit: state.limit,
    startKey: previousStartKey,
    history: previousHistory,
    ...scopePayload(state.scope),
  })
}

function createNextCursor(
  resource: PaginationResource,
  state: PaginationState,
  lastEvaluatedKey?: Record<string, unknown>,
): string | null {
  if (!lastEvaluatedKey) {
    return null
  }

  return encodeCursor({
    resource,
    limit: state.limit,
    startKey: lastEvaluatedKey,
    history: [...state.history, state.startKey],
    ...scopePayload(state.scope),
  })
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (isCursorPayload(parsed)) {
      return parsed
    }
  } catch {
    // Fall through to the common InvalidInputError below.
  }

  throw new InvalidInputError('Cursor is malformed.')
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (!isRecord(value)) {
    return false
  }

  return (
    (value.resource === 'products' ||
      value.resource === 'categories' ||
      value.resource === 'orders' ||
      value.resource === 'inventories') &&
    isPageSize(value.limit) &&
    isCursorKey(value.startKey) &&
    Array.isArray(value.history) &&
    value.history.every(isCursorKey) &&
    (value.scope === undefined || isCursorScope(value.scope))
  )
}

function isPageSize(value: unknown): value is PageSize {
  return PAGE_SIZE_OPTIONS.includes(value as PageSize)
}

function isCursorKey(value: unknown): value is CursorKey {
  return value === null || isRecord(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCursorScope(value: unknown): value is CursorScope {
  return (
    isRecord(value) && Object.values(value).every((scopeValue) => typeof scopeValue === 'string')
  )
}

function scopesMatch(left: CursorScope, right: CursorScope): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right[key] === value)
  )
}

function scopePayload(scope: CursorScope): Pick<CursorPayload, 'scope'> | Record<string, never> {
  return Object.keys(scope).length > 0 ? { scope } : {}
}
