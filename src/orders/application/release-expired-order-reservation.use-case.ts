import { Inject, Injectable } from '@nestjs/common'
import { ExpireReservationAndReleaseInventoryIfUnpaidUseCase } from './expire-reservation-and-release-inventory-if-unpaid.use-case'
import { FindOrderItemsUseCase } from './find-order-items.use-case'
import { Order } from '../domain/order.entity'

@Injectable()
export class ReleaseExpiredOrderReservationUseCase {
  constructor(
    @Inject(FindOrderItemsUseCase)
    private readonly findOrderItemsUseCase: FindOrderItemsUseCase,
    @Inject(ExpireReservationAndReleaseInventoryIfUnpaidUseCase)
    private readonly expireReservationAndReleaseInventoryIfUnpaidUseCase: ExpireReservationAndReleaseInventoryIfUnpaidUseCase,
  ) {}

  async execute(order: Order): Promise<void> {
    if (!order.canExpireReservation()) {
      return
    }

    const items = await this.findOrderItemsUseCase.execute(order.orderId)
    if (items.length === 0) {
      return
    }

    await this.expireReservationAndReleaseInventoryIfUnpaidUseCase.execute(
      order,
      items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    )
  }
}
