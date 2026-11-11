import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as events from 'aws-cdk-lib/aws-events'
import * as eventTargets from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources'
import { Construct } from 'constructs'
import { getAwsInfraEnv } from '../../config/env'
import {
  createNodejsBundling,
  removeGeneratedSourceArtifacts,
  sourceEntryPath,
} from '../../shared/lambda-bundling'

export interface OrdersWorkersConstructProps {
  productsTable: dynamodb.ITable
  cartsTable: dynamodb.ITable
  cartItemsTable: dynamodb.ITable
  ordersTable: dynamodb.ITable
  orderItemsTable: dynamodb.ITable
  inventoryTable: dynamodb.ITable
  placeOrderQueue: sqs.IQueue
  userPoolId: string
  userPoolClientId: string
}

export class OrdersWorkersConstruct extends Construct {
  readonly placeOrderWorker: nodejs.NodejsFunction
  readonly reservationExpiryPoller: nodejs.NodejsFunction

  constructor(scope: Construct, id: string, props: OrdersWorkersConstructProps) {
    super(scope, id)
    const infraEnv = getAwsInfraEnv()

    const sharedEnvironment = {
      PRODUCTS_TABLE: props.productsTable.tableName,
      CARTS_TABLE: props.cartsTable.tableName,
      CART_ITEMS_TABLE: props.cartItemsTable.tableName,
      ORDERS_TABLE: props.ordersTable.tableName,
      ORDER_ITEMS_TABLE: props.orderItemsTable.tableName,
      INVENTORY_TABLE: props.inventoryTable.tableName,
      COGNITO_USER_POOL_ID: props.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      CLIENT_CORS_ORIGINS: infraEnv.clientOrigins.join(','),
      FRONT_END_PAYMENT_RETURN_URL: infraEnv.frontendPaymentReturnUrl,
      VNPAY_TMN_CODE: infraEnv.vnpayTmnCode,
      VNPAY_SECURE_SECRET: infraEnv.vnpaySecureSecret,
      PAYMENT_CONFIRMATION_SECONDS_TIMEOUT: String(infraEnv.paymentConfirmationTimeoutSeconds),
      VNPAY_PAYMENT_URL: infraEnv.vnpayPaymentUrl,
      VNPAY_RETURN_URL: infraEnv.vnpayReturnUrl,
      VNPAY_IPN_URL: infraEnv.vnpayIpnUrl,
      VNPAY_LOCALE: infraEnv.vnpayLocale,
      VNPAY_ORDER_TYPE: infraEnv.vnpayOrderType,
      VNPAY_API_IP_ADDR: infraEnv.vnpayApiIpAddr,
      // PLACE_ORDER_DELAY_MS: '10000',
    }

    this.placeOrderWorker = new nodejs.NodejsFunction(this, 'PlaceOrderWorker', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('workers', 'order-worker.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      bundling: createNodejsBundling({
        afterBundling: () => removeGeneratedSourceArtifacts(),
      }),
      environment: sharedEnvironment,
    })

    this.reservationExpiryPoller = new nodejs.NodejsFunction(this, 'ReservationExpiryPoller', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('workers', 'order-expiry-poller.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      bundling: createNodejsBundling({
        afterBundling: () => removeGeneratedSourceArtifacts(),
      }),
      environment: sharedEnvironment,
    })

    this.placeOrderWorker.addEventSource(
      new lambdaEventSources.SqsEventSource(props.placeOrderQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    )

    new events.Rule(this, 'ReservationExpiryPollerSchedule', {
      schedule: events.Schedule.rate(
        cdk.Duration.minutes(infraEnv.reservationExpiryPollerScheduleMinutes),
      ),
      targets: [new eventTargets.LambdaFunction(this.reservationExpiryPoller)],
    })

    const workerFunctions = [this.placeOrderWorker, this.reservationExpiryPoller]
    const tables = [
      props.productsTable,
      props.cartsTable,
      props.cartItemsTable,
      props.ordersTable,
      props.orderItemsTable,
      props.inventoryTable,
    ]

    tables.forEach((table) => {
      workerFunctions.forEach((worker) => table.grantReadWriteData(worker))
    })

    workerFunctions.forEach((worker) => {
      worker.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['dynamodb:TransactWriteItems'],
          resources: [props.ordersTable.tableArn, props.inventoryTable.tableArn],
        }),
      )
    })

    props.placeOrderQueue.grantConsumeMessages(this.placeOrderWorker)
  }
}
