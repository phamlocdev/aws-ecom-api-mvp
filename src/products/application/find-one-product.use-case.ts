import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '../../common/domain-error'
import { PRODUCT_REPOSITORY, ProductRepositoryPort } from '../domain/product.repository.port'
import { Product } from '../domain/product.entity'
import { ProductStatus } from '../domain/product-status.enum'

// Used both by the products controller (as a building block for the other
// product use-cases) and directly by other modules (orders, orders worker)
// that only need the raw product record, without image read URLs.
@Injectable()
export class FindOneProductUseCase {
  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: ProductRepositoryPort,
  ) {}

  async execute(productId: string): Promise<Product> {
    const product = await this.productRepository.findOne(productId)
    if (!product || product.status === ProductStatus.DELETED) {
      throw new NotFoundError(`Product ${productId} was not found.`)
    }
    return product
  }
}
