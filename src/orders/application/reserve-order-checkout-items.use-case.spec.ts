import { ConflictError } from '../../common/domain-error'
import { ReserveInventoryUseCase } from '../../inventory/application/reserve-inventory.use-case'
import { FindOneProductUseCase } from '../../products/application/find-one-product.use-case'
import { Product } from '../../products/domain/product.entity'
import { ProductStatus } from '../../products/domain/product-status.enum'
import { OrderStatus } from '../domain/order-status.enum'
import { OrderRepositoryPort } from '../domain/order.repository.port'
import { FailPendingOrderAndReleaseReservationUseCase } from './fail-pending-order-and-release-reservation.use-case'
import { MarkFailedUseCase } from './mark-failed.use-case'
import { MarkReservedUseCase } from './mark-reserved.use-case'
import { ReserveOrderCheckoutItemsUseCase } from './reserve-order-checkout-items.use-case'

const product: Product = {
  productId: 'p1',
  name: 'Headphones',
  description: 'Wireless headphones',
  categoryId: 'electronics',
  price: 100000,
  currency: 'VND',
  status: ProductStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function mockUseCase<T extends { execute: (...args: never[]) => unknown }>(): jest.Mocked<T> {
  return { execute: jest.fn() } as unknown as jest.Mocked<T>
}

function createDeps() {
  const repository = {
    createOrderItems: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<OrderRepositoryPort, 'createOrderItems'>>
  const reserveInventoryUseCase = mockUseCase<ReserveInventoryUseCase>()
  const findOneProductUseCase = mockUseCase<FindOneProductUseCase>()
  findOneProductUseCase.execute.mockResolvedValue(product)
  const markReservedUseCase = mockUseCase<MarkReservedUseCase>()
  const markFailedUseCase = mockUseCase<MarkFailedUseCase>()
  const failPendingOrderAndReleaseReservationUseCase =
    mockUseCase<FailPendingOrderAndReleaseReservationUseCase>()

  const useCase = new ReserveOrderCheckoutItemsUseCase(
    repository as unknown as OrderRepositoryPort,
    reserveInventoryUseCase,
    findOneProductUseCase,
    markReservedUseCase,
    markFailedUseCase,
    failPendingOrderAndReleaseReservationUseCase,
  )

  return {
    repository,
    reserveInventoryUseCase,
    findOneProductUseCase,
    markReservedUseCase,
    markFailedUseCase,
    failPendingOrderAndReleaseReservationUseCase,
    useCase,
  }
}

describe('ReserveOrderCheckoutItemsUseCase', () => {
  it('reserves inventory, persists order items and marks the order RESERVED (no actorId)', async () => {
    const { reserveInventoryUseCase, repository, markReservedUseCase, useCase } = createDeps()

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
    expect(markReservedUseCase.execute).toHaveBeenCalledWith('order-1', 200000)
    expect(result).toEqual({ reservationSucceeded: true })
  })

  it('marks the order RESERVED with a system actor when actorId is provided (worker path)', async () => {
    const { markReservedUseCase, useCase } = createDeps()

    await useCase.execute({
      orderId: 'order-1',
      cartItems: [{ productId: 'p1', quantity: 1 }],
      actorId: 'place-order-worker',
    })

    expect(markReservedUseCase.execute).toHaveBeenCalledWith(
      'order-1',
      100000,
      expect.objectContaining({ actorType: 'system', actorId: 'place-order-worker' }),
    )
  })

  it('swallows a ConflictError (insufficient inventory) and releases already-reserved items without rethrowing', async () => {
    const {
      reserveInventoryUseCase,
      failPendingOrderAndReleaseReservationUseCase,
      markFailedUseCase,
      useCase,
    } = createDeps()
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

    expect(failPendingOrderAndReleaseReservationUseCase.execute).toHaveBeenCalledWith(
      'order-1',
      'Insufficient inventory for product p2.',
      [{ productId: 'p1', quantity: 1 }],
    )
    expect(markFailedUseCase.execute).not.toHaveBeenCalled()
    expect(result).toEqual({ reservationSucceeded: false })
  })

  it('swallows a ConflictError on the very first item (nothing reserved yet) and marks the order FAILED', async () => {
    const {
      reserveInventoryUseCase,
      markFailedUseCase,
      failPendingOrderAndReleaseReservationUseCase,
      useCase,
    } = createDeps()
    reserveInventoryUseCase.execute.mockRejectedValue(
      new ConflictError('Insufficient inventory for product p1.'),
    )

    const result = await useCase.execute({
      orderId: 'order-1',
      cartItems: [{ productId: 'p1', quantity: 1 }],
    })

    expect(markFailedUseCase.execute).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.FAILED,
      'Insufficient inventory for product p1.',
    )
    expect(failPendingOrderAndReleaseReservationUseCase.execute).not.toHaveBeenCalled()
    expect(result).toEqual({ reservationSucceeded: false })
  })

  it('uses a system actor for the failure path when actorId is provided (worker path)', async () => {
    const { reserveInventoryUseCase, markFailedUseCase, useCase } = createDeps()
    reserveInventoryUseCase.execute.mockRejectedValue(
      new ConflictError('Insufficient inventory for product p1.'),
    )

    await useCase.execute({
      orderId: 'order-1',
      cartItems: [{ productId: 'p1', quantity: 1 }],
      actorId: 'place-order-worker',
    })

    expect(markFailedUseCase.execute).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.FAILED,
      'Insufficient inventory for product p1.',
      expect.objectContaining({ actorType: 'system', actorId: 'place-order-worker' }),
    )
  })

  it('rethrows an unexpected (non-ConflictError) error after marking the order FAILED', async () => {
    const { reserveInventoryUseCase, markFailedUseCase, useCase } = createDeps()
    reserveInventoryUseCase.execute.mockRejectedValue(new Error('DynamoDB is unavailable.'))

    await expect(
      useCase.execute({ orderId: 'order-1', cartItems: [{ productId: 'p1', quantity: 1 }] }),
    ).rejects.toThrow('DynamoDB is unavailable.')
    expect(markFailedUseCase.execute).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.FAILED,
      'DynamoDB is unavailable.',
    )
  })
})
