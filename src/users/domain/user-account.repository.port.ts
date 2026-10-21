import { UserAccount, UserLoginAudit } from './user.entity'

export const USER_ACCOUNT_REPOSITORY = Symbol('USER_ACCOUNT_REPOSITORY')

export interface LoginContextFields {
  updatedAt: string
  lastLoginIp?: string
  lastLoginUserAgent?: string
}

export interface LoginAuditContextFields {
  updatedAt: string
  ipAddress?: string
  userAgent?: string
}

export interface LoginAuditQueryResult {
  items: UserLoginAudit[]
  lastEvaluatedKey?: Record<string, unknown>
}

/**
 * Port for the DynamoDB-backed `userAccounts`/`userLoginAudit` tables,
 * implemented by the infrastructure layer. Kept free of any NestJS/AWS SDK
 * type so the application layer can depend on it directly.
 */
export interface UserAccountRepositoryPort {
  findById(userId: string): Promise<UserAccount | null>

  /** Full overwrite of the stored account (put semantics), matching the pre-refactor behavior. */
  save(account: UserAccount): Promise<void>

  updateLoginContext(userId: string, fields: LoginContextFields): Promise<void>

  findLatestLoginAudit(userId: string): Promise<UserLoginAudit | undefined>

  updateLoginAuditContext(
    userId: string,
    loginAt: string,
    fields: LoginAuditContextFields,
  ): Promise<void>

  queryLoginAudit(
    userId: string,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<LoginAuditQueryResult>
}
