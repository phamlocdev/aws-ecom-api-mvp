import { Cart, CartItem } from './cart.entity'
import { CartStatus } from './cart-status.enum'

export const CART_REPOSITORY = Symbol('CART_REPOSITORY')

/**
 * Port implemented by the infrastructure layer. Kept free of any
 * NestJS/AWS SDK type so the application layer can depend on it directly.
 */
export interface CartRepositoryPort {
  /** No existence check is translated to a domain error here (matches the pre-refactor behavior). */
  create(cart: Cart): Promise<void>

  findAllByCustomer(customerId: string): Promise<Cart[]>

  /** Returns null if the cart does not exist for this customerId/cartId pair. */
  findOne(customerId: string, cartId: string): Promise<Cart | null>

  findItems(cartId: string): Promise<CartItem[]>

  /** Upserts the item (no existence check), matching the previous addItem behavior. */
  putItem(item: CartItem): Promise<void>

  /** Throws NotFoundError if the product is not in the cart. */
  updateItemQuantity(
    cartId: string,
    productId: string,
    quantity: number,
    updatedAt: string,
  ): Promise<void>

  /** Throws NotFoundError if the product is not in the cart. */
  removeItem(cartId: string, productId: string): Promise<void>

  updateStatus(
    customerId: string,
    cartId: string,
    status: CartStatus,
    updatedAt: string,
  ): Promise<void>
}
