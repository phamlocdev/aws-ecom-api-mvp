import { ORDERS_ENTITY_TYPE } from '../domain/order.entity'
import { OrderListFilter } from '../domain/order.repository.port'

export function buildStaffOrderQuery(
  filter: OrderListFilter,
  exclusiveStartKey?: Record<string, unknown>,
): Record<string, unknown> {
  if (filter.customerEmail) {
    return {
      IndexName: 'GSI_CustomerEmailOrders',
      KeyConditionExpression: '#customerEmail = :customerEmail',
      ExpressionAttributeNames: { '#customerEmail': 'customerEmail' },
      ExpressionAttributeValues: { ':customerEmail': filter.customerEmail },
      ExclusiveStartKey: exclusiveStartKey,
    }
  }

  if (filter.customerId) {
    return {
      IndexName: 'GSI_CustomerOrders',
      KeyConditionExpression: '#customerId = :customerId',
      ExpressionAttributeNames: { '#customerId': 'customerId' },
      ExpressionAttributeValues: { ':customerId': filter.customerId },
      ExclusiveStartKey: exclusiveStartKey,
    }
  }

  if (filter.status) {
    return {
      IndexName: 'GSI_OrderStatusCreatedAt',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': filter.status },
      ExclusiveStartKey: exclusiveStartKey,
    }
  }

  return {
    IndexName: 'GSI_OrderCreatedAt',
    KeyConditionExpression: '#entityType = :entityType',
    ExpressionAttributeNames: { '#entityType': 'entityType' },
    ExpressionAttributeValues: { ':entityType': ORDERS_ENTITY_TYPE },
    ExclusiveStartKey: exclusiveStartKey,
  }
}

export function buildCustomerOrderQuery(
  customerId: string,
  exclusiveStartKey?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    IndexName: 'GSI_CustomerOrders',
    KeyConditionExpression: '#customerId = :customerId',
    ExpressionAttributeNames: { '#customerId': 'customerId' },
    ExpressionAttributeValues: { ':customerId': customerId },
    ExclusiveStartKey: exclusiveStartKey,
  }
}
