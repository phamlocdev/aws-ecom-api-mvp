import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { ConflictError, NotFoundError } from '../common/domain-error'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { Role } from '../auth/roles.enum'
import { Permission } from '../auth/permissions'
import { AuthenticatedUser } from '../auth/auth.types'
import { DynamoDbCategoryRepository } from './infrastructure/dynamodb-category.repository'
import { CategoryRepositoryPort } from './domain/category.repository.port'
import { CreateCategoryUseCase } from './application/create-category.use-case'
import { FindAllCategoriesUseCase } from './application/find-all-categories.use-case'
import { FindOneCategoryUseCase } from './application/find-one-category.use-case'
import { UpdateCategoryUseCase } from './application/update-category.use-case'
import { DeleteCategoryUseCase } from './application/delete-category.use-case'

import { mockClient } from 'aws-sdk-client-mock'

describe('categories use-cases (integration)', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient)
  let repository: CategoryRepositoryPort
  let createCategoryUseCase: CreateCategoryUseCase
  let findAllCategoriesUseCase: FindAllCategoriesUseCase
  let findOneCategoryUseCase: FindOneCategoryUseCase
  let updateCategoryUseCase: UpdateCategoryUseCase
  let deleteCategoryUseCase: DeleteCategoryUseCase

  const adminUser: AuthenticatedUser = {
    sub: 'admin-1',
    username: 'admin',
    email: 'admin@example.com',
    groups: [Role.ADMIN],
    permissions: [
      Permission.CATEGORIES_CREATE,
      Permission.CATEGORIES_UPDATE,
      Permission.CATEGORIES_DELETE,
    ],
    tokenUse: 'access',
    clientId: 'test-client',
  }

  beforeEach(() => {
    ddbMock.reset()

    const dynamoDbService = {
      documentClient: ddbMock as unknown as DynamoDBDocumentClient,
    } as unknown as DynamoDbService

    const dynamoTables = {
      categories: 'categories-test',
    } as unknown as DynamoTablesService

    repository = new DynamoDbCategoryRepository(dynamoDbService, dynamoTables)
    createCategoryUseCase = new CreateCategoryUseCase(repository)
    findAllCategoriesUseCase = new FindAllCategoriesUseCase(repository)
    findOneCategoryUseCase = new FindOneCategoryUseCase(repository)
    updateCategoryUseCase = new UpdateCategoryUseCase(repository)
    deleteCategoryUseCase = new DeleteCategoryUseCase(repository)
  })

  describe('CreateCategoryUseCase', () => {
    it('puts a new category item with a conditional check on categoryId', async () => {
      ddbMock.on(PutCommand).resolves({})

      const result = await createCategoryUseCase.execute(adminUser, {
        categoryId: 'electronics',
        name: 'Electronics',
      })

      expect(result).toMatchObject({
        categoryId: 'electronics',
        name: 'Electronics',
        status: 'ACTIVE',
      })

      const calls = ddbMock.commandCalls(PutCommand)
      expect(calls).toHaveLength(1)
      const input = calls[0].args[0].input
      expect(input.TableName).toBe('categories-test')
      expect(input.Item).toMatchObject({ categoryId: 'electronics', name: 'Electronics' })
      expect(input.ConditionExpression).toBe('attribute_not_exists(#categoryId)')
    })

    it('throws ConflictError when categoryId already exists (ConditionalCheckFailedException)', async () => {
      ddbMock
        .on(PutCommand)
        .rejects(
          Object.assign(new Error('conditional check failed'), {
            name: 'ConditionalCheckFailedException',
          }),
        )

      await expect(
        createCategoryUseCase.execute(adminUser, { categoryId: 'electronics', name: 'Electronics' }),
      ).rejects.toBeInstanceOf(ConflictError)
    })
  })

  describe('FindAllCategoriesUseCase', () => {
    it('scans with a filter that excludes DELETED categories', async () => {
      ddbMock.on(ScanCommand).resolves({ Items: [], Count: 0 })

      const result = await findAllCategoriesUseCase.execute({})

      const scanCalls = ddbMock.commandCalls(ScanCommand)
      expect(scanCalls).toHaveLength(1)
      const input = scanCalls[0].args[0].input
      expect(input.TableName).toBe('categories-test')
      expect(input.FilterExpression).toBe(
        'attribute_not_exists(#status) OR #status <> :deleted',
      )
      expect(input.ExpressionAttributeValues).toMatchObject({ ':deleted': 'DELETED' })
      expect(result.items).toEqual([])
    })

    it('returns items from the scan result', async () => {
      const item = {
        categoryId: 'electronics',
        name: 'Electronics',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      ddbMock.on(ScanCommand).resolves({ Items: [item] })

      const result = await findAllCategoriesUseCase.execute({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ categoryId: 'electronics' })
    })

    it('encodes the LastEvaluatedKey as nextCursor', async () => {
      const lastKey = { categoryId: 'z-last' }
      ddbMock.on(ScanCommand).resolves({ Items: [], LastEvaluatedKey: lastKey })

      const result = await findAllCategoriesUseCase.execute({})

      expect(result.nextCursor).not.toBeNull()
    })
  })

  describe('FindOneCategoryUseCase', () => {
    it('returns the category when the item exists', async () => {
      const item = {
        categoryId: 'electronics',
        name: 'Electronics',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      ddbMock.on(GetCommand).resolves({ Item: item })

      const result = await findOneCategoryUseCase.execute('electronics')

      const getCalls = ddbMock.commandCalls(GetCommand)
      expect(getCalls).toHaveLength(1)
      expect(getCalls[0].args[0].input.Key).toEqual({ categoryId: 'electronics' })
      expect(result).toMatchObject({ categoryId: 'electronics' })
    })

    it('throws NotFoundError when the item is missing from DynamoDB', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined })

      await expect(findOneCategoryUseCase.execute('missing')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('throws NotFoundError when the category is soft-deleted', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          categoryId: 'electronics',
          name: 'Electronics',
          status: 'DELETED',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      })

      await expect(findOneCategoryUseCase.execute('electronics')).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })

  describe('UpdateCategoryUseCase', () => {
    it('sends an UpdateCommand with a conditional check and returns updated attributes', async () => {
      const updatedItem = {
        categoryId: 'electronics',
        name: 'Updated Electronics',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }
      ddbMock.on(UpdateCommand).resolves({ Attributes: updatedItem })

      const result = await updateCategoryUseCase.execute(adminUser, 'electronics', {
        name: 'Updated Electronics',
      })

      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls).toHaveLength(1)
      const input = updateCalls[0].args[0].input
      expect(input.TableName).toBe('categories-test')
      expect(input.Key).toEqual({ categoryId: 'electronics' })
      expect(input.ConditionExpression).toBe(
        'attribute_exists(#categoryId) AND #status <> :deleted',
      )
      expect(input.ReturnValues).toBe('ALL_NEW')
      expect(result).toMatchObject({ categoryId: 'electronics', name: 'Updated Electronics' })
    })

    it('throws NotFoundError when the category does not exist (ConditionalCheckFailedException)', async () => {
      ddbMock
        .on(UpdateCommand)
        .rejects(
          Object.assign(new Error('conditional check failed'), {
            name: 'ConditionalCheckFailedException',
          }),
        )

      await expect(
        updateCategoryUseCase.execute(adminUser, 'missing', { name: 'New Name' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('DeleteCategoryUseCase', () => {
    it('soft-deletes the category by setting status to DELETED', async () => {
      ddbMock.on(UpdateCommand).resolves({})

      await deleteCategoryUseCase.execute(adminUser, 'electronics')

      const updateCalls = ddbMock.commandCalls(UpdateCommand)
      expect(updateCalls).toHaveLength(1)
      const input = updateCalls[0].args[0].input
      expect(input.TableName).toBe('categories-test')
      expect(input.Key).toEqual({ categoryId: 'electronics' })
      expect(input.ExpressionAttributeValues).toMatchObject({ ':deleted': 'DELETED' })
    })

    it('throws NotFoundError when the category does not exist (ConditionalCheckFailedException)', async () => {
      ddbMock
        .on(UpdateCommand)
        .rejects(
          Object.assign(new Error('conditional check failed'), {
            name: 'ConditionalCheckFailedException',
          }),
        )

      await expect(deleteCategoryUseCase.execute(adminUser, 'missing')).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })
})
