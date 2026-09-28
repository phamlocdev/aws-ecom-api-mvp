import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as route53 from 'aws-cdk-lib/aws-route53'
import { Construct } from 'constructs'

export type CustomDomainConfig = {
  certificate: acm.ICertificate
  domainName: string
  hostedZone: route53.IHostedZone
}

export function createRegionalCustomDomainConfig(
  scope: Construct,
  idPrefix: string,
  domainName: string | undefined,
  hostedZoneName: string | undefined,
): CustomDomainConfig | undefined {
  if (!domainName) {
    return undefined
  }

  const hostedZone = lookupHostedZone(scope, `${idPrefix}HostedZone`, hostedZoneName ?? domainName)
  const certificate = new acm.Certificate(scope, `${idPrefix}Certificate`, {
    domainName,
    validation: acm.CertificateValidation.fromDns(hostedZone),
  })

  return {
    certificate,
    domainName,
    hostedZone,
  }
}

export function createCloudFrontCustomDomainConfig(
  scope: Construct,
  idPrefix: string,
  domainName: string | undefined,
  hostedZoneName: string | undefined,
): CustomDomainConfig | undefined {
  if (!domainName) {
    return undefined
  }

  const hostedZone = lookupHostedZone(scope, `${idPrefix}HostedZone`, hostedZoneName ?? domainName)
  const certificate = new acm.DnsValidatedCertificate(scope, `${idPrefix}Certificate`, {
    domainName,
    hostedZone,
    region: 'us-east-1',
  })

  return {
    certificate,
    domainName,
    hostedZone,
  }
}

export function toHostedZoneRecordName(
  domainName: string,
  hostedZone: route53.IHostedZone,
): string {
  const zoneName = hostedZone.zoneName.replace(/\.$/, '')
  return domainName === zoneName
    ? ''
    : domainName.replace(new RegExp(`\\.${escapeRegex(zoneName)}$`), '')
}

function lookupHostedZone(scope: Construct, id: string, domainName: string): route53.IHostedZone {
  return route53.HostedZone.fromLookup(scope, id, {
    domainName,
  })
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
