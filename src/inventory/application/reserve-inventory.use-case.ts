import { Inject, Injectable, Logger } from '@nestjs/common'
import { systemAuditMutationContext } from '../../audit/audit-actor'
import { ConflictError, NotFoundError } from '../../common/domain-error'
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

    const inventory = await this.inventoryRepository.findOne(productId)
    if (!inventory) {
      throw new NotFoundError(`Inventory record for product ${productId} not found.`)
    }
    inventory.reserve(quantity)

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
