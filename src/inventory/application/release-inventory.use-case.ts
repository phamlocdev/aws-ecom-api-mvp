import { Inject, Injectable } from '@nestjs/common'
import { systemAuditMutationContext } from '../../audit/audit-actor'
import { ReservedInventoryItem } from '../domain/inventory.entity'
import { INVENTORY_REPOSITORY, InventoryRepositoryPort } from '../domain/inventory.repository.port'

@Injectable()
export class ReleaseInventoryUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepositoryPort,
  ) {}

  execute(items: ReservedInventoryItem[]): Promise<void> {
    const actor = systemAuditMutationContext('orders-service', 'Inventory reservation released')
    return this.inventoryRepository.release(items, actor)
  }
}
