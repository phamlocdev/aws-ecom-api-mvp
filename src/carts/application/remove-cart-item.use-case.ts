import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { NotFoundError, UnauthorizedDomainError } from '../../common/domain-error'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { touchCart } from './touch-cart.util'

@Injectable()
export class RemoveCartItemUseCase {
  constructor(
    @Inject(CART_REPOSITORY)
    private readonly cartRepository: CartRepositoryPort,
  ) {}

  async execute(user: AuthenticatedUser, cartId: string, productId: string): Promise<void> {
    const cart = await this.cartRepository.findOne(user.sub, cartId)
    if (!cart) throw new NotFoundError(`Cart ${cartId} was not found.`)
    if (cart.customerId !== user.sub)
      throw new UnauthorizedDomainError('You do not have access to this cart.')
    cart.ensureUsable()

    await this.cartRepository.removeItem(cartId, productId)
    await touchCart(this.cartRepository, cart)
  }
}
