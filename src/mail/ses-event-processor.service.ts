import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { SNSEvent } from 'aws-lambda'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { EmailTracking } from './mail.types'

type SesEventType = 'Send' | 'Delivery' | 'Bounce' | 'Complaint' | 'Reject' | 'Rendering Failure'

interface SesSnsEvent {
  eventType?: SesEventType
  mail?: {
    messageId?: string
    destination?: string[]
    timestamp?: string
  }
  delivery?: {
    recipients?: string[]
    timestamp?: string
  }
  bounce?: {
    bounceType?: EmailTracking['bounceType']
    bounceSubType?: string
    timestamp?: string
    bouncedRecipients?: Array<{
      emailAddress?: string
      diagnosticCode?: string
      status?: string
    }>
  }
  complaint?: {
    complaintSubType?: string
    timestamp?: string
    complainedRecipients?: Array<{
      emailAddress?: string
    }>
  }
  reject?: {
    reason?: string
  }
  renderingFailure?: {
    errorMessage?: string
    templateName?: string
  }
  failure?: {
    errorMessage?: string
    templateName?: string
  }
}

@Injectable()
export class SesEventProcessorService {
  private readonly logger = new Logger(SesEventProcessorService.name)
  private readonly tableName: string

  constructor(
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
    this.tableName = configService.get<string>('EMAIL_TRACKING_TABLE') ?? 'email-tracking'
  }

  async handleSesEventBatch(event: SNSEvent): Promise<void> {
    await Promise.all(
      event.Records.map(async (record) => {
        try {
          await this.processSesEvent(JSON.parse(record.Sns.Message) as SesSnsEvent)
        } catch (error) {
          this.logger.error('Failed to process SES event.', error)
        }
      }),
    )
  }

  private async processSesEvent(event: SesSnsEvent): Promise<void> {
    console.log('Processing SES event:', JSON.stringify(event, null, 2))
    const messageId = event.mail?.messageId
    const eventType = event.eventType
    if (!messageId || !eventType) {
      this.logger.warn('SES event is missing eventType or mail.messageId.')
      return
    }

    const recipients = resolveEventRecipients(event)
    if (recipients.length === 0) {
      this.logger.warn(`SES ${eventType} event ${messageId} does not include recipients.`)
      return
    }

    await Promise.all(
      recipients.map(async (recipientEmail) => {
        const trackingItem = await this.findTrackingItem(messageId, recipientEmail)
        if (!trackingItem) {
          this.logger.warn(
            `Email tracking item was not found for SES message ${messageId} and recipient ${recipientEmail}.`,
          )
          return
        }

        await this.updateTrackingItem(trackingItem.emailId, event, recipientEmail)
      }),
    )
  }

  private async findTrackingItem(
    sesMessageId: string,
    recipientEmail: string,
  ): Promise<EmailTracking | undefined> {
    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI_SesMessageRecipient',
        KeyConditionExpression:
          '#sesMessageId = :sesMessageId AND #recipientEmail = :recipientEmail',
        ExpressionAttributeNames: {
          '#sesMessageId': 'sesMessageId',
          '#recipientEmail': 'recipientEmail',
        },
        ExpressionAttributeValues: {
          ':sesMessageId': sesMessageId,
          ':recipientEmail': recipientEmail,
        },
        Limit: 1,
      }),
    )

    return response.Items?.[0] as EmailTracking | undefined
  }

  private async updateTrackingItem(
    emailId: string,
    event: SesSnsEvent,
    recipientEmail: string,
  ): Promise<void> {
    const timestamp = resolveEventTimestamp(event)
    const update = buildEventUpdate(event, timestamp, recipientEmail)
    if (!update) {
      return
    }

    try {
      await this.dynamoDbService.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { emailId },
          UpdateExpression: update.updateExpression,
          ConditionExpression: update.conditionExpression,
          ExpressionAttributeNames: update.names,
          ExpressionAttributeValues: update.values,
        }),
      )
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        this.logger.log(`Skipped stale SES ${event.eventType} event for tracking item ${emailId}.`)
        return
      }

      throw error
    }
  }
}

function  buildEventUpdate(
  event: SesSnsEvent,
  timestamp: string,
  recipientEmail: string,
):
  | {
      updateExpression: string
      conditionExpression: string
      names: Record<string, string>
      values: Record<string, unknown>
    }
  | undefined {
  const status = resolveStatus(event.eventType)
  if (!status) {
    return undefined
  }

  const names: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
    '#lastSesEventAt': 'lastSesEventAt',
  }
  const values: Record<string, unknown> = {
    ':updatedAt': timestamp,
    ':lastSesEventAt': timestamp,
    ':status': status,
  }
  const assignments = [
    '#updatedAt = :updatedAt',
    '#lastSesEventAt = :lastSesEventAt',
    '#status = :status',
  ]

  switch (event.eventType) {
    case 'Send':
      break
    case 'Delivery':
      names['#deliveredAt'] = 'deliveredAt'
      values[':deliveredAt'] = timestamp
      assignments.push('#deliveredAt = :deliveredAt')
      break
    case 'Bounce':
      names['#bouncedAt'] = 'bouncedAt'
      names['#failureReason'] = 'failureReason'
      values[':bouncedAt'] = timestamp
      values[':failureReason'] = resolveBounceFailureReason(event, recipientEmail)
      assignments.push('#bouncedAt = :bouncedAt', '#failureReason = :failureReason')
      if (event.bounce?.bounceType) {
        names['#bounceType'] = 'bounceType'
        values[':bounceType'] = event.bounce.bounceType
        assignments.push('#bounceType = :bounceType')
      }
      if (event.bounce?.bounceSubType) {
        names['#bounceSubType'] = 'bounceSubType'
        values[':bounceSubType'] = event.bounce.bounceSubType
        assignments.push('#bounceSubType = :bounceSubType')
      }
      break
    case 'Complaint':
      names['#complainedAt'] = 'complainedAt'
      values[':complainedAt'] = timestamp
      assignments.push('#complainedAt = :complainedAt')
      if (event.complaint?.complaintSubType) {
        names['#complaintSubType'] = 'complaintSubType'
        values[':complaintSubType'] = event.complaint.complaintSubType
        assignments.push('#complaintSubType = :complaintSubType')
      }
      break
    case 'Reject':
      names['#failedAt'] = 'failedAt'
      names['#failureReason'] = 'failureReason'
      values[':failedAt'] = timestamp
      values[':failureReason'] = event.reject?.reason ?? 'ses-rejected-email'
      assignments.push('#failedAt = :failedAt', '#failureReason = :failureReason')
      break
    case 'Rendering Failure':
      names['#failedAt'] = 'failedAt'
      names['#failureReason'] = 'failureReason'
      values[':failedAt'] = timestamp
      values[':failureReason'] =
        event.renderingFailure?.errorMessage ??
        event.failure?.errorMessage ??
        'ses-rendering-failure'
      assignments.push('#failedAt = :failedAt', '#failureReason = :failureReason')
      break
    default:
      return undefined
  }

  return {
    updateExpression: `SET ${assignments.join(', ')}`,
    conditionExpression:
      'attribute_not_exists(#lastSesEventAt) OR :lastSesEventAt >= #lastSesEventAt',
    names,
    values,
  }
}

function resolveStatus(eventType: SesEventType | undefined): EmailTracking['status'] | undefined {
  switch (eventType) {
    case 'Send':
      return 'SENT'
    case 'Delivery':
      return 'DELIVERED'
    case 'Bounce':
      return 'BOUNCED'
    case 'Complaint':
      return 'COMPLAINED'
    case 'Reject':
      return 'REJECTED'
    case 'Rendering Failure':
      return 'FAILED'
    default:
      return undefined
  }
}

function resolveEventRecipients(event: SesSnsEvent): string[] {
  switch (event.eventType) {
    case 'Delivery':
      return normalizeEmails(event.delivery?.recipients)
    case 'Bounce':
      return normalizeEmails(
        event.bounce?.bouncedRecipients?.map((recipient) => recipient.emailAddress),
      )
    case 'Complaint':
      return normalizeEmails(
        event.complaint?.complainedRecipients?.map((recipient) => recipient.emailAddress),
      )
    case 'Send':
    case 'Reject':
    case 'Rendering Failure':
      return normalizeEmails(event.mail?.destination)
    default:
      return []
  }
}

function resolveEventTimestamp(event: SesSnsEvent): string {
  return (
    event.delivery?.timestamp ??
    event.bounce?.timestamp ??
    event.complaint?.timestamp ??
    event.mail?.timestamp ??
    new Date().toISOString()
  )
}

function resolveBounceFailureReason(event: SesSnsEvent, recipientEmail: string): string {
  const bouncedRecipient = event.bounce?.bouncedRecipients?.find(
    (recipient) => recipient.emailAddress?.trim().toLowerCase() === recipientEmail,
  )

  return (
    bouncedRecipient?.diagnosticCode ??
    bouncedRecipient?.status ??
    event.bounce?.bounceSubType ??
    'ses-bounced-email'
  )
}

function normalizeEmails(emails: Array<string | undefined> | undefined): string[] {
  return Array.from(
    new Set(
      (emails ?? [])
        .map((email) => email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email)),
    ),
  )
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConditionalCheckFailedException'
  )
}
