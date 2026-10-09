import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AttributeValue } from '@aws-sdk/client-dynamodb'
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda'
import { DynamoDbService } from '../dynamodb/dynamodb.service'

const AUDIT_RETENTION_SECONDS = 365 * 24 * 60 * 60
const ENTITY_TYPE_OCCURRED_AT_INDEX = 'GSI_EntityTypeOccurredAt'

export const AUDIT_ENTITY_TYPES = [
  'ORDER',
  'PRODUCT',
  'CATEGORY',
  'INVENTORY',
  'USER_ACCOUNT',
] as const

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number]
type AuditEventName = 'INSERT' | 'MODIFY' | 'REMOVE'
type AuditActorType = 'customer' | 'admin' | 'system' | 'unknown'
type AuditFieldChange = { before?: unknown; after?: unknown }
type AuditDiff = Record<string, AuditFieldChange>
const ARRAY_KEY_FIELDS = ['id', 'key', 'productId', 'lineId', 'userId'] as const

interface AuditEntityConfig {
  idFields: string[]
  auditedFields: string[]
}

const AUDIT_ENTITY_CONFIGS: Record<AuditEntityType, AuditEntityConfig> = {
  ORDER: {
    idFields: ['orderId'],
    auditedFields: [
      'status',
      'paymentStatus',
      'paymentExpiresAt',
      'failureReason',
      'paymentFailureReason',
      'totalAmount',
      'shippedAt',
      'cancelledAt',
    ],
  },
  PRODUCT: {
    idFields: ['productId'],
    auditedFields: [
      'name',
      'description',
      'categoryId',
      'price',
      'imageUrl',
      'images',
      'status',
      'deletedAt',
    ],
  },
  CATEGORY: {
    idFields: ['categoryId'],
    auditedFields: ['name', 'description', 'status', 'deletedAt'],
  },
  INVENTORY: {
    idFields: ['productId'],
    auditedFields: ['availableQuantity', 'reservedQuantity'],
  },
  USER_ACCOUNT: {
    idFields: ['userId'],
    auditedFields: [
      'username',
      'email',
      'name',
      'avatarKey',
      'permissions',
      'status',
      'passwordStatus',
      'address',
    ],
  },
}

export interface AuditLogItem {
  entityKey: string
  occurredAtAuditId: string
  auditId: string
  entityType: AuditEntityType
  entityId: string
  sourceTable?: string
  eventName: AuditEventName
  occurredAt: string
  actorType: AuditActorType
  actorId?: string
  actorEmail?: string
  reason?: string
  diff: AuditDiff
  before: Record<string, unknown>
  after: Record<string, unknown>
  keys?: Record<string, unknown>
  schemaVersion: number
  expiresAt: number
}

export interface AuditLogQueryResult {
  items: AuditLogItem[]
  nextCursor: string | null
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

interface AuditPipeEnvelope {
  entityType?: AuditEntityType
  sourceTable?: string
  record?: DynamoDbStreamRecord
}

export interface AuditLogDocumentClient {
  send(command: PutCommand | QueryCommand): Promise<unknown>
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name)
  private readonly auditLogTableName: string

  constructor(
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
    this.auditLogTableName = configService.get<string>('AUDIT_LOG_TABLE') ?? 'audit-log'
  }

  async handleBatch(event: SQSEvent): Promise<SQSBatchResponse> {
    const failures: { itemIdentifier: string }[] = []

    for (const record of event.Records) {
      try {
        await this.processSqsRecord(record)
      } catch (error) {
        this.logger.error(`Failed to process audit record ${record.messageId}`, error)
        failures.push({ itemIdentifier: record.messageId })
      }
    }

    return {
      batchItemFailures: failures,
    }
  }

  async findByEntity(input: {
    entityType: string
    entityId?: string
    limit?: number
    cursor?: string
  }): Promise<AuditLogQueryResult> {
    const entityType = parseAuditEntityType(input.entityType)
    const entityId = readString(input.entityId)

    const requestedLimit = Number.isFinite(input.limit) ? input.limit : 25
    const limit = Math.min(Math.max(requestedLimit ?? 25, 1), 100)
    const keyConditionExpression = entityId
      ? '#entityKey = :entityKey'
      : '#entityType = :entityType'
    const expressionAttributeNames: Record<string, string> = entityId
      ? { '#entityKey': 'entityKey' }
      : { '#entityType': 'entityType' }
    const expressionAttributeValues: Record<string, string> = entityId
      ? { ':entityKey': buildEntityKey(entityType, entityId) }
      : { ':entityType': entityType }
    const response = (await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.auditLogTableName,
        ...(entityId ? {} : { IndexName: ENTITY_TYPE_OCCURRED_AT_INDEX }),
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(input.cursor),
      }),
    )) as { Items?: AuditLogItem[]; LastEvaluatedKey?: Record<string, unknown> }

    return {
      items: response.Items ?? [],
      nextCursor: encodeCursor(response.LastEvaluatedKey),
    }
  }

  private async processSqsRecord(record: SQSRecord): Promise<void> {
    const envelopes = parseAuditPipeEnvelopes(record.body)

    for (const envelope of envelopes) {
      const item = buildAuditLogItem(envelope)

      if (!item) {
        continue
      }

      await putAuditLogItem(this.dynamoDbService.documentClient, this.auditLogTableName, item)
    }
  }
}

export async function putAuditLogItem(
  client: AuditLogDocumentClient,
  tableName: string,
  item: AuditLogItem,
): Promise<void> {
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression:
          'attribute_not_exists(#entityKey) AND attribute_not_exists(#occurredAtAuditId)',
        ExpressionAttributeNames: {
          '#entityKey': 'entityKey',
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

export function buildAuditLogItem(envelope: AuditPipeEnvelope): AuditLogItem | undefined {
  const entityType = parseAuditEntityType(envelope.entityType)
  const config = AUDIT_ENTITY_CONFIGS[entityType]
  const record = envelope.record

  if (!record || !isAuditEventName(record.eventName)) {
    return undefined
  }

  const newImage = sanitizeImage(unmarshallImage(record.dynamodb?.NewImage))
  const oldImage = sanitizeImage(unmarshallImage(record.dynamodb?.OldImage))
  const keys = unmarshallImage(record.dynamodb?.Keys)
  const entityId = resolveEntityId(config, newImage, oldImage, keys)
  const auditId = record.eventID ?? record.dynamodb?.SequenceNumber

  if (!entityId || !auditId) {
    throw new Error(`Audit stream record is missing entity id or audit id for ${entityType}.`)
  }

  const diff = buildAuditDiff(record.eventName, oldImage, newImage, config.auditedFields)
  if (Object.keys(diff).length === 0) {
    return undefined
  }

  const occurredAt = resolveOccurredAt(record, newImage)
  const expiresAt = Math.floor(new Date(occurredAt).getTime() / 1000) + AUDIT_RETENTION_SECONDS

  return {
    entityKey: buildEntityKey(entityType, entityId),
    occurredAtAuditId: `${occurredAt}#${auditId}`,
    auditId,
    entityType,
    entityId,
    ...(envelope.sourceTable ? { sourceTable: envelope.sourceTable } : {}),
    eventName: record.eventName,
    occurredAt,
    ...resolveActor(newImage, oldImage),
    diff,
    before: pickAuditedFields(oldImage, config.auditedFields),
    after: pickAuditedFields(newImage, config.auditedFields),
    ...(Object.keys(keys).length > 0 ? { keys } : {}),
    schemaVersion: 1,
    expiresAt,
  }
}

export function buildAuditDiff(
  eventName: AuditEventName,
  oldImage: Record<string, unknown>,
  newImage: Record<string, unknown>,
  auditedFields: readonly string[],
): AuditDiff {
  const diff: AuditDiff = {}

  for (const field of auditedFields) {
    const before = oldImage[field]
    const after = newImage[field]

    if (eventName === 'INSERT') {
      if (after !== undefined) {
        diff[field] = { after }
      }
      continue
    }

    if (eventName === 'REMOVE') {
      if (before !== undefined) {
        diff[field] = { before }
      }
      continue
    }

    const change = buildChangedValuePair(before, after)
    if (change) {
      diff[field] = change
    }
  }

  return diff
}

export function parseAuditPipeEnvelope(body: string): AuditPipeEnvelope {
  return parseAuditPipeEnvelopes(body)[0]
}

export function parseAuditPipeEnvelopes(body: string): AuditPipeEnvelope[] {
  const parsed = JSON.parse(body) as AuditPipeEnvelope | AuditPipeEnvelope[]
  const values = Array.isArray(parsed) ? parsed : [parsed]

  return values.map((value) => {
    if ('record' in value && value.record) {
      return value
    }

    return {
      record: value as DynamoDbStreamRecord,
    }
  })
}

function parseAuditEntityType(value: unknown): AuditEntityType {
  if (typeof value === 'string' && AUDIT_ENTITY_TYPES.includes(value as AuditEntityType)) {
    return value as AuditEntityType
  }
  throw new BadRequestException(`Unsupported audit entityType: ${String(value ?? '')}`)
}

function isAuditEventName(value: unknown): value is AuditEventName {
  return value === 'INSERT' || value === 'MODIFY' || value === 'REMOVE'
}

function resolveEntityId(
  config: AuditEntityConfig,
  newImage: Record<string, unknown>,
  oldImage: Record<string, unknown>,
  keys: Record<string, unknown>,
): string | undefined {
  return config.idFields
    .map(
      (field) =>
        readString(newImage[field]) ?? readString(oldImage[field]) ?? readString(keys[field]),
    )
    .find(Boolean)
}

function buildEntityKey(entityType: AuditEntityType, entityId: string): string {
  return `${entityType}#${entityId}`
}

function pickAuditedFields(
  image: Record<string, unknown>,
  auditedFields: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of auditedFields) {
    if (image[field] !== undefined) {
      result[field] = image[field]
    }
  }
  return result
}

function resolveActor(
  newImage: Record<string, unknown>,
  oldImage: Record<string, unknown>,
): {
  actorType: AuditActorType
  actorId?: string
  actorEmail?: string
  reason?: string
} {
  const image = Object.keys(newImage).length > 0 ? newImage : oldImage
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

function sanitizeImage(image: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...image }
  const images = sanitized.images
  if (Array.isArray(images)) {
    sanitized.images = images.map((item) => {
      if (!item || typeof item !== 'object') {
        return item
      }
      const image = item as Record<string, unknown>
      return {
        key: image.key,
        sortOrder: image.sortOrder,
        isPrimary: image.isPrimary,
        ...(image.altText ? { altText: image.altText } : {}),
      }
    })
  }
  return sanitized
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
  if (left === right) {
    return true
  }

  if (Number.isNaN(left) && Number.isNaN(right)) {
    return true
  }

  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!isSameValue(left[index], right[index])) {
        return false
      }
    }

    return true
  }

  const leftObject = left as Record<string, unknown>
  const rightObject = right as Record<string, unknown>
  const leftKeys = Object.keys(leftObject)

  if (leftKeys.length !== Object.keys(rightObject).length) {
    return false
  }

  for (const key of leftKeys) {
    if (
      !Object.prototype.hasOwnProperty.call(rightObject, key) ||
      !isSameValue(leftObject[key], rightObject[key])
    ) {
      return false
    }
  }

  return true
}

function buildChangedValuePair(before: unknown, after: unknown): AuditFieldChange | undefined {
  if (isSameValue(before, after)) {
    return undefined
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    return buildObjectChange(before, after)
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    return (
      buildArrayChange(before, after) ?? {
        before,
        after,
      }
    )
  }

  return {
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  }
}

function buildObjectChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditFieldChange | undefined {
  const beforePatch: Record<string, unknown> = {}
  const afterPatch: Record<string, unknown> = {}
  let changed = false
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])

  for (const key of keys) {
    const childChange = buildChangedValuePair(before[key], after[key])
    if (!childChange) {
      continue
    }

    changed = true
    if ('before' in childChange) {
      beforePatch[key] = childChange.before
    }
    if ('after' in childChange) {
      afterPatch[key] = childChange.after
    }
  }

  if (!changed) {
    return undefined
  }

  return {
    before: beforePatch,
    after: afterPatch,
  }
}

function buildArrayChange(before: unknown[], after: unknown[]): AuditFieldChange | undefined {
  if (!canUseKeyedArrayDiff(before, after)) {
    return undefined
  }

  if (hasCommonArrayKeyReorder(before, after)) {
    return undefined
  }

  const beforeByKey = new Map(
    before.map((item) => {
      const key = readArrayItemKey(item)
      return [key.token, { item, key }] as const
    }),
  )
  const afterByKey = new Map(
    after.map((item) => {
      const key = readArrayItemKey(item)
      return [key.token, { item, key }] as const
    }),
  )
  const keys = Array.from(new Set([...beforeByKey.keys(), ...afterByKey.keys()])).sort(
    (left, right) => {
      const leftIndex = readArrayKeyIndex(left, before, after)
      const rightIndex = readArrayKeyIndex(right, before, after)
      return leftIndex - rightIndex
    },
  )
  const beforePatch: unknown[] = []
  const afterPatch: unknown[] = []

  for (const key of keys) {
    const beforeEntry = beforeByKey.get(key)
    const afterEntry = afterByKey.get(key)

    if (!beforeEntry) {
      afterPatch.push(afterEntry?.item)
      continue
    }

    if (!afterEntry) {
      beforePatch.push(beforeEntry.item)
      continue
    }

    const childChange = buildChangedValuePair(beforeEntry.item, afterEntry.item)
    if (!childChange) {
      continue
    }

    if ('before' in childChange) {
      beforePatch.push(ensureArrayItemKey(childChange.before, beforeEntry.key))
    }
    if ('after' in childChange) {
      afterPatch.push(ensureArrayItemKey(childChange.after, afterEntry.key))
    }
  }

  if (beforePatch.length === 0 && afterPatch.length === 0) {
    return undefined
  }

  return {
    before: beforePatch,
    after: afterPatch,
  }
}

function canUseKeyedArrayDiff(before: unknown[], after: unknown[]): boolean {
  const items = [...before, ...after]
  if (items.length === 0 || !items.every(isPlainObject)) {
    return false
  }

  const beforeKeys = before.map((item) => readArrayItemKey(item).token)
  const afterKeys = after.map((item) => readArrayItemKey(item).token)

  return (
    beforeKeys.every(Boolean) &&
    afterKeys.every(Boolean) &&
    new Set(beforeKeys).size === beforeKeys.length &&
    new Set(afterKeys).size === afterKeys.length
  )
}

function hasCommonArrayKeyReorder(before: unknown[], after: unknown[]): boolean {
  const afterKeys = new Set(after.map((item) => readArrayItemKey(item).token))
  const beforeCommonKeys = before
    .map((item) => readArrayItemKey(item).token)
    .filter((key) => afterKeys.has(key))
  const beforeKeys = new Set(beforeCommonKeys)
  const afterCommonKeys = after
    .map((item) => readArrayItemKey(item).token)
    .filter((key) => beforeKeys.has(key))

  return !isSameValue(beforeCommonKeys, afterCommonKeys)
}

function readArrayKeyIndex(key: string, before: unknown[], after: unknown[]): number {
  const beforeIndex = before.findIndex((item) => readArrayItemKey(item).token === key)
  if (beforeIndex >= 0) {
    return beforeIndex
  }

  return after.findIndex((item) => readArrayItemKey(item).token === key)
}

function readArrayItemKey(item: unknown): { field: string; value: string | number; token: string } {
  if (!isPlainObject(item)) {
    return { field: '', value: '', token: '' }
  }

  for (const field of ARRAY_KEY_FIELDS) {
    const value = item[field]
    if (typeof value === 'string' || typeof value === 'number') {
      return { field, value, token: `${field}:${value}` }
    }
  }

  return { field: '', value: '', token: '' }
}

function ensureArrayItemKey(
  value: unknown,
  key: { field: string; value: string | number },
): unknown {
  if (!isPlainObject(value) || key.field in value) {
    return value
  }

  return {
    [key.field]: key.value,
    ...value,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConditionalCheckFailedException'
  )
}

function encodeCursor(value: Record<string, unknown> | undefined): string | null {
  if (!value) {
    return null
  }

  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined
  }

  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new BadRequestException('cursor is invalid.')
  }
}
