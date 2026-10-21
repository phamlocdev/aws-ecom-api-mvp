import { Inject, Injectable } from '@nestjs/common'
import { InventorySummary } from '../domain/inventory.entity'
import { INVENTORY_REPOSITORY, InventoryRepositoryPort } from '../domain/inventory.repository.port'

@Injectable()
export class FindOneInventoryUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepositoryPort,
  ) {}

  execute(productId: string): Promise<InventorySummary> {
    return this.inventoryRepository.findOneSummary(productId)
  }
}
