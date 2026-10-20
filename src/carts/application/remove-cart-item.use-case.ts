import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { ensureCartUsable } from '../domain/cart.rules'
import { GetOwnedCartUseCase } from './get-owned-cart.use-case'
import { touchCart } from './touch-cart.util'

@Injectable()
export class RemoveCartItemUseCase {
  constructor(
    @Inject(CART_REPOSITORY)
    private readonly cartRepository: CartRepositoryPort,
    @Inject(GetOwnedCartUseCase)
    private readonly getOwnedCartUseCase: GetOwnedCartUseCase,
  ) {}

  async execute(user: AuthenticatedUser, cartId: string, productId: string): Promise<void> {
    const cart = await this.getOwnedCartUseCase.execute(user.sub, cartId)
    ensureCartUsable(cart)

    await this.cartRepository.removeItem(cartId, productId)
    await touchCart(this.cartRepository, cart)
  }
}
