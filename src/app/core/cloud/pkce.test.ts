import { describe, expect, it } from 'vitest'
import { challengeFor, createState, createVerifier } from './pkce'

/** Only these characters may appear in base64url output. Padding is stripped. */
const BASE64URL = /^[A-Za-z0-9\-_]+$/

describe('createVerifier', () => {
  it('stays inside the length RFC 7636 allows', () => {
    const verifier = createVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
  })

  it('is base64url, so a query string cannot alter it in transit', () => {
    expect(createVerifier()).toMatch(BASE64URL)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 50 }, () => createVerifier()))
    expect(seen.size).toBe(50)
  })
})

describe('challengeFor', () => {
  /*
   * The worked example from RFC 7636 Appendix B. Pinning it here is what proves this is a
   * real S256 challenge and not merely a self-consistent one -- a hash with the wrong
   * encoding round-trips against itself perfectly and is rejected only by Dropbox.
   */
  it('matches the RFC 7636 test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    await expect(challengeFor(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('is base64url and unpadded', async () => {
    const challenge = await challengeFor(createVerifier())
    expect(challenge).toMatch(BASE64URL)
    expect(challenge).not.toContain('=')
  })

  it('is stable for one verifier and different across two', async () => {
    const a = createVerifier()
    expect(await challengeFor(a)).toBe(await challengeFor(a))
    expect(await challengeFor(a)).not.toBe(await challengeFor(createVerifier()))
  })
})

describe('createState', () => {
  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 50 }, () => createState()))
    expect(seen.size).toBe(50)
  })
})
