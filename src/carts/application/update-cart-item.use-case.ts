import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { CartDetails } from '../domain/cart.entity'
import { GetOwnedCartUseCase } from './get-owned-cart.use-case'
import { FindOneCartUseCase } from './find-one-cart.use-case'
import { touchCart } from './touch-cart.util'

@Injectable()
export class UpdateCartItemUseCase {
  constructor(
    @Inject(CART_REPOSITORY)
    private readonly cartRepository: CartRepositoryPort,
    @Inject(GetOwnedCartUseCase)
    private readonly getOwnedCartUseCase: GetOwnedCartUseCase,
    @Inject(FindOneCartUseCase)
    private readonly findOneCartUseCase: FindOneCartUseCase,
  ) {}

  async execute(
    user: AuthenticatedUser,
    cartId: string,
    productId: string,
    quantity: number,
  ): Promise<CartDetails> {
    const cart = await this.getOwnedCartUseCase.execute(user.sub, cartId)
    cart.ensureUsable()

    await this.cartRepository.updateItemQuantity(
      cartId,
      productId,
      quantity,
      new Date().toISOString(),
    )

    await touchCart(this.cartRepository, cart)
    return this.findOneCartUseCase.execute(user, cartId)
  }
}
