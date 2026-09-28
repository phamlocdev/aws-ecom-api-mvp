import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as events from 'aws-cdk-lib/aws-events'
import * as eventTargets from 'aws-cdk-lib/aws-events-targets'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import { Construct } from 'constructs'
import { getAwsInfraEnv } from '../../config/env'
import {
  copyDirectoryIntoBundle,
  createNodejsBundling,
  removeGeneratedSourceArtifacts,
  sourceEntryPath,
} from '../../shared/lambda-bundling'

export interface OrderNotificationConstructProps {
  eventBus: events.IEventBus
  ordersTable: dynamodb.ITable
  orderItemsTable: dynamodb.ITable
  emailTrackingTable: dynamodb.ITable
  eventConsumerIdempotencyTable: dynamodb.ITable
}

export class OrderNotificationConstruct extends Construct {
  readonly orderNotificationWorker: nodejs.NodejsFunction
  readonly analyticsDemoWorker: nodejs.NodejsFunction
  readonly fulfillmentDemoWorker: nodejs.NodejsFunction
  readonly cancellationInventoryDemoWorker: nodejs.NodejsFunction
  readonly cancellationAccountingDemoWorker: nodejs.NodejsFunction

  constructor(scope: Construct, id: string, props: OrderNotificationConstructProps) {
    super(scope, id)
    const infraEnv = getAwsInfraEnv()

    this.orderNotificationWorker = new nodejs.NodejsFunction(this, 'Worker', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('order-notification-worker.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling: createNodejsBundling({
        afterBundling: (inputDir, outputDir) => [
          ...removeGeneratedSourceArtifacts(),
          ...copyDirectoryIntoBundle(inputDir, outputDir, 'src/mail/templates', 'templates'),
        ],
      }),
      environment: {
        ORDERS_TABLE: props.ordersTable.tableName,
        ORDER_ITEMS_TABLE: props.orderItemsTable.tableName,
        EMAIL_TRACKING_TABLE: props.emailTrackingTable.tableName,
        SES_ENABLED: String(infraEnv.sesEnabled),
        SES_FROM_EMAIL: infraEnv.sesFromEmail ?? '',
        SES_VERIFIED_RECIPIENTS: infraEnv.sesVerifiedRecipients.join(','),
        SES_CONFIGURATION_SET_NAME: infraEnv.sesConfigurationSetName ?? '',
      },
    })

    this.analyticsDemoWorker = new nodejs.NodejsFunction(this, 'AnalyticsDemoWorker', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('order-shipped-analytics-demo-worker.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      bundling: createNodejsBundling({
        afterBundling: () => removeGeneratedSourceArtifacts(),
      }),
      environment: {
        EVENT_CONSUMER_IDEMPOTENCY_TABLE: props.eventConsumerIdempotencyTable.tableName,
      },
    })

    this.fulfillmentDemoWorker = new nodejs.NodejsFunction(this, 'FulfillmentDemoWorker', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('order-shipped-fulfillment-demo-worker.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      bundling: createNodejsBundling({
        afterBundling: () => removeGeneratedSourceArtifacts(),
      }),
      environment: {
        EVENT_CONSUMER_IDEMPOTENCY_TABLE: props.eventConsumerIdempotencyTable.tableName,
      },
    })

    this.cancellationInventoryDemoWorker = new nodejs.NodejsFunction(
      this,
      'CancellationInventoryDemoWorker',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: sourceEntryPath('order-cancelled-inventory-demo-worker.ts'),
        handler: 'handler',
        timeout: cdk.Duration.seconds(30),
        memorySize: 128,
        bundling: createNodejsBundling({
          afterBundling: () => removeGeneratedSourceArtifacts(),
        }),
        environment: {
          EVENT_CONSUMER_IDEMPOTENCY_TABLE: props.eventConsumerIdempotencyTable.tableName,
        },
      },
    )

    this.cancellationAccountingDemoWorker = new nodejs.NodejsFunction(
      this,
      'CancellationAccountingDemoWorker',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: sourceEntryPath('order-cancelled-accounting-demo-worker.ts'),
        handler: 'handler',
        timeout: cdk.Duration.seconds(30),
        memorySize: 128,
        bundling: createNodejsBundling({
          afterBundling: () => removeGeneratedSourceArtifacts(),
        }),
        environment: {
          EVENT_CONSUMER_IDEMPOTENCY_TABLE: props.eventConsumerIdempotencyTable.tableName,
        },
      },
    )

    const eventTargetDlq = new sqs.Queue(this, 'OrderNotificationEventTargetDlq', {
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    const orderShippedNotificationQueue = this.createWorkerQueue('OrderShippedNotification')
    const orderShippedAnalyticsQueue = this.createWorkerQueue('OrderShippedAnalytics')
    const orderShippedFulfillmentQueue = this.createWorkerQueue('OrderShippedFulfillment')
    const orderCancelledNotificationQueue = this.createWorkerQueue('OrderCancelledNotification')
    const orderCancelledInventoryQueue = this.createWorkerQueue('OrderCancelledInventory')
    const orderCancelledAccountingQueue = this.createWorkerQueue('OrderCancelledAccounting')

    const sqsTargetOptions: eventTargets.SqsQueueProps = {
      retryAttempts: 3,
      maxEventAge: cdk.Duration.hours(2),
      deadLetterQueue: eventTargetDlq,
    }

    this.addWorkerEventSource(this.orderNotificationWorker, orderShippedNotificationQueue)
    this.addWorkerEventSource(this.orderNotificationWorker, orderCancelledNotificationQueue)
    this.addWorkerEventSource(this.analyticsDemoWorker, orderShippedAnalyticsQueue)
    this.addWorkerEventSource(this.fulfillmentDemoWorker, orderShippedFulfillmentQueue)
    this.addWorkerEventSource(this.cancellationInventoryDemoWorker, orderCancelledInventoryQueue)
    this.addWorkerEventSource(this.cancellationAccountingDemoWorker, orderCancelledAccountingQueue)

    props.ordersTable.grantReadData(this.orderNotificationWorker)
    props.orderItemsTable.grantReadData(this.orderNotificationWorker)
    props.emailTrackingTable.grantReadWriteData(this.orderNotificationWorker)
    props.eventConsumerIdempotencyTable.grantReadWriteData(this.analyticsDemoWorker)
    props.eventConsumerIdempotencyTable.grantReadWriteData(this.fulfillmentDemoWorker)
    props.eventConsumerIdempotencyTable.grantReadWriteData(this.cancellationInventoryDemoWorker)
    props.eventConsumerIdempotencyTable.grantReadWriteData(this.cancellationAccountingDemoWorker)

    new events.Rule(this, 'OrderShippedRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['ecommerce.orders'],
        detailType: ['OrderShipped'],
      },
      targets: [
        new eventTargets.SqsQueue(orderShippedNotificationQueue.queue, sqsTargetOptions),
        new eventTargets.SqsQueue(orderShippedAnalyticsQueue.queue, sqsTargetOptions),
        new eventTargets.SqsQueue(orderShippedFulfillmentQueue.queue, sqsTargetOptions),
      ],
    })

    const orderCancelledEventPattern: events.EventPattern = {
      source: ['ecommerce.orders'],
      detailType: ['OrderCancelled'],
    }

    new events.Rule(this, 'OrderCancelledInventoryRule', {
      eventBus: props.eventBus,
      eventPattern: orderCancelledEventPattern,
      targets: [new eventTargets.SqsQueue(orderCancelledInventoryQueue.queue, sqsTargetOptions)],
    })

    new events.Rule(this, 'OrderCancelledAccountingRule', {
      eventBus: props.eventBus,
      eventPattern: {
        ...orderCancelledEventPattern,
        detail: {
          totalAmount: [{ numeric: ['>=', 10_000_000] }],
        },
      },
      targets: [new eventTargets.SqsQueue(orderCancelledAccountingQueue.queue, sqsTargetOptions)],
    })

    new events.Rule(this, 'OrderCancelledNotificationRule', {
      eventBus: props.eventBus,
      eventPattern: orderCancelledEventPattern,
      targets: [new eventTargets.SqsQueue(orderCancelledNotificationQueue.queue, sqsTargetOptions)],
    })
  }

  private createWorkerQueue(idPrefix: string): { queue: sqs.Queue; dlq: sqs.Queue } {
    const dlq = new sqs.Queue(this, `${idPrefix}Dlq`, {
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    const queue = new sqs.Queue(this, `${idPrefix}Queue`, {
      visibilityTimeout: cdk.Duration.seconds(30),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    })

    return { queue, dlq }
  }

  private addWorkerEventSource(
    worker: nodejs.NodejsFunction,
    queuePair: { queue: sqs.Queue },
  ): void {
    worker.addEventSource(
      new lambdaEventSources.SqsEventSource(queuePair.queue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    )
    queuePair.queue.grantConsumeMessages(worker)
  }
}
