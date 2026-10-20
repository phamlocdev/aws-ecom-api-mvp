import { CartStatus } from './cart-status.enum'

export interface Cart {
  customerId: string
  cartId: string
  status: CartStatus
  createdAt: string
  updatedAt: string
  expiresAt: number
}

export interface CartItem {
  cartId: string
  customerId: string
  productId: string
  quantity: number
  createdAt: string
  updatedAt: string
}

export interface CartDetails extends Cart {
  items: CartItem[]
}
