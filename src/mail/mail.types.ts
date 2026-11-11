import type { Order, OrderItem } from '../orders/domain/order.entity'

export interface SendOrderConfirmationEmailInput {
  order: Order
  items: OrderItem[]
  recipientEmails?: string[]
  resendOfEmailId?: string
  resendOfByRecipient?: Record<string, string>
}

export interface SendShippedOrderNotificationEmailInput {
  order: Order
  items: OrderItem[]
  shippedAt: string
  recipientEmails?: string[]
  resendOfEmailId?: string
  resendOfByRecipient?: Record<string, string>
  idempotencyMode?: EmailIdempotencyMode
}

export interface SendCancelledOrderNotificationEmailInput {
  order: Order
  items: OrderItem[]
  cancelledAt: string
  recipientEmails?: string[]
  resendOfEmailId?: string
  resendOfByRecipient?: Record<string, string>
  idempotencyMode?: EmailIdempotencyMode
}

export interface SendWelcomeNewCustomerEmailInput {
  user: {
    sub?: string
    username: string
    email?: string
    name?: string
  }
  recipientEmails?: string[]
  resendOfByRecipient?: Record<string, string>
}

export interface SendCognitoAuthEmailInput {
  emailType: CognitoAuthEmailType
  user: {
    sub?: string
    username: string
    email?: string
    name?: string
  }
  code?: string
  recipientEmails?: string[]
}

export type EmailSendStatus = 'SENT' | 'SKIPPED' | 'FAILED'
export type EmailIdempotencyMode = 'claim-once'

export interface EmailSendResult {
  status: EmailSendStatus
  messageId?: string
  reason?: string
  recipientEmails?: string[]
}

export type EmailDeliveryStatus =
  'PENDING' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'REJECTED' | 'FAILED' | 'SKIPPED'

export type EmailType =
  | 'ORDER_CONFIRMATION'
  | 'WELCOME_NEW_CUSTOMER'
  | 'SHIPPED_ORDER_NOTIFICATION'
  | 'CANCELLED_ORDER_NOTIFICATION'
  | CognitoAuthEmailType

export type CognitoAuthEmailType =
  | 'COGNITO_SIGN_UP'
  | 'COGNITO_RESEND_CODE'
  | 'COGNITO_FORGOT_PASSWORD'
  | 'COGNITO_ADMIN_CREATE_USER'
  | 'COGNITO_UPDATE_USER_ATTRIBUTE'
  | 'COGNITO_VERIFY_USER_ATTRIBUTE'
  | 'COGNITO_AUTHENTICATION'
  | 'COGNITO_ACCOUNT_TAKEOVER_NOTIFICATION'

export type EmailContextType = 'ORDER' | 'USER'

export type EmailDeliveryStatistics = Record<EmailType, Record<EmailDeliveryStatus, number>>

export const EMAIL_DELIVERY_STATUSES: EmailDeliveryStatus[] = [
  'PENDING',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'REJECTED',
  'FAILED',
  'SKIPPED',
]
