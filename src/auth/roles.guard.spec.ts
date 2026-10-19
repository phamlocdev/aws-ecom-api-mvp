import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { RolesGuard } from './roles.guard'
import { Role } from './roles.enum'
import { AuthenticatedRequest } from './auth.types'

describe('RolesGuard', () => {
  function createContext(user: AuthenticatedRequest['user'] | undefined): ExecutionContext {
    return {
      getHandler: () => ({}) as unknown,
      getClass: () => ({}) as unknown,
      switchToHttp: () => ({
        getRequest: () => ({ user }) as AuthenticatedRequest,
      }),
    } as unknown as ExecutionContext
  }

  function createGuard(overrides: { isPublic?: boolean; requiredRoles?: Role[] }): RolesGuard {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(overrides.isPublic ?? false)
        .mockReturnValueOnce(overrides.requiredRoles),
    } as unknown as Reflector

    return new RolesGuard(reflector)
  }

  it('allows access when the route is public, regardless of user', () => {
    const guard = createGuard({ isPublic: true })
    expect(guard.canActivate(createContext(undefined))).toBe(true)
  })

  it('allows access when the route declares no required roles', () => {
    const guard = createGuard({ requiredRoles: undefined })
    expect(guard.canActivate(createContext(undefined))).toBe(true)
  })

  it('throws Unauthorized when roles are required but there is no authenticated user', () => {
    const guard = createGuard({ requiredRoles: [Role.ADMIN] })
    expect(() => guard.canActivate(createContext(undefined))).toThrow(UnauthorizedException)
  })

  it('throws Forbidden when the authenticated user lacks the required role', () => {
    const guard = createGuard({ requiredRoles: [Role.ADMIN] })
    const user = { groups: [Role.CUSTOMER] } as AuthenticatedRequest['user']
    expect(() => guard.canActivate(createContext(user))).toThrow(ForbiddenException)
  })

  it('allows access when the authenticated user has one of the required roles', () => {
    const guard = createGuard({ requiredRoles: [Role.ADMIN, Role.MANAGER] })
    const user = { groups: [Role.MANAGER] } as AuthenticatedRequest['user']
    expect(guard.canActivate(createContext(user))).toBe(true)
  })
})
