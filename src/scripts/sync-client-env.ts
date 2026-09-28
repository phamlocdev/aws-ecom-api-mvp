import * as fs from 'fs'
import * as path from 'path'
import {
  exitWithError,
  getAwsOutputs,
  getResolvedApiGatewayUrl,
  getResolvedCognitoUserPoolEndpoint,
  getScriptContext,
} from './script-helpers'

async function main(): Promise<void> {
  const { runtimeEnv, serverRoot, envFilePath } = getScriptContext()
  const outputs = getAwsOutputs()
  const clientEnvPath = path.resolve(serverRoot, '..', 'client', '.env')
  const apiGatewayBaseUrl = getResolvedApiGatewayUrl()
  const mediaPublicBaseUrl = outputs.MediaPublicBaseUrl ?? ''

  const nextEnv = {
    NEXT_PUBLIC_API_GATEWAY_BASE_URL: outputs.ApiGatewayUrl ?? '',
    NEXT_PUBLIC_MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    NEXT_PUBLIC_COGNITO_REGION: runtimeEnv.AWS_REGION,
    NEXT_PUBLIC_COGNITO_USER_POOL_ID: outputs.CognitoUserPoolId ?? '',
    NEXT_PUBLIC_COGNITO_CLIENT_ID: outputs.CognitoClientId ?? '',
    NEXT_PUBLIC_COGNITO_DOMAIN_URL: outputs.HostedUiDomain ?? '',
    NEXT_PUBLIC_COGNITO_USER_POOL_ENDPOINT: getResolvedCognitoUserPoolEndpoint(),
  }

  for (const [key, value] of Object.entries(nextEnv)) {
    if (!value) {
      throw new Error(`Cannot sync ${key} because its source value is missing.`)
    }
  }

  const fileContents = [
    '# API',
    `NEXT_PUBLIC_API_GATEWAY_BASE_URL=${nextEnv.NEXT_PUBLIC_API_GATEWAY_BASE_URL}`,
    '',
    '# Media',
    `NEXT_PUBLIC_MEDIA_PUBLIC_BASE_URL=${nextEnv.NEXT_PUBLIC_MEDIA_PUBLIC_BASE_URL}`,
    '',
    '# Cognito',
    `NEXT_PUBLIC_COGNITO_REGION=${nextEnv.NEXT_PUBLIC_COGNITO_REGION}`,
    `NEXT_PUBLIC_COGNITO_USER_POOL_ID=${nextEnv.NEXT_PUBLIC_COGNITO_USER_POOL_ID}`,
    `NEXT_PUBLIC_COGNITO_CLIENT_ID=${nextEnv.NEXT_PUBLIC_COGNITO_CLIENT_ID}`,
    `NEXT_PUBLIC_COGNITO_DOMAIN_URL=${nextEnv.NEXT_PUBLIC_COGNITO_DOMAIN_URL}`,
    `NEXT_PUBLIC_COGNITO_USER_POOL_ENDPOINT=${nextEnv.NEXT_PUBLIC_COGNITO_USER_POOL_ENDPOINT}`,
    '',
  ].join('\n')

  fs.writeFileSync(clientEnvPath, fileContents, 'utf8')
  syncServerEnvFile(envFilePath, apiGatewayBaseUrl, mediaPublicBaseUrl)
  console.log(`Synced client env to ${clientEnvPath}.`)
}

function syncServerEnvFile(
  envFilePath: string,
  apiGatewayBaseUrl: string,
  mediaPublicBaseUrl: string,
): void {
  if (!mediaPublicBaseUrl) {
    throw new Error('Cannot sync MEDIA_PUBLIC_BASE_URL because MediaPublicBaseUrl is missing.')
  }

  const envContent = fs.readFileSync(envFilePath, 'utf8')
  const nextReturnUrl = `${apiGatewayBaseUrl}/payments/vnpay/return`
  const nextIpnUrl = `${apiGatewayBaseUrl}/payments/vnpay/ipn`

  const updated = upsertEnvVar(
    upsertEnvVar(
      upsertEnvVar(envContent, 'VNPAY_RETURN_URL', nextReturnUrl),
      'VNPAY_IPN_URL',
      nextIpnUrl,
    ),
    'MEDIA_PUBLIC_BASE_URL',
    mediaPublicBaseUrl,
  )

  fs.writeFileSync(envFilePath, updated, 'utf8')
}

function upsertEnvVar(content: string, key: string, value: string): string {
  const pattern = new RegExp(`^${escapeRegex(key)}=.*$`, 'm')
  const nextLine = `${key}=${value}`

  if (pattern.test(content)) {
    return content.replace(pattern, nextLine)
  }

  const normalized = content.endsWith('\n') ? content : `${content}\n`
  return `${normalized}${nextLine}\n`
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

void main().catch(exitWithError)
