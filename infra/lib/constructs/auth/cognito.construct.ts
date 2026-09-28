import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
// Uncomment when re-enabling CUSTOM_EMAIL_SENDER.
// import * as kms from 'aws-cdk-lib/aws-kms'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import { Construct } from 'constructs'
import { getAwsInfraEnv } from '../../config/env'
import {
  copyDirectoryIntoBundle,
  createNodejsBundling,
  removeGeneratedSourceArtifacts,
  sourceEntryPath,
} from '../../shared/lambda-bundling'
import { InfraRole } from '../../shared/roles'
import { createUserPoolGroups } from './cognito-groups'

export interface CognitoConstructProps {
  callbackUrls: string[]
  logoutUrls: string[]
  hostedUiDomainPrefix: string
  googleClientId?: string
  googleClientSecret?: string
  emailTrackingTable: dynamodb.ITable
  userAccountsTable: dynamodb.ITable
  userLoginAuditTable: dynamodb.ITable
}

export class CognitoConstruct extends Construct {
  readonly userPool: cognito.UserPool
  readonly userPoolClient: cognito.UserPoolClient
  readonly userPoolDomain: cognito.UserPoolDomain
  readonly postConfirmationHandler: nodejs.NodejsFunction
  readonly preTokenGenerationHandler: nodejs.NodejsFunction
  readonly preSignUpHandler: nodejs.NodejsFunction
  readonly preAuthenticationHandler: nodejs.NodejsFunction
  readonly postAuthenticationHandler: nodejs.NodejsFunction
  // Uncomment when re-enabling CUSTOM_EMAIL_SENDER.
  // readonly customEmailSenderHandler: nodejs.NodejsFunction

  constructor(scope: Construct, id: string, props: CognitoConstructProps) {
    super(scope, id)
    const infraEnv = getAwsInfraEnv()
    if (infraEnv.sesEnabled && !infraEnv.sesFromEmail) {
      throw new Error('SES_FROM_EMAIL is required for Cognito default emails sent through SES.')
    }
    const userPoolEmail = infraEnv.sesEnabled
      ? cognito.UserPoolEmail.withSES({
          fromEmail: infraEnv.sesFromEmail!,
          sesVerifiedDomain: infraEnv.sesVerifiedDomainName,
          configurationSetName: infraEnv.sesConfigurationSetName,
        })
      : cognito.UserPoolEmail.withCognito()

    // Uncomment when re-enabling CUSTOM_EMAIL_SENDER.
    // const customSenderKmsKey = new kms.Key(this, 'CustomSenderKmsKey', {
    //   alias: `alias/${infraEnv.hostedUiDomainPrefix}-custom-email-sender`,
    //   enableKeyRotation: true,
    //   removalPolicy: cdk.RemovalPolicy.RETAIN,
    // })
    // customSenderKmsKey.addToResourcePolicy(
    //   new iam.PolicyStatement({
    //     principals: [new iam.ServicePrincipal('cognito-idp.amazonaws.com')],
    //     actions: ['kms:Encrypt', 'kms:GenerateDataKey'],
    //     resources: ['*'],
    //   }),
    // )

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true, username: true },
      autoVerify: { email: true },
      email: userPoolEmail,
      // Uncomment when re-enabling CUSTOM_EMAIL_SENDER.
      // customSenderKmsKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false,
      },
    })

    this.postConfirmationHandler = new nodejs.NodejsFunction(this, 'PostConfirmationHandler', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('cognito', 'post-confirmation.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      bundling: createNodejsBundling({
        afterBundling: (inputDir, outputDir) => [
          ...removeGeneratedSourceArtifacts(),
          ...copyDirectoryIntoBundle(inputDir, outputDir, 'src/mail/templates', 'templates'),
        ],
      }),
      environment: {
        COGNITO_DEFAULT_GROUP: InfraRole.customer,
        EMAIL_TRACKING_TABLE: props.emailTrackingTable.tableName,
        SES_ENABLED: String(infraEnv.sesEnabled),
        SES_FROM_EMAIL: infraEnv.sesFromEmail ?? '',
        SES_VERIFIED_RECIPIENTS: infraEnv.sesVerifiedRecipients.join(','),
        SES_CONFIGURATION_SET_NAME: infraEnv.sesConfigurationSetName ?? '',
        USER_ACCOUNTS_TABLE: props.userAccountsTable.tableName,
      },
    })

    props.emailTrackingTable.grantReadWriteData(this.postConfirmationHandler)
    props.userAccountsTable.grantReadWriteData(this.postConfirmationHandler)
    this.postConfirmationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminAddUserToGroup'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'cognito-idp',
            resource: 'userpool',
            resourceName: '*',
          }),
        ],
      }),
    )

    this.userPool.addTrigger(
      cognito.UserPoolOperation.POST_CONFIRMATION,
      this.postConfirmationHandler,
    )

    this.preSignUpHandler = new nodejs.NodejsFunction(this, 'PreSignUpHandler', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('cognito', 'pre-sign-up.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      bundling: createNodejsBundling(),
      environment: {
        COGNITO_DISPOSABLE_EMAIL_DOMAINS: infraEnv.cognitoDisposableEmailDomains.join(','),
      },
    })
    this.preSignUpHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:ListUsers'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'cognito-idp',
            resource: 'userpool',
            resourceName: '*',
          }),
        ],
      }),
    )
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, this.preSignUpHandler)

    this.preAuthenticationHandler = new nodejs.NodejsFunction(this, 'PreAuthenticationHandler', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('cognito', 'pre-authentication.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      bundling: createNodejsBundling(),
      environment: {
        USER_ACCOUNTS_TABLE: props.userAccountsTable.tableName,
      },
    })
    props.userAccountsTable.grantReadData(this.preAuthenticationHandler)
    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_AUTHENTICATION,
      this.preAuthenticationHandler,
    )

    this.postAuthenticationHandler = new nodejs.NodejsFunction(this, 'PostAuthenticationHandler', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('cognito', 'post-authentication.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      bundling: createNodejsBundling(),
      environment: {
        USER_ACCOUNTS_TABLE: props.userAccountsTable.tableName,
        USER_LOGIN_AUDIT_TABLE: props.userLoginAuditTable.tableName,
      },
    })
    props.userAccountsTable.grantReadWriteData(this.postAuthenticationHandler)
    props.userLoginAuditTable.grantReadWriteData(this.postAuthenticationHandler)
    this.userPool.addTrigger(
      cognito.UserPoolOperation.POST_AUTHENTICATION,
      this.postAuthenticationHandler,
    )

    // Uncomment this block when re-enabling CUSTOM_EMAIL_SENDER.
    // this.customEmailSenderHandler = new nodejs.NodejsFunction(this, 'CustomEmailSenderHandler', {
    //   runtime: lambda.Runtime.NODEJS_24_X,
    //   entry: sourceEntryPath('cognito', 'custom-email-sender.ts'),
    //   handler: 'handler',
    //   timeout: cdk.Duration.seconds(15),
    //   memorySize: 256,
    //   bundling: createNodejsBundling({
    //     afterBundling: (inputDir, outputDir) => [
    //       ...removeGeneratedSourceArtifacts(),
    //       ...copyDirectoryIntoBundle(inputDir, outputDir, 'src/mail/templates', 'templates'),
    //     ],
    //   }),
    //   environment: {
    //     EMAIL_TRACKING_TABLE: props.emailTrackingTable.tableName,
    //     KEY_ID: customSenderKmsKey.keyId,
    //     KEY_ARN: customSenderKmsKey.keyArn,
    //     SES_ENABLED: String(infraEnv.sesEnabled),
    //     SES_FROM_EMAIL: infraEnv.sesFromEmail ?? '',
    //     SES_VERIFIED_RECIPIENTS: infraEnv.sesVerifiedRecipients.join(','),
    //     SES_CONFIGURATION_SET_NAME: infraEnv.sesConfigurationSetName ?? '',
    //   },
    // })
    // props.emailTrackingTable.grantReadWriteData(this.customEmailSenderHandler)
    // customSenderKmsKey.grantDecrypt(this.customEmailSenderHandler)
    // this.userPool.addTrigger(
    //   cognito.UserPoolOperation.CUSTOM_EMAIL_SENDER,
    //   this.customEmailSenderHandler,
    // )

    this.preTokenGenerationHandler = new nodejs.NodejsFunction(this, 'PreTokenGenerationHandler', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('cognito', 'pre-token-generation.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      bundling: createNodejsBundling(),
      environment: {
        USER_ACCOUNTS_TABLE: props.userAccountsTable.tableName,
      },
    })
    props.userAccountsTable.grantReadData(this.preTokenGenerationHandler)

    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      this.preTokenGenerationHandler,
      cognito.LambdaVersion.V2_0,
    )

    const supportedIdentityProviders = [cognito.UserPoolClientIdentityProvider.COGNITO]
    const googleProvider =
      props.googleClientId && props.googleClientSecret
        ? new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
            userPool: this.userPool,
            clientId: props.googleClientId,
            clientSecretValue: cdk.SecretValue.unsafePlainText(props.googleClientSecret),
            scopes: ['openid', 'email', 'profile'],
            attributeMapping: {
              email: cognito.ProviderAttribute.GOOGLE_EMAIL,
              emailVerified: cognito.ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
              fullname: cognito.ProviderAttribute.GOOGLE_NAME,
            },
          })
        : undefined

    if (googleProvider) {
      supportedIdentityProviders.push(cognito.UserPoolClientIdentityProvider.GOOGLE)
    }

    this.userPoolClient = this.userPool.addClient('WebAppClient', {
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.minutes(5),
      idTokenValidity: cdk.Duration.minutes(5),
      refreshTokenValidity: cdk.Duration.hours(1),
      refreshTokenRotationGracePeriod: cdk.Duration.seconds(30),
      enableTokenRevocation: true,
      supportedIdentityProviders,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: props.callbackUrls,
        logoutUrls: props.logoutUrls,
        defaultRedirectUri: props.callbackUrls[0],
      },
    })

    if (googleProvider) {
      this.userPoolClient.node.addDependency(googleProvider)
    }

    this.userPoolDomain = this.userPool.addDomain('HostedUiDomain', {
      cognitoDomain: {
        domainPrefix: props.hostedUiDomainPrefix,
      },
    })

    createUserPoolGroups(this, this.userPool)
  }
}
