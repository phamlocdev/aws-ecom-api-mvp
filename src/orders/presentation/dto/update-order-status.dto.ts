import { ApiProperty } from '@nestjs/swagger'
import { IsIn } from 'class-validator'
import { OrderStatus } from '../../domain/order-status.enum'

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: [OrderStatus.SHIPPED, OrderStatus.CANCELLED], example: OrderStatus.SHIPPED })
  @IsIn([OrderStatus.SHIPPED, OrderStatus.CANCELLED])
  status!: OrderStatus.SHIPPED | OrderStatus.CANCELLED
}
