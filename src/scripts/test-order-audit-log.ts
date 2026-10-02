import assert from 'assert'
import {
  buildAuditDiff,
  buildAuditLogItem,
  parseAuditPipeEnvelope,
  putAuditLogItem,
  type AuditLogDocumentClient,
  type AuditLogItem,
  type DynamoDbStreamRecord,
} from '../audit/audit-log.service'

async function main(): Promise<void> {
  testOrderInsertDiff()
  testProductModifyDiff()
  testObjectKeyOrderDoesNotCreateDiff()
  testArrayOrderStillCreatesDiff()
  testUserPlaintextPiiDiff()
  testNonAllowlistedChanges()
  testSoftDeleteModify()
  testPipeWrappedRecordParsing()
  await testIdempotentConditionalFailure()
  await testRealWriteFailure()

  console.log('Audit log tests passed.')
}

function testOrderInsertDiff(): void {
  const diff = buildAuditDiff(
    'INSERT',
    {},
    {
      orderId: 'order-1',
      status: 'PENDING',
      paymentStatus: 'NOT_STARTED',
      customerEmail: 'ignored@example.com',
    },
    ['status', 'paymentStatus'],
  )

  assert.deepEqual(diff, {
    status: { after: 'PENDING' },
    paymentStatus: { after: 'NOT_STARTED' },
  })
}

function testProductModifyDiff(): void {
  const item = buildAuditLogItem({
    entityType: 'PRODUCT',
    sourceTable: 'products',
    record: {
      eventID: 'event-product',
      eventName: 'MODIFY',
      dynamodb: {
        OldImage: {
          productId: { S: 'product-1' },
          name: { S: 'Before' },
          price: { N: '1000' },
        },
        NewImage: {
          productId: { S: 'product-1' },
          name: { S: 'After' },
          price: { N: '2000' },
          updatedAt: { S: '2026-09-28T00:00:00.000Z' },
        },
      },
    },
  })

  assert.equal(item?.entityKey, 'PRODUCT#product-1')
  assert.deepEqual(item?.diff, {
    name: { before: 'Before', after: 'After' },
    price: { before: 1000, after: 2000 },
  })
}

function testObjectKeyOrderDoesNotCreateDiff(): void {
  const diff = buildAuditDiff(
    'MODIFY',
    {
      images: [
        {
          key: 'product-1/front.jpg',
          sortOrder: 1,
          metadata: { width: 800, height: 600 },
        },
      ],
    },
    {
      images: [
        {
          metadata: { height: 600, width: 800 },
          sortOrder: 1,
          key: 'product-1/front.jpg',
        },
      ],
    },
    ['images'],
  )

  assert.deepEqual(diff, {})
}

function testArrayOrderStillCreatesDiff(): void {
  const diff = buildAuditDiff(
    'MODIFY',
    { images: [{ key: 'front.jpg' }, { key: 'back.jpg' }] },
    { images: [{ key: 'back.jpg' }, { key: 'front.jpg' }] },
    ['images'],
  )

  assert.deepEqual(diff, {
    images: {
      before: [{ key: 'front.jpg' }, { key: 'back.jpg' }],
      after: [{ key: 'back.jpg' }, { key: 'front.jpg' }],
    },
  })
}

function testUserPlaintextPiiDiff(): void {
  const item = buildAuditLogItem({
    entityType: 'USER_ACCOUNT',
    sourceTable: 'user-accounts',
    record: {
      eventID: 'event-user',
      eventName: 'MODIFY',
      dynamodb: {
        OldImage: {
          userId: { S: 'user-1' },
          email: { S: 'before@example.com' },
        },
        NewImage: {
          userId: { S: 'user-1' },
          email: { S: 'after@example.com' },
        },
      },
    },
  })

  assert.deepEqual(item?.diff.email, {
    before: 'before@example.com',
    after: 'after@example.com',
  })
}

function testNonAllowlistedChanges(): void {
  const item = buildAuditLogItem({
    entityType: 'ORDER',
    sourceTable: 'orders',
    record: {
      eventID: 'event-ignored',
      eventName: 'MODIFY',
      dynamodb: {
        OldImage: {
          orderId: { S: 'order-1' },
          customerName: { S: 'Before' },
        },
        NewImage: {
          orderId: { S: 'order-1' },
          customerName: { S: 'After' },
        },
      },
    },
  })

  assert.equal(item, undefined)
}

function testSoftDeleteModify(): void {
  const item = buildAuditLogItem({
    entityType: 'CATEGORY',
    sourceTable: 'categories',
    record: {
      eventID: 'event-delete',
      eventName: 'MODIFY',
      dynamodb: {
        OldImage: {
          categoryId: { S: 'category-1' },
          status: { S: 'ACTIVE' },
        },
        NewImage: {
          categoryId: { S: 'category-1' },
          status: { S: 'DELETED' },
          deletedAt: { S: '2026-09-28T00:00:00.000Z' },
          lastModifiedByType: { S: 'admin' },
          lastModifiedById: { S: 'user-1' },
          lastModifiedReason: { S: 'Category deleted' },
        },
      },
    },
  })

  assert.equal(item?.eventName, 'MODIFY')
  assert.equal(item?.actorType, 'admin')
  assert.deepEqual(item?.diff.status, { before: 'ACTIVE', after: 'DELETED' })
  assert.deepEqual(item?.diff.deletedAt, { after: '2026-09-28T00:00:00.000Z' })
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

  const parsed = parseAuditPipeEnvelope(
    JSON.stringify({ entityType: 'ORDER', sourceTable: 'orders', record }),
  )
  const item = buildAuditLogItem(parsed)

  assert.equal(item?.entityId, 'order-1')
  assert.equal(item?.auditId, 'event-1')
  assert.equal(item?.actorType, 'customer')
  assert.equal(item?.actorId, 'user-1')
  assert.equal(item?.reason, 'Order created')
  assert.deepEqual(item?.diff, { status: { after: 'PENDING' } })
}

async function testIdempotentConditionalFailure(): Promise<void> {
  const client: AuditLogDocumentClient = {
    async send() {
      const error = new Error('duplicate')
      error.name = 'ConditionalCheckFailedException'
      throw error
    },
  }

  await putAuditLogItem(client, 'audit-table', buildItem())
}

async function testRealWriteFailure(): Promise<void> {
  const client: AuditLogDocumentClient = {
    async send() {
      throw new Error('boom')
    },
  }

  await assert.rejects(() => putAuditLogItem(client, 'audit-table', buildItem()), /boom/)
}

function buildItem(): AuditLogItem {
  return {
    entityKey: 'ORDER#order-1',
    occurredAtAuditId: '2026-09-28T00:00:00.000Z#event-1',
    auditId: 'event-1',
    entityType: 'ORDER',
    entityId: 'order-1',
    eventName: 'INSERT',
    occurredAt: '2026-09-28T00:00:00.000Z',
    actorType: 'customer',
    actorId: 'user-1',
    reason: 'Order created',
    diff: {
      status: { after: 'PENDING' },
    },
    before: {},
    after: {
      status: 'PENDING',
    },
    schemaVersion: 1,
    expiresAt: 1_800_000_000,
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
