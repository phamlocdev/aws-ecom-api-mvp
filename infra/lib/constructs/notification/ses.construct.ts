import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as ses from 'aws-cdk-lib/aws-ses'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import { Construct } from 'constructs'
import { getAwsInfraEnv } from '../../config/env'
import { createNodejsBundling, sourceEntryPath } from '../../shared/lambda-bundling'
import { lookupHostedZone } from '../../shared/custom-domain'

export interface SesConstructProps {
  emailTrackingTable: dynamodb.ITable
}

export class SesConstruct extends Construct {
  readonly configurationSetName: string
  readonly fromEmail?: string
  readonly verifiedDomainName?: string
  readonly domainIdentity?: ses.IEmailIdentity
  readonly createdDomainIdentity?: ses.EmailIdentity
  readonly eventTopic: sns.Topic
  readonly eventProcessor: nodejs.NodejsFunction

  constructor(scope: Construct, id: string, props: SesConstructProps) {
    super(scope, id)

    const infraEnv = getAwsInfraEnv()
    this.configurationSetName = infraEnv.sesConfigurationSetName
    this.fromEmail = infraEnv.sesFromEmail
    this.verifiedDomainName = infraEnv.sesVerifiedDomainName

    const configurationSet = new ses.CfnConfigurationSet(this, 'ConfigurationSet', {
      name: this.configurationSetName,
    })

    if (infraEnv.sesVerifiedDomainName) {
      if (infraEnv.sesCreateDomainIdentity) {
        if (!infraEnv.sesHostedZoneName) {
          throw new Error('SES hosted zone name is required when SES_CREATE_DOMAIN_IDENTITY=true.')
        }

        const hostedZone = lookupHostedZone(this, 'SesHostedZone', infraEnv.sesHostedZoneName)
        this.createdDomainIdentity = this.createDomainIdentity(
          infraEnv.sesVerifiedDomainName,
          hostedZone,
        )
        this.domainIdentity = this.createdDomainIdentity
      } else {
        this.domainIdentity = ses.EmailIdentity.fromEmailIdentityName(
          this,
          'ImportedDomainIdentity',
          infraEnv.sesVerifiedDomainName,
        )
      }
    }

    this.eventTopic = new sns.Topic(this, 'SesEventsTopic')
    this.eventProcessor = new nodejs.NodejsFunction(this, 'SesEventProcessor', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: sourceEntryPath('ses-event-processor.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling: createNodejsBundling(),
      environment: {
        EMAIL_TRACKING_TABLE: props.emailTrackingTable.tableName,
      },
    })

    props.emailTrackingTable.grantReadWriteData(this.eventProcessor)
    this.eventTopic.addSubscription(new subscriptions.LambdaSubscription(this.eventProcessor))
    const topicPolicy = this.eventTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.eventTopic.topicArn],
        conditions: {
          StringEquals: {
            'AWS:SourceAccount': cdk.Stack.of(this).account,
          },
        },
      }),
    )

    const eventDestination = new ses.CfnConfigurationSetEventDestination(
      this,
      'ConfigurationSetEventDestination',
      {
        configurationSetName: this.configurationSetName,
        eventDestination: {
          enabled: true,
          matchingEventTypes: [
            'SEND',
            'DELIVERY',
            'BOUNCE',
            'COMPLAINT',
            'REJECT',
            'RENDERING_FAILURE',
          ],
          snsDestination: {
            topicArn: this.eventTopic.topicArn,
          },
        },
      },
    )
    eventDestination.addResourceDependency(configurationSet)
    if (topicPolicy.policyDependable) {
      eventDestination.node.addDependency(topicPolicy.policyDependable)
    }
  }

  grantSendEmail(grantee: iam.IGrantable) {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resourceArns: [this.domainIdentity?.emailIdentityArn ?? '*'],
    })
  }

  private createDomainIdentity(
    domainName: string,
    hostedZone: route53.IHostedZone,
  ): ses.EmailIdentity {
    const mailFromDomain = `mail.${domainName}`
    const identity = new ses.EmailIdentity(this, 'DomainIdentity', {
      identity: ses.Identity.domain(domainName),
      mailFromDomain,
      mailFromBehaviorOnMxFailure: ses.MailFromBehaviorOnMxFailure.USE_DEFAULT_VALUE,
    })

    this.addDkimRecord('DkimDnsToken1', hostedZone, identity.dkimDnsTokenName1, [
      identity.dkimDnsTokenValue1,
    ])
    this.addDkimRecord('DkimDnsToken2', hostedZone, identity.dkimDnsTokenName2, [
      identity.dkimDnsTokenValue2,
    ])
    this.addDkimRecord('DkimDnsToken3', hostedZone, identity.dkimDnsTokenName3, [
      identity.dkimDnsTokenValue3,
    ])

    new route53.CfnRecordSet(this, 'MailFromMxRecord', {
      hostedZoneId: hostedZone.hostedZoneId,
      name: `${mailFromDomain}.`,
      type: 'MX',
      resourceRecords: [`10 feedback-smtp.${cdk.Stack.of(this).region}.amazonses.com`],
      ttl: '1800',
    })

    new route53.CfnRecordSet(this, 'MailFromTxtRecord', {
      hostedZoneId: hostedZone.hostedZoneId,
      name: `${mailFromDomain}.`,
      type: 'TXT',
      resourceRecords: ['"v=spf1 include:amazonses.com ~all"'],
      ttl: '1800',
    })

    return identity
  }

  private addDkimRecord(
    id: string,
    hostedZone: route53.IHostedZone,
    name: string,
    resourceRecords: string[],
  ): void {
    new route53.CfnRecordSet(this, id, {
      hostedZoneId: hostedZone.hostedZoneId,
      name,
      type: 'CNAME',
      resourceRecords,
      ttl: '1800',
    })
  }
}
