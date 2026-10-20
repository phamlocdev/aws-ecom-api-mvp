import { Module } from '@nestjs/common'
import { UploadModule } from '../../upload/upload.module'
import { ProductsController } from './products.controller'
import { CreateProductUseCase } from '../application/create-product.use-case'
import { FindAllProductsUseCase } from '../application/find-all-products.use-case'
import { FindOneProductUseCase } from '../application/find-one-product.use-case'
import { FindProductForResponseUseCase } from '../application/find-product-for-response.use-case'
import { UpdateProductUseCase } from '../application/update-product.use-case'
import { DeleteProductUseCase } from '../application/delete-product.use-case'
import { PRODUCT_REPOSITORY } from '../domain/product.repository.port'
import { DynamoDbProductRepository } from '../infrastructure/dynamodb-product.repository'
import { ProductEventsPublisher } from '../infrastructure/product-events.publisher'

@Module({
  imports: [UploadModule],
  controllers: [ProductsController],
  providers: [
    ProductEventsPublisher,
    CreateProductUseCase,
    FindAllProductsUseCase,
    FindOneProductUseCase,
    FindProductForResponseUseCase,
    UpdateProductUseCase,
    DeleteProductUseCase,
    { provide: PRODUCT_REPOSITORY, useClass: DynamoDbProductRepository },
  ],
  exports: [FindOneProductUseCase],
})
export class ProductsModule {}
