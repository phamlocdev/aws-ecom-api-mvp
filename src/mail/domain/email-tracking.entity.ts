import { z } from 'zod'
import type { EmailContextType, EmailDeliveryStatus, EmailType } from '../mail.types'

const emailTypeValues = [
  'ORDER_CONFIRMATION',
  'WELCOME_NEW_CUSTOMER',
  'SHIPPED_ORDER_NOTIFICATION',
  'CANCELLED_ORDER_NOTIFICATION',
  'COGNITO_SIGN_UP',
  'COGNITO_RESEND_CODE',
  'COGNITO_FORGOT_PASSWORD',
  'COGNITO_ADMIN_CREATE_USER',
  'COGNITO_UPDATE_USER_ATTRIBUTE',
  'COGNITO_VERIFY_USER_ATTRIBUTE',
  'COGNITO_AUTHENTICATION',
  'COGNITO_ACCOUNT_TAKEOVER_NOTIFICATION',
] as const

const EmailTrackingPropsSchema = z.object({
  emailId: z.string(),
  emailType: z.enum(emailTypeValues),
  recipientEmail: z.string(),
  status: z.enum(['PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'REJECTED', 'FAILED', 'SKIPPED']),
  contextType: z.enum(['ORDER', 'USER']),
  contextId: z.string(),
  contextKey: z.string(),
  sesMessageId: z.string().optional(),
  attemptNumber: z.number(),
  resendOfEmailId: z.string().optional(),
  lastSesEventAt: z.string().optional(),
  bounceType: z.enum(['Permanent', 'Transient', 'Undetermined']).optional(),
  bounceSubType: z.string().optional(),
  complaintSubType: z.string().optional(),
  failureReason: z.string().optional(),
  configurationSetName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sentAt: z.string().optional(),
  deliveredAt: z.string().optional(),
  bouncedAt: z.string().optional(),
  complainedAt: z.string().optional(),
  failedAt: z.string().optional(),
})

const EmailDeliverySummaryPropsSchema = z.object({
  recipientEmail: z.string(),
  emailType: z.enum(emailTypeValues),
  status: z.enum(['PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'REJECTED', 'FAILED', 'SKIPPED']),
  updatedAt: z.string(),
  emailId: z.string(),
  isRetryable: z.boolean(),
  attemptNumber: z.number(),
})

type EmailTrackingProps = {
  emailId: string
  emailType: EmailType
  recipientEmail: string
  status: EmailDeliveryStatus
  contextType: EmailContextType
  contextId: string
  contextKey: string
  sesMessageId?: string
  attemptNumber: number
  resendOfEmailId?: string
  lastSesEventAt?: string
  bounceType?: 'Permanent' | 'Transient' | 'Undetermined'
  bounceSubType?: string
  complaintSubType?: string
  failureReason?: string
  configurationSetName?: string
  createdAt: string
  updatedAt: string
  sentAt?: string
  deliveredAt?: string
  bouncedAt?: string
  complainedAt?: string
  failedAt?: string
}

export type CreateEmailTrackingData = EmailTrackingProps

export class EmailTracking {
  readonly emailId!: string
  readonly emailType!: EmailType
  readonly recipientEmail!: string
  readonly status!: EmailDeliveryStatus
  readonly contextType!: EmailContextType
  readonly contextId!: string
  readonly contextKey!: string
  readonly sesMessageId?: string
  readonly attemptNumber!: number
  readonly resendOfEmailId?: string
  readonly lastSesEventAt?: string
  readonly bounceType?: 'Permanent' | 'Transient' | 'Undetermined'
  readonly bounceSubType?: string
  readonly complaintSubType?: string
  readonly failureReason?: string
  readonly configurationSetName?: string
  readonly createdAt!: string
  readonly updatedAt!: string
  readonly sentAt?: string
  readonly deliveredAt?: string
  readonly bouncedAt?: string
  readonly complainedAt?: string
  readonly failedAt?: string

  protected constructor(props: EmailTrackingProps) {
    Object.assign(this, props)
  }

  static create(data: CreateEmailTrackingData): EmailTracking {
    return new EmailTracking(data)
  }

  static fromRecord(item: Record<string, unknown>): EmailTracking {
    const parsed = EmailTrackingPropsSchema.parse(item)
    return new EmailTracking({
      ...parsed,
      emailType: parsed.emailType as EmailType,
      status: parsed.status as EmailDeliveryStatus,
      contextType: parsed.contextType as EmailContextType,
      bounceType: parsed.bounceType as 'Permanent' | 'Transient' | 'Undetermined' | undefined,
    })
  }

  get isRetryable(): boolean {
    return ['FAILED', 'BOUNCED'].includes(this.status) && this.bounceType !== 'Permanent'
  }
}

export class EmailTrackingView extends EmailTracking {
  // Stores per-instance value from isRetryableEmailTracking() — more comprehensive than the
  // parent's simple getter (also handles REJECTED, PENDING/SENT+time check).
  private readonly _isRetryable: boolean

  private constructor(trackingProps: EmailTrackingProps, isRetryable: boolean) {
    super(trackingProps)
    this._isRetryable = isRetryable
  }

  override get isRetryable(): boolean {
    return this._isRetryable
  }

  static fromParts(tracking: EmailTracking, isRetryable: boolean): EmailTrackingView {
    return new EmailTrackingView(tracking as unknown as EmailTrackingProps, isRetryable)
  }
}

type EmailDeliverySummaryProps = {
  recipientEmail: string
  emailType: EmailType
  status: EmailDeliveryStatus
  updatedAt: string
  emailId: string
  isRetryable: boolean
  attemptNumber: number
}

export class EmailDeliverySummary {
  readonly recipientEmail!: string
  readonly emailType!: EmailType
  readonly status!: EmailDeliveryStatus
  readonly updatedAt!: string
  readonly emailId!: string
  readonly isRetryable!: boolean
  readonly attemptNumber!: number

  private constructor(props: EmailDeliverySummaryProps) {
    Object.assign(this, props)
  }

  static create(data: EmailDeliverySummaryProps): EmailDeliverySummary {
    return new EmailDeliverySummary(data)
  }

  static fromRecord(item: Record<string, unknown>): EmailDeliverySummary {
    const parsed = EmailDeliverySummaryPropsSchema.parse(item)
    return new EmailDeliverySummary({
      ...parsed,
      emailType: parsed.emailType as EmailType,
      status: parsed.status as EmailDeliveryStatus,
    })
  }
}
