import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaginatedResponseDto } from '../../../pagination/pagination.types'
import { ProductStatus } from '../../../products/domain/product-status.enum'

export class InventoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string

  @ApiProperty()
  productName!: string

  @ApiProperty()
  categoryId!: string

  @ApiPropertyOptional()
  imageUrl?: string

  @ApiProperty({ enum: ProductStatus })
  productStatus!: ProductStatus

  @ApiProperty({ example: 10 })
  availableQuantity!: number

  @ApiProperty({ example: 2 })
  reservedQuantity!: number

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string
}

export class PaginatedInventoryResponseDto extends PaginatedResponseDto<InventoryResponseDto> {
  @ApiProperty({ type: [InventoryResponseDto] })
  declare items: InventoryResponseDto[]
}
