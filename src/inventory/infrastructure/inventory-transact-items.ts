import {
  AUDIT_ACTOR_ATTRIBUTE_NAMES,
  AUDIT_ACTOR_FIELDS,
  AuditMutationContext,
  toAuditMutationExpressionValues,
} from '../../audit/audit-actor'
import { InvalidInputError } from '../../common/domain-error'
import { TransactItem } from '../../common/transact-item.type'
import { InventoryReleaseItem } from '../domain/inventory.repository.port'

export function buildInventoryReleaseTransactItems(
  tableName: string,
  items: InventoryReleaseItem[],
  timestamp: string,
  actor: AuditMutationContext,
): TransactItem[] {
  if (items.length > 99) {
    throw new InvalidInputError(
      'Cannot release reservations for orders with more than 99 unique products.',
    )
  }

  return items.map((item) => ({
    Update: {
      TableName: tableName,
      Key: { productId: item.productId },
      UpdateExpression: `SET #availableQuantity = #availableQuantity + :quantity, #reservedQuantity = #reservedQuantity - :quantity, #updatedAt = :updatedAt, ${AUDIT_ACTOR_FIELDS}`,
      ConditionExpression: '#reservedQuantity >= :quantity',
      ExpressionAttributeNames: {
        '#availableQuantity': 'availableQuantity',
        '#reservedQuantity': 'reservedQuantity',
        '#updatedAt': 'updatedAt',
        ...AUDIT_ACTOR_ATTRIBUTE_NAMES,
      },
      ExpressionAttributeValues: {
        ':quantity': item.quantity,
        ':updatedAt': timestamp,
        ...toAuditMutationExpressionValues(actor),
      },
    },
  }))
}
