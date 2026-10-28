import { ConflictError } from '../../common/domain-error'
import { ReserveInventoryUseCase } from '../../inventory/application/reserve-inventory.use-case'
import { FindOneProductUseCase } from '../../products/application/find-one-product.use-case'
import { Product } from '../../products/domain/product.entity'
import { ProductStatus } from '../../products/domain/product-status.enum'
import { Order } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { PaymentStatus } from '../domain/payment-status.enum'
import { OrderRepositoryPort } from '../domain/order.repository.port'
import { ReserveOrderCheckoutItemsUseCase } from './reserve-order-checkout-items.use-case'

const product = Product.fromRecord({
  productId: 'p1',
  name: 'Headphones',
  description: 'Wireless headphones',
  categoryId: 'electronics',
  price: 100000,
  currency: 'VND',
  status: ProductStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const pendingOrder = Order.fromRecord({
  orderId: 'order-1',
  customerId: 'customer-1',
  customerEmail: 'customer@example.com',
  customerName: 'Customer One',
  cartId: 'cart-1',
  status: OrderStatus.PENDING,
  entityType: 'ORDER',
  deduplicationKey: 'dedup-1',
  paymentStatus: PaymentStatus.NOT_STARTED,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function mockUseCase<T extends { execute: (...args: never[]) => unknown }>(): jest.Mocked<T> {
  return { execute: jest.fn() } as unknown as jest.Mocked<T>
}

function createDeps() {
  const repository = {
    create: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    createOrderItems: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue(pendingOrder),
    findOrderItems: jest.fn(),
    findMany: jest.fn(),
    findExpiredReserved: jest.fn(),
    cancelWithInventoryRelease: jest.fn(),
    failWithInventoryRelease: jest.fn().mockResolvedValue(undefined),
    expireWithInventoryRelease: jest.fn(),
  } as unknown as jest.Mocked<OrderRepositoryPort>

  const reserveInventoryUseCase = mockUseCase<ReserveInventoryUseCase>()
  const findOneProductUseCase = mockUseCase<FindOneProductUseCase>()
  findOneProductUseCase.execute.mockResolvedValue(product)

  const configService = { getOrThrow: jest.fn().mockReturnValue(60) }

  const useCase = new ReserveOrderCheckoutItemsUseCase(
    repository as unknown as OrderRepositoryPort,
    reserveInventoryUseCase,
    findOneProductUseCase,
    configService as never,
  )

  return { repository, reserveInventoryUseCase, findOneProductUseCase, configService, useCase }
}

describe('ReserveOrderCheckoutItemsUseCase', () => {
  it('reserves inventory, persists order items and saves the order as RESERVED', async () => {
    const { reserveInventoryUseCase, repository, useCase } = createDeps()

    const result = await useCase.execute({
      orderId: 'order-1',
      cartItems: [{ productId: 'p1', quantity: 2 }],
    })

    expect(reserveInventoryUseCase.execute).toHaveBeenCalledWith('p1', 2)
    expect(repository.createOrderItems).toHaveBeenCalledWith([
      expect.objectContaining({
        orderId: 'order-1',
        productId: 'p1',
        quantity: 2,
        lineTotal: 200000,
      }),
    ])
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.RESERVED }),
    )
    expect(result).toEqual({ reservationSucceeded: true })
  })

  it('swallows a ConflictError (insufficient inventory) and releases already-reserved items without rethrowing', async () => {
    const { reserveInventoryUseCase, repository, useCase } = createDeps()
    reserveInventoryUseCase.execute
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ConflictError('Insufficient inventory for product p2.'))

    const result = await useCase.execute({
      orderId: 'order-1',
      cartItems: [
        { productId: 'p1', quantity: 1 },
        { productId: 'p2', quantity: 1 },
      ],
    })

    expect(repository.failWithInventoryRelease).toHaveBeenCalledWith(
      'order-1',
      'Insufficient inventory for product p2.',
      [{ productId: 'p1', quantity: 1 }],
      expect.objectContaining({ actorType: 'system' }),
    )
    expect(repository.save).not.toHaveBeenCalled()
    expect(result).toEqual({ reservationSucceeded: false })
  })

  it('swallows a ConflictError on the very first item (nothing reserved yet) and saves the order as FAILED', async () => {
    const { reserveInventoryUseCase, repository, useCase } = createDeps()
    reserveInventoryUseCase.execute.mockRejectedValue(
      new ConflictError('Insufficient inventory for product p1.'),
    )

    const result = await useCase.execute({
      orderId: 'order-1',
      cartItems: [{ productId: 'p1', quantity: 1 }],
    })

    expect(repository.failWithInventoryRelease).not.toHaveBeenCalled()
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.FAILED }),
    )
    expect(result).toEqual({ reservationSucceeded: false })
  })

  it('uses the provided actorId as the system actor identity', async () => {
    const { repository, useCase } = createDeps()

    await useCase.execute({
      orderId: 'order-1',
      cartItems: [{ productId: 'p1', quantity: 1 }],
      actorId: 'place-order-worker',
    })

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.RESERVED }),
    )
  })

  it('rethrows an unexpected (non-ConflictError) error after saving the order as FAILED', async () => {
    const { reserveInventoryUseCase, repository, useCase } = createDeps()
    reserveInventoryUseCase.execute.mockRejectedValue(new Error('DynamoDB is unavailable.'))

    await expect(
      useCase.execute({ orderId: 'order-1', cartItems: [{ productId: 'p1', quantity: 1 }] }),
    ).rejects.toThrow('DynamoDB is unavailable.')
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.FAILED }),
    )
  })
})
