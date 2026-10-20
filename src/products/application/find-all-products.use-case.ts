import { Inject, Injectable } from '@nestjs/common'
import { PaginatedResponse } from '../../pagination/pagination.types'
import { resolvePaginationState, toPaginatedResponse } from '../../pagination/pagination.util'
import { UploadService } from '../../upload/upload.service'
import { PRODUCT_REPOSITORY, ProductRepositoryPort } from '../domain/product.repository.port'
import { Product } from '../domain/product.entity'
import { FindAllProductsInput, normalizeProductFilters, toCursorScope } from './product-query.util'
import { withPrimaryImageReadUrls } from './product-image.util'

@Injectable()
export class FindAllProductsUseCase {
  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: ProductRepositoryPort,
    @Inject(UploadService)
    private readonly uploadService: UploadService,
  ) {}

  async execute(query: FindAllProductsInput): Promise<PaginatedResponse<Product>> {
    const filters = normalizeProductFilters(query)
    const cursorScope = toCursorScope(filters)
    const pagination = resolvePaginationState('products', query, cursorScope)

    const page = await this.productRepository.findAll(filters, pagination.limit, pagination.startKey)
    const enrichedItems = await withPrimaryImageReadUrls(this.uploadService, page.items)

    return {
      ...toPaginatedResponse('products', pagination, enrichedItems, page.lastEvaluatedKey),
      scannedCount: page.scannedCount,
    }
  }
}
