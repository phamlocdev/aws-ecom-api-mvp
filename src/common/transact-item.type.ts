export type TransactItem = {
  Put?: {
    TableName: string
    Item: Record<string, unknown>
    ConditionExpression?: string
    ExpressionAttributeNames?: Record<string, string>
    ExpressionAttributeValues?: Record<string, unknown>
  }
  Update?: {
    TableName: string
    Key: Record<string, unknown>
    UpdateExpression: string
    ConditionExpression?: string
    ExpressionAttributeNames?: Record<string, string>
    ExpressionAttributeValues?: Record<string, unknown>
  }
  Delete?: {
    TableName: string
    Key: Record<string, unknown>
    ConditionExpression?: string
    ExpressionAttributeNames?: Record<string, string>
    ExpressionAttributeValues?: Record<string, unknown>
  }
  ConditionCheck?: {
    TableName: string
    Key: Record<string, unknown>
    ConditionExpression: string
    ExpressionAttributeNames?: Record<string, string>
    ExpressionAttributeValues?: Record<string, unknown>
  }
}
