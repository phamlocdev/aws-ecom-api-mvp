import { Inject, Injectable, Logger } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { UploadService } from '../../upload/upload.service'
import { ProductEventsPublisher } from '../infrastructure/product-events.publisher'
import { PRODUCT_REPOSITORY, ProductRepositoryPort } from '../domain/product.repository.port'
import { getProductImageKeys } from './product-image.util'
import { publishProductMutationBestEffort } from './product-event.util'
import { FindOneProductUseCase } from './find-one-product.use-case'

@Injectable()
export class DeleteProductUseCase {
  private readonly logger = new Logger(DeleteProductUseCase.name)

  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: ProductRepositoryPort,
    @Inject(FindOneProductUseCase)
    private readonly findOneProductUseCase: FindOneProductUseCase,
    @Inject(UploadService)
    private readonly uploadService: UploadService,
    @Inject(ProductEventsPublisher)
    private readonly productEventsPublisher: ProductEventsPublisher,
  ) {}

  async execute(user: AuthenticatedUser, productId: string): Promise<void> {
    const existingProduct = await this.findOneProductUseCase.execute(productId)
    const timestamp = new Date().toISOString()
    existingProduct.delete(timestamp)
    const actor = buildUserAuditMutationContext(user, 'Product deleted')

    await this.productRepository.remove(productId, timestamp, actor)
    await this.uploadService.deleteObjectsBestEffort(getProductImageKeys(existingProduct.images))
    await publishProductMutationBestEffort(
      this.productEventsPublisher,
      this.logger,
      'deleted',
      productId,
    )
  }
}
