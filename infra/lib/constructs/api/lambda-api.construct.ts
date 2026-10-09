import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as events from 'aws-cdk-lib/aws-events'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import { Construct } from 'constructs'
import { getAwsInfraEnv } from '../../config/env'
import {
  copyDirectoryIntoBundle,
  createNodejsBundling,
  removeGeneratedSourceArtifacts,
  sourceEntryPath,
} from '../../shared/lambda-bundling'

export interface LambdaApiConstructProps {
  productsTable: dynamodb.ITable
  categoriesTable: dynamodb.ITable
  cartsTable: dynamodb.ITable
  cartItemsTable: dynamodb.ITable
  ordersTable: dynamodb.ITable
  auditLogTable: dynamodb.ITable
  orderItemsTable: dynamodb.ITable
  emailTrackingTable: dynamodb.ITable
  inventoryTable: dynamodb.ITable
  userAccountsTable: dynamodb.ITable
  userLoginAuditTable: dynamodb.ITable
  mediaBucket: s3.IBucket
  placeOrderQueue: sqs.IQueue
  orderEventsBus: events.IEventBus
  userPoolId: string
  userPoolClientId: string
}

export class LambdaApiConstruct extends Construct {
  readonly apiHandler: nodejs.NodejsFunction

  constructor(scope: Construct, id: string, props: LambdaApiConstructProps) {
    super(scope, id)
    const infraEnv = getAwsInfraEnv()

    this.apiHandler = new nodejs.NodejsFunction(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('lambda.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: createNodejsBundling({
        afterBundling: (inputDir, outputDir) => [
          ...removeGeneratedSourceArtifacts(),
          ...copyDirectoryIntoBundle(inputDir, outputDir, 'src/mail/templates', 'templates'),
        ],
      }),
      environment: {
        PRODUCTS_TABLE: props.productsTable.tableName,
        CATEGORIES_TABLE: props.categoriesTable.tableName,
        CARTS_TABLE: props.cartsTable.tableName,
        CART_ITEMS_TABLE: props.cartItemsTable.tableName,
        ORDERS_TABLE: props.ordersTable.tableName,
        AUDIT_LOG_TABLE: props.auditLogTable.tableName,
        ORDER_ITEMS_TABLE: props.orderItemsTable.tableName,
        EMAIL_TRACKING_TABLE: props.emailTrackingTable.tableName,
        INVENTORY_TABLE: props.inventoryTable.tableName,
        USER_ACCOUNTS_TABLE: props.userAccountsTable.tableName,
        USER_LOGIN_AUDIT_TABLE: props.userLoginAuditTable.tableName,
        MEDIA_BUCKET_NAME: props.mediaBucket.bucketName,
        PRODUCT_IMAGE_MAX_COUNT: String(infraEnv.productImageMaxCount),
        MEDIA_READ_URL_TTL_SECONDS: String(infraEnv.mediaReadUrlTtlSeconds),
        UPLOAD_MAX_FILE_SIZE_BYTES: String(infraEnv.uploadMaxFileSizeBytes),
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClientId,
        CLIENT_CORS_ORIGINS: infraEnv.clientOrigins.join(','),
        FRONT_END_PAYMENT_RETURN_URL: infraEnv.frontendPaymentReturnUrl,
        PLACE_ORDER_QUEUE_URL: props.placeOrderQueue.queueUrl,
        ORDER_EVENTS_BUS_NAME: props.orderEventsBus.eventBusName,
        PAYMENT_CONFIRMATION_SECONDS_TIMEOUT: String(infraEnv.paymentConfirmationTimeoutSeconds),
        VNPAY_TMN_CODE: infraEnv.vnpayTmnCode,
        VNPAY_SECURE_SECRET: infraEnv.vnpaySecureSecret,
        VNPAY_PAYMENT_URL: infraEnv.vnpayPaymentUrl,
        VNPAY_RETURN_URL: infraEnv.vnpayReturnUrl,
        VNPAY_IPN_URL: infraEnv.vnpayIpnUrl,
        VNPAY_LOCALE: infraEnv.vnpayLocale,
        VNPAY_ORDER_TYPE: infraEnv.vnpayOrderType,
        VNPAY_API_IP_ADDR: infraEnv.vnpayApiIpAddr,
        SES_ENABLED: String(infraEnv.sesEnabled),
        SES_FROM_EMAIL: infraEnv.sesFromEmail ?? '',
        SES_VERIFIED_RECIPIENTS: infraEnv.sesVerifiedRecipients.join(','),
        SES_CONFIGURATION_SET_NAME: infraEnv.sesConfigurationSetName ?? '',
      },
    })

    props.productsTable.grantReadWriteData(this.apiHandler)
    props.categoriesTable.grantReadWriteData(this.apiHandler)
    props.cartsTable.grantReadWriteData(this.apiHandler)
    props.cartItemsTable.grantReadWriteData(this.apiHandler)
    props.ordersTable.grantReadWriteData(this.apiHandler)
    props.auditLogTable.grantReadData(this.apiHandler)
    props.orderItemsTable.grantReadWriteData(this.apiHandler)
    props.emailTrackingTable.grantReadWriteData(this.apiHandler)
    props.inventoryTable.grantReadWriteData(this.apiHandler)
    props.userAccountsTable.grantReadWriteData(this.apiHandler)
    props.userLoginAuditTable.grantReadWriteData(this.apiHandler)
    props.placeOrderQueue.grantSendMessages(this.apiHandler)
    props.orderEventsBus.grantPutEventsTo(this.apiHandler)
    this.apiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
        resources: [props.mediaBucket.arnForObjects('*')],
      }),
    )

    this.apiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:TransactWriteItems'],
        resources: [
          props.ordersTable.tableArn,
          props.productsTable.tableArn,
          props.inventoryTable.tableArn,
        ],
      }),
    )

    this.apiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminListGroupsForUser',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:ListUsers',
        ],
        resources: [
          `arn:${cdk.Stack.of(this).partition}:cognito-idp:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:userpool/${props.userPoolId}`,
        ],
      }),
    )
  }
}
