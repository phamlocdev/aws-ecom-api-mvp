import * as cdk from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'
import { getAwsInfraEnv } from '../../config/env'
import {
  createCloudFrontCustomDomainConfig,
  toHostedZoneRecordName,
} from '../../shared/custom-domain'

export interface S3ConstructProps {
  bucketName: string
  clientOrigins: string[]
  publicReadPrefixes?: string[]
}

export class S3Construct extends Construct {
  readonly mediaBucket: s3.Bucket
  readonly mediaDistribution: cloudfront.Distribution
  readonly mediaPublicBaseUrl: string

  constructor(scope: Construct, id: string, props: S3ConstructProps) {
    super(scope, id)
    const infraEnv = getAwsInfraEnv()

    const publicReadPrefixes = [
      ...new Set(
        (props.publicReadPrefixes ?? ['products/'])
          .map((prefix) => prefix.trim().replace(/^\/+/, '').replace(/\/+$/, ''))
          .filter(Boolean)
          .map((prefix) => `${prefix}/`),
      ),
    ]
    const publicReadUriPrefixes = publicReadPrefixes.map((prefix) => `/${prefix}`)

    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: props.bucketName,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      publicReadAccess: false,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedOrigins: props.clientOrigins,
          allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedHeaders: ['content-type', 'x-amz-*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
    })

    if (publicReadPrefixes.length > 0) {
      this.mediaBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.AnyPrincipal()],
          actions: ['s3:GetObject'],
          // publicReadPrefixes =  ['products/']
          resources: publicReadPrefixes.map((prefix) =>
            this.mediaBucket.arnForObjects(`${prefix}*`),
          ),
        }),
      )
    }

    const publicPrefixGuardFunction = new cloudfront.Function(this, 'PublicPrefixGuardFunction', {
      functionName: `${cdk.Stack.of(this).stackName}StoragePublicPrefixGuardFunctionV2`,
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
          var allowedPrefixes = ${JSON.stringify(publicReadUriPrefixes)};

          function handler(event) {
            var request = event.request;
            var uri = normalizeUri(request.uri || '/');

            for (var i = 0; i < allowedPrefixes.length; i++) {
              if (uri.indexOf(allowedPrefixes[i]) === 0) {
                request.uri = uri;
                return request;
              }
            }

            return {
              statusCode: 403,
              statusDescription: 'Forbidden',
              headers: {
                'cache-control': { value: 'no-store' }
              }
            };
          }

          function normalizeUri(uri) {
            return uri.indexOf('/') === 0 ? uri : '/' + uri;
          }
        `),
    })

    const mediaOriginAccessControl = new cloudfront.S3OriginAccessControl(
      this,
      'MediaOriginAccessControl',
      {
        originAccessControlName: `${cdk.Stack.of(this).stackName}StorageMediaOriginAccessControlV2`,
      },
    )
    const customDomain = createCloudFrontCustomDomainConfig(
      this,
      'Media',
      infraEnv.mediaDomainName,
      infraEnv.mediaHostedZoneName,
    )

    this.mediaDistribution = new cloudfront.Distribution(this, 'MediaDistribution', {
      certificate: customDomain?.certificate,
      domainNames: customDomain ? [customDomain.domainName] : undefined,
      webAclId: infraEnv.mediaWafWebAclArn,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.mediaBucket, {
          originAccessControl: mediaOriginAccessControl,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        functionAssociations: [
          {
            function: publicPrefixGuardFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
    })
    this.mediaPublicBaseUrl = customDomain
      ? `https://${customDomain.domainName}`
      : `https://${this.mediaDistribution.distributionDomainName}`

    if (customDomain) {
      new route53.ARecord(this, 'MediaAliasRecord', {
        zone: customDomain.hostedZone,
        recordName: toHostedZoneRecordName(customDomain.domainName, customDomain.hostedZone),
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(this.mediaDistribution),
        ),
      })

      new route53.AaaaRecord(this, 'MediaIpv6AliasRecord', {
        zone: customDomain.hostedZone,
        recordName: toHostedZoneRecordName(customDomain.domainName, customDomain.hostedZone),
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(this.mediaDistribution),
        ),
      })
    }
  }
}
