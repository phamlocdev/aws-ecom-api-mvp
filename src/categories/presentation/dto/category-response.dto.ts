import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaginatedResponseDto } from '../../../pagination/pagination.types'

export class CategoryResponseDto {
  @ApiProperty({ example: 'electronics' })
  categoryId!: string

  @ApiProperty({ example: 'Thiết bị điện tử' })
  name!: string

  @ApiPropertyOptional({ example: 'Thiết bị công nghệ và phụ kiện.' })
  description?: string

  @ApiProperty({ format: 'date-time' })
  createdAt!: string

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string
}

export class PaginatedCategoryResponseDto extends PaginatedResponseDto<CategoryResponseDto> {
  @ApiProperty({ type: [CategoryResponseDto] })
  declare items: CategoryResponseDto[]
}
