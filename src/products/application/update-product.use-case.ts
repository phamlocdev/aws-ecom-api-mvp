import { Inject, Injectable, Logger } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { InvalidInputError } from '../../common/domain-error'
import { UploadService } from '../../upload/upload.service'
import { ProductEventsPublisher } from '../infrastructure/product-events.publisher'
import { PRODUCT_REPOSITORY, ProductRepositoryPort } from '../domain/product.repository.port'
import { Product } from '../domain/product.entity'
import { ProductStatus } from '../domain/product-status.enum'
import {
  deleteRemovedProductImages,
  prepareProductImages,
  ProductImageInput,
} from './product-image.util'
import { publishProductMutationBestEffort } from './product-event.util'
import { FindOneProductUseCase } from './find-one-product.use-case'

export interface UpdateProductChanges {
  name?: string
  description?: string
  categoryId?: string
  price?: number
  imageUrl?: string
  images?: ProductImageInput[]
  status?: ProductStatus
}

@Injectable()
export class UpdateProductUseCase {
  private readonly logger = new Logger(UpdateProductUseCase.name)

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

  async execute(
    user: AuthenticatedUser,
    productId: string,
    changes: UpdateProductChanges,
  ): Promise<Product> {
    const existingProduct = await this.findOneProductUseCase.execute(productId)
    const { images, ...productFieldUpdates } = changes
    const preparedImages = images !== undefined
      ? await prepareProductImages(this.uploadService, images)
      : undefined
    const updates: Partial<Product> = {
      ...productFieldUpdates,
      ...(preparedImages !== undefined ? { images: preparedImages } : {}),
    }

    const mutableFields = Object.entries(updates).filter(([, value]) => value !== undefined)
    if (mutableFields.length === 0) {
      throw new InvalidInputError('Provide at least one product field to update.')
    }

    const timestamp = new Date().toISOString()
    if (changes.status === ProductStatus.INACTIVE) {
      existingProduct.deactivate()
    } else if (changes.status === ProductStatus.ACTIVE) {
      existingProduct.activate()
    }
    const actor = buildUserAuditMutationContext(user, 'Product updated')
    const updatedProduct = await this.productRepository.update(productId, updates, timestamp, actor)

    if (images !== undefined) {
      await deleteRemovedProductImages(
        this.uploadService,
        this.logger,
        existingProduct.images,
        updatedProduct.images,
      )
    }

    await publishProductMutationBestEffort(
      this.productEventsPublisher,
      this.logger,
      'updated',
      updatedProduct.productId,
    )
    return updatedProduct
  }
}


