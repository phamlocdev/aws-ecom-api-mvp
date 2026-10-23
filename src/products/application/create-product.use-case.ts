import { Inject, Injectable, Logger } from '@nestjs/common'
import { buildUserAuditMutationContext, toAuditMutationAttributes } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { UploadService } from '../../upload/upload.service'
import { ProductEventsPublisher } from '../infrastructure/product-events.publisher'
import {
  InitialProductInventory,
  PRODUCT_REPOSITORY,
  ProductRepositoryPort,
} from '../domain/product.repository.port'
import { Product } from '../domain/product.entity'
import { ProductStatus } from '../domain/product-status.enum'
import { prepareProductImages, ProductImageInput } from './product-image.util'
import { publishProductMutationBestEffort } from './product-event.util'

export interface CreateProductInput {
  name: string
  description: string
  categoryId: string
  price: number
  availableQuantity?: number
  imageUrl?: string
  images?: ProductImageInput[]
  status?: ProductStatus
}

@Injectable()
export class CreateProductUseCase {
  private readonly logger = new Logger(CreateProductUseCase.name)

  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: ProductRepositoryPort,
    @Inject(UploadService)
    private readonly uploadService: UploadService,
    @Inject(ProductEventsPublisher)
    private readonly productEventsPublisher: ProductEventsPublisher,
  ) {}

  async execute(user: AuthenticatedUser, input: CreateProductInput): Promise<Product> {
    const images = await prepareProductImages(this.uploadService, input.images)
    const actor = buildUserAuditMutationContext(user, 'Product created')
    const product = Product.create({
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      price: input.price,
      imageUrl: input.imageUrl,
      images,
      status: input.status,
      ...toAuditMutationAttributes(actor),
    })
    const initialInventory: InitialProductInventory = {
      productId: product.productId,
      availableQuantity: input.availableQuantity ?? 0,
      reservedQuantity: 0,
      updatedAt: product.createdAt,
      ...toAuditMutationAttributes({ ...actor, reason: 'Initial inventory created' }),
    }

    await this.productRepository.create(product, initialInventory)
    await publishProductMutationBestEffort(
      this.productEventsPublisher,
      this.logger,
      'created',
      product.productId,
    )
    return product
  }
}
