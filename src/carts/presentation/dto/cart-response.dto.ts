import { ApiProperty } from '@nestjs/swagger'
import { CartStatus } from '../../domain/cart-status.enum'

export class CartItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string

  @ApiProperty()
  quantity!: number

  @ApiProperty()
  createdAt!: string

  @ApiProperty()
  updatedAt!: string
}

export class CartResponseDto {
  @ApiProperty()
  customerId!: string

  @ApiProperty({ format: 'uuid' })
  cartId!: string

  @ApiProperty({ enum: CartStatus })
  status!: CartStatus

  @ApiProperty()
  createdAt!: string

  @ApiProperty()
  updatedAt!: string

  @ApiProperty()
  expiresAt!: number
}

export class CartDetailsResponseDto extends CartResponseDto {
  @ApiProperty({ type: CartItemResponseDto, isArray: true })
  items!: CartItemResponseDto[]
}
