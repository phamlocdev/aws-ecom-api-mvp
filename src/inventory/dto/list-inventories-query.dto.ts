import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'
import { PaginationQueryDto } from '../../pagination/pagination-query.dto'
import { ProductStatus } from '../../products/domain/product-status.enum'

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

function toProductIdArray({ value }: { value: unknown }): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
  }

  if (typeof value === 'string') {
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)

    return items.length > 0 ? items : undefined
  }

  return undefined
}

export class ListInventoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'Bluetooth',
    description: 'Case-sensitive substring search across product name, description, or productId.',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(120)
  q?: string

  @ApiPropertyOptional({
    enum: ProductStatus,
    description: 'Return only inventory rows for products with this status.',
  })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus

  @ApiPropertyOptional({
    type: [String],
    description:
      'Optional list of product IDs to fetch inventory summaries for. Accepts a comma-separated string.',
  })
  @IsOptional()
  @Transform(toProductIdArray)
  @IsArray()
  @IsString({ each: true })
  productIds?: string[]
}
