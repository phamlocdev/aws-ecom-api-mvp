import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AttributeValue } from '@aws-sdk/client-dynamodb'
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda'
import { DynamoDbService } from '../dynamodb/dynamodb.service'

const AUDIT_RETENTION_SECONDS = 365 * 24 * 60 * 60
const AUDITED_FIELDS = ['status', 'paymentStatus'] as const

type AuditEventName = 'INSERT' | 'MODIFY'
type AuditActorType = 'customer' | 'admin' | 'system' | 'unknown'
type AuditedField = (typeof AUDITED_FIELDS)[number]
type AuditFieldChange = { before?: unknown; after?: unknown }
type AuditDiff = Partial<Record<AuditedField, AuditFieldChange>>

export interface OrderAuditLogItem {
  orderId: string
  occurredAtAuditId: string
  auditId: string
  eventName: AuditEventName
  occurredAt: string
  actorType: AuditActorType
  actorId?: string
  actorEmail?: string
  reason?: string
  diff: AuditDiff
  expiresAt: number
}

export interface DynamoDbStreamRecord {
  eventID?: string
  eventName?: string
  dynamodb?: {
    ApproximateCreationDateTime?: number
    Keys?: Record<string, AttributeValue>
    NewImage?: Record<string, AttributeValue>
    OldImage?: Record<string, AttributeValue>
    SequenceNumber?: string
  }
}

interface PipeWrappedRecord {
  record?: DynamoDbStreamRecord
}

export interface AuditLogDocumentClient {
  send(command: PutCommand): Promise<unknown>
}

@Injectable()
export class OrderAuditLogProcessorService {
  private readonly logger = new Logger(OrderAuditLogProcessorService.name)
  private readonly orderAuditLogTableName: string

  constructor(
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
    this.orderAuditLogTableName =
      configService.get<string>('ORDER_AUDIT_LOG_TABLE') ?? 'order-audit-log'
  }

  async handleBatch(event: SQSEvent): Promise<SQSBatchResponse> {
    const failures: { itemIdentifier: string }[] = []

    for (const record of event.Records) {
      try {
        await this.processSqsRecord(record)
      } catch (error) {
        this.logger.error(`Failed to process order audit record ${record.messageId}`, error)
        failures.push({ itemIdentifier: record.messageId })
      }
    }

    return {
      batchItemFailures: failures,
    }
  }

  private async processSqsRecord(record: SQSRecord): Promise<void> {
    const streamRecords = parseStreamRecords(record.body)

    for (const streamRecord of streamRecords) {
      const item = buildOrderAuditLogItem(streamRecord)

      if (!item) {
        continue
      }

      await putOrderAuditLogItem(
        this.dynamoDbService.documentClient,
        this.orderAuditLogTableName,
        item,
      )
    }
  }
}

export async function putOrderAuditLogItem(
  client: AuditLogDocumentClient,
  tableName: string,
  item: OrderAuditLogItem,
): Promise<void> {
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression:
          'attribute_not_exists(#orderId) attribute_not_existsAND (#occurredAtAuditId)',
        ExpressionAttributeNames: {
          '#orderId': 'orderId',
          '#occurredAtAuditId': 'occurredAtAuditId',
        },
      }),
    )
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      return
    }
    throw error
  }
}

export function buildOrderAuditLogItem(
  record: DynamoDbStreamRecord,
): OrderAuditLogItem | undefined {
  if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') {
    if (record.eventName === 'REMOVE') {
      console.warn(`Ignoring REMOVE order audit stream record ${record.eventID ?? 'unknown'}.`)
    }
    return undefined
  }

  const newImage = unmarshallImage(record.dynamodb?.NewImage)
  const oldImage = unmarshallImage(record.dynamodb?.OldImage)
  const orderId = readString(newImage.orderId) ?? readString(oldImage.orderId)
  const auditId = record.eventID ?? record.dynamodb?.SequenceNumber

  if (!orderId || !auditId) {
    throw new Error('Order audit stream record is missing orderId or auditId.')
  }

  const diff = buildAuditDiff(record.eventName, oldImage, newImage)
  if (Object.keys(diff).length === 0) {
    return undefined
  }

  const occurredAt = resolveOccurredAt(record, newImage)
  const expiresAt = Math.floor(new Date(occurredAt).getTime() / 1000) + AUDIT_RETENTION_SECONDS

  return {
    orderId,
    occurredAtAuditId: `${occurredAt}#${auditId}`,
    auditId,
    eventName: record.eventName,
    occurredAt,
    ...resolveActor(newImage),
    diff,
    expiresAt,
  }
}

export function buildAuditDiff(
  eventName: AuditEventName,
  oldImage: Record<string, unknown>,
  newImage: Record<string, unknown>,
): AuditDiff {
  const diff: AuditDiff = {}

  for (const field of AUDITED_FIELDS) {
    const before = oldImage[field]
    const after = newImage[field]

    if (eventName === 'INSERT') {
      if (after !== undefined) {
        diff[field] = { after }
      }
      continue
    }

    if (!isSameValue(before, after)) {
      diff[field] = {
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
      }
    }
  }

  return diff
}

export function parseStreamRecord(body: string): DynamoDbStreamRecord {
  return parseStreamRecords(body)[0]
}

export function parseStreamRecords(body: string): DynamoDbStreamRecord[] {
  const parsed = JSON.parse(body) as DynamoDbStreamRecord | PipeWrappedRecord
  if (Array.isArray(parsed)) {
    return parsed.map(unwrapStreamRecord)
  }
  return [unwrapStreamRecord(parsed)]
}

function unwrapStreamRecord(
  parsed: DynamoDbStreamRecord | PipeWrappedRecord,
): DynamoDbStreamRecord {
  if ('record' in parsed && parsed.record) {
    return parsed.record
  }
  return parsed as DynamoDbStreamRecord
}

function resolveActor(image: Record<string, unknown>): {
  actorType: AuditActorType
  actorId?: string
  actorEmail?: string
  reason?: string
} {
  const actorType = readActorType(image.lastModifiedByType)
  const actorId = readString(image.lastModifiedById)
  const actorEmail = readOptionalActorEmail(image.lastModifiedByEmail)
  const reason = readString(image.lastModifiedReason)

  return {
    actorType,
    ...(actorId ? { actorId } : {}),
    ...(actorEmail ? { actorEmail } : {}),
    ...(reason ? { reason } : {}),
  }
}

function resolveOccurredAt(
  record: DynamoDbStreamRecord,
  newImage: Record<string, unknown>,
): string {
  const streamTimestamp = record.dynamodb?.ApproximateCreationDateTime
  if (typeof streamTimestamp === 'number' && Number.isFinite(streamTimestamp)) {
    return new Date(streamTimestamp * 1000).toISOString()
  }

  const updatedAt = readString(newImage.updatedAt)
  if (updatedAt && !Number.isNaN(new Date(updatedAt).getTime())) {
    return updatedAt
  }

  return new Date().toISOString()
}

function unmarshallImage(
  image: Record<string, AttributeValue> | undefined,
): Record<string, unknown> {
  if (!image) {
    return {}
  }

  return unmarshall(image)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readActorType(value: unknown): AuditActorType {
  if (value === 'customer' || value === 'admin' || value === 'system') {
    return value
  }
  return 'unknown'
}

function readOptionalActorEmail(value: unknown): string | undefined {
  const email = readString(value)
  return email === 'unknown' ? undefined : email
}

function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConditionalCheckFailedException'
  )
}
