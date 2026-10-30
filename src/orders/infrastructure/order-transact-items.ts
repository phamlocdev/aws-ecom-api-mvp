import {
  AUDIT_ACTOR_ATTRIBUTE_NAMES,
  AUDIT_ACTOR_FIELDS,
  AuditMutationContext,
  toAuditMutationExpressionValues,
} from '../../audit/audit-actor'
import { TransactItem } from '../../common/transact-item.type'
import { Order } from '../domain/order.entity'
import { PAYMENT_WINDOW_EXPIRED_REASON } from '../domain/payment-reservation.config'

export function buildOrderFailTransactItem(
  tableName: string,
  orderId: string,
  failureReason: string,
  actor: AuditMutationContext,
): TransactItem {
  const timestamp = new Date().toISOString()
  return {
    Update: {
      TableName: tableName,
      Key: { orderId },
      UpdateExpression: `SET #status = :status, #failureReason = :failureReason, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
      ExpressionAttributeNames: {
        '#status': 'status',
        '#failureReason': 'failureReason',
        '#updatedAt': 'updatedAt',
        ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
      },
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':failureReason': failureReason,
        ':updatedAt': timestamp,
        ...toAuditMutationExpressionValues(actor),
      },
    },
  }
}

export function buildOrderCancelTransactItem(tableName: string, order: Order): TransactItem {
  return {
    Put: {
      TableName: tableName,
      Item: order.toRecord(),
    },
  }
}

export function buildOrderExpireTransactItem(
  tableName: string,
  order: Order,
  actor: AuditMutationContext,
): TransactItem | null {
  if (!order.paymentExpiresAt) return null
  const timestamp = new Date().toISOString()
  return {
    Update: {
      TableName: tableName,
      Key: { orderId: order.orderId },
      UpdateExpression: `SET #status = :status, #failureReason = :failureReason, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
      ConditionExpression:
        '#status = :reserved AND #paymentStatus <> :paid AND #paymentExpiresAt = :paymentExpiresAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#paymentStatus': 'paymentStatus',
        '#paymentExpiresAt': 'paymentExpiresAt',
        '#failureReason': 'failureReason',
        '#updatedAt': 'updatedAt',
        ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
      },
      ExpressionAttributeValues: {
        ':reserved': 'RESERVED',
        ':paid': 'PAID',
        ':paymentExpiresAt': order.paymentExpiresAt,
        ':status': 'EXPIRED',
        ':failureReason': PAYMENT_WINDOW_EXPIRED_REASON,
        ':updatedAt': timestamp,
        ...toAuditMutationExpressionValues(actor),
      },
    },
  }
}
