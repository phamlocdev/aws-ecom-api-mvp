import { InvalidInputError, NotFoundError, UnauthorizedDomainError } from '../../common/domain-error'
import { Role } from '../../auth/roles.enum'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CartRepositoryPort } from '../domain/cart.repository.port'
import { Cart } from '../domain/cart.entity'
import { CartStatus } from '../domain/cart-status.enum'
import { CreateCartUseCase } from './create-cart.use-case'
import { FindAllCartsUseCase } from './find-all-carts.use-case'
import { FindOneCartUseCase } from './find-one-cart.use-case'
import { GetOwnedCartUseCase } from './get-owned-cart.use-case'
import { GetCartItemsUseCase } from './get-cart-items.use-case'
import { AddCartItemUseCase } from './add-cart-item.use-case'
import { UpdateCartItemUseCase } from './update-cart-item.use-case'
import { RemoveCartItemUseCase } from './remove-cart-item.use-case'
import { MarkCartExpiredUseCase } from './mark-cart-expired.use-case'

// Unit tests for the carts use-cases (Giai đoạn 3): exercised against a
// mocked CartRepositoryPort, no AWS SDK involved. See docs/refactor/PLAN.md.

const user: AuthenticatedUser = {
  sub: 'customer-1',
  username: 'customer',
  email: 'customer@example.com',
  groups: [Role.CUSTOMER],
  permissions: [],
  tokenUse: 'access',
  clientId: 'test-client',
}

const activeCart: Cart = {
  customerId: user.sub,
  cartId: 'cart-1',
  status: CartStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
}

const expiredCart: Cart = {
  ...activeCart,
  cartId: 'cart-expired',
  expiresAt: Math.floor(Date.now() / 1000) - 3600,
}

function createRepositoryMock(): jest.Mocked<CartRepositoryPort> {
  return {
    create: jest.fn(),
    findAllByCustomer: jest.fn(),
    findOne: jest.fn(),
    findItems: jest.fn(),
    putItem: jest.fn(),
    updateItemQuantity: jest.fn(),
    removeItem: jest.fn(),
    updateStatus: jest.fn(),
  }
}

describe('CreateCartUseCase', () => {
  it('builds an ACTIVE cart owned by the authenticated customer', async () => {
    const repository = createRepositoryMock()
    repository.create.mockResolvedValue(undefined)
    const useCase = new CreateCartUseCase(repository)

    const result = await useCase.execute(user, {})

    expect(result).toMatchObject({ customerId: user.sub, status: CartStatus.ACTIVE })
    expect(repository.create).toHaveBeenCalledWith(result)
  })
})

describe('FindAllCartsUseCase', () => {
  it('derives the status of every returned cart', async () => {
    const repository = createRepositoryMock()
    repository.findAllByCustomer.mockResolvedValue([expiredCart])
    const useCase = new FindAllCartsUseCase(repository)

    const result = await useCase.execute(user)

    expect(repository.findAllByCustomer).toHaveBeenCalledWith(user.sub)
    expect(result[0].status).toBe(CartStatus.EXPIRED)
  })
})

describe('GetOwnedCartUseCase', () => {
  it('throws NotFoundError when the cart does not exist', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(null)
    const useCase = new GetOwnedCartUseCase(repository)

    await expect(useCase.execute(user.sub, 'missing')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws UnauthorizedDomainError when the cart belongs to a different customer', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue({ ...activeCart, customerId: 'someone-else' })
    const useCase = new GetOwnedCartUseCase(repository)

    await expect(useCase.execute(user.sub, activeCart.cartId)).rejects.toBeInstanceOf(
      UnauthorizedDomainError,
    )
  })

  it('derives EXPIRED status once the TTL has passed', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(expiredCart)
    const useCase = new GetOwnedCartUseCase(repository)

    const result = await useCase.execute(user.sub, expiredCart.cartId)

    expect(result.status).toBe(CartStatus.EXPIRED)
  })
})

describe('FindOneCartUseCase', () => {
  it('combines the owned cart with its items', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(activeCart)
    repository.findItems.mockResolvedValue([
      {
        cartId: activeCart.cartId,
        customerId: user.sub,
        productId: 'p1',
        quantity: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const useCase = new FindOneCartUseCase(
      new GetOwnedCartUseCase(repository),
      new GetCartItemsUseCase(repository),
    )

    const result = await useCase.execute(user, activeCart.cartId)

    expect(result.items).toHaveLength(1)
    expect(result.cartId).toBe(activeCart.cartId)
  })
})

describe('AddCartItemUseCase', () => {
  it('throws InvalidInputError when the cart has expired', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(expiredCart)
    const findOneCartUseCase = new FindOneCartUseCase(
      new GetOwnedCartUseCase(repository),
      new GetCartItemsUseCase(repository),
    )
    const useCase = new AddCartItemUseCase(
      repository,
      new GetOwnedCartUseCase(repository),
      findOneCartUseCase,
    )

    await expect(
      useCase.execute(user, expiredCart.cartId, { productId: 'p1', quantity: 1 }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    expect(repository.putItem).not.toHaveBeenCalled()
  })

  it('puts the item, touches the cart and returns the refreshed details', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(activeCart)
    repository.findItems.mockResolvedValue([])
    const findOneCartUseCase = new FindOneCartUseCase(
      new GetOwnedCartUseCase(repository),
      new GetCartItemsUseCase(repository),
    )
    const useCase = new AddCartItemUseCase(
      repository,
      new GetOwnedCartUseCase(repository),
      findOneCartUseCase,
    )

    const result = await useCase.execute(user, activeCart.cartId, { productId: 'p1', quantity: 2 })

    expect(repository.putItem).toHaveBeenCalledWith(
      expect.objectContaining({ cartId: activeCart.cartId, productId: 'p1', quantity: 2 }),
    )
    expect(repository.updateStatus).toHaveBeenCalledWith(
      activeCart.customerId,
      activeCart.cartId,
      CartStatus.ACTIVE,
      expect.any(String),
    )
    expect(result.cartId).toBe(activeCart.cartId)
  })
})

describe('UpdateCartItemUseCase', () => {
  it('propagates NotFoundError raised by the repository', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(activeCart)
    repository.updateItemQuantity.mockRejectedValue(
      new NotFoundError('Product missing is not in cart cart-1.'),
    )
    const findOneCartUseCase = new FindOneCartUseCase(
      new GetOwnedCartUseCase(repository),
      new GetCartItemsUseCase(repository),
    )
    const useCase = new UpdateCartItemUseCase(
      repository,
      new GetOwnedCartUseCase(repository),
      findOneCartUseCase,
    )

    await expect(
      useCase.execute(user, activeCart.cartId, 'missing', 3),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('RemoveCartItemUseCase', () => {
  it('throws InvalidInputError when the cart has expired', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(expiredCart)
    const useCase = new RemoveCartItemUseCase(repository, new GetOwnedCartUseCase(repository))

    await expect(
      useCase.execute(user, expiredCart.cartId, 'p1'),
    ).rejects.toBeInstanceOf(InvalidInputError)
    expect(repository.removeItem).not.toHaveBeenCalled()
  })

  it('removes the item and touches the cart', async () => {
    const repository = createRepositoryMock()
    repository.findOne.mockResolvedValue(activeCart)
    const useCase = new RemoveCartItemUseCase(repository, new GetOwnedCartUseCase(repository))

    await useCase.execute(user, activeCart.cartId, 'p1')

    expect(repository.removeItem).toHaveBeenCalledWith(activeCart.cartId, 'p1')
    expect(repository.updateStatus).toHaveBeenCalled()
  })
})

describe('MarkCartExpiredUseCase', () => {
  it('is a no-op when the cart is already EXPIRED', async () => {
    const repository = createRepositoryMock()
    const useCase = new MarkCartExpiredUseCase(repository)

    await useCase.execute({ ...activeCart, status: CartStatus.EXPIRED })

    expect(repository.updateStatus).not.toHaveBeenCalled()
  })

  it('marks an ACTIVE cart as EXPIRED', async () => {
    const repository = createRepositoryMock()
    const useCase = new MarkCartExpiredUseCase(repository)

    await useCase.execute(activeCart)

    expect(repository.updateStatus).toHaveBeenCalledWith(
      activeCart.customerId,
      activeCart.cartId,
      CartStatus.EXPIRED,
      expect.any(String),
    )
  })
})
