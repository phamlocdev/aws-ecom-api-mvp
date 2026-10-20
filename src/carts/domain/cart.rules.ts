import { InvalidInputError } from '../../common/domain-error'
import { Cart } from './cart.entity'
import { CartStatus } from './cart-status.enum'

// Pure business rules shared by several cart use-cases. Kept in domain/
// because they only depend on the Cart entity, not on Nest/AWS SDK.

export function toEpochSeconds(value: number): number {
  return Math.floor(value / 1000)
}

/** A cart whose TTL has passed is EXPIRED even if the stored row has not been touched yet. */
export function deriveCartStatus(cart: Cart): Cart {
  if (cart.expiresAt <= toEpochSeconds(Date.now())) {
    return {
      ...cart,
      status: CartStatus.EXPIRED,
    }
  }

  if (cart.status === CartStatus.EXPIRED) {
    return cart
  }

  return {
    ...cart,
    status: CartStatus.ACTIVE,
  }
}

/** Throws InvalidInputError if the cart can no longer be mutated (expired). */
export function ensureCartUsable(cart: Cart): void {
  if (cart.expiresAt <= toEpochSeconds(Date.now()) || cart.status === CartStatus.EXPIRED) {
    throw new InvalidInputError(`Cart ${cart.cartId} has expired.`)
  }
}
