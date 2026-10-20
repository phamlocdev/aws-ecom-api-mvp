import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CART_REPOSITORY, CartRepositoryPort } from '../domain/cart.repository.port'
import { Cart } from '../domain/cart.entity'
import { CartStatus } from '../domain/cart-status.enum'
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
    const timestamp = new Date().toISOString()
    const cart: Cart = {
      customerId: user.sub,
      cartId: randomUUID(),
      status: CartStatus.ACTIVE,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: toEpochSeconds(
        Date.now() + (input.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000,
      ),
    }

    await this.cartRepository.create(cart)
    return cart
  }
}
