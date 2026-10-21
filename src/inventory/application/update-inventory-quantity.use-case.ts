import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { InvalidInputError } from '../../common/domain-error'
import { InventorySummary } from '../domain/inventory.entity'
import { INVENTORY_REPOSITORY, InventoryRepositoryPort } from '../domain/inventory.repository.port'

@Injectable()
export class UpdateInventoryQuantityUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepositoryPort,
  ) {}

  async execute(
    user: AuthenticatedUser,
    productId: string,
    availableQuantity: number,
  ): Promise<InventorySummary> {
    if (availableQuantity < 0) {
      throw new InvalidInputError('availableQuantity must be a non-negative integer.')
    }

    const timestamp = new Date().toISOString()
    const actor = buildUserAuditMutationContext(user, 'Inventory quantity adjusted')
    return this.inventoryRepository.updateAvailableQuantity(
      productId,
      availableQuantity,
      timestamp,
      actor,
    )
  }
}
