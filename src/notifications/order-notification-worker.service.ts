import { Inject, Injectable, Logger } from '@nestjs/common'
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { EmailTrackingService } from '../mail/email-tracking.service'
import { SesMailService } from '../mail/ses-mail.service'
import { OrderStatus } from '../orders/domain/order-status.enum'
import { PaymentStatus } from '../orders/domain/payment-status.enum'
import type { Order, OrderItem } from '../orders/domain/order.entity'

export interface OrderShippedNotificationEventDetail {
  orderId?: unknown
  shippedAt?: unknown
}

export interface OrderCancelledNotificationEventDetail {
  orderId?: unknown
  cancelledAt?: unknown
}

@Injectable()
export class OrderNotificationWorkerService {
  private readonly logger = new Logger(OrderNotificationWorkerService.name)
  private readonly ordersTableName: string
  private readonly orderItemsTableName: string

  constructor(
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
    @Inject(SesMailService)
    private readonly sesMailService: SesMailService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    this.ordersTableName = dynamoTables.orders
    this.orderItemsTableName = dynamoTables.orderItems
  }

  async handleOrderShippedEvent(detail: OrderShippedNotificationEventDetail): Promise<void> {
    this.logger.log(`Received OrderShipped event detail: ${JSON.stringify(detail)}.`)

    // throw new Error(
    //   'FORCE_EVENT_CONSUMER_FAILURE is set to true, forcing a retryable failure for testing purposes.',
    // )

    if (!isNonEmptyString(detail.orderId) || !isNonEmptyString(detail.shippedAt)) {
      this.logger.warn(`Skipped invalid OrderShipped event detail: ${JSON.stringify(detail)}.`)
      return
    }

    const order = await this.findOrder(detail.orderId)
    if (!order) {
      this.logger.warn(
        `Skipped shipped notification because order ${detail.orderId} was not found.`,
      )
      return
    }

    if (order.status !== OrderStatus.SHIPPED || order.paymentStatus !== PaymentStatus.PAID) {
      this.logger.warn(
        `Skipped shipped notification for order ${order.orderId}: status=${order.status}, paymentStatus=${order.paymentStatus}.`,
      )
      return
    }

    const hasActiveTracking = await this.emailTrackingService.hasActiveTracking({
      contextType: 'ORDER',
      contextId: order.orderId,
      emailType: 'SHIPPED_ORDER_NOTIFICATION',
    })
    if (hasActiveTracking) {
      this.logger.log(`Skipped duplicate shipped notification for order ${order.orderId}.`)
      return
    }

    const items = await this.findOrderItems(order.orderId)
    const result = await this.sesMailService.sendShippedOrderNotificationEmail({
      order,
      items,
      shippedAt: detail.shippedAt,
      idempotencyMode: 'claim-once',
    })

    if (result.status === 'SENT') {
      this.logger.log(`Shipped notification email sent for order ${order.orderId}.`)
      return
    }

    if (result.status === 'FAILED' && isRetryableNotificationFailure(result.reason)) {
      throw new Error(
        `Retryable shipped notification failure for order ${order.orderId}: ${result.reason}`,
      )
    }

    this.logger.warn(
      `Best-effort shipped notification for order ${order.orderId} finished with status=${result.status}: ${result.reason ?? 'unknown-reason'}.`,
    )
  }

  async handleOrderCancelledEvent(detail: OrderCancelledNotificationEventDetail): Promise<void> {
    this.logger.log(`Received OrderCancelled event detail: ${JSON.stringify(detail)}.`)

    if (!isNonEmptyString(detail.orderId) || !isNonEmptyString(detail.cancelledAt)) {
      this.logger.warn(`Skipped invalid OrderCancelled event detail: ${JSON.stringify(detail)}.`)
      return
    }

    const order = await this.findOrder(detail.orderId)
    if (!order) {
      this.logger.warn(
        `Skipped cancelled notification because order ${detail.orderId} was not found.`,
      )
      return
    }

    if (order.status !== OrderStatus.CANCELLED || order.paymentStatus !== PaymentStatus.PAID) {
      this.logger.warn(
        `Skipped cancelled notification for order ${order.orderId}: status=${order.status}, paymentStatus=${order.paymentStatus}.`,
      )
      return
    }

    const hasActiveTracking = await this.emailTrackingService.hasActiveTracking({
      contextType: 'ORDER',
      contextId: order.orderId,
      emailType: 'CANCELLED_ORDER_NOTIFICATION',
    })
    if (hasActiveTracking) {
      this.logger.log(`Skipped duplicate cancelled notification for order ${order.orderId}.`)
      return
    }

    const items = await this.findOrderItems(order.orderId)
    const result = await this.sesMailService.sendCancelledOrderNotificationEmail({
      order,
      items,
      cancelledAt: detail.cancelledAt,
      idempotencyMode: 'claim-once',
    })

    if (result.status === 'SENT') {
      this.logger.log(`Cancelled notification email sent for order ${order.orderId}.`)
      return
    }

    if (result.status === 'FAILED' && isRetryableNotificationFailure(result.reason)) {
      throw new Error(
        `Retryable cancelled notification failure for order ${order.orderId}: ${result.reason}`,
      )
    }

    this.logger.warn(
      `Best-effort cancelled notification for order ${order.orderId} finished with status=${result.status}: ${result.reason ?? 'unknown-reason'}.`,
    )
  }

  private async findOrder(orderId: string): Promise<Order | undefined> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.ordersTableName,
        Key: { orderId },
      }),
    )

    return response.Item as Order | undefined
  }

  private async findOrderItems(orderId: string): Promise<OrderItem[]> {
    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.orderItemsTableName,
        KeyConditionExpression: '#orderId = :orderId',
        ExpressionAttributeNames: { '#orderId': 'orderId' },
        ExpressionAttributeValues: { ':orderId': orderId },
      }),
    )

    return (response.Items ?? []) as OrderItem[]
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRetryableNotificationFailure(reason: string | undefined): boolean {
  if (!reason) {
    return false
  }

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
