import { Module } from '@nestjs/common'
import { ProductsModule } from '../../products/presentation/products.module'
import { InventoryController } from './inventory.controller'
import { FindAllInventoriesUseCase } from '../application/find-all-inventories.use-case'
import { FindOneInventoryUseCase } from '../application/find-one-inventory.use-case'
import { UpdateInventoryQuantityUseCase } from '../application/update-inventory-quantity.use-case'
import { ReserveInventoryUseCase } from '../application/reserve-inventory.use-case'
import { ReleaseInventoryUseCase } from '../application/release-inventory.use-case'
import { INVENTORY_REPOSITORY } from '../domain/inventory.repository.port'
import { DynamoDbInventoryRepository } from '../infrastructure/dynamodb-inventory.repository'

@Module({
  imports: [ProductsModule],
  controllers: [InventoryController],
  providers: [
    FindAllInventoriesUseCase,
    FindOneInventoryUseCase,
    UpdateInventoryQuantityUseCase,
    ReserveInventoryUseCase,
    ReleaseInventoryUseCase,
    { provide: INVENTORY_REPOSITORY, useClass: DynamoDbInventoryRepository },
  ],
  exports: [INVENTORY_REPOSITORY, ReserveInventoryUseCase, ReleaseInventoryUseCase],
})
export class InventoryModule {}
