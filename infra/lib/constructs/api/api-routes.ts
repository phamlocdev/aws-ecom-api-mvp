import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers'
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { routeAuthOptions } from '../../shared/route-auth-options'

export function registerApiRoutes(
  api: apigatewayv2.HttpApi,
  integration: integrations.HttpLambdaIntegration,
  authorizer?: authorizers.HttpJwtAuthorizer,
): void {
  api.addRoutes({
    path: '/health',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
  })

  api.addRoutes({
    path: '/audit',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
    ...routeAuthOptions(authorizer),
  })

  api.addRoutes({
    path: '/products',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
  })
  api.addRoutes({
    path: '/products',
    methods: [apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/products/{productId}',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
  })
  api.addRoutes({
    path: '/products/{productId}',
    methods: [apigatewayv2.HttpMethod.PATCH, apigatewayv2.HttpMethod.DELETE],
    integration,
    ...routeAuthOptions(authorizer),
  })

  api.addRoutes({
    path: '/upload/presign',
    methods: [apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })

  api.addRoutes({
    path: '/categories',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
  })
  api.addRoutes({
    path: '/categories',
    methods: [apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/categories/{categoryId}',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
  })
  api.addRoutes({
    path: '/categories/{categoryId}',
    methods: [apigatewayv2.HttpMethod.PATCH, apigatewayv2.HttpMethod.DELETE],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/users',
    methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/users/email-statistics',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/users/login-audit',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/users/me/login-context',
    methods: [apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/users/{userId}/email-tracking',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/users/{userId}',
    methods: [apigatewayv2.HttpMethod.PATCH, apigatewayv2.HttpMethod.DELETE],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/users/{userId}/permissions',
    methods: [apigatewayv2.HttpMethod.PATCH],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/users/{userId}/password',
    methods: [apigatewayv2.HttpMethod.PATCH],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/users/{userId}/emails/welcome-new-customer/resend-failed',
    methods: [apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/users/me/profile',
    methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PATCH],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/users/me/password',
    methods: [apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })

  api.addRoutes({
    path: '/carts',
    methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/carts/{cartId}',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/carts/{cartId}/items',
    methods: [apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/carts/{cartId}/items/{productId}',
    methods: [apigatewayv2.HttpMethod.PATCH, apigatewayv2.HttpMethod.DELETE],
    integration,
    ...routeAuthOptions(authorizer),
  })

  api.addRoutes({
    path: '/orders',
    methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/orders/email-statistics',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/orders/{orderId}',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/orders/{orderId}/email-tracking',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/orders/{orderId}/status',
    methods: [apigatewayv2.HttpMethod.PATCH],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/orders/{orderId}/emails/{emailType}/resend-failed',
    methods: [apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/orders/{orderId}/pay',
    methods: [apigatewayv2.HttpMethod.POST],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/payments/vnpay/return',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
  })
  api.addRoutes({
    path: '/payments/vnpay/ipn',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
  })
  api.addRoutes({
    path: '/inventories',
    methods: [apigatewayv2.HttpMethod.GET],
    integration,
    ...routeAuthOptions(authorizer),
  })
  api.addRoutes({
    path: '/inventories/{productId}',
    methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PATCH],
    integration,
    ...routeAuthOptions(authorizer),
  })
}
