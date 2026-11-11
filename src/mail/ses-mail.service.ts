import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SESv2Client, SendEmailCommand, type SendEmailCommandInput } from '@aws-sdk/client-sesv2'
import Handlebars from 'handlebars'
import { promises as fs } from 'fs'
import * as path from 'path'
import { EmailTrackingService } from './email-tracking.service'
import {
  EmailContextType,
  EmailIdempotencyMode,
  EmailSendResult,
  EmailType,
  SendCognitoAuthEmailInput,
  SendCancelledOrderNotificationEmailInput,
  SendOrderConfirmationEmailInput,
  SendShippedOrderNotificationEmailInput,
  SendWelcomeNewCustomerEmailInput,
} from './mail.types'

const TEMPLATE_FILES: Record<EmailType, string> = {
  ORDER_CONFIRMATION: 'order-confirmation.hbs',
  WELCOME_NEW_CUSTOMER: 'welcome-new-customer.hbs',
  SHIPPED_ORDER_NOTIFICATION: 'shipped-order-notification.hbs',
  CANCELLED_ORDER_NOTIFICATION: 'cancelled-order-notification.hbs',
  COGNITO_SIGN_UP: 'cognito-auth-code.hbs',
  COGNITO_RESEND_CODE: 'cognito-auth-code.hbs',
  COGNITO_FORGOT_PASSWORD: 'cognito-auth-code.hbs',
  COGNITO_ADMIN_CREATE_USER: 'cognito-admin-create-user.hbs',
  COGNITO_UPDATE_USER_ATTRIBUTE: 'cognito-auth-code.hbs',
  COGNITO_VERIFY_USER_ATTRIBUTE: 'cognito-auth-code.hbs',
  COGNITO_AUTHENTICATION: 'cognito-auth-code.hbs',
  COGNITO_ACCOUNT_TAKEOVER_NOTIFICATION: 'cognito-auth-code.hbs',
}
const EMAIL_SUBJECTS: Record<EmailType, string> = {
  ORDER_CONFIRMATION: 'Xác nhận đơn hàng của bạn',
  WELCOME_NEW_CUSTOMER: 'Chào mừng bạn đến với DynamoDB MVP',
  SHIPPED_ORDER_NOTIFICATION: 'Đơn hàng của bạn đã được vận chuyển',
  CANCELLED_ORDER_NOTIFICATION: 'Đơn hàng của bạn đã bị hủy',
  COGNITO_SIGN_UP: 'Mã xác thực tài khoản của bạn',
  COGNITO_RESEND_CODE: 'Mã xác thực tài khoản của bạn',
  COGNITO_FORGOT_PASSWORD: 'Mã đặt lại mật khẩu của bạn',
  COGNITO_ADMIN_CREATE_USER: 'Tài khoản của bạn đã được tạo',
  COGNITO_UPDATE_USER_ATTRIBUTE: 'Mã xác thực thông tin tài khoản',
  COGNITO_VERIFY_USER_ATTRIBUTE: 'Mã xác thực thông tin tài khoản',
  COGNITO_AUTHENTICATION: 'Mã đăng nhập của bạn',
  COGNITO_ACCOUNT_TAKEOVER_NOTIFICATION: 'Cảnh báo bảo mật tài khoản',
}

interface OrderConfirmationTemplateItemView {
  productName: string
  quantity: number
  unitPrice: string
  lineTotal: string
}

interface OrderConfirmationTemplateView {
  customerName: string
  orderId: string
  paidAt: string
  paymentTransactionId: string
  totalAmount: string
  items: OrderConfirmationTemplateItemView[]
}

interface ShippedOrderNotificationTemplateView {
  customerName: string
  orderId: string
  shippedAt: string
  totalAmount: string
  items: OrderConfirmationTemplateItemView[]
}

interface CancelledOrderNotificationTemplateView {
  customerName: string
  orderId: string
  cancelledAt: string
  totalAmount: string
  items: OrderConfirmationTemplateItemView[]
}

interface WelcomeNewCustomerTemplateView {
  customerName: string
  username: string
  email: string
}

interface CognitoAuthCodeTemplateView {
  customerName: string
  username: string
  code: string
  purpose: string
}

interface CognitoAdminCreateUserTemplateView {
  customerName: string
  username: string
  temporaryPassword: string
}

type MailTemplateView =
  | OrderConfirmationTemplateView
  | ShippedOrderNotificationTemplateView
  | CancelledOrderNotificationTemplateView
  | WelcomeNewCustomerTemplateView
  | CognitoAuthCodeTemplateView
  | CognitoAdminCreateUserTemplateView

@Injectable()
export class SesMailService {
  private readonly logger = new Logger(SesMailService.name)
  private readonly sesClient: SESv2Client
  private readonly isEnabled: boolean
  private readonly fromEmail?: string
  private readonly orderConfirmationSubject: string
  private readonly welcomeNewCustomerSubject: string
  private readonly shippedOrderNotificationSubject: string
  private readonly cancelledOrderNotificationSubject: string
  private readonly configurationSetName?: string
  private readonly templatePromises = new Map<
    EmailType,
    Promise<Handlebars.TemplateDelegate<MailTemplateView>>
  >()

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
  ) {
    const region =
      configService.get<string>('AWS_REGION') ??
      configService.get<string>('AWS_DEFAULT_REGION') ??
      'ap-southeast-1'

    this.sesClient = new SESv2Client({ region })
    this.isEnabled = configService.get<boolean>('SES_ENABLED') ?? false
    this.fromEmail = configService.get<string>('SES_FROM_EMAIL') ?? undefined
    this.orderConfirmationSubject = EMAIL_SUBJECTS.ORDER_CONFIRMATION
    this.welcomeNewCustomerSubject = EMAIL_SUBJECTS.WELCOME_NEW_CUSTOMER
    this.shippedOrderNotificationSubject = EMAIL_SUBJECTS.SHIPPED_ORDER_NOTIFICATION
    this.cancelledOrderNotificationSubject = EMAIL_SUBJECTS.CANCELLED_ORDER_NOTIFICATION
    this.configurationSetName = configService.get<string>('SES_CONFIGURATION_SET_NAME') ?? undefined
  }

  async sendOrderConfirmationEmail(
    input: SendOrderConfirmationEmailInput,
  ): Promise<EmailSendResult> {
    const recipientEmails = resolveRecipientEmails(
      input.order.customerEmail,
      input.order.additionalReceivingEmails,
      input.recipientEmails,
    )

    return this.sendTemplatedEmail({
      emailType: 'ORDER_CONFIRMATION',
      contextType: 'ORDER',
      contextId: input.order.id,
      recipientEmails,
      subject: this.orderConfirmationSubject,
      templateView: buildOrderConfirmationTemplateView(input),
      resendOfByRecipient: resolveResendOfByRecipient(input, recipientEmails),
    })
  }

  async sendShippedOrderNotificationEmail(
    input: SendShippedOrderNotificationEmailInput,
  ): Promise<EmailSendResult> {
    const recipientEmails = resolveRecipientEmails(
      input.order.customerEmail,
      input.order.additionalReceivingEmails,
      input.recipientEmails,
    )

    return this.sendTemplatedEmail({
      emailType: 'SHIPPED_ORDER_NOTIFICATION',
      contextType: 'ORDER',
      contextId: input.order.id,
      recipientEmails,
      subject: this.shippedOrderNotificationSubject,
      templateView: buildShippedOrderNotificationTemplateView(input),
      resendOfByRecipient: resolveResendOfByRecipient(input, recipientEmails),
      idempotencyMode: input.idempotencyMode,
    })
  }

  async sendCancelledOrderNotificationEmail(
    input: SendCancelledOrderNotificationEmailInput,
  ): Promise<EmailSendResult> {
    const recipientEmails = resolveRecipientEmails(
      input.order.customerEmail,
      input.order.additionalReceivingEmails,
      input.recipientEmails,
    )

    return this.sendTemplatedEmail({
      emailType: 'CANCELLED_ORDER_NOTIFICATION',
      contextType: 'ORDER',
      contextId: input.order.id,
      recipientEmails,
      subject: this.cancelledOrderNotificationSubject,
      templateView: buildCancelledOrderNotificationTemplateView(input),
      resendOfByRecipient: resolveResendOfByRecipient(input, recipientEmails),
      idempotencyMode: input.idempotencyMode,
    })
  }

  async sendWelcomeNewCustomerEmail(
    input: SendWelcomeNewCustomerEmailInput,
  ): Promise<EmailSendResult> {
    const contextId = input.user.sub ?? input.user.username
    return this.sendTemplatedEmail({
      emailType: 'WELCOME_NEW_CUSTOMER',
      contextType: 'USER',
      contextId,
      recipientEmails: resolveRecipientEmails(input.user.email, undefined, input.recipientEmails),
      subject: this.welcomeNewCustomerSubject,
      templateView: buildWelcomeNewCustomerTemplateView(input),
      resendOfByRecipient: input.resendOfByRecipient,
    })
  }

  async sendCognitoAuthEmail(input: SendCognitoAuthEmailInput): Promise<EmailSendResult> {
    const contextId = input.user.sub ?? input.user.username
    return this.sendTemplatedEmail({
      emailType: input.emailType,
      contextType: 'USER',
      contextId,
      recipientEmails: resolveRecipientEmails(input.user.email, undefined, input.recipientEmails),
      subject: EMAIL_SUBJECTS[input.emailType],
      templateView: buildCognitoAuthTemplateView(input),
    })
  }

  private async sendTemplatedEmail(input: {
    emailType: EmailType
    contextType: EmailContextType
    contextId: string
    recipientEmails: string[]
    subject: string
    templateView: MailTemplateView
    resendOfByRecipient?: Record<string, string>
    idempotencyMode?: EmailIdempotencyMode
  }): Promise<EmailSendResult> {
    if (!this.isEnabled) {
      await this.createSkippedTrackingItems(input, 'ses-disabled')
      return {
        status: 'SKIPPED',
        reason: 'ses-disabled',
        recipientEmails: input.recipientEmails,
      }
    }

    if (!this.fromEmail) {
      await this.createSkippedTrackingItems(input, 'missing-from-email')
      return {
        status: 'SKIPPED',
        reason: 'missing-from-email',
        recipientEmails: input.recipientEmails,
      }
    }

    if (input.recipientEmails.length === 0) {
      this.emailTrackingService.logTrackingSkipped(input.contextId, 'missing-recipient-email')
      return {
        status: 'SKIPPED',
        reason: 'missing-recipient-email',
        recipientEmails: input.recipientEmails,
      }
    }

    let trackingEmailIds: string[] = []
    let claimedRecipientEmails: string[] = []

    try {
      const trackingItems = await this.emailTrackingService.createTrackingItems({
        emailType: input.emailType,
        contextType: input.contextType,
        contextId: input.contextId,
        recipientEmails: input.recipientEmails,
        status: 'PENDING',
        configurationSetName: this.configurationSetName,
        resendOfByRecipient: input.resendOfByRecipient,
        idempotencyMode: input.idempotencyMode,
      })
      trackingEmailIds = trackingItems.map((item) => item.emailId)
      claimedRecipientEmails = trackingItems.map((item) => item.recipientEmail)

      if (claimedRecipientEmails.length === 0) {
        return {
          status: 'SKIPPED',
          reason: 'duplicate-notification-email',
          recipientEmails: input.recipientEmails,
        }
      }

      const template = await this.getTemplate(input.emailType)
      const html = template(input.templateView)

      const commandInput: SendEmailCommandInput = {
        FromEmailAddress: this.fromEmail,
        Destination: {
          ToAddresses: claimedRecipientEmails,
        },
        ...(this.configurationSetName ? { ConfigurationSetName: this.configurationSetName } : {}),
        Content: {
          Simple: {
            Subject: {
              Data: input.subject,
              Charset: 'UTF-8',
            },
            Body: {
              Html: {
                Data: html,
                Charset: 'UTF-8',
              },
            },
          },
        },
      }

      const response = await this.sesClient.send(new SendEmailCommand(commandInput))
      try {
        await this.emailTrackingService.markSent(trackingEmailIds, response.MessageId)
      } catch (error) {
        this.logger.error(
          `Failed to mark ${input.emailType} tracking as sent for ${input.contextId}.`,
          error,
        )
      }

      return {
        status: 'SENT',
        messageId: response.MessageId,
        recipientEmails: claimedRecipientEmails,
      }
    } catch (error) {
      this.logger.error(`Failed to send ${input.emailType} for ${input.contextId}.`, error)

      const failureReason = resolveFailureReason(error)
      if (trackingEmailIds.length > 0) {
        await this.emailTrackingService.markFailed(trackingEmailIds, failureReason)
      }

      return {
        status: 'FAILED',
        reason: failureReason,
        recipientEmails: claimedRecipientEmails,
      }
    }
  }

  private async createSkippedTrackingItems(
    input: {
      emailType: EmailType
      contextType: EmailContextType
      contextId: string
      recipientEmails: string[]
      resendOfByRecipient?: Record<string, string>
      idempotencyMode?: EmailIdempotencyMode
    },
    reason: string,
  ): Promise<void> {
    if (input.recipientEmails.length === 0) {
      this.emailTrackingService.logTrackingSkipped(input.contextId, reason)
      return
    }

    await this.emailTrackingService.createTrackingItems({
      emailType: input.emailType,
      contextType: input.contextType,
      contextId: input.contextId,
      recipientEmails: input.recipientEmails,
      status: 'SKIPPED',
      configurationSetName: this.configurationSetName,
      failureReason: reason,
      resendOfByRecipient: input.resendOfByRecipient,
      idempotencyMode: input.idempotencyMode,
    })
  }

  private async getTemplate(
    emailType: EmailType,
  ): Promise<Handlebars.TemplateDelegate<MailTemplateView>> {
    const existingPromise = this.templatePromises.get(emailType)
    if (existingPromise) {
      return existingPromise
    }

    const promise = this.loadTemplate(emailType)
    this.templatePromises.set(emailType, promise)
    return promise
  }

  private async loadTemplate(
    emailType: EmailType,
  ): Promise<Handlebars.TemplateDelegate<MailTemplateView>> {
    const templateSource = await this.readTemplateFile(TEMPLATE_FILES[emailType])
    return Handlebars.compile<MailTemplateView>(templateSource)
  }

  private async readTemplateFile(templateFileName: string): Promise<string> {
    const candidatePaths = [
      path.resolve(__dirname, 'templates', templateFileName),
      path.resolve(__dirname, 'templates', 'mail', 'templates', templateFileName),
    ]

    for (const candidatePath of candidatePaths) {
      try {
        return await fs.readFile(candidatePath, 'utf8')
      } catch (error) {
        if (isMissingFileError(error)) {
          continue
        }

        throw error
      }
    }

    throw new Error(`Email template ${templateFileName} was not found in the Lambda artifact.`)
  }
}

function buildOrderConfirmationTemplateView(
  input: SendOrderConfirmationEmailInput,
): OrderConfirmationTemplateView {
  const paidAt = input.order.paidAt ? formatOrderTimestamp(input.order.paidAt) : 'N/A'

  return {
    customerName: input.order.customerName?.trim() || 'bạn',
    orderId: input.order.id,
    paidAt,
    paymentTransactionId: input.order.paymentTransactionId ?? 'N/A',
    totalAmount: formatCurrency(input.order.totalAmount ?? 0),
    items: buildOrderItemTemplateViews(input.items),
  }
}

function buildShippedOrderNotificationTemplateView(
  input: SendShippedOrderNotificationEmailInput,
): ShippedOrderNotificationTemplateView {
  return {
    customerName: input.order.customerName?.trim() || 'bạn',
    orderId: input.order.id,
    shippedAt: formatOrderTimestamp(input.shippedAt),
    totalAmount: formatCurrency(input.order.totalAmount ?? 0),
    items: buildOrderItemTemplateViews(input.items),
  }
}

function buildCancelledOrderNotificationTemplateView(
  input: SendCancelledOrderNotificationEmailInput,
): CancelledOrderNotificationTemplateView {
  return {
    customerName: input.order.customerName?.trim() || 'bạn',
    orderId: input.order.id,
    cancelledAt: formatOrderTimestamp(input.cancelledAt),
    totalAmount: formatCurrency(input.order.totalAmount ?? 0),
    items: buildOrderItemTemplateViews(input.items),
  }
}

function buildWelcomeNewCustomerTemplateView(
  input: SendWelcomeNewCustomerEmailInput,
): WelcomeNewCustomerTemplateView {
  return {
    customerName: input.user.name?.trim() || input.user.username || 'bạn',
    username: input.user.username,
    email: input.user.email ?? 'N/A',
  }
}

function buildCognitoAuthTemplateView(
  input: SendCognitoAuthEmailInput,
): CognitoAuthCodeTemplateView | CognitoAdminCreateUserTemplateView {
  const customerName = input.user.name?.trim() || input.user.username || 'bạn'
  if (input.emailType === 'COGNITO_ADMIN_CREATE_USER') {
    return {
      customerName,
      username: input.user.username,
      temporaryPassword: input.code ?? 'N/A',
    }
  }

  return {
    customerName,
    username: input.user.username,
    code: input.code ?? 'N/A',
    purpose: describeCognitoAuthEmailPurpose(input.emailType),
  }
}

function describeCognitoAuthEmailPurpose(
  emailType: SendCognitoAuthEmailInput['emailType'],
): string {
  switch (emailType) {
    case 'COGNITO_FORGOT_PASSWORD':
      return 'đặt lại mật khẩu'
    case 'COGNITO_AUTHENTICATION':
      return 'hoàn tất đăng nhập'
    case 'COGNITO_UPDATE_USER_ATTRIBUTE':
    case 'COGNITO_VERIFY_USER_ATTRIBUTE':
      return 'xác thực thông tin tài khoản'
    case 'COGNITO_ACCOUNT_TAKEOVER_NOTIFICATION':
      return 'xác minh hoạt động bảo mật'
    case 'COGNITO_SIGN_UP':
    case 'COGNITO_RESEND_CODE':
    case 'COGNITO_ADMIN_CREATE_USER':
      return 'xác thực tài khoản'
  }
}

function buildOrderItemTemplateViews(items: SendOrderConfirmationEmailInput['items']) {
  return items.map((item) => ({
    productName: item.productName,
    quantity: item.quantity,
    unitPrice: formatCurrency(item.unitPrice),
    lineTotal: formatCurrency(item.lineTotal),
  }))
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatOrderTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(timestamp))
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function resolveFailureReason(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'ses-send-failed'
  }

  return error.name ? `${error.name}: ${error.message}` : error.message
}

function resolveRecipientEmails(
  customerEmail: string | undefined,
  additionalReceivingEmails: string[] | undefined,
  overrideRecipientEmails?: string[],
): string[] {
  const recipients = overrideRecipientEmails ?? [
    customerEmail,
    ...(additionalReceivingEmails ?? []),
  ]

  return Array.from(
    new Set(
      recipients
        .map((email) => email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email)),
    ),
  )
}

function resolveResendOfByRecipient(
  input: { resendOfEmailId?: string; resendOfByRecipient?: Record<string, string> },
  recipientEmails: string[],
): Record<string, string> | undefined {
  if (input.resendOfByRecipient) {
    return input.resendOfByRecipient
  }

  if (!input.resendOfEmailId || recipientEmails.length !== 1) {
    return undefined
  }

  return {
    [recipientEmails[0]]: input.resendOfEmailId,
  }
}
