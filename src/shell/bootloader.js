/*
 * Shopping List bootloader.
 *
 * Inlined into docs/index.html by scripts/build-shell.mjs. Runs as a classic script
 * before any application code exists, and must never import anything, because everything
 * it needs has to already be resident when the thing it is rescuing you from happens.
 *
 * Responsibilities:
 *   1. Decide which build to run, and load it from Cache Storage.
 *   2. Detect a build that fails to start, and recover -- retry, then roll back, then
 *      hand off to the rescue screen.
 *   3. Stage the next update completely before it is ever used, so the cutover is a
 *      local pointer flip that cannot be interrupted by the network.
 *
 * Boot metadata lives in localStorage rather than IndexedDB on purpose: it is
 * synchronous, so the decisions below cannot be blocked by an async failure, and it has
 * far fewer ways to be unavailable. Application data lives in a *separate* IndexedDB
 * database that nothing in this file or rescue.js ever touches.
 */
;(function () {
  'use strict'

  var slp = window.__slp

  /* ---------------------------------------------------------------- constants */

  // The app's own directory, derived at runtime. Nothing here may hardcode a path: the
  // same build has to run at the Pages subpath, at a staging root, and on localhost.
  var ROOT = new URL('./', document.baseURI)

  var PREFIX = 'slp.boot.'
  var CACHE_PREFIX = 'slp.release.'

  var ASSET_TIMEOUT_MS = 30000 // T1: bytes must arrive (generous; first install may be slow)
  var MOUNT_TIMEOUT_MS = 5000 // T2: once they have, the app must render
  var MAX_ATTEMPTS = 2 // failures of one build before rolling back
  var MAX_ERRORS = 20 // error ring buffer

  /* ------------------------------------------------------------------ storage */

  // localStorage can be entirely unavailable (some private-browsing modes, embedded
  // webviews with storage disabled). Degrade to memory rather than throwing: the app
  // still runs, it just re-downloads on every launch instead of persisting a pointer.
  var mem = Object.create(null)

  function get(key) {
    try {
      var v = localStorage.getItem(PREFIX + key)
      return v === null ? undefined : v
    } catch (e) {
      return mem[key]
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, String(value))
    } catch (e) {
      mem[key] = String(value)
    }
  }

  function del(key) {
    try {
      localStorage.removeItem(PREFIX + key)
    } catch (e) {
      delete mem[key]
    }
  }

  function getJSON(key, fallback) {
    var raw = get(key)
    if (raw === undefined) return fallback
    try {
      return JSON.parse(raw)
    } catch (e) {
      return fallback
    }
  }

  function setJSON(key, value) {
    set(key, JSON.stringify(value))
  }

  /* -------------------------------------------------------------------- utils */

  function at(path) {
    return new URL(path, ROOT).href
  }

  function releaseUrl(build, path) {
    return at('releases/' + build + '/' + path)
  }

  function manifestOf(build) {
    return build ? getJSON('mf.' + build, null) : null
  }

  /**
   * Builds known to fail on this device.
   *
   * Without this list, recovery loops: rolling back frees the bad build's cache, the
   * next update check sees it is still the newest on the server, stages it again, and
   * the following launch promotes straight back into it. A shipped bad release would
   * ping-pong forever instead of settling on the last good version.
   *
   * Entries are cleared only by publishing a different build, or by the user explicitly
   * choosing "Download a fresh copy" from the rescue screen.
   */
  function badBuilds() {
    return getJSON('bad', [])
  }

  function markBad(build) {
    if (!build) return
    var bad = badBuilds()
    if (bad.indexOf(build) !== -1) return
    bad.push(build)
    while (bad.length > 5) bad.shift()
    setJSON('bad', bad)
  }

  function isBad(build) {
    return badBuilds().indexOf(build) !== -1
  }

  function recordError(reason, err) {
    var entry = {
      t: Date.now(),
      reason: reason,
      build: get('active') || null,
      msg: err ? String((err && err.stack) || (err && err.message) || err).slice(0, 600) : '',
    }
    slp.errors.push(entry)
    var log = getJSON('errors', [])
    log.push(entry)
    while (log.length > MAX_ERRORS) log.shift()
    setJSON('errors', log)
  }

  /* -------------------------------------------------------------- boot status */

  var statusEl = null

  function status(title, detail, actionLabel, action) {
    if (!statusEl) statusEl = document.getElementById('slp-boot')
    if (!statusEl) return
    statusEl.textContent = ''
    var h = document.createElement('div')
    h.className = 'slp-boot-title'
    h.textContent = title
    statusEl.appendChild(h)
    if (detail) {
      var p = document.createElement('div')
      p.className = 'slp-boot-detail'
      p.textContent = detail
      statusEl.appendChild(p)
    }
    if (actionLabel) {
      var b = document.createElement('button')
      b.className = 'slp-boot-action'
      b.type = 'button'
      b.textContent = actionLabel
      b.addEventListener('click', action)
      statusEl.appendChild(b)
    }
    statusEl.hidden = false
  }

  function clearStatus() {
    if (statusEl) statusEl.hidden = true
  }

  /* ------------------------------------------------------------------ failure */

  var settled = false // true once this boot has been decided, either way

  /**
   * Report an unrecoverable failure.
   *
   * The rescue screen is rendered on a *later* task, never synchronously. Callers rely
   * on that: criticalSection() in the app reports through here and then rethrows, and the
   * drag engine's teardown runs in a `finally` on the way out. Rendering rescue inline
   * would tear the DOM down before that teardown ran, leaving the user on a rescue screen
   * with permanently broken touch scrolling underneath it.
   */
  function fail(reason, err) {
    recordError(reason, err)
    if (settled) return
    settled = true
    clearTimers()
    setTimeout(function () {
      openRescue(reason)
    }, 0)
  }

  function openRescue(reason) {
    if (slp.rescue && slp.rescue.open) {
      slp.rescue.open(reason, api)
    } else {
      // rescue.js failed to parse -- should be impossible, but never leave a blank page.
      document.body.innerHTML =
        '<div style="font:16px system-ui;padding:24px;color:#000;background:#fff">' +
        'Shopping List could not start.<br><br>' +
        '<a href="reset.html" style="color:#00e">Open the reset page</a></div>'
    }
  }

  /* ------------------------------------------------------------------- timers */

  var t1 = 0
  var t2 = 0

  function clearTimers() {
    if (t1) clearTimeout(t1)
    if (t2) clearTimeout(t2)
    t1 = t2 = 0
  }

  /**
   * Refuse to judge a hidden document, and retry once it is actually on screen.
   *
   * A backgrounded tab does not paint and does not run requestAnimationFrame, so a
   * perfectly healthy build that was launched and immediately backgrounded looks exactly
   * like one that failed to start. Condemning it would roll back a working version
   * because the user switched apps during startup. Returns true when the decision was
   * deferred.
   */
  function deferIfHidden(retry) {
    if (!document.hidden) return false
    var onVisible = function () {
      if (document.hidden) return
      document.removeEventListener('visibilitychange', onVisible)
      if (!settled) retry()
    }
    document.addEventListener('visibilitychange', onVisible)
    return true
  }

  /* ------------------------------------------------------------- health check */

  /**
   * Healthy means BOTH the app said so AND it actually painted.
   *
   * Either signal alone lies in a different direction: a flag set by an app that rendered
   * nothing looks healthy, and an app that painted but regressed its ready call looks
   * broken. Requiring both catches the blank-screen case, which is the one a user cannot
   * diagnose or work around.
   */
  function isHealthy() {
    if (window.__APP_READY__ !== true) return false
    var bar = document.querySelector('[data-app-topbar]')
    return !!bar && bar.offsetHeight > 0
  }

  function markHealthy() {
    if (settled) return
    settled = true
    clearTimers()
    clearStatus()
    del('attempts')
    del('rolledBack')

    var build = get('active')
    var good = getJSON('good', [])
    if (good.indexOf(build) === -1) {
      good.push(build)
      while (good.length > 5) good.shift()
      setJSON('good', good)
    }

    // Only now, with a proven-good build running, do we touch the network.
    whenIdle(function () {
      pruneCaches()
      checkForUpdate()
    })
  }

  function whenIdle(fn) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: 5000 })
    } else {
      setTimeout(fn, 2000)
    }
  }

  /* ------------------------------------------------------------- app injection */

  function injectApp(build, mf) {
    var files = (mf.css || []).concat([mf.entry])
    var remaining = files.length

    function mountCheck() {
      if (settled) return
      if (isHealthy()) {
        markHealthy()
        return
      }
      if (
        deferIfHidden(function () {
          t2 = setTimeout(mountCheck, MOUNT_TIMEOUT_MS)
        })
      ) {
        return
      }
      fail('mount-timeout')
    }

    function assetLoaded() {
      remaining -= 1
      if (remaining > 0 || settled) return
      // Bytes are in. Only now does the mount clock start -- measuring from page start
      // would false-positive on a slow first install over a bad connection.
      if (t1) clearTimeout(t1)
      t1 = 0
      t2 = setTimeout(mountCheck, MOUNT_TIMEOUT_MS)
    }

    function assetFailed(e) {
      // Fires immediately on a 404 or a dropped connection -- far more precise than
      // waiting for T1, and the common case when a cache has been evicted mid-life.
      fail('asset-load', new Error('Failed to load ' + ((e.target && e.target.src) || (e.target && e.target.href) || '?')))
    }

    // Backstop only: a 404 or dropped connection fires the elements' own error events
    // immediately, which is both faster and more specific than this.
    t1 = setTimeout(function assetCheck() {
      if (settled) return
      if (
        deferIfHidden(function () {
          t1 = setTimeout(assetCheck, ASSET_TIMEOUT_MS)
        })
      ) {
        return
      }
      fail('asset-timeout')
    }, ASSET_TIMEOUT_MS)

    ;(mf.css || []).forEach(function (href) {
      var link = document.createElement('link')
      link.rel = 'stylesheet'
      link.dataset.slpApp = '1'
      link.addEventListener('load', assetLoaded)
      link.addEventListener('error', assetFailed)
      link.href = releaseUrl(build, href)
      document.head.appendChild(link)
    })

    var script = document.createElement('script')
    script.type = 'module'
    script.dataset.slpApp = '1'
    script.addEventListener('load', assetLoaded)
    script.addEventListener('error', assetFailed)
    script.src = releaseUrl(build, mf.entry)
    document.head.appendChild(script)
  }

  /* -------------------------------------------------------------- update logic */

  function latestUrl() {
    // GitHub Pages serves everything with max-age=600 through a CDN and offers no header
    // control, so the pointer is both no-store and cache-busted.
    return at('releases/latest.json') + '?t=' + Date.now()
  }

  function fetchLatest() {
    return fetch(latestUrl(), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('latest.json HTTP ' + res.status)
      return res.json()
    })
  }

  /**
   * Download an entire build into its own cache bucket, then prove it landed.
   *
   * Anything less than complete is discarded. There is deliberately no partial state to
   * resume from: a half-staged build that got recorded as available is precisely the
   * failure this architecture exists to prevent.
   */
  function stage(mf, onProgress, force) {
    var cacheName = CACHE_PREFIX + mf.build
    var urls = mf.assets.map(function (p) {
      return releaseUrl(mf.build, p)
    })
    var cache
    var done = 0

    return caches
      .open(cacheName)
      .then(function (c) {
        cache = c
        return Promise.all(
          urls.map(function (u) {
            // `force` bypasses the HTTP cache as well as ours. Normal staging does not
            // need it -- release assets are content-hashed, so a cache hit is the right
            // answer -- but a recovery download must be able to escape bad bytes.
            return fetch(u, force ? { cache: 'reload' } : undefined)
              .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + u)
                return cache.put(u, res)
              })
              .then(function () {
                done += 1
                if (onProgress) onProgress(done, urls.length)
              })
          }),
        )
      })
      .then(function () {
        // Verify rather than trust. cache.addAll() is specified to be atomic, but this
        // is the one place where being wrong means shipping a broken app to a user who
        // may be offline and unable to re-download, so the cost of checking is worth it.
        return Promise.all(
          urls.map(function (u) {
            return cache.match(u).then(function (hit) {
              if (!hit) throw new Error('Missing after staging: ' + u)
            })
          }),
        )
      })
      .then(function () {
        setJSON('mf.' + mf.build, mf)
        return mf.build
      })
      .catch(function (err) {
        // Leave nothing behind. The user's current build is untouched and they never
        // learn this happened; the next launch simply tries again.
        return caches.delete(cacheName).then(function () {
          throw err
        })
      })
  }

  function checkForUpdate() {
    if (!('caches' in window)) return
    var active = get('active')
    var pending = get('pending')

    fetchLatest()
      .then(function (mf) {
        if (!mf || !mf.build || !mf.entry || !mf.assets) throw new Error('Malformed latest.json')
        if (mf.build === active || mf.build === pending) return null
        // A build this device already rolled back from. Re-staging it would undo the
        // rollback on the next launch; wait for a genuinely new build instead.
        if (isBad(mf.build)) return null
        return stage(mf)
      })
      .then(function (build) {
        if (!build) return
        set('pending', build)
        // The app may show a "restart to update" affordance; it is purely optional, and
        // the update applies on the next cold start regardless.
        window.dispatchEvent(new CustomEvent('slp:update-ready', { detail: { build: build } }))
      })
      .catch(function (err) {
        // Update failures are never user-visible. Offline, flaky, 404 on a pruned
        // release -- all of it just means "not this launch".
        recordError('update-check', err)
      })
  }

  function pruneCaches() {
    if (!('caches' in window)) return
    var keep = {}
    ;['active', 'previous', 'pending'].forEach(function (k) {
      var v = get(k)
      if (v) keep[CACHE_PREFIX + v] = true
    })
    caches.keys().then(function (names) {
      names.forEach(function (n) {
        if (n.indexOf(CACHE_PREFIX) === 0 && !keep[n]) caches.delete(n)
      })
    })
    // Drop stored manifests for builds we no longer hold.
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i)
        if (k && k.indexOf(PREFIX + 'mf.') === 0) {
          var b = k.slice((PREFIX + 'mf.').length)
          if (!keep[CACHE_PREFIX + b]) localStorage.removeItem(k)
        }
      }
    } catch (e) {
      /* storage unavailable; nothing to prune */
    }
  }

  /* ---------------------------------------------------------------- first run */

  function firstRun() {
    status('Setting up…', 'Downloading the app. This happens once.')
    fetchLatest()
      .then(function (mf) {
        return stage(mf, function (done, total) {
          status('Setting up…', 'Downloading ' + done + ' of ' + total + '…')
        })
      })
      .then(function (build) {
        set('active', build)
        clearStatus()
        run()
      })
      .catch(function (err) {
        recordError('first-run', err)
        status(
          'Needs a connection',
          'Shopping List has to download once before it can work offline.',
          'Try again',
          function () {
            location.reload()
          },
        )
      })
  }

  /* --------------------------------------------------------------------- boot */

  function run() {
    var build = get('active')
    var mf = manifestOf(build)

    if (!build || !mf) {
      // Pointer without a manifest means storage was partially cleared. Treat as first
      // run rather than trying to repair it.
      del('active')
      firstRun()
      return
    }

    var attempts = parseInt(get('attempts') || '0', 10) || 0
    set('attempts', attempts + 1)

    injectApp(build, mf)

    // Registered on every boot, not gated on app health: what it caches is the bootloader
    // and the rescue screen, which are exactly what must survive a broken app.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(at('sw.js'), { scope: ROOT.pathname }).catch(function (err) {
        recordError('sw-register', err)
      })
    }
  }

  function start() {
    // Explicit escape hatch, handled before a single line of app code is loaded.
    if (/(^|[#&])rescue\b/.test(location.hash)) {
      settled = true
      openRescue('hash')
      return
    }

    var attempts = parseInt(get('attempts') || '0', 10) || 0
    var previous = get('previous')
    var rolledBack = get('rolledBack') === '1'

    if (attempts >= MAX_ATTEMPTS) {
      if (previous && !rolledBack && previous !== get('active') && manifestOf(previous)) {
        // This build has failed twice. Fall back to the last one that worked and give it
        // the same allowance; if that fails too, we stop guessing and ask the user.
        var failing = get('active')
        recordError('auto-rollback', new Error('Rolling back from ' + failing + ' to ' + previous))
        markBad(failing)
        set('active', previous)
        del('previous')
        set('rolledBack', '1')
        del('attempts')
      } else {
        settled = true
        openRescue('boot-loop')
        return
      }
    } else if (attempts === 0) {
      // Only promote on a clean start. Promoting during a crash loop would swap in an
      // untried build at the exact moment we are trying to establish what works.
      var pending = get('pending')
      if (pending && manifestOf(pending) && !isBad(pending)) {
        var active = get('active')
        if (active && active !== pending) set('previous', active)
        set('active', pending)
        del('pending')
      }
    }

    run()
  }

  /* ---------------------------------------------------------------- public API */

  // Consumed by rescue.js, and by the app through src/app/core/bootBridge.ts.
  var api = {
    ROOT: ROOT,
    at: at,
    get: get,
    set: set,
    del: del,
    getJSON: getJSON,
    setJSON: setJSON,
    manifestOf: manifestOf,
    cachePrefix: CACHE_PREFIX,
    prefix: PREFIX,
    stage: stage,
    fetchLatest: fetchLatest,
    isHealthy: isHealthy,
    markBad: markBad,
    isBad: isBad,
    clearBad: function () {
      del('bad')
    },
  }
  slp.boot = api

  window.__bootOk = function () {
    window.__APP_READY__ = true
    // If layout has not settled yet, leave T2 running rather than deciding early.
    if (isHealthy()) markHealthy()
  }

  window.__bootFail = function (reason, err) {
    fail(reason || 'app', err)
  }

  window.__rescue = function (reason) {
    settled = true
    clearTimers()
    openRescue(reason || 'manual')
  }

  // Errors captured by the prelude before this script ran (see index.template.html).
  if (slp.pending && slp.pending.length) {
    var early = slp.pending.slice()
    slp.pending.length = 0
    early.forEach(function (e) {
      recordError(e.reason, e.error)
    })
    fail('pre-boot', early[0] && early[0].error)
    return
  }

  slp.onError = function (reason, err) {
    // Before the app is up, any uncaught error is fatal -- it means the build did not
    // start. Afterwards it is recorded but tolerated: tearing down a working session
    // over one stray error would be worse than the error. Paths that genuinely cannot
    // fail opt in explicitly via criticalSection().
    if (settled) recordError(reason, err)
    else fail(reason, err)
  }

  start()
})()
