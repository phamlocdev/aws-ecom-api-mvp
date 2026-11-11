import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { Cart } from '../domain/cart.entity'
import { toEpochSeconds } from '../domain/cart.rules'

const DEFAULT_TTL_DAYS = 30

export interface CreateCartInput {
  ttlDays?: number
}

@Injectable()
export class CreateCartUseCase {
  constructor(
    @Inject(CART_REPOSITORY)
    private readonly cartRepository: CartRepositoryPort,
  ) {}

  async execute(user: AuthenticatedUser, input: CreateCartInput): Promise<Cart> {
    const cart = Cart.create({
      customerId: user.sub,
      expiresAt: toEpochSeconds(
        Date.now() + (input.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000,
      ),
    })

    await this.cartRepository.create(cart)
    return cart
  }
}
