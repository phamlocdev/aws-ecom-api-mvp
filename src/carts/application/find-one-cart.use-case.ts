import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { NotFoundError, UnauthorizedDomainError } from '../../common/domain-error'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { CartDetails } from '../domain/cart.entity'

@Injectable()
export class FindOneCartUseCase {
  constructor(
    @Inject(CART_REPOSITORY)
    private readonly cartRepository: CartRepositoryPort,
  ) {}

  async execute(user: AuthenticatedUser, cartId: string): Promise<CartDetails> {
    const cart = await this.cartRepository.findOne(user.sub, cartId)
    if (!cart) throw new NotFoundError(`Cart ${cartId} was not found.`)
    if (cart.customerId !== user.sub)
      throw new UnauthorizedDomainError('You do not have access to this cart.')
    const items = await this.cartRepository.findItems(cartId)
    return CartDetails.fromParts(cart, items)
  }
}
