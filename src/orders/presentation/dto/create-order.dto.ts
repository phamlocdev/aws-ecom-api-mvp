import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsEmail, IsOptional, IsUUID } from 'class-validator'

export class CreateOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  cartId!: string

  @ApiProperty({
    type: [String],
    required: false,
    maxItems: 49,
    example: ['ops@example.com', 'accounting@example.com'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(49)
  @IsEmail({}, { each: true })
  additionalReceivingEmails?: string[]
}
