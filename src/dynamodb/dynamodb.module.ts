import { Global, Module } from '@nestjs/common'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from './dynamodb.service'

@Global()
@Module({
  providers: [DynamoDbService, DynamoTablesService],
  exports: [DynamoDbService, DynamoTablesService],
})
export class DynamoDbModule {}
