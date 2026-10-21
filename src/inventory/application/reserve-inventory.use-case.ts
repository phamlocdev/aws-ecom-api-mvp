import { Inject, Injectable, Logger } from '@nestjs/common'
import { systemAuditMutationContext } from '../../audit/audit-actor'
import { ConflictError } from '../../common/domain-error'
import { INVENTORY_REPOSITORY, InventoryRepositoryPort } from '../domain/inventory.repository.port'

@Injectable()
export class ReserveInventoryUseCase {
  private readonly logger = new Logger(ReserveInventoryUseCase.name)

  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepositoryPort,
  ) {}

  async execute(productId: string, quantity: number): Promise<void> {
    const actor = systemAuditMutationContext('orders-service', 'Inventory reserved for order')

    try {
      await this.inventoryRepository.reserve(productId, quantity, actor)
      this.logger.log(`Reserved quantity=${quantity} for product ${productId}.`)
    } catch (error) {
      if (error instanceof ConflictError) {
        this.logger.warn(
          `Reserve rejected for product ${productId} with quantity=${quantity} due to insufficient inventory.`,
        )
      }
      throw error
    }
  }
}
