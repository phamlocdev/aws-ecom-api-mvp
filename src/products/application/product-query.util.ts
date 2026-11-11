import { PaginationQueryDto } from '../../pagination/pagination-query.dto'
import { CursorScope } from '../../pagination/pagination.types'
import { ProductFilters } from '../domain/product.repository.port'

// Use-case input for listing products: pagination fields plus the same
// filters as ProductFilters (kept separate from the HTTP-layer
// ListProductsQueryDto so the application layer never depends on
// presentation/, per docs/refactor/PLAN.md).
export type FindAllProductsInput = PaginationQueryDto & ProductFilters

export function normalizeProductFilters(query: FindAllProductsInput): ProductFilters {
  return {
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.minPrice !== undefined ? { minPrice: query.minPrice } : {}),
    ...(query.maxPrice !== undefined ? { maxPrice: query.maxPrice } : {}),
    ...(query.updatedFrom ? { updatedFrom: new Date(query.updatedFrom).toISOString() } : {}),
    ...(query.updatedTo ? { updatedTo: new Date(query.updatedTo).toISOString() } : {}),
    ...(query.q ? { q: query.q } : {}),
  }
}

export function toCursorScope(filters: ProductFilters): CursorScope {
  const scope: CursorScope = {}

  if (filters.categoryId) {
    scope.categoryId = filters.categoryId
  }
  if (filters.status) {
    scope.status = filters.status
  }
  if (filters.minPrice !== undefined) {
    scope.minPrice = String(filters.minPrice)
  }
  if (filters.maxPrice !== undefined) {
    scope.maxPrice = String(filters.maxPrice)
  }
  if (filters.updatedFrom) {
    scope.updatedFrom = filters.updatedFrom
  }
  if (filters.updatedTo) {
    scope.updatedTo = filters.updatedTo
  }
  if (filters.q) {
    scope.q = filters.q
  }

  return scope
}
