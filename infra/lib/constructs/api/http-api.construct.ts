import * as cdk from 'aws-cdk-lib'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers'
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import { Construct } from 'constructs'
import { getAwsInfraEnv } from '../../config/env'
import {
  createRegionalCustomDomainConfig,
  toHostedZoneRecordName,
} from '../../shared/custom-domain'
import { registerApiRoutes } from './api-routes'

export interface HttpApiConstructProps {
  apiHandler: lambda.IFunction
  userPoolId: string
  userPoolClientId: string
  clientOrigins: string[]
}

export class HttpApiConstruct extends Construct {
  readonly api: apigatewayv2.HttpApi
  readonly apiBaseUrl: string
  readonly jwtIssuer: string
  readonly authorizer?: authorizers.HttpJwtAuthorizer

  constructor(scope: Construct, id: string, props: HttpApiConstructProps) {
    super(scope, id)
    const infraEnv = getAwsInfraEnv()

    this.jwtIssuer = `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${props.userPoolId}`

    this.api = new apigatewayv2.HttpApi(this, 'NestHttpApi', {
      apiName: 'nestjs-ecommerce-local',
      createDefaultStage: true,
      corsPreflight: {
        allowOrigins: props.clientOrigins,
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PATCH,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.HEAD,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['authorization', 'content-type'],
      },
    })

    const integration = new integrations.HttpLambdaIntegration(
      'ApiHandlerIntegration',
      props.apiHandler,
      {
        payloadFormatVersion: apigatewayv2.PayloadFormatVersion.VERSION_2_0,
        scopePermissionToRoute: false,
      },
    )

    this.authorizer = new authorizers.HttpJwtAuthorizer('AdminAuthorizer', this.jwtIssuer, {
      jwtAudience: [props.userPoolClientId],
      identitySource: ['$request.header.Authorization'],
    })

    registerApiRoutes(this.api, integration, this.authorizer)

    const customDomain = createRegionalCustomDomainConfig(
      this,
      'Api',
      infraEnv.apiDomainName,
      infraEnv.apiHostedZoneName,
    )
    this.apiBaseUrl = customDomain ? `https://${customDomain.domainName}` : this.api.apiEndpoint

    if (customDomain) {
      const domainName = new apigatewayv2.DomainName(this, 'ApiDomainName', {
        domainName: customDomain.domainName,
        certificate: customDomain.certificate,
        ipAddressType: apigatewayv2.IpAddressType.DUAL_STACK,
      })

      new apigatewayv2.ApiMapping(this, 'ApiDomainMapping', {
        api: this.api,
        domainName,
      })

      const aliasTarget = route53.RecordTarget.fromAlias(
        new targets.ApiGatewayv2DomainProperties(
          domainName.regionalDomainName,
          domainName.regionalHostedZoneId,
        ),
      )

      new route53.ARecord(this, 'ApiAliasRecord', {
        zone: customDomain.hostedZone,
        recordName: toHostedZoneRecordName(customDomain.domainName, customDomain.hostedZone),
        target: aliasTarget,
      })

      new route53.AaaaRecord(this, 'ApiIpv6AliasRecord', {
        zone: customDomain.hostedZone,
        recordName: toHostedZoneRecordName(customDomain.domainName, customDomain.hostedZone),
        target: aliasTarget,
      })
    }
  }
}
