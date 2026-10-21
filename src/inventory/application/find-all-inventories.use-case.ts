import { Inject, Injectable } from '@nestjs/common'
import { DEFAULT_PAGE_SIZE } from '../../pagination/pagination-query.dto'
import { PaginatedResponse } from '../../pagination/pagination.types'
import { resolvePaginationState, toPaginatedResponse } from '../../pagination/pagination.util'
import { InventorySummary } from '../domain/inventory.entity'
import { INVENTORY_REPOSITORY, InventoryRepositoryPort } from '../domain/inventory.repository.port'
import {
  FindAllInventoriesInput,
  normalizeInventoryFilters,
  toCursorScope,
} from './inventory-query.util'

@Injectable()
export class FindAllInventoriesUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepositoryPort,
  ) {}

  async execute(query: FindAllInventoriesInput): Promise<PaginatedResponse<InventorySummary>> {
    if (query.productIds && query.productIds.length > 0) {
      const items = await this.inventoryRepository.findSummariesByProductIds(query.productIds)
      return {
        items,
        previousCursor: null,
        nextCursor: null,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        currentPage: 1,
      }
    }

    const filters = normalizeInventoryFilters(query)
    const cursorScope = toCursorScope(filters)
    const pagination = resolvePaginationState('inventories', query, cursorScope)

    const page = await this.inventoryRepository.findAllSummaries(
      filters,
      pagination.limit,
      pagination.startKey,
    )

    return {
      ...toPaginatedResponse('inventories', pagination, page.items, page.lastEvaluatedKey),
      scannedCount: page.scannedCount,
    }
  }
}
