import { Inject, Injectable } from '@nestjs/common'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { Cart } from '../domain/cart.entity'
import { CartStatus } from '../domain/cart-status.enum'

// Used by the order checkout/expiry flows (orders service, orders worker) to
// release a cart once its reservation window has lapsed.
@Injectable()
export class MarkCartExpiredUseCase {
  constructor(
    @Inject(CART_REPOSITORY)
    private readonly cartRepository: CartRepositoryPort,
  ) {}

  async execute(cart: Cart): Promise<void> {
    if (cart.status === CartStatus.EXPIRED) {
      return
    }

    const updatedAt = new Date().toISOString()
    cart.expire(updatedAt)
    await this.cartRepository.updateStatus(cart.customerId, cart.cartId, CartStatus.EXPIRED, updatedAt)
  }
}
