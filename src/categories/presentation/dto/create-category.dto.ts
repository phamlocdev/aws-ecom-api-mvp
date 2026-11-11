import { Transform } from 'class-transformer'
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

export class CreateCategoryDto {
  @ApiProperty({
    example: 'electronics',
    description: 'Stable lowercase slug used by Product.categoryId',
  })
  @Transform(trimString)
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(64)
  categoryId!: string

  @ApiProperty({ example: 'Thiết bị điện tử' })
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string

  @ApiPropertyOptional({ example: 'Thiết bị công nghệ và phụ kiện.' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description?: string
}
