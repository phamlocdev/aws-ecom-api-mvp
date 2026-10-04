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

type AuditEntityType = 'ORDER' | 'PRODUCT' | 'CATEGORY' | 'INVENTORY' | 'USER_ACCOUNT'

interface AuditedSource {
  entityType: AuditEntityType
  idField: string
  table: dynamodb.Table
}

export interface AuditLogConstructProps {
  auditLogTable: dynamodb.ITable
  auditLogQueue: sqs.IQueue
  auditLogDlq: sqs.IQueue
  sources: AuditedSource[]
}

export class AuditLogConstruct extends Construct {
  readonly auditLogProcessor: nodejs.NodejsFunction

  constructor(scope: Construct, id: string, props: AuditLogConstructProps) {
    super(scope, id)

    for (const source of props.sources) {
      if (!source.table.tableStreamArn) {
        throw new Error(
          `${source.table.tableName} stream must be enabled for audit log processing.`,
        )
      }
    }

    this.auditLogProcessor = new nodejs.NodejsFunction(this, 'Processor', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('audit-log-processor.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling: createNodejsBundling({
        afterBundling: () => removeGeneratedSourceArtifacts(),
      }),
      environment: {
        AUDIT_LOG_TABLE: props.auditLogTable.tableName,
      },
    })

    this.auditLogProcessor.addEventSource(
      new lambdaEventSources.SqsEventSource(props.auditLogQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    )

    props.auditLogQueue.grantConsumeMessages(this.auditLogProcessor)
    props.auditLogTable.grantWriteData(this.auditLogProcessor)

    const pipeRole = new iam.Role(this, 'PipeRole', {
      assumedBy: new iam.ServicePrincipal('pipes.amazonaws.com'),
    })

    for (const source of props.sources) {
      pipeRole.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            'dynamodb:DescribeStream',
            'dynamodb:GetRecords',
            'dynamodb:GetShardIterator',
            'dynamodb:ListStreams',
          ],
          resources: [source.table.tableStreamArn!],
        }),
      )
    }
    pipeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [props.auditLogQueue.queueArn],
      }),
    )

    for (const source of props.sources) {
      new pipes.CfnPipe(this, `${source.entityType}StreamToAuditQueuePipe`, {
        roleArn: pipeRole.roleArn,
        source: source.table.tableStreamArn!,
        target: props.auditLogQueue.queueArn,
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
                  eventName: ['INSERT', 'MODIFY', 'REMOVE'],
                }),
              },
            ],
          },
        },
        targetParameters: {
          inputTemplate: `{"entityType":"${source.entityType}","sourceTable":"${source.table.tableName}","record": <aws.pipes.event.json>}`,
          sqsQueueParameters: {
            messageDeduplicationId: '$.eventID',
            messageGroupId: `$.dynamodb.Keys.${source.idField}.S`,
          },
        },
      })
    }
  }
}
