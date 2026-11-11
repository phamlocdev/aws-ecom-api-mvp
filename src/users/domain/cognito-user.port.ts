export const COGNITO_USER_REPOSITORY = Symbol('COGNITO_USER_REPOSITORY')

export interface CognitoUserRecord {
  username: string
  enabled: boolean
  status?: string
  attributes: Record<string, string>
  createdAt?: string
  updatedAt?: string
}

export interface CreateCognitoUserInput {
  username: string
  email: string
  name?: string
  temporaryPassword: string
}

/**
 * Port for Cognito identity operations, implemented by the infrastructure
 * layer. Kept free of any NestJS/AWS SDK type so the application layer can
 * depend on it directly.
 */
export interface CognitoUserPort {
  listAllUsers(): Promise<CognitoUserRecord[]>

  getUserGroups(username: string): Promise<string[]>

  /**
   * Pass-through of the raw Cognito error when the user does not exist. The
   * pre-refactor code never caught this at this call site, so it is
   * intentionally NOT translated to a domain error here (see
   * docs/refactor/PROGRESS.md, nhật ký `users`).
   */
  getUserByUsername(username: string): Promise<CognitoUserRecord>

  /** Throws ConflictError if the username already exists (the only Cognito error the pre-refactor code translated explicitly). */
  createUser(input: CreateCognitoUserInput): Promise<void>

  addUserToGroup(username: string, group: string): Promise<void>

  updateUserAttributes(username: string, attributes: Record<string, string>): Promise<void>

  enableUser(username: string): Promise<void>

  disableUser(username: string): Promise<void>

  setUserPassword(username: string, password: string, permanent: boolean): Promise<void>

  /** Returns the first user matching the email filter, or null. */
  findUserByEmail(email: string): Promise<CognitoUserRecord | null>
}
