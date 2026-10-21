import { PaginationQueryDto } from '../../pagination/pagination-query.dto'
import { CursorScope } from '../../pagination/pagination.types'
import { InventoryFilters } from '../domain/inventory.repository.port'

// Use-case input for listing inventories: pagination fields plus the same
// filters as InventoryFilters, plus the optional productIds batch-lookup
// (kept separate from the HTTP-layer ListInventoriesQueryDto so the
// application layer never depends on presentation/, per docs/refactor/PLAN.md).
export type FindAllInventoriesInput = PaginationQueryDto &
  InventoryFilters & { productIds?: string[] }

export function normalizeInventoryFilters(query: FindAllInventoriesInput): InventoryFilters {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.status ? { status: query.status } : {}),
  }
}

export function toCursorScope(filters: InventoryFilters): CursorScope {
  const scope: CursorScope = {}

  if (filters.q) {
    scope.q = filters.q
  }

  if (filters.status) {
    scope.status = filters.status
  }

  return scope
}
