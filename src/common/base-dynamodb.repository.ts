import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  QueryCommandInput,
  QueryCommandOutput,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { ConflictError } from './domain-error'
import { isConditionalCheckFailure, isTransactionCanceled } from './dynamodb-errors'
import { TransactItem } from './transact-item.type'
import { DynamoDbService } from '../dynamodb/dynamodb.service'

export abstract class BaseDynamoDbRepository<TEntity> {
  protected abstract readonly tableName: string
  protected abstract readonly primaryKeyName: string
  protected abstract fromRecord(item: Record<string, unknown>): TEntity
  protected abstract toRecord(entity: TEntity): Record<string, unknown>

  constructor(protected readonly dynamoDbService: DynamoDbService) {}

  async findById(id: string): Promise<TEntity | null> {
    const item = await this.getItem(this.tableName, { [this.primaryKeyName]: id })
    return item ? this.fromRecord(item) : null
  }

  async save(entity: TEntity): Promise<void> {
    await this.putRecord(this.tableName, this.toRecord(entity))
  }

  protected async getItem<T = Record<string, unknown>>(
    tableName: string,
    key: Record<string, unknown>,
  ): Promise<T | null> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({ TableName: tableName, Key: key }),
    )
    return (response.Item as T) ?? null
  }

  protected async putRecord(
    tableName: string,
    item: Record<string, unknown>,
    conditionExpression?: string,
    expressionAttributeNames?: Record<string, string>,
  ): Promise<void> {
    await this.dynamoDbService.documentClient.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ...(conditionExpression && {
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: expressionAttributeNames,
        }),
      }),
    )
  }

  protected async updateItem(
    tableName: string,
    key: Record<string, unknown>,
    updateExpression: string,
    expressionAttributeNames: Record<string, string>,
    expressionAttributeValues: Record<string, unknown>,
    conditionExpression?: string,
    returnValues?: 'ALL_NEW' | 'UPDATED_NEW' | 'ALL_OLD' | 'UPDATED_OLD' | 'NONE',
  ): Promise<Record<string, unknown> | null> {
    const response = await this.dynamoDbService.documentClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ...(conditionExpression && { ConditionExpression: conditionExpression }),
        ...(returnValues && { ReturnValues: returnValues }),
      }),
    )
    return (response.Attributes as Record<string, unknown>) ?? null
  }

  protected async queryItems(input: QueryCommandInput): Promise<QueryCommandOutput> {
    return this.dynamoDbService.documentClient.send(new QueryCommand(input))
  }

  protected async deleteItem(
    tableName: string,
    key: Record<string, unknown>,
    conditionExpression?: string,
    expressionAttributeNames?: Record<string, string>,
  ): Promise<void> {
    await this.dynamoDbService.documentClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: key,
        ...(conditionExpression && {
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: expressionAttributeNames,
        }),
      }),
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async executeTransaction(items: TransactItem[]): Promise<void> {
    try {
      await this.dynamoDbService.documentClient.send(
        new TransactWriteCommand({ TransactItems: items as any }),
      )
    } catch (error) {
      if (isConditionalCheckFailure(error) || isTransactionCanceled(error)) {
        throw new ConflictError('Transaction was rejected due to a condition failure.')
      }
      throw error
    }
  }
}

