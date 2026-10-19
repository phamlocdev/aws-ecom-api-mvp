import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { ConflictError } from '../common/domain-error'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { InventoryService } from './inventory.service'

// Baseline test for Giai đoạn 0: locks in the oversell-prevention contract
// (conditional UpdateCommand on DynamoDB) BEFORE this service is refactored
// into domain/application/infrastructure layers. See docs/refactor/PLAN.md.
describe('InventoryService.reserve / release', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient)
  let service: InventoryService

  beforeEach(() => {
    ddbMock.reset()

    const dynamoDbService = {
      documentClient: ddbMock as unknown as DynamoDBDocumentClient,
    } as unknown as DynamoDbService

    const dynamoTables = {
      inventory: 'inventory-test',
      products: 'products-test',
    } as unknown as DynamoTablesService

    service = new InventoryService(dynamoDbService, dynamoTables)
  })

  it('reserves stock with a conditional UpdateCommand requiring enough availableQuantity', async () => {
    ddbMock
      .on(GetCommand)
      .resolves({ Item: { productId: 'p1', availableQuantity: 5, reservedQuantity: 0 } })
    ddbMock.on(UpdateCommand).resolves({})

    await service.reserve('p1', 3)

    const updateCalls = ddbMock.commandCalls(UpdateCommand)
    expect(updateCalls).toHaveLength(1)
    const input = updateCalls[0].args[0].input
    expect(input.ConditionExpression).toBe('#availableQuantity >= :quantity')
    expect(input.ExpressionAttributeValues).toMatchObject({ ':quantity': 3 })
  })

  it('throws ConflictError when DynamoDB rejects the reservation (insufficient stock)', async () => {
    ddbMock
      .on(GetCommand)
      .resolves({ Item: { productId: 'p1', availableQuantity: 1, reservedQuantity: 0 } })
    ddbMock.on(UpdateCommand).rejects(
      Object.assign(new Error('conditional check failed'), {
        name: 'ConditionalCheckFailedException',
      }),
    )

    await expect(service.reserve('p1', 5)).rejects.toThrow(ConflictError)
  })

  it('releases reserved stock with a conditional UpdateCommand requiring enough reservedQuantity', async () => {
    ddbMock.on(UpdateCommand).resolves({})

    await service.release([{ productId: 'p1', quantity: 2 }])

    const updateCalls = ddbMock.commandCalls(UpdateCommand)
    expect(updateCalls).toHaveLength(1)
    const input = updateCalls[0].args[0].input
    expect(input.ConditionExpression).toBe('#reservedQuantity >= :quantity')
    expect(input.ExpressionAttributeValues).toMatchObject({ ':quantity': 2 })
  })
})
