import { mockClient } from 'aws-sdk-client-mock'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { InvalidInputError, NotFoundError, UnauthorizedDomainError } from '../common/domain-error'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { Role } from '../auth/roles.enum'
import { AuthenticatedUser } from '../auth/auth.types'
import { DynamoDbCartRepository } from './infrastructure/dynamodb-cart.repository'
import { CartRepositoryPort } from './domain/cart.repository.port'
import { CartStatus } from './domain/cart-status.enum'
import { Cart } from './domain/cart.entity'
import { CreateCartUseCase } from './application/create-cart.use-case'
import { GetOwnedCartUseCase } from './application/get-owned-cart.use-case'
import { GetCartItemsUseCase } from './application/get-cart-items.use-case'
import { FindOneCartUseCase } from './application/find-one-cart.use-case'
import { AddCartItemUseCase } from './application/add-cart-item.use-case'
import { UpdateCartItemUseCase } from './application/update-cart-item.use-case'
import { RemoveCartItemUseCase } from './application/remove-cart-item.use-case'
import { MarkCartExpiredUseCase } from './application/mark-cart-expired.use-case'

// Giai đoạn 3 step 0/7 baseline for `carts` (see docs/refactor/PLAN.md):
// originally written against the pre-refactor monolithic CartsService, now
// driving the post-refactor use-cases + DynamoDbCartRepository to confirm the
// DynamoDB contract and business behavior did not change.
describe('carts use-cases (post-refactor baseline)', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient)
  let repository: CartRepositoryPort
  let createCartUseCase: CreateCartUseCase
  let getOwnedCartUseCase: GetOwnedCartUseCase
  let findOneCartUseCase: FindOneCartUseCase
  let addCartItemUseCase: AddCartItemUseCase
  let updateCartItemUseCase: UpdateCartItemUseCase
  let removeCartItemUseCase: RemoveCartItemUseCase
  let markCartExpiredUseCase: MarkCartExpiredUseCase

  const user: AuthenticatedUser = {
    sub: 'customer-1',
    username: 'customer',
    email: 'customer@example.com',
    groups: [Role.CUSTOMER],
    permissions: [],
    tokenUse: 'access',
    clientId: 'test-client',
  }

  const activeCart = Cart.fromRecord({
    customerId: user.sub,
    cartId: 'cart-1',
    status: CartStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })

  const expiredCart = Cart.fromRecord({
    customerId: user.sub,
    cartId: 'cart-expired',
    status: CartStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) - 3600,
  })

  beforeEach(() => {
    ddbMock.reset()

    const dynamoDbService = {
      documentClient: ddbMock as unknown as DynamoDBDocumentClient,
    } as unknown as DynamoDbService

    const dynamoTables = {
      carts: 'carts-test',
      cartItems: 'cart-items-test',
    } as unknown as DynamoTablesService

    repository = new DynamoDbCartRepository(dynamoDbService, dynamoTables)
    createCartUseCase = new CreateCartUseCase(repository)
    getOwnedCartUseCase = new GetOwnedCartUseCase(repository)
    const getCartItemsUseCase = new GetCartItemsUseCase(repository)
    findOneCartUseCase = new FindOneCartUseCase(getOwnedCartUseCase, getCartItemsUseCase)
    addCartItemUseCase = new AddCartItemUseCase(repository, getOwnedCartUseCase, findOneCartUseCase)
    updateCartItemUseCase = new UpdateCartItemUseCase(
      repository,
      getOwnedCartUseCase,
      findOneCartUseCase,
    )
    removeCartItemUseCase = new RemoveCartItemUseCase(repository, getOwnedCartUseCase)
    markCartExpiredUseCase = new MarkCartExpiredUseCase(repository)
  })

  describe('CreateCartUseCase', () => {
    it('creates a cart owned by the authenticated customer', async () => {
      ddbMock.on(PutCommand).resolves({})

      const cart = await createCartUseCase.execute(user, {})

      expect(cart.customerId).toBe(user.sub)
      expect(cart.status).toBe(CartStatus.ACTIVE)
      const calls = ddbMock.commandCalls(PutCommand)
      expect(calls).toHaveLength(1)
      expect(calls[0].args[0].input.TableName).toBe('carts-test')
    })
  })

  describe('GetOwnedCartUseCase', () => {
    it('throws NotFoundError when the cart does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined })

      await expect(getOwnedCartUseCase.execute(user.sub, 'missing')).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })

    it('derives EXPIRED status once the TTL has passed, even if stored status is ACTIVE', async () => {
      ddbMock.on(GetCommand).resolves({ Item: expiredCart })

      const cart = await getOwnedCartUseCase.execute(user.sub, expiredCart.cartId)

      expect(cart.status).toBe(CartStatus.EXPIRED)
    })

    it('throws UnauthorizedDomainError when the cart belongs to a different customer', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { ...activeCart, customerId: 'someone-else' } })

      await expect(
        getOwnedCartUseCase.execute(user.sub, activeCart.cartId),
      ).rejects.toBeInstanceOf(UnauthorizedDomainError)
    })
  })

  describe('AddCartItemUseCase', () => {
    it('throws InvalidInputError when the cart has expired', async () => {
      ddbMock.on(GetCommand).resolves({ Item: expiredCart })

      await expect(
        addCartItemUseCase.execute(user, expiredCart.cartId, { productId: 'p1', quantity: 1 }),
      ).rejects.toBeInstanceOf(InvalidInputError)
    })

    it('puts the item and touches the cart', async () => {
      ddbMock.on(GetCommand).resolves({ Item: activeCart })
      ddbMock.on(PutCommand).resolves({})
      ddbMock.on(UpdateCommand).resolves({})
      ddbMock.on(QueryCommand).resolves({ Items: [] })

      await addCartItemUseCase.execute(user, activeCart.cartId, { productId: 'p1', quantity: 2 })

      const putCalls = ddbMock.commandCalls(PutCommand)
      expect(putCalls).toHaveLength(1)
      expect(putCalls[0].args[0].input.TableName).toBe('cart-items-test')
      expect(putCalls[0].args[0].input.Item).toMatchObject({
        cartId: activeCart.cartId,
        productId: 'p1',
        quantity: 2,
      })
      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls).toHaveLength(1)
      expect(updateCalls[0].args[0].input.TableName).toBe('carts-test')
    })
  })

  describe('UpdateCartItemUseCase', () => {
    it('throws NotFoundError when the product is not in the cart', async () => {
      ddbMock.on(GetCommand).resolves({ Item: activeCart })
      ddbMock.on(UpdateCommand).rejects(
        Object.assign(new Error('conditional check failed'), {
          name: 'ConditionalCheckFailedException',
        }),
      )

      await expect(
        updateCartItemUseCase.execute(user, activeCart.cartId, 'missing-product', 1),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('RemoveCartItemUseCase', () => {
    it('throws NotFoundError when the product is not in the cart', async () => {
      ddbMock.on(GetCommand).resolves({ Item: activeCart })
      ddbMock.on(DeleteCommand).rejects(
        Object.assign(new Error('conditional check failed'), {
          name: 'ConditionalCheckFailedException',
        }),
      )

      await expect(
        removeCartItemUseCase.execute(user, activeCart.cartId, 'missing-product'),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('MarkCartExpiredUseCase', () => {
    it('is a no-op when the cart is already EXPIRED', async () => {
      await markCartExpiredUseCase.execute(
        Cart.fromRecord({ ...(activeCart as unknown as Record<string, unknown>), status: CartStatus.EXPIRED }),
      )

      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0)
    })

    it('marks an ACTIVE cart as EXPIRED', async () => {
      ddbMock.on(UpdateCommand).resolves({})

      await markCartExpiredUseCase.execute(activeCart)

      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls).toHaveLength(1)
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ':status': CartStatus.EXPIRED,
      })
    })
  })
})
