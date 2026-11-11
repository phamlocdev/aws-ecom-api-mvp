import { mockClient } from 'aws-sdk-client-mock'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { ConfigService } from '@nestjs/config'
import { SesMailService } from './ses-mail.service'
import { EmailTrackingService } from './email-tracking.service'
import type { Order, OrderItem } from '../orders/domain/order.entity'

// Mock fs so template loading never touches the real filesystem
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockResolvedValue('<html>{{customerName}}</html>'),
  },
}))

const sesMock = mockClient(SESv2Client)

function makeConfigService(overrides: Record<string, unknown> = {}): ConfigService {
  const config: Record<string, unknown> = {
    AWS_REGION: 'ap-southeast-1',
    SES_ENABLED: true,
    SES_FROM_EMAIL: 'no-reply@example.com',
    SES_CONFIGURATION_SET_NAME: undefined,
    ...overrides,
  }
  return {
    get: jest.fn((key: string) => config[key]),
  } as unknown as ConfigService
}

function makeEmailTrackingService(): jest.Mocked<EmailTrackingService> {
  return {
    createTrackingItems: jest.fn().mockResolvedValue([
      { emailId: 'track-1', recipientEmail: 'user@example.com' },
    ]),
    markSent: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    logTrackingSkipped: jest.fn(),
    createOrderConfirmationTrackingItems: jest.fn(),
    hasActiveOrderConfirmationTracking: jest.fn(),
    hasActiveTracking: jest.fn(),
    findByContext: jest.fn(),
    findLatestRetryableForRecipient: jest.fn(),
    getLatestSummary: jest.fn(),
    getStatistics: jest.fn(),
  } as unknown as jest.Mocked<EmailTrackingService>
}

function makeOrder(): Order {
  return {
    orderId: 'order-1',
    customerId: 'user-1',
    customerEmail: 'user@example.com',
    customerName: 'Nguyen Van A',
    totalAmount: 500000,
    status: 'PAYMENT_PENDING',
    paymentStatus: 'PENDING',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Order
}

function makeOrderItems(): OrderItem[] {
  return [
    {
      lineId: 'line-1',
      productId: 'prod-1',
      productName: 'Wireless Headphones',
      quantity: 2,
      unitPrice: 250000,
      lineTotal: 500000,
    } as unknown as OrderItem,
  ]
}

describe('SesMailService', () => {
  let trackingService: jest.Mocked<EmailTrackingService>

  beforeEach(() => {
    sesMock.reset()
    trackingService = makeEmailTrackingService()
  })

  describe('when SES is disabled', () => {
    it('returns SKIPPED with reason "ses-disabled" without calling SES', async () => {
      const service = new SesMailService(
        makeConfigService({ SES_ENABLED: false }),
        trackingService,
      )

      const result = await service.sendOrderConfirmationEmail({
        order: makeOrder(),
        items: makeOrderItems(),
      })

      expect(result.status).toBe('SKIPPED')
      expect(result.reason).toBe('ses-disabled')
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0)
    })
  })

  describe('when fromEmail is not configured', () => {
    it('returns SKIPPED with reason "missing-from-email"', async () => {
      const service = new SesMailService(
        makeConfigService({ SES_FROM_EMAIL: undefined }),
        trackingService,
      )

      const result = await service.sendOrderConfirmationEmail({
        order: makeOrder(),
        items: makeOrderItems(),
      })

      expect(result.status).toBe('SKIPPED')
      expect(result.reason).toBe('missing-from-email')
    })
  })

  describe('when the order has no customer email and no override', () => {
    it('returns SKIPPED with reason "missing-recipient-email"', async () => {
      const service = new SesMailService(makeConfigService(), trackingService)
      const order = { ...makeOrder(), customerEmail: undefined }
      trackingService.createTrackingItems.mockResolvedValue([])

      const result = await service.sendOrderConfirmationEmail({
        order: order as unknown as Order,
        items: makeOrderItems(),
      })

      expect(result.status).toBe('SKIPPED')
      expect(result.reason).toBe('missing-recipient-email')
    })
  })

  describe('when tracking claims zero recipients (duplicate-notification-email)', () => {
    it('returns SKIPPED with reason "duplicate-notification-email"', async () => {
      trackingService.createTrackingItems.mockResolvedValue([])
      const service = new SesMailService(makeConfigService(), trackingService)

      const result = await service.sendOrderConfirmationEmail({
        order: makeOrder(),
        items: makeOrderItems(),
      })

      expect(result.status).toBe('SKIPPED')
      expect(result.reason).toBe('duplicate-notification-email')
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0)
    })
  })

  describe('when SES send succeeds', () => {
    it('returns SENT with the messageId and marks tracking as sent', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-msg-001' })
      const service = new SesMailService(makeConfigService(), trackingService)

      const result = await service.sendOrderConfirmationEmail({
        order: makeOrder(),
        items: makeOrderItems(),
      })

      expect(result.status).toBe('SENT')
      expect(result.messageId).toBe('ses-msg-001')
      expect(result.recipientEmails).toContain('user@example.com')
      expect(trackingService.markSent).toHaveBeenCalledWith(['track-1'], 'ses-msg-001')
    })

    it('sends to the correct From address with UTF-8 charset', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-msg-002' })
      const service = new SesMailService(makeConfigService(), trackingService)

      await service.sendOrderConfirmationEmail({
        order: makeOrder(),
        items: makeOrderItems(),
      })

      const calls = sesMock.commandCalls(SendEmailCommand)
      expect(calls).toHaveLength(1)
      const input = calls[0].args[0].input
      expect(input.FromEmailAddress).toBe('no-reply@example.com')
      expect(input.Destination?.ToAddresses).toContain('user@example.com')
      expect(input.Content?.Simple?.Body?.Html?.Charset).toBe('UTF-8')
    })
  })

  describe('when SES send fails', () => {
    it('returns FAILED and marks tracking as failed', async () => {
      sesMock.on(SendEmailCommand).rejects(Object.assign(new Error('SES error'), { name: 'SESv2ServiceException' }))
      const service = new SesMailService(makeConfigService(), trackingService)

      const result = await service.sendOrderConfirmationEmail({
        order: makeOrder(),
        items: makeOrderItems(),
      })

      expect(result.status).toBe('FAILED')
      expect(result.reason).toContain('SESv2ServiceException')
      expect(trackingService.markFailed).toHaveBeenCalledWith(
        ['track-1'],
        expect.stringContaining('SESv2ServiceException'),
      )
    })
  })

  describe('sendWelcomeNewCustomerEmail', () => {
    it('returns SKIPPED when SES is disabled', async () => {
      const service = new SesMailService(
        makeConfigService({ SES_ENABLED: false }),
        trackingService,
      )

      const result = await service.sendWelcomeNewCustomerEmail({
        user: { sub: 'u-1', username: 'nguyenvana', email: 'user@example.com' },
      })

      expect(result.status).toBe('SKIPPED')
    })

    it('returns SENT when SES is enabled and send succeeds', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-welcome-001' })
      const service = new SesMailService(makeConfigService(), trackingService)

      const result = await service.sendWelcomeNewCustomerEmail({
        user: { sub: 'u-1', username: 'nguyenvana', email: 'user@example.com' },
      })

      expect(result.status).toBe('SENT')
    })
  })

  describe('sendCognitoAuthEmail', () => {
    it('returns SENT for COGNITO_SIGN_UP email type', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-cognito-001' })
      const service = new SesMailService(makeConfigService(), trackingService)

      const result = await service.sendCognitoAuthEmail({
        emailType: 'COGNITO_SIGN_UP',
        user: { username: 'nguyenvana', email: 'user@example.com' },
        code: '123456',
      })

      expect(result.status).toBe('SENT')
    })

    it('returns SENT for COGNITO_ADMIN_CREATE_USER with temporary password', async () => {
      sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-cognito-002' })
      const service = new SesMailService(makeConfigService(), trackingService)

      const result = await service.sendCognitoAuthEmail({
        emailType: 'COGNITO_ADMIN_CREATE_USER',
        user: { username: 'newuser', email: 'newuser@example.com' },
        code: 'TempPass123!',
      })

      expect(result.status).toBe('SENT')
    })
  })
})
