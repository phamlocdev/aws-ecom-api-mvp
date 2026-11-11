import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { NotFoundError, UnauthorizedDomainError } from '../../common/domain-error'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { CartDetails, CartItem } from '../domain/cart.entity'
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
  ) {}

  async execute(
    user: AuthenticatedUser,
    cartId: string,
    input: AddCartItemInput,
  ): Promise<CartDetails> {
    const cart = await this.cartRepository.findOne(user.sub, cartId)
    if (!cart) throw new NotFoundError(`Cart ${cartId} was not found.`)
    if (cart.customerId !== user.sub)
      throw new UnauthorizedDomainError('You do not have access to this cart.')
    cart.ensureUsable()

    const item = CartItem.create({
      cartId,
      customerId: user.sub,
      productId: input.productId,
      quantity: input.quantity,
    })

    await this.cartRepository.putItem(item)
    await touchCart(this.cartRepository, cart)

    const items = await this.cartRepository.findItems(cartId)
    return CartDetails.fromParts(cart, items)
  }
}
