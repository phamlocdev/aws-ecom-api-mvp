import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsUUID, Min } from 'class-validator'

export class UpsertCartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number
}
