import { Inject, Injectable, Logger } from '@nestjs/common'
import { buildUserAuditMutationContext, toAuditMutationAttributes } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { GetCartItemsUseCase } from '../../carts/application/get-cart-items.use-case'
import { GetOwnedCartUseCase } from '../../carts/application/get-owned-cart.use-case'
import { MarkCartExpiredUseCase } from '../../carts/application/mark-cart-expired.use-case'
import { CartStatus } from '../../carts/domain/cart-status.enum'
import { InvalidInputError } from '../../common/domain-error'
import { FindCustomerProfileByUsernameUseCase } from '../../users/application/find-customer-profile-by-username.use-case'
import { Order } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { CreateOrderInput } from './create-order-input.type'
import { GetOrderByIdUseCase } from './get-order-by-id.use-case'
import { MarkFailedUseCase } from './mark-failed.use-case'
import { ReserveOrderCheckoutItemsUseCase } from './reserve-order-checkout-items.use-case'

@Injectable()
export class CreateOrderRequestUseCase {
  private readonly logger = new Logger(CreateOrderRequestUseCase.name)

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(GetOwnedCartUseCase)
    private readonly getOwnedCartUseCase: GetOwnedCartUseCase,
    @Inject(GetCartItemsUseCase)
    private readonly getCartItemsUseCase: GetCartItemsUseCase,
    @Inject(MarkCartExpiredUseCase)
    private readonly markCartExpiredUseCase: MarkCartExpiredUseCase,
    @Inject(FindCustomerProfileByUsernameUseCase)
    private readonly findCustomerProfileByUsernameUseCase: FindCustomerProfileByUsernameUseCase,
    @Inject(MarkFailedUseCase)
    private readonly markFailedUseCase: MarkFailedUseCase,
    @Inject(ReserveOrderCheckoutItemsUseCase)
    private readonly reserveOrderCheckoutItemsUseCase: ReserveOrderCheckoutItemsUseCase,
    @Inject(GetOrderByIdUseCase)
    private readonly getOrderByIdUseCase: GetOrderByIdUseCase,
  ) {}

  async execute(user: AuthenticatedUser, input: CreateOrderInput): Promise<Order> {
    const cart = await this.getOwnedCartUseCase.execute(user.sub, input.cartId)
    if (cart.status === CartStatus.EXPIRED || cart.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new InvalidInputError(`Cart ${input.cartId} has expired.`)
    }

    const profile =
      user.name && user.email
        ? { username: user.username, name: user.name, email: user.email, sub: user.sub }
        : await this.findCustomerProfileByUsernameUseCase.execute(user.username)

    const createActor = buildUserAuditMutationContext(user, 'Order created')
    const order = Order.create({
      customerId: user.sub,
      customerEmail: user.email ?? profile.email,
      customerName: user.name ?? profile.name,
      additionalReceivingEmails: input.additionalReceivingEmails,
      cartId: input.cartId,
      ...toAuditMutationAttributes(createActor),
    })

    await this.orderRepository.create(order)

    this.logger.log(
      `>>>>>> [START]: Processing order ${order.orderId} for cart ${order.cartId} and customer ${order.customerId}.`,
    )

    const cartItems = await this.getCartItemsUseCase.execute(cart.cartId)
    if (cartItems.length === 0) {
      this.logger.warn(
        `>>>>>> [WARN]: Order ${order.orderId} failed because cart ${cart.cartId} has no items.`,
      )
      await this.markFailedUseCase.execute(order.orderId, OrderStatus.FAILED, 'Cart has no items.')
      return this.getOrderByIdUseCase.execute(order.orderId)
    }

    const { reservationSucceeded } = await this.reserveOrderCheckoutItemsUseCase.execute({
      orderId: order.orderId,
      cartItems: cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    })

    if (reservationSucceeded) {
      await this.markCartExpiredUseCase.execute(cart)
    }

    return this.getOrderByIdUseCase.execute(order.orderId)
  }
}
