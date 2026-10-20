import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { Cart } from '../domain/cart.entity'
import { deriveCartStatus } from '../domain/cart.rules'

@Injectable()
export class FindAllCartsUseCase {
  constructor(
    @Inject(CART_REPOSITORY)
    private readonly cartRepository: CartRepositoryPort,
  ) {}

  async execute(user: AuthenticatedUser): Promise<Cart[]> {
    const carts = await this.cartRepository.findAllByCustomer(user.sub)
    return carts.map((cart) => deriveCartStatus(cart))
  }
}
