import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, Min } from 'class-validator'

export class UpdateInventoryDto {
  @ApiProperty({
    example: 25,
    description: 'Absolute available quantity to persist for this product.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  availableQuantity!: number
}
