import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaginatedResponseDto } from '../../../pagination/pagination.types'
import { ProductStatus } from '../../domain/product-status.enum'

export class ProductResponseDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string

  @ApiProperty()
  name!: string

  @ApiProperty()
  description!: string

  @ApiProperty()
  categoryId!: string

  @ApiProperty({ example: 1299000 })
  price!: number

  @ApiProperty({ example: 'VND' })
  currency!: 'VND'

  @ApiPropertyOptional()
  imageUrl?: string

  @ApiPropertyOptional({ type: () => [ProductImageResponseDto] })
  images?: ProductImageResponseDto[]

  @ApiProperty({ enum: ProductStatus })
  status!: ProductStatus

  @ApiProperty({ format: 'date-time' })
  createdAt!: string

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string
}

export class ProductImageResponseDto {
  @ApiProperty()
  key!: string

  @ApiProperty()
  sortOrder!: number

  @ApiProperty()
  isPrimary!: boolean

  @ApiPropertyOptional()
  altText?: string

  @ApiPropertyOptional()
  readUrl?: string

  @ApiPropertyOptional({ example: 900 })
  readUrlExpiresInSeconds?: number
}

export class PaginatedProductResponseDto extends PaginatedResponseDto<ProductResponseDto> {
  @ApiProperty({ type: [ProductResponseDto] })
  declare items: ProductResponseDto[]
}
