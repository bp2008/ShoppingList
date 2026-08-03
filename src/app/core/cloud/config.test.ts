import { describe, expect, it } from 'vitest'
import { REDIRECT_URIS, matchRedirectUri } from './config'

const LOCAL = 'http://localhost:5173/'
const PAGES = 'https://bp2008.github.io/ShoppingList/'

describe('REDIRECT_URIS', () => {
  it('holds the two addresses registered with Dropbox', () => {
    expect(REDIRECT_URIS).toEqual([LOCAL, PAGES])
  })

  /*
   * The value returned is handed straight to Dropbox as `redirect_uri`, where it has to be
   * byte-identical to the registered string. Every entry therefore has to already be in the
   * normalised form `matchRedirectUri` compares against, or nothing would ever match it.
   */
  it('is stored in the same normalised form the matcher produces', () => {
    for (const uri of REDIRECT_URIS) expect(matchRedirectUri(uri)).toBe(uri)
  })
})

describe('matchRedirectUri', () => {
  it('accepts the registered addresses', () => {
    expect(matchRedirectUri(LOCAL)).toBe(LOCAL)
    expect(matchRedirectUri(PAGES)).toBe(PAGES)
  })

  it('ignores the hash route, which is where the app almost always is', () => {
    expect(matchRedirectUri(`${PAGES}#/list/abc123?settings`)).toBe(PAGES)
    expect(matchRedirectUri(`${LOCAL}#/`)).toBe(LOCAL)
  })

  it('ignores a query string, including a returning OAuth code', () => {
    expect(matchRedirectUri(`${PAGES}?code=xyz&state=abc`)).toBe(PAGES)
  })

  it('treats index.html and a missing trailing slash as the same directory', () => {
    expect(matchRedirectUri(`${PAGES}index.html`)).toBe(PAGES)
    expect(matchRedirectUri('https://bp2008.github.io/ShoppingList')).toBe(PAGES)
  })

  /* A fork, a clone served from anywhere else, or the built site on another port. */
  describe('refuses anywhere unregistered', () => {
    it.each([
      ['a fork on another host', 'https://someone-else.github.io/ShoppingList/'],
      ['the same host, another project', 'https://bp2008.github.io/OtherApp/'],
      ['a different port', 'http://localhost:8080/ShoppingList/'],
      ['the built site served locally', 'http://localhost:8080/'],
      ['a subdirectory of a registered path', `${PAGES}releases/`],
      ['plain http against the live host', 'http://bp2008.github.io/ShoppingList/'],
      ['a file:// copy', 'file:///C:/ShoppingList/index.html'],
      ['nonsense', 'not a url'],
      ['empty', ''],
    ])('%s', (_label, href) => {
      expect(matchRedirectUri(href)).toBeNull()
    })
  })

  it('is case-sensitive about the path, which GitHub Pages also is', () => {
    expect(matchRedirectUri('https://bp2008.github.io/shoppinglist/')).toBeNull()
  })
})
