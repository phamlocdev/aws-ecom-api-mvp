export const Permission = {
  AUDIT_READ: 'audit:read',
  PRODUCTS_READ: 'products:read',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  CATEGORIES_READ: 'categories:read',
  CATEGORIES_CREATE: 'categories:create',
  CATEGORIES_UPDATE: 'categories:update',
  CATEGORIES_DELETE: 'categories:delete',
  INVENTORIES_READ: 'inventories:read',
  INVENTORIES_UPDATE: 'inventories:update',
  ORDERS_READ: 'orders:read',
  ORDERS_UPDATE: 'orders:update',
  ORDERS_EMAIL_READ: 'orders:email:read',
  ORDERS_EMAIL_RESEND: 'orders:email:resend',
  USERS_READ: 'users:read',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DISABLE: 'users:disable',
  USERS_PERMISSIONS_UPDATE: 'users:permissions:update',
  USERS_EMAIL_READ: 'users:email:read',
  USERS_EMAIL_RESEND: 'users:email:resend',
  USERS_LOGIN_AUDIT_READ: 'users:login-audit:read',
} as const

export type Permission = (typeof Permission)[keyof typeof Permission]

export const ALL_PERMISSIONS = Object.values(Permission)

export const ADMIN_PERMISSIONS = ALL_PERMISSIONS

export const MANAGER_PERMISSIONS: Permission[] = [
  Permission.PRODUCTS_READ,
  Permission.PRODUCTS_CREATE,
  Permission.PRODUCTS_UPDATE,
  Permission.CATEGORIES_READ,
  Permission.CATEGORIES_CREATE,
  Permission.CATEGORIES_UPDATE,
  Permission.INVENTORIES_READ,
  Permission.INVENTORIES_UPDATE,
  Permission.ORDERS_READ,
  Permission.ORDERS_UPDATE,
  Permission.ORDERS_EMAIL_READ,
  Permission.ORDERS_EMAIL_RESEND,
]

export const CUSTOMER_PERMISSIONS: Permission[] = []

export function normalizePermissions(values: unknown): Permission[] {
  const items = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? parsePermissionString(values)
      : []
  const allowed = new Set<string>(ALL_PERMISSIONS)
  const unique = new Set<Permission>()

  for (const item of items) {
    if (typeof item === 'string' && allowed.has(item)) {
      unique.add(item as Permission)
    }
  }

  return [...unique].sort()
}

function parsePermissionString(value: string): unknown[] {
  const normalized = value.trim()
  if (!normalized) {
    return []
  }

  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    const inner = normalized.slice(1, -1).trim()
    if (!inner) {
      return []
    }

    try {
      const parsed = JSON.parse(normalized) as unknown
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return inner
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    }
  }

  return normalized
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}
