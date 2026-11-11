import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '../../common/domain-error'
import { PRODUCT_REPOSITORY, ProductRepositoryPort } from '../domain/product.repository.port'
import { Product } from '../domain/product.entity'
import { ProductStatus } from '../domain/product-status.enum'
import { UploadService } from '../../upload/upload.service'
import { withAllImageReadUrls } from './product-image.util'

@Injectable()
export class FindProductForResponseUseCase {
  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: ProductRepositoryPort,
    @Inject(UploadService)
    private readonly uploadService: UploadService,
  ) {}

  async execute(productId: string): Promise<Product> {
    const product = await this.productRepository.findOne(productId)
    if (!product || product.status === ProductStatus.DELETED) {
      throw new NotFoundError(`Product ${productId} was not found.`)
    }
    return withAllImageReadUrls(this.uploadService, product)
  }
}
