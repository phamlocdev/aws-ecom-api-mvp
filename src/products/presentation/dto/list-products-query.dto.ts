import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator'
import { PaginationQueryDto } from '../../../pagination/pagination-query.dto'
import { ProductStatus } from '../../domain/product-status.enum'

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

@ValidatorConstraint({ name: 'isGreaterThanOrEqualTo', async: false })
class IsGreaterThanOrEqualToConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [relatedPropertyName] = args.constraints as [string]
    const relatedValue = (args.object as Record<string, unknown>)[relatedPropertyName]

    if (value === undefined || relatedValue === undefined) {
      return true
    }

    return typeof value === 'number' && typeof relatedValue === 'number' && value >= relatedValue
  }

  defaultMessage(args: ValidationArguments): string {
    const [relatedPropertyName] = args.constraints as [string]
    return `${args.property} must be greater than or equal to ${relatedPropertyName}.`
  }
}

@ValidatorConstraint({ name: 'isDateGreaterThanOrEqualTo', async: false })
class IsDateGreaterThanOrEqualToConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [relatedPropertyName] = args.constraints as [string]
    const relatedValue = (args.object as Record<string, unknown>)[relatedPropertyName]

    if (value === undefined || relatedValue === undefined) {
      return true
    }

    const timestamp = typeof value === 'string' ? Date.parse(value) : Number.NaN
    const relatedTimestamp =
      typeof relatedValue === 'string' ? Date.parse(relatedValue) : Number.NaN

    return (
      Number.isFinite(timestamp) &&
      Number.isFinite(relatedTimestamp) &&
      timestamp >= relatedTimestamp
    )
  }

  defaultMessage(args: ValidationArguments): string {
    const [relatedPropertyName] = args.constraints as [string]
    return `${args.property} must be greater than or equal to ${relatedPropertyName}.`
  }
}

export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'electronics',
    description: 'Return only products that reference this categoryId.',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  categoryId?: string

  @ApiPropertyOptional({
    enum: ProductStatus,
    description: 'Return only products with this status.',
  })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus

  @ApiPropertyOptional({
    example: 100000,
    description: 'Minimum product price in VND.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minPrice?: number

  @ApiPropertyOptional({
    example: 500000,
    description: 'Maximum product price in VND.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Validate(IsGreaterThanOrEqualToConstraint, ['minPrice'])
  maxPrice?: number

  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00.000Z',
    description: 'Return products updated at or after this ISO timestamp.',
  })
  @IsOptional()
  @Transform(trimString)
  @IsDateString()
  updatedFrom?: string

  @ApiPropertyOptional({
    example: '2026-08-31T23:59:59.999Z',
    description: 'Return products updated at or before this ISO timestamp.',
  })
  @IsOptional()
  @Transform(trimString)
  @IsDateString()
  @Validate(IsDateGreaterThanOrEqualToConstraint, ['updatedFrom'])
  updatedTo?: string

  @ApiPropertyOptional({
    example: 'Bluetooth',
    description: 'Case-sensitive substring search across product name and description.',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  q?: string
}
