import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError, UnauthorizedDomainError } from '../../common/domain-error'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { Cart } from '../domain/cart.entity'

// Looked up by every other cart use-case (and directly by orders/orders
// worker, which only need the raw cart, not its items).
@Injectable()
export class GetOwnedCartUseCase {
  constructor(
    @Inject(CART_REPOSITORY)
    private readonly cartRepository: CartRepositoryPort,
  ) {}

  async execute(customerId: string, cartId: string): Promise<Cart> {
    const cart = await this.cartRepository.findOne(customerId, cartId)
    if (!cart) {
      throw new NotFoundError(`Cart ${cartId} was not found.`)
    }

    if (cart.customerId !== customerId) {
      throw new UnauthorizedDomainError('You do not have access to this cart.')
    }

    return cart
  }
}
