import { mockClient } from 'aws-sdk-client-mock'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import {
  EmailTrackingService,
  buildClaimOnceEmailId,
  buildContextKey,
  buildOrderContextKey,
  buildUserContextKey,
  isRetryableEmailFailureReason,
  isRetryableEmailTracking,
} from './email-tracking.service'
import type { EmailTracking } from './mail.types'

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('buildContextKey', () => {
  it('concatenates contextType and contextId with a hash separator', () => {
    expect(buildContextKey('ORDER', 'order-123')).toBe('ORDER#order-123')
    expect(buildContextKey('USER', 'user-456')).toBe('USER#user-456')
  })
})

describe('buildOrderContextKey', () => {
  it('builds an ORDER context key', () => {
    expect(buildOrderContextKey('order-abc')).toBe('ORDER#order-abc')
  })
})

describe('buildUserContextKey', () => {
  it('builds a USER context key', () => {
    expect(buildUserContextKey('user-xyz')).toBe('USER#user-xyz')
  })
})

describe('buildClaimOnceEmailId', () => {
  it('is deterministic for the same inputs', () => {
    const id1 = buildClaimOnceEmailId('ORDER', 'order-1', 'ORDER_CONFIRMATION', 'a@example.com')
    const id2 = buildClaimOnceEmailId('ORDER', 'order-1', 'ORDER_CONFIRMATION', 'a@example.com')

    expect(id1).toBe(id2)
  })

  it('differs for different recipient emails', () => {
    const id1 = buildClaimOnceEmailId('ORDER', 'order-1', 'ORDER_CONFIRMATION', 'a@example.com')
    const id2 = buildClaimOnceEmailId('ORDER', 'order-1', 'ORDER_CONFIRMATION', 'b@example.com')

    expect(id1).not.toBe(id2)
  })

  it('starts with the "claim-once#" prefix', () => {
    const id = buildClaimOnceEmailId('ORDER', 'order-1', 'ORDER_CONFIRMATION', 'a@example.com')

    expect(id.startsWith('claim-once#')).toBe(true)
  })

  it('normalises recipient email to lowercase', () => {
    const lower = buildClaimOnceEmailId('ORDER', 'x', 'ORDER_CONFIRMATION', 'user@EXAMPLE.COM')
    const already = buildClaimOnceEmailId('ORDER', 'x', 'ORDER_CONFIRMATION', 'user@example.com')

    expect(lower).toBe(already)
  })
})

describe('isRetryableEmailTracking', () => {
  function makeItem(overrides: Partial<EmailTracking>): EmailTracking {
    return {
      emailId: 'email-1',
      emailType: 'ORDER_CONFIRMATION',
      recipientEmail: 'user@example.com',
      contextType: 'ORDER',
      contextId: 'order-1',
      contextKey: 'ORDER#order-1',
      attemptNumber: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'PENDING',
      ...overrides,
    }
  }

  it('returns true for FAILED status', () => {
    expect(isRetryableEmailTracking(makeItem({ status: 'FAILED' }))).toBe(true)
  })

  it('returns true for REJECTED status', () => {
    expect(isRetryableEmailTracking(makeItem({ status: 'REJECTED' }))).toBe(true)
  })

  it('returns true for BOUNCED Transient', () => {
    expect(
      isRetryableEmailTracking(makeItem({ status: 'BOUNCED', bounceType: 'Transient' })),
    ).toBe(true)
  })

  it('returns true for BOUNCED Undetermined', () => {
    expect(
      isRetryableEmailTracking(makeItem({ status: 'BOUNCED', bounceType: 'Undetermined' })),
    ).toBe(true)
  })

  it('returns false for BOUNCED Permanent', () => {
    expect(
      isRetryableEmailTracking(makeItem({ status: 'BOUNCED', bounceType: 'Permanent' })),
    ).toBe(false)
  })

  it('returns false for DELIVERED status', () => {
    expect(isRetryableEmailTracking(makeItem({ status: 'DELIVERED' }))).toBe(false)
  })

  it('returns false for COMPLAINED status', () => {
    expect(isRetryableEmailTracking(makeItem({ status: 'COMPLAINED' }))).toBe(false)
  })

  it('returns false for a PENDING item updated less than 30 minutes ago', () => {
    expect(
      isRetryableEmailTracking(makeItem({ status: 'PENDING', updatedAt: new Date().toISOString() })),
    ).toBe(false)
  })

  it('returns true for a PENDING item updated more than 30 minutes ago', () => {
    const oldDate = new Date(Date.now() - 31 * 60 * 1000).toISOString()
    expect(
      isRetryableEmailTracking(makeItem({ status: 'PENDING', updatedAt: oldDate })),
    ).toBe(true)
  })

  it('returns false for a SENT item updated less than 30 minutes ago', () => {
    expect(
      isRetryableEmailTracking(makeItem({ status: 'SENT', updatedAt: new Date().toISOString() })),
    ).toBe(false)
  })

  it('returns true for a SENT item updated more than 30 minutes ago', () => {
    const oldDate = new Date(Date.now() - 31 * 60 * 1000).toISOString()
    expect(
      isRetryableEmailTracking(makeItem({ status: 'SENT', updatedAt: oldDate })),
    ).toBe(true)
  })
})

describe('isRetryableEmailFailureReason', () => {
  it('returns false for undefined', () => {
    expect(isRetryableEmailFailureReason(undefined)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isRetryableEmailFailureReason('')).toBe(false)
  })

  it('returns true for throttle-related reasons', () => {
    expect(isRetryableEmailFailureReason('ThrottlingException: too many requests')).toBe(true)
    expect(isRetryableEmailFailureReason('Rate exceeded')).toBe(true)
  })

  it('returns true for network-related reasons', () => {
    expect(isRetryableEmailFailureReason('ECONNRESET')).toBe(true)
    expect(isRetryableEmailFailureReason('Network error')).toBe(true)
    expect(isRetryableEmailFailureReason('ETIMEDOUT')).toBe(true)
    expect(isRetryableEmailFailureReason('ENOTFOUND: dns lookup failed')).toBe(true)
  })

  it('returns true for server error reasons', () => {
    expect(isRetryableEmailFailureReason('Service unavailable')).toBe(true)
    expect(isRetryableEmailFailureReason('Internal server error')).toBe(true)
    expect(isRetryableEmailFailureReason('5xx error')).toBe(true)
  })

  it('returns false for permanent errors', () => {
    expect(isRetryableEmailFailureReason('ses-disabled')).toBe(false)
    expect(isRetryableEmailFailureReason('missing-from-email')).toBe(false)
    expect(isRetryableEmailFailureReason('InvalidParameterValue')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// EmailTrackingService — DynamoDB integration
// ---------------------------------------------------------------------------

describe('EmailTrackingService', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient)
  let service: EmailTrackingService

  beforeEach(() => {
    ddbMock.reset()

    const dynamoDbService = {
      documentClient: ddbMock as unknown as DynamoDBDocumentClient,
    } as unknown as DynamoDbService

    const dynamoTables = {
      emailTracking: 'email-tracking-test',
    } as unknown as DynamoTablesService

    service = new EmailTrackingService(dynamoDbService, dynamoTables)
  })

  describe('markSent', () => {
    it('sends an UpdateCommand setting status to SENT', async () => {
      ddbMock.on(UpdateCommand).resolves({})

      await service.markSent(['email-id-1'], 'ses-msg-id')

      const calls = ddbMock.commandCalls(UpdateCommand)
      expect(calls).toHaveLength(1)
      const input = calls[0].args[0].input
      expect(input.Key).toEqual({ emailId: 'email-id-1' })
      expect(input.ExpressionAttributeValues).toMatchObject({ ':status': 'SENT' })
    })

    it('marks multiple email IDs in parallel', async () => {
      ddbMock.on(UpdateCommand).resolves({})

      await service.markSent(['email-id-1', 'email-id-2'], undefined)

      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2)
    })
  })

  describe('markFailed', () => {
    it('sends an UpdateCommand setting status to FAILED', async () => {
      ddbMock.on(UpdateCommand).resolves({})

      await service.markFailed(['email-id-1'], 'ses-send-failed')

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input
      expect(input.ExpressionAttributeValues).toMatchObject({
        ':status': 'FAILED',
        ':failureReason': 'ses-send-failed',
      })
    })
  })

  describe('createTrackingItems', () => {
    it('puts a new tracking item and returns it', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] })
      ddbMock.on(PutCommand).resolves({})

      const items = await service.createTrackingItems({
        emailType: 'ORDER_CONFIRMATION',
        contextType: 'ORDER',
        contextId: 'order-1',
        recipientEmails: ['user@example.com'],
        status: 'PENDING',
      })

      expect(items).toHaveLength(1)
      expect(items[0].emailType).toBe('ORDER_CONFIRMATION')
      expect(items[0].recipientEmail).toBe('user@example.com')
      expect(items[0].status).toBe('PENDING')
      expect(items[0].contextKey).toBe('ORDER#order-1')
      expect(items[0].attemptNumber).toBe(1)

      const putCalls = ddbMock.commandCalls(PutCommand)
      expect(putCalls).toHaveLength(1)
      expect(putCalls[0].args[0].input.TableName).toBe('email-tracking-test')
    })

    it('uses a deterministic claim-once emailId when idempotencyMode is "claim-once"', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] })
      ddbMock.on(PutCommand).resolves({})

      const items = await service.createTrackingItems({
        emailType: 'ORDER_CONFIRMATION',
        contextType: 'ORDER',
        contextId: 'order-1',
        recipientEmails: ['user@example.com'],
        status: 'PENDING',
        idempotencyMode: 'claim-once',
      })

      expect(items[0].emailId.startsWith('claim-once#')).toBe(true)
    })

    it('returns empty array when claim-once item already exists and is not retryable', async () => {
      const existingId = buildClaimOnceEmailId(
        'ORDER',
        'order-1',
        'ORDER_CONFIRMATION',
        'user@example.com',
      )
      ddbMock.on(QueryCommand).resolves({ Items: [] })
      ddbMock.on(PutCommand).rejects(
        Object.assign(new Error('duplicate'), { name: 'ConditionalCheckFailedException' }),
      )
      ddbMock.on(GetCommand).resolves({
        Item: {
          emailId: existingId,
          status: 'SENT',
          updatedAt: new Date().toISOString(),
          attemptNumber: 1,
        } as Partial<EmailTracking>,
      })

      const items = await service.createTrackingItems({
        emailType: 'ORDER_CONFIRMATION',
        contextType: 'ORDER',
        contextId: 'order-1',
        recipientEmails: ['user@example.com'],
        status: 'PENDING',
        idempotencyMode: 'claim-once',
      })

      expect(items).toHaveLength(0)
    })
  })

  describe('hasActiveOrderConfirmationTracking', () => {
    it('returns false when no items exist for the order', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] })

      const result = await service.hasActiveOrderConfirmationTracking('order-1')

      expect(result).toBe(false)
    })

    it('returns true when a non-FAILED item exists', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            emailType: 'ORDER_CONFIRMATION',
            status: 'SENT',
            contextKey: 'ORDER#order-1',
            recipientEmail: 'user@example.com',
            attemptNumber: 1,
            updatedAt: new Date().toISOString(),
          } as Partial<EmailTracking>,
        ],
      })

      const result = await service.hasActiveOrderConfirmationTracking('order-1')

      expect(result).toBe(true)
    })

    it('returns false when the only item is FAILED', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            emailType: 'ORDER_CONFIRMATION',
            status: 'FAILED',
            contextKey: 'ORDER#order-1',
            recipientEmail: 'user@example.com',
            attemptNumber: 1,
            updatedAt: new Date().toISOString(),
          } as Partial<EmailTracking>,
        ],
      })

      const result = await service.hasActiveOrderConfirmationTracking('order-1')

      expect(result).toBe(false)
    })
  })
})
