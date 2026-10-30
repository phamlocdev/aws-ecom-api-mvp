import { Inject, Injectable, Logger } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { NotFoundError } from '../../common/domain-error'
import { UploadService } from '../../upload/upload.service'
import { ProductEventsPublisher } from '../infrastructure/product-events.publisher'
import { PRODUCT_REPOSITORY, ProductRepositoryPort } from '../domain/product.repository.port'
import { ProductStatus } from '../domain/product-status.enum'
import { getProductImageKeys } from './product-image.util'
import { publishProductMutationBestEffort } from './product-event.util'

@Injectable()
export class DeleteProductUseCase {
  private readonly logger = new Logger(DeleteProductUseCase.name)

  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: ProductRepositoryPort,
    @Inject(UploadService)
    private readonly uploadService: UploadService,
    @Inject(ProductEventsPublisher)
    private readonly productEventsPublisher: ProductEventsPublisher,
  ) {}

  async execute(user: AuthenticatedUser, productId: string): Promise<void> {
    const existingProduct = await this.productRepository.findOne(productId)
    if (!existingProduct || existingProduct.status === ProductStatus.DELETED) {
      throw new NotFoundError(`Product ${productId} was not found.`)
    }

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
