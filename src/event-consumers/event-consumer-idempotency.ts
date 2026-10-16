import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb'

export type EventConsumerIdempotencyStatus =
  'IN_PROGRESS' | 'COMPLETED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL'

export type EventConsumerClaimResultStatus = 'CLAIMED' | 'DUPLICATE' | 'RECLAIMED'

export interface EventConsumerClaimInput {
  idempotencyKey: string
  consumerName: string
  eventId?: string
  eventSource?: string
  eventDetailType?: string
  contextType: string
  contextId: string
}

export interface EventConsumerClaimResult {
  status: EventConsumerClaimResultStatus
  record?: EventConsumerIdempotencyRecord
}

export interface EventConsumerIdempotencyRecord {
  idempotencyKey: string
  status: EventConsumerIdempotencyStatus
  consumerName: string
  eventId?: string
  eventSource?: string
  eventDetailType?: string
  contextType: string
  contextId: string
  attemptNumber: number
  startedAt: string
  updatedAt: string
  inProgressExpiresAt?: number
  completedAt?: string
  failedAt?: string
  failureReason?: string
  expiresAt?: number
}

const IN_PROGRESS_STALE_AFTER_SECONDS = 15 * 60
const COMPLETED_TTL_SECONDS = 90 * 24 * 60 * 60

let documentClient: DynamoDBDocumentClient | undefined

export async function claimOnce(input: EventConsumerClaimInput): Promise<EventConsumerClaimResult> {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const tableName = getIdempotencyTableName()
  const item: EventConsumerIdempotencyRecord = {
    idempotencyKey: input.idempotencyKey,
    status: 'IN_PROGRESS',
    consumerName: input.consumerName,
    eventId: input.eventId,
    eventSource: input.eventSource,
    eventDetailType: input.eventDetailType,
    contextType: input.contextType,
    contextId: input.contextId,
    attemptNumber: 1,
    startedAt: nowIso,
    updatedAt: nowIso,
    inProgressExpiresAt: toEpochSeconds(now) + IN_PROGRESS_STALE_AFTER_SECONDS,
  }

  try {
    await getDocumentClient().send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(#idempotencyKey)',
        ExpressionAttributeNames: {
          '#idempotencyKey': 'idempotencyKey',
        },
      }),
    )

    return { status: 'CLAIMED', record: item }
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error
    }
  }

  const existing = await findRecord(input.idempotencyKey)
  if (!existing || !isReclaimable(existing, now)) {
    return { status: 'DUPLICATE', record: existing }
  }

  const reclaimed = await reclaimRecord(existing, input, now)
  return reclaimed
    ? { status: 'RECLAIMED', record: reclaimed }
    : { status: 'DUPLICATE', record: existing }
}

export async function markCompleted(idempotencyKey: string): Promise<void> {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()

  await getDocumentClient().send(
    new UpdateCommand({
      TableName: getIdempotencyTableName(),
      Key: { idempotencyKey },
      UpdateExpression:
        'SET #status = :completed, #updatedAt = :updatedAt, #completedAt = :completedAt, #expiresAt = :expiresAt REMOVE #failureReason, #failedAt, #inProgressExpiresAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#completedAt': 'completedAt',
        '#expiresAt': 'expiresAt',
        '#failureReason': 'failureReason',
        '#failedAt': 'failedAt',
        '#inProgressExpiresAt': 'inProgressExpiresAt',
      },
      ExpressionAttributeValues: {
        ':completed': 'COMPLETED',
        ':updatedAt': nowIso,
        ':completedAt': nowIso,
        ':expiresAt': toEpochSeconds(now) + COMPLETED_TTL_SECONDS,
      },
    }),
  )
}

export async function markFailed(idempotencyKey: string, reason: string): Promise<void> {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const status: EventConsumerIdempotencyStatus = isRetryableFailureReason(reason)
    ? 'FAILED_RETRYABLE'
    : 'FAILED_FINAL'

  await getDocumentClient().send(
    new UpdateCommand({
      TableName: getIdempotencyTableName(),
      Key: { idempotencyKey },
      UpdateExpression:
        'SET #status = :status, #updatedAt = :updatedAt, #failedAt = :failedAt, #failureReason = :failureReason, #expiresAt = :expiresAt REMOVE #inProgressExpiresAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#failedAt': 'failedAt',
        '#failureReason': 'failureReason',
        '#expiresAt': 'expiresAt',
        '#inProgressExpiresAt': 'inProgressExpiresAt',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':updatedAt': nowIso,
        ':failedAt': nowIso,
        ':failureReason': reason,
        ':expiresAt': toEpochSeconds(now) + COMPLETED_TTL_SECONDS,
      },
    }),
  )
}

export async function runIdempotentEventConsumer(
  input: EventConsumerClaimInput,
  sideEffect: () => Promise<void>,
): Promise<EventConsumerClaimResultStatus> {
  // DEMO ONLY: lets us reproduce the duplicate-processing bug on purpose by
  // bypassing the idempotency claim. Never set in infra; must stay unset in production.
  if (process.env.DISABLE_EVENT_CONSUMER_IDEMPOTENCY === 'true') {
    await sideEffect()
    return 'CLAIMED'
  }

  const claim = await claimOnce(input)
  if (claim.status === 'DUPLICATE') {
    console.log(
      JSON.stringify({
        worker: input.consumerName,
        message: 'Skipped duplicate EventBridge consumer action.',
        idempotencyKey: input.idempotencyKey,
        existingStatus: claim.record?.status,
      }),
    )
    return claim.status
  }

  try {
    await sideEffect()
    await markCompleted(input.idempotencyKey)
    return claim.status
  } catch (error) {
    const reason = resolveFailureReason(error)
    await markFailed(input.idempotencyKey, reason)
    throw error
  }
}

async function findRecord(
  idempotencyKey: string,
): Promise<EventConsumerIdempotencyRecord | undefined> {
  const response = await getDocumentClient().send(
    new GetCommand({
      TableName: getIdempotencyTableName(),
      Key: { idempotencyKey },
    }),
  )

  return response.Item as EventConsumerIdempotencyRecord | undefined
}

async function reclaimRecord(
  existing: EventConsumerIdempotencyRecord,
  input: EventConsumerClaimInput,
  now: number,
): Promise<EventConsumerIdempotencyRecord | undefined> {
  const nowIso = new Date(now).toISOString()

  try {
    const response = await getDocumentClient().send(
      new UpdateCommand({
        TableName: getIdempotencyTableName(),
        Key: { idempotencyKey: input.idempotencyKey },
        UpdateExpression:
          'SET #status = :inProgress, #consumerName = :consumerName, #eventId = :eventId, #eventSource = :eventSource, #eventDetailType = :eventDetailType, #contextType = :contextType, #contextId = :contextId, #attemptNumber = :attemptNumber, #startedAt = :startedAt, #updatedAt = :updatedAt, #inProgressExpiresAt = :inProgressExpiresAt REMOVE #failureReason, #failedAt, #completedAt',
        ConditionExpression:
          '#status = :failedRetryable OR (#status = :inProgress AND #inProgressExpiresAt <= :now)',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#consumerName': 'consumerName',
          '#eventId': 'eventId',
          '#eventSource': 'eventSource',
          '#eventDetailType': 'eventDetailType',
          '#contextType': 'contextType',
          '#contextId': 'contextId',
          '#attemptNumber': 'attemptNumber',
          '#startedAt': 'startedAt',
          '#updatedAt': 'updatedAt',
          '#inProgressExpiresAt': 'inProgressExpiresAt',
          '#failureReason': 'failureReason',
          '#failedAt': 'failedAt',
          '#completedAt': 'completedAt',
        },
        ExpressionAttributeValues: {
          ':inProgress': 'IN_PROGRESS',
          ':failedRetryable': 'FAILED_RETRYABLE',
          ':consumerName': input.consumerName,
          ':eventId': input.eventId,
          ':eventSource': input.eventSource,
          ':eventDetailType': input.eventDetailType,
          ':contextType': input.contextType,
          ':contextId': input.contextId,
          ':attemptNumber': (existing.attemptNumber ?? 0) + 1,
          ':startedAt': nowIso,
          ':updatedAt': nowIso,
          ':inProgressExpiresAt': toEpochSeconds(now) + IN_PROGRESS_STALE_AFTER_SECONDS,
          ':now': toEpochSeconds(now),
        },
        ReturnValues: 'ALL_NEW',
      }),
    )

    return response.Attributes as EventConsumerIdempotencyRecord | undefined
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return undefined
    }

    throw error
  }
}

function isReclaimable(record: EventConsumerIdempotencyRecord, now: number): boolean {
  if (record.status === 'FAILED_RETRYABLE') {
    return true
  }

  return (
    record.status === 'IN_PROGRESS' &&
    typeof record.inProgressExpiresAt === 'number' &&
    record.inProgressExpiresAt <= toEpochSeconds(now)
  )
}

function getDocumentClient(): DynamoDBDocumentClient {
  if (!documentClient) {
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'ap-southeast-1'
    documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    })
  }

  return documentClient
}

function getIdempotencyTableName(): string {
  const tableName = process.env.EVENT_CONSUMER_IDEMPOTENCY_TABLE
  if (!tableName) {
    throw new Error('EVENT_CONSUMER_IDEMPOTENCY_TABLE is not configured.')
  }

  return tableName
}

function isRetryableFailureReason(reason: string): boolean {
  const normalizedReason = reason.toLowerCase()
  return [
    'throttl',
    'too many requests',
    'timeout',
    'timed out',
    'econnreset',
    'etimedout',
    'enotfound',
    'network',
    'service unavailable',
    'temporarily unavailable',
    'internal server error',
    'request limit',
    'rate exceeded',
    '5xx',
  ].some((token) => normalizedReason.includes(token))
}

function resolveFailureReason(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'event-consumer-failed'
  }

  return error.name ? `${error.name}: ${error.message}` : error.message
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConditionalCheckFailedException'
  )
}

function toEpochSeconds(milliseconds: number): number {
  return Math.floor(milliseconds / 1000)
}
