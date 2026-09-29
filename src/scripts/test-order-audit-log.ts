import assert from 'assert'
import {
  buildAuditDiff,
  buildOrderAuditLogItem,
  parseStreamRecord,
  putOrderAuditLogItem,
  type AuditLogDocumentClient,
  type DynamoDbStreamRecord,
  type OrderAuditLogItem,
} from '../audit/order-audit-log-processor.service'

async function main(): Promise<void> {
  testInsertDiff()
  testModifyDiff()
  testNonAllowlistedChanges()
  testRemoveIgnored()
  testPipeWrappedRecordParsing()
  testBatchRecordParsing()
  await testIdempotentConditionalFailure()
  await testRealWriteFailure()

  console.log('Order audit log tests passed.')
}

function testInsertDiff(): void {
  const diff = buildAuditDiff(
    'INSERT',
    {},
    {
      orderId: 'order-1',
      status: 'PENDING',
      paymentStatus: 'NOT_STARTED',
      totalAmount: 1000,
      customerEmail: 'ignored@example.com',
    },
  )

  assert.deepEqual(diff, {
    status: { after: 'PENDING' },
    paymentStatus: { after: 'NOT_STARTED' },
  })
}

function testModifyDiff(): void {
  const diff = buildAuditDiff(
    'MODIFY',
    {
      status: 'RESERVED',
      paymentStatus: 'PROCESSING',
      totalAmount: 1000,
    },
    {
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      totalAmount: 1000,
    },
  )

  assert.deepEqual(diff, {
    status: { before: 'RESERVED', after: 'CONFIRMED' },
    paymentStatus: { before: 'PROCESSING', after: 'PAID' },
  })
}

function testNonAllowlistedChanges(): void {
  const diff = buildAuditDiff(
    'MODIFY',
    {
      customerName: 'Before',
      status: 'PENDING',
      paymentStatus: 'NOT_STARTED',
      totalAmount: 1000,
      paymentExpiresAt: 1_800_000_000,
    },
    {
      customerName: 'After',
      status: 'PENDING',
      paymentStatus: 'NOT_STARTED',
      totalAmount: 2000,
      paymentExpiresAt: 1_800_000_300,
      failureReason: 'Ignored',
    },
  )

  assert.deepEqual(diff, {})

  const item = buildOrderAuditLogItem({
    eventID: 'event-ignored',
    eventName: 'MODIFY',
    dynamodb: {
      OldImage: {
        orderId: { S: 'order-1' },
        status: { S: 'PENDING' },
        paymentStatus: { S: 'NOT_STARTED' },
        totalAmount: { N: '1000' },
      },
      NewImage: {
        orderId: { S: 'order-1' },
        status: { S: 'PENDING' },
        paymentStatus: { S: 'NOT_STARTED' },
        totalAmount: { N: '2000' },
        failureReason: { S: 'Ignored' },
      },
    },
  })

  assert.equal(item, undefined)
}

function testRemoveIgnored(): void {
  const item = buildOrderAuditLogItem({
    eventID: 'event-1',
    eventName: 'REMOVE',
    dynamodb: {
      OldImage: {
        orderId: { S: 'order-1' },
        status: { S: 'PENDING' },
      },
    },
  })

  assert.equal(item, undefined)
}

function testPipeWrappedRecordParsing(): void {
  const record: DynamoDbStreamRecord = {
    eventID: 'event-1',
    eventName: 'INSERT',
    dynamodb: {
      ApproximateCreationDateTime: 1_800_000_000,
      NewImage: {
        orderId: { S: 'order-1' },
        status: { S: 'PENDING' },
        lastModifiedByType: { S: 'customer' },
        lastModifiedById: { S: 'user-1' },
        lastModifiedReason: { S: 'Order created' },
      },
    },
  }

  const parsed = parseStreamRecord(JSON.stringify({ record }))
  const item = buildOrderAuditLogItem(parsed)

  assert.equal(item?.orderId, 'order-1')
  assert.equal(item?.auditId, 'event-1')
  assert.equal(item?.actorType, 'customer')
  assert.equal(item?.actorId, 'user-1')
  assert.equal(item?.reason, 'Order created')
  assert.deepEqual(item?.diff, { status: { after: 'PENDING' } })
}

function testBatchRecordParsing(): void {
  const first: DynamoDbStreamRecord = {
    eventID: 'event-1',
    eventName: 'MODIFY',
    dynamodb: {
      OldImage: {
        orderId: { S: 'order-1' },
        status: { S: 'PENDING' },
      },
      NewImage: {
        orderId: { S: 'order-1' },
        status: { S: 'RESERVED' },
      },
    },
  }
  const second: DynamoDbStreamRecord = {
    eventID: 'event-2',
    eventName: 'MODIFY',
    dynamodb: {
      OldImage: {
        orderId: { S: 'order-2' },
        status: { S: 'PENDING' },
      },
      NewImage: {
        orderId: { S: 'order-2' },
        status: { S: 'FAILED' },
      },
    },
  }

  assert.equal(
    parseStreamRecord(JSON.stringify([{ record: first }, { record: second }])).eventID,
    'event-1',
  )
}

async function testIdempotentConditionalFailure(): Promise<void> {
  const client: AuditLogDocumentClient = {
    async send() {
      const error = new Error('duplicate')
      error.name = 'ConditionalCheckFailedException'
      throw error
    },
  }

  await putOrderAuditLogItem(client, 'audit-table', buildItem())
}

async function testRealWriteFailure(): Promise<void> {
  const client: AuditLogDocumentClient = {
    async send() {
      throw new Error('boom')
    },
  }

  await assert.rejects(() => putOrderAuditLogItem(client, 'audit-table', buildItem()), /boom/)
}

function buildItem(): OrderAuditLogItem {
  return {
    orderId: 'order-1',
    occurredAtAuditId: '2026-09-28T00:00:00.000Z#event-1',
    auditId: 'event-1',
    eventName: 'INSERT',
    occurredAt: '2026-09-28T00:00:00.000Z',
    actorType: 'customer',
    actorId: 'user-1',
    reason: 'Order created',
    diff: {
      status: { after: 'PENDING' },
    },
    expiresAt: 1_800_000_000,
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
