import { z } from 'zod'
import { EmailDeliverySummary } from '../../mail/domain/email-tracking.entity'
import { EmailType } from '../../mail/mail.types'
import { Permission } from '../../auth/permissions'

export type ManagedUser = {
  username: string
  enabled: boolean
  status?: string
  accountStatus?: UserAccountStatus
  name?: string
  sub?: string
  email?: string
  emailVerified: boolean
  groups: string[]
  permissions: Permission[]
  createdAt?: string
  updatedAt?: string
  welcomeEmailTracking?: EmailDeliverySummary
  passwordStatus?: UserPasswordStatus
}

export type UserAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING_APPROVAL' | 'DELETED'
export type UserPasswordStatus = 'REQUIRED' | 'SET'

const UserAddressPropsSchema = z.object({
  recipientName: z.string().optional(),
  phone: z.string().optional(),
  line1: z.string().optional(),
  location: z.object({
    ward: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
  }).optional(),
  notes: z.string().optional(),
})

type UserAddressProps = z.infer<typeof UserAddressPropsSchema>

export class UserAddress {
  readonly recipientName?: string
  readonly phone?: string
  readonly line1?: string
  readonly location?: { ward?: string; district?: string; city?: string }
  readonly notes?: string

  private constructor(props: UserAddressProps) {
    Object.assign(this, props)
  }

  static create(data: UserAddressProps): UserAddress {
    return new UserAddress(data)
  }

  static fromRecord(item: Record<string, unknown>): UserAddress {
    return new UserAddress(UserAddressPropsSchema.parse(item))
  }
}

export interface CustomerProfile {
  username: string
  email?: string
  name?: string
  sub?: string
}

const UserProfilePropsSchema = z.object({
  userId: z.string(),
  username: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  avatarKey: z.string().optional(),
  avatarReadUrl: z.string().optional(),
  avatarReadUrlExpiresInSeconds: z.number().optional(),
  address: UserAddressPropsSchema.optional(),
  passwordStatus: z.enum(['REQUIRED', 'SET']),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type UserProfileProps = {
  userId: string
  username: string
  email?: string
  name?: string
  avatarKey?: string
  avatarReadUrl?: string
  avatarReadUrlExpiresInSeconds?: number
  address?: UserAddress
  passwordStatus: UserPasswordStatus
  createdAt: string
  updatedAt: string
}

export class UserProfile {
  readonly userId!: string
  readonly username!: string
  readonly email?: string
  readonly name?: string
  readonly avatarKey?: string
  readonly avatarReadUrl?: string
  readonly avatarReadUrlExpiresInSeconds?: number
  readonly address?: UserAddress
  readonly passwordStatus!: UserPasswordStatus
  readonly createdAt!: string
  readonly updatedAt!: string

  private constructor(props: UserProfileProps) {
    Object.assign(this, props)
  }

  static fromRecord(item: Record<string, unknown>): UserProfile {
    const parsed = UserProfilePropsSchema.parse(item)
    return new UserProfile({
      ...parsed,
      passwordStatus: parsed.passwordStatus as UserPasswordStatus,
      address: parsed.address ? UserAddress.create(parsed.address) : undefined,
    })
  }
}

const UserAccountPropsSchema = z.object({
  userId: z.string(),
  username: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  avatarKey: z.string().optional(),
  address: UserAddressPropsSchema.optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING_APPROVAL', 'DELETED']).optional(),
  passwordStatus: z.enum(['REQUIRED', 'SET']).optional(),
  permissions: z.array(z.string()),
  lastModifiedByType: z.string().optional(),
  lastModifiedById: z.string().optional(),
  lastModifiedByEmail: z.string().optional(),
  lastModifiedReason: z.string().optional(),
  lastLoginAt: z.string().optional(),
  lastLoginIp: z.string().optional(),
  lastLoginUserAgent: z.string().optional(),
  loginCount: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type UserAccountProps = {
  userId: string
  username: string
  email?: string
  name?: string
  avatarKey?: string
  address?: UserAddress
  status?: UserAccountStatus
  passwordStatus?: UserPasswordStatus
  permissions: Permission[]
  lastModifiedByType?: string
  lastModifiedById?: string
  lastModifiedByEmail?: string
  lastModifiedReason?: string
  lastLoginAt?: string
  lastLoginIp?: string
  lastLoginUserAgent?: string
  loginCount?: number
  createdAt: string
  updatedAt: string
}

export class UserAccount {
  readonly userId!: string
  readonly username!: string
  readonly email?: string
  readonly name?: string
  readonly avatarKey?: string
  readonly address?: UserAddress
  readonly status?: UserAccountStatus
  readonly passwordStatus?: UserPasswordStatus
  readonly permissions!: Permission[]
  readonly lastModifiedByType?: string
  readonly lastModifiedById?: string
  readonly lastModifiedByEmail?: string
  readonly lastModifiedReason?: string
  readonly lastLoginAt?: string
  readonly lastLoginIp?: string
  readonly lastLoginUserAgent?: string
  readonly loginCount?: number
  readonly createdAt!: string
  readonly updatedAt!: string

  private constructor(props: UserAccountProps) {
    Object.assign(this, props)
  }

  static fromRecord(item: Record<string, unknown>): UserAccount {
    const parsed = UserAccountPropsSchema.parse(item)
    return new UserAccount({
      ...parsed,
      status: parsed.status as UserAccountStatus | undefined,
      passwordStatus: parsed.passwordStatus as UserPasswordStatus | undefined,
      permissions: parsed.permissions as Permission[],
      address: parsed.address ? UserAddress.create(parsed.address) : undefined,
    })
  }
}

const UserLoginAuditPropsSchema = z.object({
  userId: z.string(),
  loginAt: z.string(),
  loginId: z.string(),
  username: z.string().optional(),
  email: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  userPoolId: z.string(),
  clientId: z.string().optional(),
  triggerSource: z.string(),
  newDeviceUsed: z.boolean().optional(),
  createdAt: z.string(),
  expiresAt: z.number(),
})

type UserLoginAuditProps = z.infer<typeof UserLoginAuditPropsSchema>

export class UserLoginAudit {
  readonly userId!: string
  readonly loginAt!: string
  readonly loginId!: string
  readonly username?: string
  readonly email?: string
  readonly ipAddress?: string
  readonly userAgent?: string
  readonly userPoolId!: string
  readonly clientId?: string
  readonly triggerSource!: string
  readonly newDeviceUsed?: boolean
  readonly createdAt!: string
  readonly expiresAt!: number

  private constructor(props: UserLoginAuditProps) {
    Object.assign(this, props)
  }

  static fromRecord(item: Record<string, unknown>): UserLoginAudit {
    return new UserLoginAudit(UserLoginAuditPropsSchema.parse(item))
  }
}

type UserLoginAuditQueryResultProps = {
  items: UserLoginAudit[]
  nextCursor: string | null
}

export class UserLoginAuditQueryResult {
  readonly items!: UserLoginAudit[]
  readonly nextCursor!: string | null

  private constructor(props: UserLoginAuditQueryResultProps) {
    Object.assign(this, props)
  }

  static fromParts(items: UserLoginAudit[], nextCursor: string | null): UserLoginAuditQueryResult {
    return new UserLoginAuditQueryResult({ items, nextCursor })
  }
}

export interface ResendUserEmailResult {
  userId: string
  emailType: EmailType
  recipientEmails: string[]
  resentCount: number
  status: string
  reason?: string
}

const UserPermissionsRecordPropsSchema = z.object({
  userId: z.string(),
  permissions: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type UserPermissionsRecordProps = {
  userId: string
  permissions: Permission[]
  createdAt: string
  updatedAt: string
}

export class UserPermissionsRecord {
  readonly userId!: string
  readonly permissions!: Permission[]
  readonly createdAt!: string
  readonly updatedAt!: string

  private constructor(props: UserPermissionsRecordProps) {
    Object.assign(this, props)
  }

  static fromRecord(item: Record<string, unknown>): UserPermissionsRecord {
    const parsed = UserPermissionsRecordPropsSchema.parse(item)
    return new UserPermissionsRecord({ ...parsed, permissions: parsed.permissions as Permission[] })
  }
}
