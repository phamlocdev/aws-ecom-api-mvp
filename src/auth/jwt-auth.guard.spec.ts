import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtAuthGuard } from './jwt-auth.guard'
import { AuthenticatedRequest } from './auth.types'

describe('JwtAuthGuard', () => {
  function createContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
    return {
      getHandler: () => ({}) as unknown,
      getClass: () => ({}) as unknown,
      switchToHttp: () => ({
        getRequest: () => request as AuthenticatedRequest,
      }),
    } as unknown as ExecutionContext
  }

  function createGuard(isPublic: boolean): JwtAuthGuard {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(isPublic),
    } as unknown as Reflector

    return new JwtAuthGuard(reflector)
  }

  function encodeClaims(claims: Record<string, unknown>): string {
    const base64url = (value: Record<string, unknown>): string =>
      Buffer.from(JSON.stringify(value)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    return `${base64url({ alg: 'none' })}.${base64url(claims)}.signature`
  }

  it('allows access when the route is public, without inspecting claims', () => {
    const guard = createGuard(true)
    const request: Partial<AuthenticatedRequest> = { headers: {} as AuthenticatedRequest['headers'] }
    expect(guard.canActivate(createContext(request))).toBe(true)
    expect(request.user).toBeUndefined()
  })

  it('throws Unauthorized when there is no API Gateway authorizer context and no bearer token', () => {
    const guard = createGuard(false)
    const request: Partial<AuthenticatedRequest> = { headers: {} as AuthenticatedRequest['headers'] }
    expect(() => guard.canActivate(createContext(request))).toThrow(UnauthorizedException)
  })

  it('reads claims from the API Gateway JWT authorizer and populates request.user', () => {
    const guard = createGuard(false)
    const request: Partial<AuthenticatedRequest> = {
      headers: {} as AuthenticatedRequest['headers'],
      apiGateway: {
        event: {
          requestContext: {
            authorizer: {
              jwt: {
                claims: {
                  sub: 'user-1',
                  username: 'alice',
                  client_id: 'client-1',
                  email: 'alice@example.com',
                  'cognito:groups': ['admin'],
                  'app:permissions': ['products:read'],
                },
              },
            },
          },
        },
      } as never,
    }

    expect(guard.canActivate(createContext(request))).toBe(true)
    expect(request.user).toMatchObject({
      sub: 'user-1',
      username: 'alice',
      clientId: 'client-1',
      email: 'alice@example.com',
      groups: ['admin'],
      permissions: ['products:read'],
      tokenUse: 'access',
    })
  })

  it('throws Unauthorized for a Bearer token when there is no API Gateway authorizer context at all', () => {
    // Current behavior: readJwtClaims only looks at the Bearer token when `request.apiGateway.event`
    // already exists with an `authorizer` key in requestContext — a bare Bearer token with no
    // apiGateway event on the request is NOT read, even though it decodes successfully.
    const guard = createGuard(false)
    const token = encodeClaims({ sub: 'user-2', username: 'bob', client_id: 'client-2' })
    const request: Partial<AuthenticatedRequest> = {
      headers: { authorization: `Bearer ${token}` } as AuthenticatedRequest['headers'],
    }

    expect(() => guard.canActivate(createContext(request))).toThrow(UnauthorizedException)
  })

  it('merges an unverified Bearer token on top of an empty API Gateway authorizer context', () => {
    const guard = createGuard(false)
    const token = encodeClaims({
      sub: 'user-2',
      username: 'bob',
      client_id: 'client-2',
      'cognito:groups': 'manager',
    })
    const request: Partial<AuthenticatedRequest> = {
      headers: { authorization: `Bearer ${token}` } as AuthenticatedRequest['headers'],
      apiGateway: {
        event: { requestContext: { authorizer: {} } } as never,
      },
    }

    expect(guard.canActivate(createContext(request))).toBe(true)
    expect(request.user).toMatchObject({
      sub: 'user-2',
      username: 'bob',
      clientId: 'client-2',
      groups: ['manager'],
    })
  })

  it('throws Unauthorized when required claims (username/client_id/sub) are incomplete', () => {
    const guard = createGuard(false)
    const request: Partial<AuthenticatedRequest> = {
      headers: {} as AuthenticatedRequest['headers'],
      apiGateway: {
        event: {
          requestContext: {
            authorizer: {
              jwt: {
                claims: {
                  sub: 'user-3',
                },
              },
            },
          },
        },
      } as never,
    }

    expect(() => guard.canActivate(createContext(request))).toThrow(UnauthorizedException)
  })
})
