import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common'
import type { Response } from 'express'
import {
  ConflictError,
  DomainError,
  ForbiddenDomainError,
  InvalidInputError,
  NotFoundError,
  UnauthorizedDomainError,
} from './domain-error'

function statusForError(exception: DomainError): HttpStatus {
  if (exception instanceof NotFoundError) return HttpStatus.NOT_FOUND
  if (exception instanceof ConflictError) return HttpStatus.CONFLICT
  if (exception instanceof InvalidInputError) return HttpStatus.BAD_REQUEST
  if (exception instanceof ForbiddenDomainError) return HttpStatus.FORBIDDEN
  if (exception instanceof UnauthorizedDomainError) return HttpStatus.UNAUTHORIZED
  return HttpStatus.INTERNAL_SERVER_ERROR
}

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    const status = statusForError(exception)

    response.status(status).json({
      statusCode: status,
      message: exception.message,
      ...(exception instanceof InvalidInputError && exception.details
        ? { details: exception.details }
        : {}),
    })
  }
}
