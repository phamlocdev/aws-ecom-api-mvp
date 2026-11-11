import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import {
  createDynamoDbClient,
  createDynamoDbDocumentClient,
  getDynamoDbSettings,
} from './dynamodb.config'

@Injectable()
export class DynamoDbService {
  readonly documentClient: DynamoDBDocumentClient

  private readonly client
  private readonly healthCheckTableName: string

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    @Inject(DynamoTablesService) dynamoTables: DynamoTablesService,
  ) {
    const settings = getDynamoDbSettings({
      AWS_REGION: configService.get<string>('AWS_REGION'),
      AWS_DEFAULT_REGION: configService.get<string>('AWS_DEFAULT_REGION'),
    })
    this.client = createDynamoDbClient(settings)
    this.documentClient = createDynamoDbDocumentClient(settings)
    this.healthCheckTableName = dynamoTables.products
  }

  async checkConnection(): Promise<void> {
    await this.client.send(new DescribeTableCommand({ TableName: this.healthCheckTableName }))
  }
}
