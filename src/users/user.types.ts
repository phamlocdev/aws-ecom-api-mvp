import { EmailDeliverySummary, EmailType } from '../mail/mail.types'
import { Permission } from '../auth/permissions'

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

export interface CustomerProfile {
  username: string
  email?: string
  name?: string
  sub?: string
}

export interface UserProfile {
  userId: string
  username: string
  email?: string
  name?: string
  avatarKey?: string
  avatarReadUrl?: string
  avatarReadUrlExpiresInSeconds?: number
  passwordStatus: UserPasswordStatus
  createdAt: string
  updatedAt: string
}

export type UserAccount = {
  userId: string
  username: string
  email?: string
  name?: string
  avatarKey?: string
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

export type UserLoginAudit = {
  userId: string
  loginAt: string
  loginId: string
  username?: string
  email?: string
  ipAddress?: string
  userAgent?: string
  userPoolId: string
  clientId?: string
  triggerSource: string
  newDeviceUsed?: boolean
  createdAt: string
  expiresAt: number
}

export type UserLoginAuditQueryResult = {
  items: UserLoginAudit[]
  nextCursor: string | null
}

export interface ResendUserEmailResult {
  userId: string
  emailType: EmailType
  recipientEmails: string[]
  resentCount: number
  status: string
  reason?: string
}

export type UserPermissionsRecord = {
  userId: string
  permissions: Permission[]
  createdAt: string
  updatedAt: string
}
