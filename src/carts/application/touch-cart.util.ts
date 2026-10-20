import { CartRepositoryPort } from '../domain/cart.repository.port'
import { Cart } from '../domain/cart.entity'
import { deriveCartStatus } from '../domain/cart.rules'

// Shared by every cart-item mutation use-case to bump the parent cart's
// updatedAt/status after an item is added/updated/removed.
export async function touchCart(cartRepository: CartRepositoryPort, cart: Cart): Promise<void> {
  await cartRepository.updateStatus(
    cart.customerId,
    cart.cartId,
    deriveCartStatus(cart).status,
    new Date().toISOString(),
  )
}
