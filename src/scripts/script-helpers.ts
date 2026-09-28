import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import * as dotenv from 'dotenv'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { validateRuntimeEnv, type RuntimeEnv } from '../config/env.validation'

const serverRoot = path.resolve(__dirname, '..', '..')
const defaultEnvFilePath = path.join(serverRoot, '.env.dev')

let cachedContext: ScriptContext | null = null

export type ScriptContext = {
  serverRoot: string
  envFilePath: string
  runtimeEnv: RuntimeEnv
  documentClient: DynamoDBDocumentClient
  cognitoClient: CognitoIdentityProviderClient
}

export type StackOutputs = {
  ApiGatewayUrl?: string
  CognitoClientId?: string
  CognitoIssuer?: string
  CognitoUserPoolId?: string
  HostedUiDomain?: string
  MediaBucketName?: string
  MediaDistributionDomainName?: string
  MediaDistributionId?: string
  MediaPublicBaseUrl?: string
  EmailTrackingTableName?: string
  EventConsumerIdempotencyTableName?: string
  OrderEventsBusName?: string
  OrdersTableName?: string
  PlaceOrderQueueUrl?: string
  ProductsTableName?: string
  UserAccessTableName?: string
  UserAccountsTableName?: string
}

export function getScriptContext(): ScriptContext {
  if (cachedContext) {
    return cachedContext
  }

  const envFilePath = process.env.RUNTIME_ENV_FILE
    ? path.resolve(process.env.RUNTIME_ENV_FILE)
    : defaultEnvFilePath

  dotenv.config({ path: envFilePath, override: true, quiet: true })

  const runtimeEnv = validateRuntimeEnv(process.env as Record<string, unknown>)
  const region = runtimeEnv.AWS_REGION ?? runtimeEnv.AWS_DEFAULT_REGION

  const dynamoDbClient = new DynamoDBClient({ region })
  const documentClient = DynamoDBDocumentClient.from(dynamoDbClient, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  })
  const cognitoClient = new CognitoIdentityProviderClient({ region })

  cachedContext = {
    serverRoot,
    envFilePath,
    runtimeEnv,
    documentClient,
    cognitoClient,
  }

  return cachedContext
}

export function getAwsOutputs(): StackOutputs {
  const outputsPath = path.join(getScriptContext().serverRoot, 'aws-outputs.json')
  if (!fs.existsSync(outputsPath)) {
    throw new Error(`Missing aws outputs file at ${outputsPath}. Run npm run infra:deploy first.`)
  }

  const fileContents = fs.readFileSync(outputsPath, 'utf8')
  const parsed = JSON.parse(fileContents) as Record<string, Record<string, string>>
  const stack = parsed.ServerDevStack

  if (!stack) {
    throw new Error('aws-outputs.json does not contain ServerDevStack outputs.')
  }

  return stack as StackOutputs
}

export function getResolvedCognitoUserPoolId(): string {
  const { runtimeEnv } = getScriptContext()
  return runtimeEnv.COGNITO_USER_POOL_ID ?? getAwsOutputs().CognitoUserPoolId ?? ''
}

export function getResolvedCognitoClientId(): string {
  const { runtimeEnv } = getScriptContext()
  return runtimeEnv.COGNITO_CLIENT_ID ?? getAwsOutputs().CognitoClientId ?? ''
}

export function getResolvedUserAccountsTableName(): string {
  const envValue = process.env.USER_ACCOUNTS_TABLE?.trim()
  if (envValue) {
    return envValue
  }

  return getAwsOutputs().UserAccountsTableName ?? getScriptContext().runtimeEnv.USER_ACCOUNTS_TABLE
}

export function getLegacyUserAccessTableName(): string | undefined {
  return process.env.USER_ACCESS_TABLE?.trim() || getAwsOutputs().UserAccessTableName
}

export function getLegacyUserProfilesTableName(): string | undefined {
  return process.env.USER_PROFILES_TABLE?.trim()
}

export function getResolvedApiGatewayUrl(): string {
  const apiGatewayUrl = getAwsOutputs().ApiGatewayUrl ?? ''
  if (!apiGatewayUrl) {
    throw new Error('ApiGatewayUrl is missing from aws-outputs.json.')
  }

  return trimTrailingSlash(apiGatewayUrl)
}

export function getResolvedCognitoUserPoolEndpoint(): string {
  const outputs = getAwsOutputs()
  const issuer = outputs.CognitoIssuer ?? ''
  const userPoolId = outputs.CognitoUserPoolId ?? getResolvedCognitoUserPoolId()

  if (!issuer || !userPoolId) {
    throw new Error(
      'Cannot resolve Cognito user pool endpoint because CognitoIssuer or CognitoUserPoolId is missing.',
    )
  }

  const suffix = `/${userPoolId}`
  return issuer.endsWith(suffix) ? issuer.slice(0, -suffix.length) : issuer
}

export function stableUuid(name: string): string {
  const hex = createHash('sha1').update(name).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16] ?? '0', 16) % 4]

  return [
    hex.slice(0, 8).join(''),
    hex.slice(8, 12).join(''),
    hex.slice(12, 16).join(''),
    hex.slice(16, 20).join(''),
    hex.slice(20, 32).join(''),
  ].join('-')
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function readIntFlag(name: string, fallback: number): number {
  const args = process.argv.slice(2)
  const directFlag = `--${name}`

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]
    if (current === directFlag) {
      const next = args[index + 1]
      const parsed = Number(next)
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed
      }
      throw new Error(`Expected a positive integer after ${directFlag}.`)
    }

    if (current?.startsWith(`${directFlag}=`)) {
      const parsed = Number(current.slice(directFlag.length + 1))
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed
      }
      throw new Error(`Expected a positive integer for ${directFlag}.`)
    }
  }

  return fallback
}

export function readRequiredStringFlag(name: string): string {
  const args = process.argv.slice(2)
  const directFlag = `--${name}`

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]
    if (current === directFlag) {
      const next = args[index + 1]
      if (typeof next === 'string' && next.trim()) {
        return next.trim()
      }
      throw new Error(`Expected a value after ${directFlag}.`)
    }

    if (current?.startsWith(`${directFlag}=`)) {
      const value = current.slice(directFlag.length + 1).trim()
      if (value) {
        return value
      }
      throw new Error(`Expected a non-empty value for ${directFlag}.`)
    }
  }

  throw new Error(`Missing required flag ${directFlag}.`)
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, '')
}

export function groupBy<TItem, TKey extends string | number>(
  items: TItem[],
  getKey: (item: TItem) => TKey,
): Map<TKey, TItem[]> {
  const grouped = new Map<TKey, TItem[]>()

  for (const item of items) {
    const key = getKey(item)
    const bucket = grouped.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      grouped.set(key, [item])
    }
  }

  return grouped
}

export function exitWithError(error: unknown): never {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(message)
  process.exit(1)
}
