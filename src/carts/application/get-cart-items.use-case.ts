import { Inject, Injectable } from '@nestjs/common'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { CartItem } from '../domain/cart.entity'

// Used internally by FindOneCartUseCase and directly by orders/orders worker.
@Injectable()
export class GetCartItemsUseCase {
  constructor(
    @Inject(CART_REPOSITORY)
    private readonly cartRepository: CartRepositoryPort,
  ) {}

  async execute(cartId: string): Promise<CartItem[]> {
    return this.cartRepository.findItems(cartId)
  }
}
