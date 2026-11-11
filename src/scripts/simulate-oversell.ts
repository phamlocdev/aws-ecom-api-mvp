import {
  InitiateAuthCommand,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider'
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { ensureSeedUser, type SeedUserAccount } from './user-seed'
import {
  exitWithError,
  getResolvedApiGatewayUrl,
  getResolvedCognitoClientId,
  getScriptContext,
  nowIso,
  readIntFlag,
  readRequiredStringFlag,
} from './script-helpers'

type SessionUser = {
  account: SeedUserAccount
  accessToken: string
}

type CartResponse = {
  cartId: string
}

type PlaceOrderResponse = {
  orderId: string
  status: string
}

type OrderDetails = {
  orderId: string
  status: string
}

type InventoryRecord = {
  productId: string
  availableQuantity: number
  reservedQuantity: number
  updatedAt: string
}

async function main(): Promise<void> {
  const customers = readIntFlag('customers', 5)
  const productId = readRequiredStringFlag('productId')
  const { documentClient, runtimeEnv, cognitoClient } = getScriptContext()
  const apiBaseUrl = getResolvedApiGatewayUrl()
  const cognitoClientId = getResolvedCognitoClientId()
  if (!cognitoClientId) {
    throw new Error('Cognito client id is missing from both .env.dev and aws-outputs.json.')
  }

  const productResponse = await documentClient.send(
    new GetCommand({
      TableName: runtimeEnv.PRODUCTS_TABLE,
      Key: { id: productId },
    }),
  )

  if (!productResponse.Item) {
    throw new Error(`Product ${productId} was not found.`)
  }

  const inventoryQuantity = 1
  await documentClient.send(
    new PutCommand({
      TableName: runtimeEnv.INVENTORY_TABLE,
      Item: {
        productId,
        availableQuantity: inventoryQuantity,
        reservedQuantity: 0,
        updatedAt: nowIso(),
      },
    }),
  )

  const accounts = buildSimulationUsers(customers)
  for (const account of accounts) {
    await ensureSeedUser(account)
  }

  const sessions = await Promise.all(
    accounts.map(async (account) => ({
      account,
      accessToken: await signIn(cognitoClient, cognitoClientId, account),
    })),
  )

  const preparedOrders = await Promise.all(
    sessions.map(async (session) => {
      const cart = await apiRequest<CartResponse>(apiBaseUrl, '/carts', session.accessToken, {
        method: 'POST',
        body: JSON.stringify({ ttlDays: 1 }),
      })

      await apiRequest(apiBaseUrl, `/carts/${cart.cartId}/items`, session.accessToken, {
        method: 'POST',
        body: JSON.stringify({
          productId,
          quantity: 1,
        }),
      })

      return { session, cartId: cart.cartId }
    }),
  )

  const placedOrders = await Promise.all(
    preparedOrders.map(async ({ session, cartId }) => ({
      session,
      order: await apiRequest<PlaceOrderResponse>(apiBaseUrl, '/orders', session.accessToken, {
        method: 'POST',
        body: JSON.stringify({ cartId }),
      }),
    })),
  )

  const finalOrders = await Promise.all(
    placedOrders.map(({ session, order }) =>
      waitForOrderResolution(apiBaseUrl, session.accessToken, order.orderId),
    ),
  )

  const inventoryResponse = await documentClient.send(
    new GetCommand({
      TableName: runtimeEnv.INVENTORY_TABLE,
      Key: { productId },
    }),
  )

  const inventory = inventoryResponse.Item as InventoryRecord | undefined
  const statusCounts = finalOrders.reduce<Record<string, number>>((result, order) => {
    result[order.status] = (result[order.status] ?? 0) + 1
    return result
  }, {})

  console.log(
    JSON.stringify(
      {
        productId,
        customers,
        startingAvailableQuantity: inventoryQuantity,
        statusCounts,
        orders: finalOrders.map((order) => ({
          orderId: order.orderId,
          status: order.status,
        })),
        inventory,
      },
      null,
      2,
    ),
  )
}

function buildSimulationUsers(customers: number): SeedUserAccount[] {
  return Array.from({ length: customers }, (_, index) => {
    const suffix = String(index + 1).padStart(3, '0')
    return {
      username: `oversell-customer-${suffix}`,
      email: `oversell.customer.${suffix}@example.com`,
      password: 'Customer@123',
      group: 'customer' as const,
      name: `Oversell Customer ${suffix}`,
    }
  })
}

async function signIn(
  cognitoClient: ReturnType<typeof getScriptContext>['cognitoClient'],
  clientId: string,
  account: SeedUserAccount,
): Promise<string> {
  const response = await cognitoClient.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: account.username,
        PASSWORD: account.password,
      },
    }),
  )

  const tokens = response.AuthenticationResult
  const accessToken = readAccessToken(tokens)
  if (!accessToken) {
    throw new Error(`Cognito sign in did not return an access token for ${account.username}.`)
  }

  return accessToken
}

function readAccessToken(tokens: AuthenticationResultType | undefined): string | undefined {
  return tokens?.AccessToken
}

async function waitForOrderResolution(
  apiBaseUrl: string,
  accessToken: string,
  orderId: string,
): Promise<OrderDetails> {
  const deadline = Date.now() + 90_000

  while (Date.now() < deadline) {
    const order = await apiRequest<OrderDetails>(apiBaseUrl, `/orders/${orderId}`, accessToken, {
      method: 'GET',
    })

    if (order.status !== 'PENDING') {
      return order
    }

    await wait(1500)
  }

  throw new Error(`Timed out waiting for order ${orderId} to leave PENDING state.`)
}

async function apiRequest<TResponse>(
  apiBaseUrl: string,
  resourcePath: string,
  accessToken: string,
  init: RequestInit,
): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${resourcePath}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Request ${init.method ?? 'GET'} ${resourcePath} failed with ${response.status}: ${body}`,
    )
  }

  if (response.status === 204) {
    return undefined as TResponse
  }

  return (await response.json()) as TResponse
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

void main().catch(exitWithError)
