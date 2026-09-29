import * as cdk from 'aws-cdk-lib'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import { Construct } from 'constructs'
import { getAwsInfraEnv } from '../../config/env'

export interface SqsConstructProps {
  visibilityTimeout?: cdk.Duration
}

export class SqsConstruct extends Construct {
  readonly placeOrderDlq: sqs.Queue
  readonly placeOrderQueue: sqs.Queue
  readonly orderAuditLogDlq: sqs.Queue
  readonly orderAuditLogQueue: sqs.Queue

  constructor(scope: Construct, id: string, props: SqsConstructProps = {}) {
    super(scope, id)

    const infraEnv = getAwsInfraEnv()
    const visibilityTimeout = props.visibilityTimeout ?? cdk.Duration.seconds(60)

    this.placeOrderDlq = new sqs.Queue(this, 'PlaceOrderDlq', {
      queueName: infraEnv.placeOrderDlqName,
      fifo: true,
      contentBasedDeduplication: false,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.placeOrderQueue = new sqs.Queue(this, 'PlaceOrderQueue', {
      queueName: infraEnv.placeOrderQueueName,
      fifo: true,
      contentBasedDeduplication: false,
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      visibilityTimeout,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deadLetterQueue: {
        queue: this.placeOrderDlq,
        maxReceiveCount: 3,
      },
    })

    this.orderAuditLogDlq = new sqs.Queue(this, 'OrderAuditLogDlq', {
      queueName: infraEnv.orderAuditLogDlqName,
      fifo: true,
      contentBasedDeduplication: false,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.orderAuditLogQueue = new sqs.Queue(this, 'OrderAuditLogQueue', {
      queueName: infraEnv.orderAuditLogQueueName,
      fifo: true,
      contentBasedDeduplication: false,
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      visibilityTimeout,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deadLetterQueue: {
        queue: this.orderAuditLogDlq,
        maxReceiveCount: 3,
      },
    })
  }
}
