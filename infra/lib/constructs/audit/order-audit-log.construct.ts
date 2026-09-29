import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as pipes from 'aws-cdk-lib/aws-pipes'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import { Construct } from 'constructs'
import {
  createNodejsBundling,
  removeGeneratedSourceArtifacts,
  sourceEntryPath,
} from '../../shared/lambda-bundling'

export interface OrderAuditLogConstructProps {
  ordersTable: dynamodb.Table
  orderAuditLogTable: dynamodb.ITable
  orderAuditLogQueue: sqs.IQueue
  orderAuditLogDlq: sqs.IQueue
}

export class OrderAuditLogConstruct extends Construct {
  readonly orderAuditLogProcessor: nodejs.NodejsFunction

  constructor(scope: Construct, id: string, props: OrderAuditLogConstructProps) {
    super(scope, id)

    if (!props.ordersTable.tableStreamArn) {
      throw new Error('OrdersTable stream must be enabled for order audit log processing.')
    }

    this.orderAuditLogProcessor = new nodejs.NodejsFunction(this, 'Processor', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('order-audit-log-processor.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling: createNodejsBundling({
        afterBundling: () => removeGeneratedSourceArtifacts(),
      }),
      environment: {
        ORDER_AUDIT_LOG_TABLE: props.orderAuditLogTable.tableName,
      },
    })

    this.orderAuditLogProcessor.addEventSource(
      new lambdaEventSources.SqsEventSource(props.orderAuditLogQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    )

    props.orderAuditLogQueue.grantConsumeMessages(this.orderAuditLogProcessor)
    props.orderAuditLogTable.grantWriteData(this.orderAuditLogProcessor)

    const pipeRole = new iam.Role(this, 'PipeRole', {
      assumedBy: new iam.ServicePrincipal('pipes.amazonaws.com'),
    })

    pipeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
          'dynamodb:ListStreams',
        ],
        resources: [props.ordersTable.tableStreamArn],
      }),
    )
    pipeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [props.orderAuditLogQueue.queueArn],
      }),
    )

    new pipes.CfnPipe(this, 'OrdersStreamToAuditQueuePipe', {
      roleArn: pipeRole.roleArn,
      source: props.ordersTable.tableStreamArn,
      target: props.orderAuditLogQueue.queueArn,
      sourceParameters: {
        dynamoDbStreamParameters: {
          batchSize: 10,
          maximumBatchingWindowInSeconds: 5,
          maximumRecordAgeInSeconds: 60 * 60 * 6,
          maximumRetryAttempts: 3,
          onPartialBatchItemFailure: 'AUTOMATIC_BISECT',
          startingPosition: 'LATEST',
        },
        filterCriteria: {
          filters: [
            {
              pattern: JSON.stringify({
                eventName: ['INSERT', 'MODIFY'],
              }),
            },
          ],
        },
      },
      targetParameters: {
        inputTemplate: '{"record": <aws.pipes.event.json>}',
        sqsQueueParameters: {
          messageDeduplicationId: '$.eventID',
          messageGroupId: '$.dynamodb.Keys.orderId.S',
        },
      },
    })
  }
}
