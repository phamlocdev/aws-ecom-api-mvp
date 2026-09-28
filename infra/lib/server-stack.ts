import * as cdk from 'aws-cdk-lib'
import * as events from 'aws-cdk-lib/aws-events'
import { Construct } from 'constructs'
import { getAwsInfraEnv } from './config/env'
import { HttpApiConstruct } from './constructs/api/http-api.construct'
import { LambdaApiConstruct } from './constructs/api/lambda-api.construct'
import { CognitoConstruct } from './constructs/auth/cognito.construct'
import { DynamoDbConstruct } from './constructs/data/dynamodb.construct'
import { OrdersWorkersConstruct } from './constructs/messaging/orders-workers.construct'
import { SqsConstruct } from './constructs/messaging/sqs.construct'
import { OrderNotificationConstruct } from './constructs/notification/order-notification.construct'
import { SesConstruct } from './constructs/notification/ses.construct'
import { ImageProcessorConstruct } from './constructs/storage/image-processor.construct'
import { S3Construct } from './constructs/storage/s3.construct'

export class ServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const env = getAwsInfraEnv()

    const data = new DynamoDbConstruct(this, 'Data')
    const messaging = new SqsConstruct(this, 'Messaging', {
      visibilityTimeout: cdk.Duration.seconds(90),
    })
    const orderEventsBus = new events.EventBus(this, 'OrderEventsBus', {
      eventBusName: env.orderEventsBusName,
    })

    const auth = new CognitoConstruct(this, 'Auth', {
      callbackUrls: env.callbackUrls,
      logoutUrls: env.logoutUrls,
      hostedUiDomainPrefix: env.hostedUiDomainPrefix,
      googleClientId: env.googleClientId,
      googleClientSecret: env.googleClientSecret,
      emailTrackingTable: data.emailTrackingTable,
      userAccountsTable: data.userAccountsTable,
      userLoginAuditTable: data.userLoginAuditTable,
    })

    const storage = new S3Construct(this, 'Storage', {
      bucketName: env.mediaBucketName,
      clientOrigins: env.clientOrigins,
      publicReadPrefixes: env.mediaPublicReadPrefixes,
    })

    new ImageProcessorConstruct(this, 'ImageProcessor', {
      mediaBucket: storage.mediaBucket,
    })

    const notification = new SesConstruct(this, 'Notification', {
      emailTrackingTable: data.emailTrackingTable,
    })
    notification.grantSendEmail(auth.postConfirmationHandler)
    // Uncomment when re-enabling CUSTOM_EMAIL_SENDER.
    // notification.grantSendEmail(auth.customEmailSenderHandler)

    const apiLambda = new LambdaApiConstruct(this, 'ApiLambda', {
      productsTable: data.productsTable,
      categoriesTable: data.categoriesTable,
      cartsTable: data.cartsTable,
      cartItemsTable: data.cartItemsTable,
      ordersTable: data.ordersTable,
      orderItemsTable: data.orderItemsTable,
      emailTrackingTable: data.emailTrackingTable,
      inventoryTable: data.inventoryTable,
      userAccountsTable: data.userAccountsTable,
      userLoginAuditTable: data.userLoginAuditTable,
      mediaBucket: storage.mediaBucket,
      placeOrderQueue: messaging.placeOrderQueue,
      orderEventsBus,
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
    })
    notification.grantSendEmail(apiLambda.apiHandler)

    const orderNotification = new OrderNotificationConstruct(this, 'OrderNotification', {
      eventBus: orderEventsBus,
      ordersTable: data.ordersTable,
      orderItemsTable: data.orderItemsTable,
      emailTrackingTable: data.emailTrackingTable,
      eventConsumerIdempotencyTable: data.eventConsumerIdempotencyTable,
    })
    notification.grantSendEmail(orderNotification.orderNotificationWorker)

    new OrdersWorkersConstruct(this, 'OrdersWorkers', {
      productsTable: data.productsTable,
      cartsTable: data.cartsTable,
      cartItemsTable: data.cartItemsTable,
      ordersTable: data.ordersTable,
      orderItemsTable: data.orderItemsTable,
      inventoryTable: data.inventoryTable,
      placeOrderQueue: messaging.placeOrderQueue,
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
    })

    const api = new HttpApiConstruct(this, 'Api', {
      apiHandler: apiLambda.apiHandler,
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
      clientOrigins: env.clientOrigins,
    })

    new cdk.CfnOutput(this, 'ProductsTableName', { value: data.productsTable.tableName })

    new cdk.CfnOutput(this, 'OrdersTableName', { value: data.ordersTable.tableName })

    new cdk.CfnOutput(this, 'EmailTrackingTableName', {
      value: data.emailTrackingTable.tableName,
    })

    new cdk.CfnOutput(this, 'EventConsumerIdempotencyTableName', {
      value: data.eventConsumerIdempotencyTable.tableName,
    })

    new cdk.CfnOutput(this, 'UserAccountsTableName', {
      value: data.userAccountsTable.tableName,
    })

    new cdk.CfnOutput(this, 'UserLoginAuditTableName', {
      value: data.userLoginAuditTable.tableName,
    })

    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: auth.userPool.userPoolId,
    })

    new cdk.CfnOutput(this, 'CognitoClientId', {
      value: auth.userPoolClient.userPoolClientId,
    })

    new cdk.CfnOutput(this, 'CognitoIssuer', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${auth.userPool.userPoolId}`,
    })

    new cdk.CfnOutput(this, 'HostedUiDomain', {
      value: auth.userPoolDomain.baseUrl(),
    })

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.apiBaseUrl,
    })

    new cdk.CfnOutput(this, 'PlaceOrderQueueUrl', {
      value: messaging.placeOrderQueue.queueUrl,
    })

    new cdk.CfnOutput(this, 'OrderEventsBusName', {
      value: orderEventsBus.eventBusName,
    })

    new cdk.CfnOutput(this, 'MediaBucketName', {
      value: storage.mediaBucket.bucketName,
    })

    new cdk.CfnOutput(this, 'MediaDistributionId', {
      value: storage.mediaDistribution.distributionId,
    })

    new cdk.CfnOutput(this, 'MediaDistributionDomainName', {
      value: storage.mediaDistribution.distributionDomainName,
    })

    new cdk.CfnOutput(this, 'MediaPublicBaseUrl', {
      value: storage.mediaPublicBaseUrl,
    })
  }
}
