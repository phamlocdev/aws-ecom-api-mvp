// Domain errors business logic should throw instead of NestJS HTTP exceptions
// directly (see docs/refactor/PLAN.md, Giai đoạn 1). DomainExceptionFilter
// maps each subclass to the matching HTTP status at the edge of the app.

export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message)
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message)
  }
}

export class InvalidInputError extends DomainError {
  constructor(
    message: string,
    public readonly details?: string[],
  ) {
    super(message)
  }
}

export class ForbiddenDomainError extends DomainError {
  constructor(message: string) {
    super(message)
  }
}

export class UnauthorizedDomainError extends DomainError {
  constructor(message: string) {
    super(message)
  }
}
