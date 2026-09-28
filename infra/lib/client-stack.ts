import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as events from 'aws-cdk-lib/aws-events'
import * as eventTargets from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { Construct } from 'constructs'
import { getAwsInfraEnv } from './config/env'
import { buildCloudFrontFunctionCode } from './shared/cloudfront-function-code'
import { createCloudFrontCustomDomainConfig } from './shared/custom-domain'
import {
  createNodejsBundling,
  removeGeneratedSourceArtifacts,
  sourceEntryPath,
} from './shared/lambda-bundling'

export class ClientStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const env = getAwsInfraEnv()
    const clientOutPath = path.resolve(__dirname, '..', '..', '..', 'client', 'out')
    const rewriteHandlerPath = path.resolve(
      __dirname,
      '..',
      'lambda',
      'client-rewrite-handler',
      'index.ts',
    )
    const productsTable = dynamodb.Table.fromTableName(this, 'ProductsTable', env.productsTableName)
    const productEventsBus = events.EventBus.fromEventBusName(
      this,
      'ProductEventsBus',
      env.orderEventsBusName,
    )
    const mediaPublicBaseUrl = requireEnvValue(env.mediaPublicBaseUrl, 'MEDIA_PUBLIC_BASE_URL')

    const siteBucket = new s3.Bucket(this, 'ClientSiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    })

    const rewriteFunction = new cloudfront.Function(this, 'RewriteFunction', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(buildCloudFrontFunctionCode(rewriteHandlerPath)),
    })

    const origin = origins.S3BucketOrigin.withOriginAccessControl(siteBucket)
    const customDomain = createCloudFrontCustomDomainConfig(
      this,
      'Client',
      env.clientDomainName,
      env.clientHostedZoneName,
    )
    const distribution = new cloudfront.Distribution(this, 'ClientDistribution', {
      defaultRootObject: 'index.html',
      certificate: customDomain?.certificate,
      domainNames: customDomain ? [customDomain.domainName] : undefined,
      webAclId: env.clientWafWebAclArn,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        functionAssociations: [
          {
            function: rewriteFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: '/404.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/404.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    })
    const clientBaseUrl = customDomain
      ? `https://${customDomain.domainName}`
      : `https://${distribution.distributionDomainName}`

    if (customDomain) {
      new route53.ARecord(this, 'ClientAliasRecord', {
        zone: customDomain.hostedZone,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      })

      new route53.AaaaRecord(this, 'ClientIpv6AliasRecord', {
        zone: customDomain.hostedZone,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      })
    }

    const productSeoGenerator = new nodejs.NodejsFunction(this, 'ProductSeoGenerator', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('product-seo-generator.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling: createNodejsBundling({
        afterBundling: () => removeGeneratedSourceArtifacts(),
      }),
      environment: {
        PRODUCTS_TABLE: env.productsTableName,
        CLIENT_SITE_BUCKET: siteBucket.bucketName,
        CLIENT_DISTRIBUTION_ID: distribution.distributionId,
        CLIENT_BASE_URL: clientBaseUrl,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        PRODUCT_TEMPLATE_KEY: 'products/__template/index.html',
      },
    })

    productsTable.grantReadData(productSeoGenerator)
    siteBucket.grantReadWrite(productSeoGenerator, 'products/*')
    productSeoGenerator.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: ['*'],
      }),
    )

    new events.Rule(this, 'ProductStaticPageRule', {
      eventBus: productEventsBus,
      eventPattern: {
        source: ['ecommerce.products'],
        detailType: ['ProductCreated', 'ProductUpdated', 'ProductDeleted'],
      },
      targets: [
        new eventTargets.LambdaFunction(productSeoGenerator, {
          retryAttempts: 3,
          maxEventAge: cdk.Duration.hours(2),
        }),
      ],
    })

    new s3deploy.BucketDeployment(this, 'DeployClientSite', {
      sources: [s3deploy.Source.asset(clientOutPath)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: false, // Do not delete files in the bucket that are not part of the deployment
    })

    new cdk.CfnOutput(this, 'ClientBucketName', {
      value: siteBucket.bucketName,
    })

    new cdk.CfnOutput(this, 'ClientDistributionId', {
      value: distribution.distributionId,
    })

    new cdk.CfnOutput(this, 'ClientDistributionDomainName', {
      value: distribution.distributionDomainName,
    })

    new cdk.CfnOutput(this, 'ClientUrl', {
      value: clientBaseUrl,
    })
  }
}

function requireEnvValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `${name} is required. Run npm run infra:deploy before deploying ClientDevStack.`,
    )
  }

  return value
}
