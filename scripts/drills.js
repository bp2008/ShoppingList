/*
 * Recovery drills.
 *
 * Paste into the devtools console of a running build (or save as a devtools Snippet).
 * Every function is deliberately destructive to APP FILES ONLY -- none of them touch the
 * slp-data IndexedDB database where the user's lists live.
 *
 * These corrupt real cache entries rather than going through a dev-only `?__fail=` flag.
 * That is a deliberate choice: a query-string flag would put test-only branches inside
 * the most safety-critical file in the project, and it would exercise the branch instead
 * of the failure. Breaking the actual bytes is what a bad deploy or an evicted cache
 * looks like from the bootloader's side.
 *
 * Usage:
 *   drills.help()
 *   await drills.breakActiveBuild()   // then reload three times
 *   await drills.state()
 */
;(function () {
  const boot = () => {
    const b = window.__slp && window.__slp.boot
    if (!b) throw new Error('Bootloader not present. Are you on a built site (not `npm run dev`)?')
    return b
  }

  const drills = {
    help() {
      console.log(
        [
          'state()               current build pointers, caches, error log',
          'breakActiveBuild()    replace the active bundle with unparseable text',
          'break404()            point the stored manifest at a file that does not exist',
          'breakBlank()          make the app mount nothing (health check must catch it)',
          'breakHang()           make the app never signal ready (watchdog must catch it)',
          'partialStageDrill()   prove a failed download leaves nothing behind',
          'seedData()            write a sample list so export has something to export',
          'reset()               clear all app caches and boot state (keeps your lists)',
          '',
          'Rollback drill: breakActiveBuild(), then reload 3x.',
          '  reload 1 + 2 -> rescue screen, attempts increments',
          '  reload 3     -> auto-rollback to previous, bad build quarantined',
          'Then publish a NEW build and reload twice: it should recover automatically.',
        ].join('\n'),
      )
    },

    async state() {
      const b = boot()
      const caches_ = {}
      for (const n of (await caches.keys()).sort()) {
        const c = await caches.open(n)
        caches_[n] = (await c.keys()).length + ' entries'
      }
      const out = {
        active: b.get('active'),
        previous: b.get('previous'),
        pending: b.get('pending'),
        attempts: b.get('attempts') || '0',
        rolledBack: b.get('rolledBack') === '1',
        bad: b.getJSON('bad', []),
        caches: caches_,
        errors: b.getJSON('errors', []).map((e) => e.reason),
      }
      console.table(out)
      return out
    },

    /** A release that does not parse. Should rescue immediately via window.onerror. */
    async breakActiveBuild() {
      const b = boot()
      const build = b.get('active')
      const mf = b.manifestOf(build)
      const url = new URL('releases/' + build + '/' + mf.entry, b.ROOT).href
      const cache = await caches.open(b.cachePrefix + build)
      await cache.put(
        url,
        new Response('this is (((not javascript', {
          headers: { 'content-type': 'text/javascript' },
        }),
      )
      console.log('Broke', build, '- reload to see the rescue screen.')
    },

    /** A release whose entry is missing. Should rescue via the script element's error event. */
    breakLink404() {
      const b = boot()
      const build = b.get('active')
      const mf = b.manifestOf(build)
      b.setJSON('mf.' + build, { ...mf, entry: 'assets/does-not-exist.js' })
      console.log('Pointed', build, 'at a missing entry - reload.')
    },

    /** Mounts, sets the ready flag, renders nothing. The offsetHeight check must catch it. */
    async breakBlank() {
      const b = boot()
      const build = b.get('active')
      const mf = b.manifestOf(build)
      const url = new URL('releases/' + build + '/' + mf.entry, b.ROOT).href
      const cache = await caches.open(b.cachePrefix + build)
      await cache.put(
        url,
        new Response('window.__APP_READY__ = true; window.__bootOk && window.__bootOk();', {
          headers: { 'content-type': 'text/javascript' },
        }),
      )
      console.log('Build', build, 'will now claim readiness without rendering - reload.')
    },

    /** Loads cleanly, never signals. Only the mount watchdog can catch this one. */
    async breakHang() {
      const b = boot()
      const build = b.get('active')
      const mf = b.manifestOf(build)
      const url = new URL('releases/' + build + '/' + mf.entry, b.ROOT).href
      const cache = await caches.open(b.cachePrefix + build)
      await cache.put(
        url,
        new Response('/* loads fine, does nothing */', {
          headers: { 'content-type': 'text/javascript' },
        }),
      )
      console.log('Build', build, 'will now hang - reload and wait ~5s.')
    },

    /** The atomicity guarantee: an interrupted download must leave no trace. */
    async partialStageDrill() {
      const b = boot()
      const build = b.get('active')
      const mf = b.manifestOf(build)
      const cacheName = b.cachePrefix + build
      const result = {}

      await caches.delete(cacheName)
      const realFetch = window.fetch.bind(window)
      const doomed = mf.assets[mf.assets.length - 1]
      window.fetch = (u, o) =>
        String(u).includes(doomed) ? Promise.reject(new TypeError('Failed to fetch')) : realFetch(u, o)

      try {
        await b.stage(mf)
        result.staged = 'RESOLVED — BUG, staging should have rejected'
      } catch (e) {
        result.staged = 'rejected as expected: ' + e.message
      }
      result.cacheLeftBehind = await caches.has(cacheName)
      result.pendingSet = b.get('pending')

      window.fetch = realFetch
      await b.stage(mf)
      result.retrySucceeded = await caches.has(cacheName)

      console.table(result)
      if (result.cacheLeftBehind || result.pendingSet) {
        console.error('ATOMICITY VIOLATED: a partial download was retained.')
      }
      return result
    },

    /** Sample data, so "Export my lists" has something to prove. */
    async seedData() {
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('slp-data', 1)
        req.onupgradeneeded = () => req.result.createObjectStore('kv')
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('kv', 'readwrite')
          tx.objectStore('kv').put(
            {
              schemaVersion: 1,
              lists: [
                {
                  id: 'l1',
                  name: 'Groceries',
                  modified: Date.now(),
                  showOthers: false,
                  catalog: [
                    { id: 'c1', name: 'Milk' },
                    { id: 'c2', name: 'Eggs' },
                  ],
                  items: [{ cid: 'c1', qty: 2 }],
                },
              ],
              settings: { theme: 'system', rowHeight: 44, showGrips: true, askQty: true },
            },
            'doc',
          )
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      })
      console.log('Seeded one list. Break the build and try "Export my lists".')
    },

    /** Back to a clean first run. Does NOT delete the slp-data database. */
    async reset() {
      for (const n of await caches.keys()) if (n.startsWith('slp.')) await caches.delete(n)
      Object.keys(localStorage)
        .filter((k) => k.startsWith('slp.'))
        .forEach((k) => localStorage.removeItem(k))
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
      console.log('Cleared. Your lists were not touched. Reload for a clean first run.')
    },
  }

  window.drills = drills
  console.log('drills loaded — drills.help()')
})()
