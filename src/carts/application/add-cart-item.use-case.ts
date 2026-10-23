import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { CartDetails, CartItem } from '../domain/cart.entity'
import { ensureCartUsable } from '../domain/cart.rules'
import { GetOwnedCartUseCase } from './get-owned-cart.use-case'
import { FindOneCartUseCase } from './find-one-cart.use-case'
import { touchCart } from './touch-cart.util'

export interface AddCartItemInput {
  productId: string
  quantity: number
}

@Injectable()
export class AddCartItemUseCase {
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
    input: AddCartItemInput,
  ): Promise<CartDetails> {
    const cart = await this.getOwnedCartUseCase.execute(user.sub, cartId)
    ensureCartUsable(cart)

    const item = CartItem.create({
      cartId,
      customerId: user.sub,
      productId: input.productId,
      quantity: input.quantity,
    })

    await this.cartRepository.putItem(item)
    await touchCart(this.cartRepository, cart)
    return this.findOneCartUseCase.execute(user, cartId)
  }
}
