import { ArgumentsHost } from '@nestjs/common'
import { DomainExceptionFilter } from './domain-exception.filter'
import {
  ConflictError,
  ForbiddenDomainError,
  InvalidInputError,
  NotFoundError,
  UnauthorizedDomainError,
} from './domain-error'

// Baseline test for Giai đoạn 1: locks in the HTTP status mapping so service
// code can throw DomainError subclasses instead of NestJS exceptions without
// changing the API contract. See docs/refactor/PLAN.md.
describe('DomainExceptionFilter', () => {
  const filter = new DomainExceptionFilter()

  function createHost() {
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost
    return { host, status, json }
  }

  it.each([
    [new NotFoundError('not found'), 404],
    [new ConflictError('conflict'), 409],
    [new InvalidInputError('invalid'), 400],
    [new ForbiddenDomainError('forbidden'), 403],
    [new UnauthorizedDomainError('unauthorized'), 401],
  ])('maps %p to HTTP %d', (exception, expectedStatus) => {
    const { host, status, json } = createHost()

    filter.catch(exception, host)

    expect(status).toHaveBeenCalledWith(expectedStatus)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: expectedStatus, message: exception.message }),
    )
  })

  it('includes details for InvalidInputError when provided', () => {
    const { host, json } = createHost()
    const exception = new InvalidInputError('invalid', ['field is required'])

    filter.catch(exception, host)

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ details: ['field is required'] }),
    )
  })
})
