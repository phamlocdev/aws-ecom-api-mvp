import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CartDetails } from '../domain/cart.entity'
import { GetOwnedCartUseCase } from './get-owned-cart.use-case'
import { GetCartItemsUseCase } from './get-cart-items.use-case'

@Injectable()
export class FindOneCartUseCase {
  constructor(
    @Inject(GetOwnedCartUseCase)
    private readonly getOwnedCartUseCase: GetOwnedCartUseCase,
    @Inject(GetCartItemsUseCase)
    private readonly getCartItemsUseCase: GetCartItemsUseCase,
  ) {}

  async execute(user: AuthenticatedUser, cartId: string): Promise<CartDetails> {
    const cart = await this.getOwnedCartUseCase.execute(user.sub, cartId)
    const items = await this.getCartItemsUseCase.execute(cartId)
    return CartDetails.fromParts(cart, items)
  }
}
