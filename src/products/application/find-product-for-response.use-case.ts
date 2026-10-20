import { Inject, Injectable } from '@nestjs/common'
import { UploadService } from '../../upload/upload.service'
import { Product } from '../domain/product.entity'
import { FindOneProductUseCase } from './find-one-product.use-case'
import { withAllImageReadUrls } from './product-image.util'

// Backs the GET /products/:productId endpoint: same lookup/soft-delete rule
// as FindOneProductUseCase, plus presigned read URLs for every image.
@Injectable()
export class FindProductForResponseUseCase {
  constructor(
    @Inject(FindOneProductUseCase)
    private readonly findOneProductUseCase: FindOneProductUseCase,
    @Inject(UploadService)
    private readonly uploadService: UploadService,
  ) {}

  async execute(productId: string): Promise<Product> {
    const product = await this.findOneProductUseCase.execute(productId)
    return withAllImageReadUrls(this.uploadService, product)
  }
}
