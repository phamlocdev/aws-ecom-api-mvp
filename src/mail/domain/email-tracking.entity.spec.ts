import { EmailTracking } from './email-tracking.entity'

function makeTracking(overrides: Record<string, unknown> = {}): EmailTracking {
  return EmailTracking.fromRecord({
    emailId: 'e1',
    emailType: 'ORDER_CONFIRMATION',
    recipientEmail: 'user@example.com',
    status: 'PENDING',
    contextType: 'ORDER',
    contextId: 'order1',
    contextKey: 'key1',
    attemptNumber: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Getter: isRetryable
// ---------------------------------------------------------------------------

describe('EmailTracking.isRetryable', () => {
  it('returns true when status is FAILED with no bounceType', () => {
    expect(makeTracking({ status: 'FAILED' }).isRetryable).toBe(true)
  })

  it('returns true when status is BOUNCED with Transient bounceType', () => {
    expect(makeTracking({ status: 'BOUNCED', bounceType: 'Transient' }).isRetryable).toBe(true)
  })

  it('returns true when status is BOUNCED with Undetermined bounceType', () => {
    expect(makeTracking({ status: 'BOUNCED', bounceType: 'Undetermined' }).isRetryable).toBe(true)
  })

  it('returns false when status is BOUNCED with Permanent bounceType', () => {
    expect(makeTracking({ status: 'BOUNCED', bounceType: 'Permanent' }).isRetryable).toBe(false)
  })

  it('returns false when status is DELIVERED', () => {
    expect(makeTracking({ status: 'DELIVERED' }).isRetryable).toBe(false)
  })

  it('returns false when status is SENT', () => {
    expect(makeTracking({ status: 'SENT' }).isRetryable).toBe(false)
  })

  it('returns false when status is PENDING', () => {
    expect(makeTracking({ status: 'PENDING' }).isRetryable).toBe(false)
  })

  it('returns false when status is SKIPPED', () => {
    expect(makeTracking({ status: 'SKIPPED' }).isRetryable).toBe(false)
  })

  it('returns false when status is COMPLAINED', () => {
    expect(makeTracking({ status: 'COMPLAINED' }).isRetryable).toBe(false)
  })

  it('returns false when status is REJECTED', () => {
    expect(makeTracking({ status: 'REJECTED' }).isRetryable).toBe(false)
  })
})
