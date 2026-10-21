import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PermissionsGuard } from './permissions.guard'
import { Permission } from './permissions'
import { AuthenticatedRequest } from './auth.types'

describe('PermissionsGuard', () => {
  function createContext(user: AuthenticatedRequest['user'] | undefined): ExecutionContext {
    return {
      getHandler: () => ({}) as unknown,
      getClass: () => ({}) as unknown,
      switchToHttp: () => ({
        getRequest: () => ({ user }) as AuthenticatedRequest,
      }),
    } as unknown as ExecutionContext
  }

  function createGuard(overrides: {
    isPublic?: boolean
    requiredPermissions?: Permission[]
  }): PermissionsGuard {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(overrides.isPublic ?? false)
        .mockReturnValueOnce(overrides.requiredPermissions),
    } as unknown as Reflector

    return new PermissionsGuard(reflector)
  }

  it('allows access when the route is public, regardless of user', () => {
    const guard = createGuard({ isPublic: true })
    expect(guard.canActivate(createContext(undefined))).toBe(true)
  })

  it('allows access when the route declares no required permissions', () => {
    const guard = createGuard({ requiredPermissions: undefined })
    expect(guard.canActivate(createContext(undefined))).toBe(true)
  })

  it('allows access when the route declares an empty required permissions list', () => {
    const guard = createGuard({ requiredPermissions: [] })
    expect(guard.canActivate(createContext(undefined))).toBe(true)
  })

  it('throws Unauthorized when permissions are required but there is no authenticated user', () => {
    const guard = createGuard({ requiredPermissions: [Permission.PRODUCTS_READ] })
    expect(() => guard.canActivate(createContext(undefined))).toThrow(UnauthorizedException)
  })

  it('throws Forbidden when the authenticated user lacks one of the required permissions', () => {
    const guard = createGuard({
      requiredPermissions: [Permission.PRODUCTS_READ, Permission.PRODUCTS_UPDATE],
    })
    const user = { permissions: [Permission.PRODUCTS_READ] } as AuthenticatedRequest['user']
    expect(() => guard.canActivate(createContext(user))).toThrow(ForbiddenException)
  })

  it('allows access when the authenticated user has all required permissions', () => {
    const guard = createGuard({
      requiredPermissions: [Permission.PRODUCTS_READ, Permission.PRODUCTS_UPDATE],
    })
    const user = {
      permissions: [Permission.PRODUCTS_READ, Permission.PRODUCTS_UPDATE, Permission.PRODUCTS_DELETE],
    } as AuthenticatedRequest['user']
    expect(guard.canActivate(createContext(user))).toBe(true)
  })
})
