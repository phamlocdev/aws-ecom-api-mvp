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
  readonly auditLogDlq: sqs.Queue
  readonly auditLogQueue: sqs.Queue
  readonly orderAuditLogDlq: sqs.Queue
  readonly orderAuditLogQueue: sqs.Queue

  constructor(scope: Construct, id: string, props: SqsConstructProps = {}) {
    super(scope, id)

    const infraEnv = getAwsInfraEnv()
    const visibilityTimeout = props.visibilityTimeout ?? cdk.Duration.seconds(60)
    const auditVisibilityTimeout = cdk.Duration.seconds(60)

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

    this.auditLogDlq = new sqs.Queue(this, 'AuditLogDlq', {
      queueName: infraEnv.auditLogDlqName,
      fifo: true,
      contentBasedDeduplication: false,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: auditVisibilityTimeout,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    this.auditLogQueue = new sqs.Queue(this, 'AuditLogQueue', {
      queueName: infraEnv.auditLogQueueName,
      fifo: true,
      contentBasedDeduplication: false,
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      visibilityTimeout: auditVisibilityTimeout,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deadLetterQueue: {
        queue: this.auditLogDlq,
        maxReceiveCount: 3,
      },
    })
    this.orderAuditLogDlq = this.auditLogDlq
    this.orderAuditLogQueue = this.auditLogQueue
  }
}
