import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { AttributeValue } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { InvalidInputError } from '../common/domain-error'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import {
  AuditLogService,
  buildAuditDiff,
  buildAuditLogItem,
  parseAuditPipeEnvelopes,
  putAuditLogItem,
  type DynamoDbStreamRecord,
} from './audit-log.service'

// ---------------------------------------------------------------------------
// Pure function tests (no I/O)
// ---------------------------------------------------------------------------

describe('buildAuditDiff', () => {
  it('INSERT: records only "after" values for fields that appear in the new image', () => {
    const diff = buildAuditDiff('INSERT', {}, { status: 'ACTIVE', name: 'Shoes' }, ['status', 'name'])

    expect(diff).toEqual({
      status: { after: 'ACTIVE' },
      name: { after: 'Shoes' },
    })
  })

  it('INSERT: omits fields that are absent from the new image', () => {
    const diff = buildAuditDiff('INSERT', {}, { status: 'ACTIVE' }, ['status', 'deletedAt'])

    expect(diff).not.toHaveProperty('deletedAt')
  })

  it('REMOVE: records only "before" values for fields present in the old image', () => {
    const diff = buildAuditDiff('REMOVE', { status: 'ACTIVE', name: 'Shoes' }, {}, ['status', 'name'])

    expect(diff).toEqual({
      status: { before: 'ACTIVE' },
      name: { before: 'Shoes' },
    })
  })

  it('MODIFY: records changed fields with before and after', () => {
    const diff = buildAuditDiff(
      'MODIFY',
      { status: 'ACTIVE', name: 'Shoes' },
      { status: 'DELETED', name: 'Shoes' },
      ['status', 'name'],
    )

    expect(diff).toEqual({
      status: { before: 'ACTIVE', after: 'DELETED' },
    })
  })

  it('MODIFY: omits fields that have not changed', () => {
    const diff = buildAuditDiff(
      'MODIFY',
      { status: 'ACTIVE', name: 'Same' },
      { status: 'ACTIVE', name: 'Same' },
      ['status', 'name'],
    )

    expect(diff).toEqual({})
  })

  it('MODIFY: detects changed nested object values', () => {
    const diff = buildAuditDiff(
      'MODIFY',
      { address: { city: 'Hanoi' } },
      { address: { city: 'HCM' } },
      ['address'],
    )

    expect(diff.address).toBeDefined()
  })
})

describe('parseAuditPipeEnvelopes', () => {
  it('wraps a single DynamoDBStreamRecord (no entityType) into an envelope', () => {
    const record: DynamoDbStreamRecord = {
      eventID: 'ev-1',
      eventName: 'INSERT',
      dynamodb: { NewImage: {}, Keys: {} },
    }
    const [envelope] = parseAuditPipeEnvelopes(JSON.stringify(record))

    expect(envelope.record).toEqual(record)
    expect(envelope.entityType).toBeUndefined()
  })

  it('handles an array of envelopes', () => {
    const envelopes = [
      { entityType: 'CATEGORY', record: { eventName: 'INSERT', dynamodb: { NewImage: {}, Keys: {} } } },
      { entityType: 'PRODUCT', record: { eventName: 'MODIFY', dynamodb: { NewImage: {}, OldImage: {}, Keys: {} } } },
    ]
    const result = parseAuditPipeEnvelopes(JSON.stringify(envelopes))

    expect(result).toHaveLength(2)
    expect(result[0].entityType).toBe('CATEGORY')
    expect(result[1].entityType).toBe('PRODUCT')
  })

  it('passes through an envelope that already has a record property', () => {
    const wrapped = {
      entityType: 'ORDER',
      sourceTable: 'orders-table',
      record: { eventName: 'MODIFY', dynamodb: {} },
    }
    const [envelope] = parseAuditPipeEnvelopes(JSON.stringify(wrapped))

    expect(envelope.entityType).toBe('ORDER')
    expect(envelope.sourceTable).toBe('orders-table')
  })
})

describe('buildAuditLogItem', () => {
  function makeMarshalled(obj: Record<string, unknown>): Record<string, AttributeValue> {
    return marshall(obj) as Record<string, AttributeValue>
  }

  it('returns undefined when eventName is not INSERT/MODIFY/REMOVE', () => {
    const result = buildAuditLogItem({
      entityType: 'CATEGORY',
      record: {
        eventID: 'ev-1',
        eventName: 'UNKNOWN',
        dynamodb: {
          Keys: makeMarshalled({ categoryId: 'cat-1' }),
          NewImage: makeMarshalled({ categoryId: 'cat-1', name: 'Electronics', status: 'ACTIVE' }),
        },
      },
    })

    expect(result).toBeUndefined()
  })

  it('returns undefined when the diff is empty (no audited field changed)', () => {
    const image = makeMarshalled({
      categoryId: 'cat-1',
      lastModifiedByType: 'admin',
    })
    const result = buildAuditLogItem({
      entityType: 'CATEGORY',
      record: {
        eventID: 'ev-1',
        eventName: 'MODIFY',
        dynamodb: {
          Keys: makeMarshalled({ categoryId: 'cat-1' }),
          OldImage: image,
          NewImage: image,
        },
      },
    })

    expect(result).toBeUndefined()
  })

  it('builds a complete AuditLogItem for a CATEGORY INSERT event', () => {
    const result = buildAuditLogItem({
      entityType: 'CATEGORY',
      record: {
        eventID: 'ev-1',
        eventName: 'INSERT',
        dynamodb: {
          ApproximateCreationDateTime: 1700000000,
          Keys: makeMarshalled({ categoryId: 'electronics' }),
          NewImage: makeMarshalled({
            categoryId: 'electronics',
            name: 'Electronics',
            status: 'ACTIVE',
            lastModifiedByType: 'admin',
            lastModifiedById: 'admin-1',
            lastModifiedByEmail: 'admin@example.com',
            lastModifiedReason: 'Category created',
          }),
        },
      },
    })

    expect(result).toBeDefined()
    expect(result!.entityType).toBe('CATEGORY')
    expect(result!.entityId).toBe('electronics')
    expect(result!.entityKey).toBe('CATEGORY#electronics')
    expect(result!.eventName).toBe('INSERT')
    expect(result!.actorType).toBe('admin')
    expect(result!.diff).toHaveProperty('status')
    expect(result!.diff).toHaveProperty('name')
    expect(result!.schemaVersion).toBe(1)
    expect(result!.expiresAt).toBeGreaterThan(0)
  })

  it('throws InvalidInputError for an unknown entity type', () => {
    expect(() =>
      buildAuditLogItem({
        entityType: 'UNKNOWN_ENTITY' as never,
        record: {
          eventID: 'ev-1',
          eventName: 'INSERT',
          dynamodb: {},
        },
      }),
    ).toThrow(InvalidInputError)
  })
})

// ---------------------------------------------------------------------------
// Service method tests (DynamoDB integration)
// ---------------------------------------------------------------------------

describe('AuditLogService', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient)
  let service: AuditLogService

  beforeEach(() => {
    ddbMock.reset()

    const dynamoDbService = {
      documentClient: ddbMock as unknown as DynamoDBDocumentClient,
    } as unknown as DynamoDbService

    const dynamoTables = {
      auditLog: 'audit-log-test',
    } as unknown as DynamoTablesService

    service = new AuditLogService(dynamoDbService, dynamoTables)
  })

  describe('handleBatch', () => {
    it('processes each SQS record and writes audit items to DynamoDB', async () => {
      ddbMock.on(PutCommand).resolves({})

      const event = {
        Records: [
          {
            messageId: 'msg-1',
            body: JSON.stringify({
              entityType: 'CATEGORY',
              record: {
                eventID: 'ev-1',
                eventName: 'INSERT',
                dynamodb: {
                  ApproximateCreationDateTime: 1700000000,
                  Keys: marshall({ categoryId: 'cat-1' }),
                  NewImage: marshall({
                    categoryId: 'cat-1',
                    name: 'Electronics',
                    status: 'ACTIVE',
                    lastModifiedByType: 'admin',
                    lastModifiedById: 'admin-1',
                    lastModifiedByEmail: 'admin@example.com',
                    lastModifiedReason: 'Created',
                  }),
                },
              },
            }),
          },
        ],
      }

      const response = await service.handleBatch(event as never)

      expect(response.batchItemFailures).toHaveLength(0)
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1)
    })

    it('returns batchItemFailures for records that fail to process', async () => {
      ddbMock.on(PutCommand).rejects(new Error('DynamoDB error'))

      const event = {
        Records: [
          {
            messageId: 'msg-fail',
            body: JSON.stringify({
              entityType: 'CATEGORY',
              record: {
                eventID: 'ev-2',
                eventName: 'INSERT',
                dynamodb: {
                  ApproximateCreationDateTime: 1700000000,
                  Keys: marshall({ categoryId: 'cat-1' }),
                  NewImage: marshall({
                    categoryId: 'cat-1',
                    name: 'Electronics',
                    status: 'ACTIVE',
                    lastModifiedByType: 'system',
                    lastModifiedById: 'system',
                    lastModifiedByEmail: 'unknown',
                    lastModifiedReason: 'Created',
                  }),
                },
              },
            }),
          },
        ],
      }

      const response = await service.handleBatch(event as never)

      expect(response.batchItemFailures).toHaveLength(1)
      expect(response.batchItemFailures[0].itemIdentifier).toBe('msg-fail')
    })
  })

  describe('findByEntity', () => {
    it('queries by entityKey when entityId is provided', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] })

      await service.findByEntity({ entityType: 'CATEGORY', entityId: 'electronics' })

      const calls = ddbMock.commandCalls(QueryCommand)
      expect(calls).toHaveLength(1)
      const input = calls[0].args[0].input
      expect(input.TableName).toBe('audit-log-test')
      expect(input.KeyConditionExpression).toBe('#entityKey = :entityKey')
      expect(input.ExpressionAttributeValues).toMatchObject({
        ':entityKey': 'CATEGORY#electronics',
      })
      expect(input.IndexName).toBeUndefined()
    })

    it('queries by entityType via GSI when no entityId is given', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] })

      await service.findByEntity({ entityType: 'PRODUCT' })

      const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input
      expect(input.IndexName).toBeDefined()
      expect(input.KeyConditionExpression).toBe('#entityType = :entityType')
      expect(input.ExpressionAttributeValues).toMatchObject({ ':entityType': 'PRODUCT' })
    })

    it('throws InvalidInputError for an unknown entityType', async () => {
      await expect(
        service.findByEntity({ entityType: 'UNKNOWN' }),
      ).rejects.toBeInstanceOf(InvalidInputError)
    })

    it('returns items and null nextCursor when no LastEvaluatedKey', async () => {
      const items = [{ entityKey: 'CATEGORY#cat-1', auditId: 'ev-1' }]
      ddbMock.on(QueryCommand).resolves({ Items: items })

      const result = await service.findByEntity({ entityType: 'CATEGORY', entityId: 'cat-1' })

      expect(result.items).toEqual(items)
      expect(result.nextCursor).toBeNull()
    })

    it('encodes LastEvaluatedKey as a base64url nextCursor', async () => {
      const lastKey = { entityKey: 'CATEGORY#last', occurredAtAuditId: '2026-01-01T00:00:00Z#ev-x' }
      ddbMock.on(QueryCommand).resolves({ Items: [], LastEvaluatedKey: lastKey })

      const result = await service.findByEntity({ entityType: 'CATEGORY', entityId: 'last' })

      expect(result.nextCursor).not.toBeNull()
      const decoded = JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString('utf8'))
      expect(decoded).toEqual(lastKey)
    })
  })
})

describe('putAuditLogItem', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient)

  beforeEach(() => ddbMock.reset())

  it('puts the item with an idempotency condition expression', async () => {
    ddbMock.on(PutCommand).resolves({})

    const item = {
      entityKey: 'CATEGORY#cat-1',
      occurredAtAuditId: '2026-01-01T00:00:00.000Z#ev-1',
    } as never

    await putAuditLogItem(ddbMock as unknown as DynamoDBDocumentClient, 'audit-test', item)

    const calls = ddbMock.commandCalls(PutCommand)
    expect(calls).toHaveLength(1)
    const input = calls[0].args[0].input
    expect(input.ConditionExpression).toContain('attribute_not_exists(#entityKey)')
    expect(input.ConditionExpression).toContain('attribute_not_exists(#occurredAtAuditId)')
  })

  it('silently ignores ConditionalCheckFailedException (duplicate item)', async () => {
    ddbMock.on(PutCommand).rejects(
      Object.assign(new Error('duplicate'), { name: 'ConditionalCheckFailedException' }),
    )

    await expect(
      putAuditLogItem(ddbMock as unknown as DynamoDBDocumentClient, 'audit-test', {} as never),
    ).resolves.toBeUndefined()
  })

  it('rethrows other DynamoDB errors', async () => {
    ddbMock.on(PutCommand).rejects(new Error('ProvisionedThroughputExceededException'))

    await expect(
      putAuditLogItem(ddbMock as unknown as DynamoDBDocumentClient, 'audit-test', {} as never),
    ).rejects.toThrow('ProvisionedThroughputExceededException')
  })
})
