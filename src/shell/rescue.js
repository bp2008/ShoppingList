/*
 * Shopping List rescue screen.
 *
 * Inlined into docs/index.html and parsed before any application code runs. It is never
 * fetched on demand, because the situations it exists for are exactly the situations in
 * which fetching does not work.
 *
 * Rules this file follows, all of them load-bearing:
 *
 *   - No dependencies, no imports, no build-time magic. Plain ES2020.
 *   - Every action is wrapped in its own try/catch and reports its own outcome inline.
 *     There is no shared failure path, so one broken capability cannot take the screen
 *     down with it.
 *   - Every optional API is feature-detected before use. Private browsing and locked-down
 *     webviews must degrade to a disabled button, never an exception.
 *   - Styling is inline only. The screen empties <body> and removes every stylesheet in
 *     the document first, so there is nothing left that could restyle it, cover it, or
 *     lay out on top of it.
 *   - It never touches application data except to read it for export. Destructive actions
 *     are opt-in and clearly labelled.
 *
 * It is deliberately plain. It does not need to be pretty; it needs to work.
 */
;(function () {
  'use strict'

  var slp = window.__slp

  // The application data store. Rescue reads it with raw IndexedDB rather than the app's
  // idb-keyval wrapper, so a broken bundle cannot prevent an export.
  // Contract shared with src/app/core/persist.ts -- keep in sync.
  var DATA_DB = 'slp-data'
  var DATA_STORE = 'kv'
  var DATA_KEY = 'doc'

  var boot = null
  var root = null

  /* ------------------------------------------------------------------ helpers */

  function css(node, styles) {
    for (var k in styles) node.style[k] = styles[k]
    return node
  }

  function el(tag, styles, text) {
    var n = document.createElement(tag)
    if (styles) css(n, styles)
    if (text != null) n.textContent = text
    return n
  }

  var FONT =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
  var MONO = 'ui-monospace, Menlo, Consolas, monospace'

  /**
   * Remove everything that could interfere, rather than layering over it.
   *
   * Covering the app with a high z-index is not enough: app CSS can restyle anything it
   * can select, an app overlay can sit above any fixed value, and a broken layout can
   * push content off screen. Emptying the body and dropping every stylesheet leaves
   * nothing to compete with.
   */
  function teardown() {
    try {
      document.body.textContent = ''
    } catch (e) {}
    try {
      var sheets = document.querySelectorAll('link[rel="stylesheet"], style')
      for (var i = sheets.length - 1; i >= 0; i--) {
        try {
          sheets[i].disabled = true
        } catch (e) {}
        try {
          sheets[i].remove()
        } catch (e) {}
      }
    } catch (e) {}
    try {
      document.body.removeAttribute('style')
      document.body.removeAttribute('class')
      document.body.removeAttribute('data-theme')
      document.documentElement.removeAttribute('style')
    } catch (e) {}
    try {
      var m = document.querySelector('meta[name="theme-color"]')
      if (m) m.setAttribute('content', '#ffffff')
    } catch (e) {}
  }

  /* -------------------------------------------------------------------- pieces */

  function heading(text) {
    return el(
      'h2',
      { font: '600 15px ' + FONT, margin: '26px 0 10px', color: '#000' },
      text,
    )
  }

  /**
   * A button plus its own result line. Each action owns its reporting, so a failure is
   * attributed to the thing that failed instead of blanking the screen.
   */
  function action(label, description, danger, fn) {
    var wrap = el('div', { margin: '0 0 14px' })

    var btn = el(
      'button',
      {
        display: 'block',
        width: '100%',
        minHeight: '52px',
        padding: '14px 16px',
        font: '600 15px ' + FONT,
        textAlign: 'left',
        color: danger ? '#b3261e' : '#000',
        background: '#fff',
        border: '1.5px solid ' + (danger ? '#b3261e' : '#767676'),
        borderRadius: '8px',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      },
      label,
    )
    btn.type = 'button'

    var desc = el(
      'div',
      { font: '400 12.5px/1.4 ' + FONT, color: '#444', margin: '5px 2px 0' },
      description,
    )

    var out = el('div', {
      font: '400 12.5px/1.4 ' + FONT,
      margin: '6px 2px 0',
      display: 'none',
      whiteSpace: 'pre-wrap',
    })

    function report(ok, message) {
      out.style.display = 'block'
      out.style.color = ok ? '#146c2e' : '#b3261e'
      out.textContent = (ok ? '✓ ' : '✗ ') + message
    }

    btn.addEventListener('click', function () {
      out.style.display = 'none'
      btn.disabled = true
      btn.style.opacity = '.55'
      var reenable = function () {
        btn.disabled = false
        btn.style.opacity = '1'
      }
      try {
        var result = fn(report, wrap)
        if (result && typeof result.then === 'function') {
          result.then(reenable, function (err) {
            report(false, String((err && err.message) || err))
            reenable()
          })
        } else {
          reenable()
        }
      } catch (err) {
        report(false, String((err && err.message) || err))
        reenable()
      }
    })

    wrap.appendChild(btn)
    wrap.appendChild(desc)
    wrap.appendChild(out)
    return wrap
  }

  /* ---------------------------------------------------------------- data access */

  /** Read the app's data document with raw IndexedDB. Resolves null when absent. */
  function readData() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in window) || !window.indexedDB) {
        reject(new Error('This browser has no IndexedDB, so there is no saved data.'))
        return
      }
      var req
      try {
        req = indexedDB.open(DATA_DB)
      } catch (err) {
        reject(err)
        return
      }
      req.onerror = function () {
        reject(req.error || new Error('Could not open the data store.'))
      }
      req.onupgradeneeded = function () {
        // Opening created it, so there was nothing saved. Do not leave a stray store.
        try {
          req.transaction.abort()
        } catch (e) {}
        resolve(null)
      }
      req.onsuccess = function () {
        var db = req.result
        try {
          if (!db.objectStoreNames.contains(DATA_STORE)) {
            db.close()
            resolve(null)
            return
          }
          var tx = db.transaction(DATA_STORE, 'readonly')
          var getReq = tx.objectStore(DATA_STORE).get(DATA_KEY)
          getReq.onsuccess = function () {
            db.close()
            resolve(getReq.result != null ? getReq.result : null)
          }
          getReq.onerror = function () {
            db.close()
            reject(getReq.error || new Error('Could not read saved data.'))
          }
        } catch (err) {
          try {
            db.close()
          } catch (e) {}
          reject(err)
        }
      }
    })
  }

  function deleteCachesMatching(prefix) {
    if (!('caches' in window)) return Promise.resolve(0)
    return caches.keys().then(function (names) {
      var targets = names.filter(function (n) {
        return n.indexOf(prefix) === 0
      })
      return Promise.all(
        targets.map(function (n) {
          return caches.delete(n)
        }),
      ).then(function () {
        return targets.length
      })
    })
  }

  function clearBootKeys() {
    var removed = 0
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i)
        if (k && k.indexOf('slp.boot.') === 0) {
          localStorage.removeItem(k)
          removed += 1
        }
      }
    } catch (e) {}
    return removed
  }

  function unregisterSW() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(0)
    return navigator.serviceWorker
      .getRegistrations()
      .then(function (regs) {
        return Promise.all(
          regs.map(function (r) {
            return r.unregister()
          }),
        ).then(function () {
          return regs.length
        })
      })
      .catch(function () {
        return 0
      })
  }

  /* ----------------------------------------------------------------- the screen */

  function open(reason, bootApi) {
    boot = bootApi || (slp && slp.boot) || null

    try {
      teardown()
    } catch (e) {}

    root = el('div', {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      background: '#ffffff',
      color: '#000000',
      font: '400 15px/1.45 ' + FONT,
      padding: 'env(safe-area-inset-top, 0) 0 40px',
      boxSizing: 'border-box',
    })

    var page = el('div', {
      maxWidth: '620px',
      margin: '0 auto',
      padding: '24px 18px 0',
      boxSizing: 'border-box',
    })

    page.appendChild(
      el('h1', { font: '600 21px ' + FONT, margin: '0 0 8px', color: '#000' }, 'Shopping List'),
    )
    page.appendChild(
      el(
        'p',
        { font: '400 14.5px/1.45 ' + FONT, margin: '0 0 4px', color: '#333' },
        reason === 'manual' || reason === 'hash'
          ? 'Recovery options. Your saved lists are not affected by opening this screen.'
          : 'The app did not start correctly. Your saved lists are still on this device.',
      ),
    )

    page.appendChild(heading('Try this first'))
    page.appendChild(buildSafeActions())

    page.appendChild(heading('Your data'))
    page.appendChild(buildExport())

    page.appendChild(heading('Last resort'))
    page.appendChild(buildDestructive())

    page.appendChild(heading('Diagnostics'))
    page.appendChild(buildDiagnostics(reason))

    root.appendChild(page)
    document.body.appendChild(root)
  }

  function reload() {
    // Drop #rescue so a manual visit does not trap the user on this screen.
    try {
      location.replace(location.pathname + location.search)
    } catch (e) {
      location.reload()
    }
  }

  function buildSafeActions() {
    var box = el('div')

    box.appendChild(
      action('Reload the app', 'Tries the current version again.', false, function (report) {
        try {
          if (boot) boot.del('attempts')
        } catch (e) {}
        report(true, 'Reloading…')
        setTimeout(reload, 400)
      }),
    )

    var previous = null
    try {
      previous = boot ? boot.get('previous') : null
    } catch (e) {}
    var prevManifest = null
    try {
      prevManifest = previous && boot ? boot.manifestOf(previous) : null
    } catch (e) {}

    if (previous && prevManifest) {
      box.appendChild(
        action(
          'Go back to version ' + (prevManifest.version || previous),
          'Switches to the last version that worked. Already on this device, so it works offline.',
          false,
          function (report) {
            if (!boot) throw new Error('Bootloader unavailable.')
            // Remember the version being abandoned, or the next update check re-stages
            // it and the following launch drops the user straight back into it.
            boot.markBad(boot.get('active'))
            boot.set('active', previous)
            boot.del('previous')
            boot.del('pending')
            boot.del('attempts')
            boot.set('rolledBack', '1')
            report(true, 'Switched. Reloading…')
            setTimeout(reload, 400)
          },
        ),
      )
    }

    box.appendChild(
      action(
        'Download a fresh copy',
        'Re-downloads the newest version from the server, ignoring anything cached. Needs a connection.',
        false,
        function (report) {
          if (!boot) throw new Error('Bootloader unavailable.')
          if (!('caches' in window)) throw new Error('This browser has no Cache Storage.')
          report(true, 'Downloading…')
          return boot
            .fetchLatest()
            .then(function (mf) {
              // Drop the target build's cache before re-staging. The service worker
              // serves release assets cache-first, so without this we would faithfully
              // re-cache the very bytes we are trying to escape. It has to be the build
              // we are about to fetch, not merely the active one -- after a rollback
              // those are different.
              return caches.delete(boot.cachePrefix + mf.build).then(function () {
                return mf
              })
            })
            .then(function (mf) {
              return boot.stage(mf, null, true)
            })
            .then(function (build) {
              boot.set('active', build)
              boot.del('pending')
              boot.del('attempts')
              boot.del('rolledBack')
              // An explicit request to run the newest build overrides any earlier
              // decision that it was bad -- this is the user overruling the automatic
              // rollback, which is the whole point of the button.
              boot.clearBad()
              report(true, 'Downloaded version ' + build + '. Reloading…')
              setTimeout(reload, 600)
            })
        },
      ),
    )

    return box
  }

  function buildExport() {
    var box = el('div')

    box.appendChild(
      action(
        'Export my lists',
        'Saves everything as a JSON file you can import again later. Do this before using anything below.',
        false,
        function (report, wrap) {
          return readData().then(function (doc) {
            if (doc == null) {
              report(false, 'No saved data found on this device.')
              return
            }
            var json = JSON.stringify(doc, null, 1)

            var area = el('textarea', {
              display: 'block',
              width: '100%',
              height: '150px',
              marginTop: '10px',
              font: '400 11.5px/1.35 ' + MONO,
              padding: '8px',
              border: '1px solid #767676',
              borderRadius: '6px',
              boxSizing: 'border-box',
              background: '#fff',
              color: '#000',
            })
            area.value = json
            area.readOnly = true

            var existing = wrap.querySelector('textarea')
            if (existing) existing.remove()
            var existingLink = wrap.querySelector('a')
            if (existingLink) existingLink.remove()
            wrap.appendChild(area)

            // A file is more durable than a text selection, but the textarea above is
            // the fallback when Blob URLs are unavailable.
            try {
              var blob = new Blob([json], { type: 'application/json' })
              var a = el(
                'a',
                {
                  display: 'inline-block',
                  marginTop: '8px',
                  font: '600 13.5px ' + FONT,
                  color: '#0b57d0',
                },
                'Save as a file',
              )
              a.href = URL.createObjectURL(blob)
              a.download = 'shopping-list-backup.json'
              wrap.appendChild(a)
            } catch (e) {
              /* textarea above is the fallback */
            }

            report(true, 'Exported ' + ((doc.lists && doc.lists.length) || 0) + ' list(s).')
          })
        },
      ),
    )

    return box
  }

  function buildDestructive() {
    var box = el('div')

    box.appendChild(
      action(
        'Clear the app, keep my lists',
        'Removes all downloaded app files and starts fresh from the server. Your saved lists are untouched.',
        true,
        function (report) {
          report(true, 'Clearing…')
          return deleteCachesMatching('slp.')
            .then(function (n) {
              clearBootKeys()
              return unregisterSW().then(function () {
                return n
              })
            })
            .then(function (n) {
              report(true, 'Cleared ' + n + ' cache(s). Reloading…')
              setTimeout(reload, 600)
            })
        },
      ),
    )

    var confirmBox = el('div', { margin: '0 0 14px' })
    var confirmInput = el('input', {
      display: 'block',
      width: '100%',
      minHeight: '46px',
      padding: '10px 12px',
      marginTop: '6px',
      font: '400 15px ' + MONO,
      border: '1.5px solid #b3261e',
      borderRadius: '8px',
      boxSizing: 'border-box',
      background: '#fff',
      color: '#000',
    })
    confirmInput.type = 'text'
    confirmInput.placeholder = 'Type RESET to confirm'
    confirmInput.autocapitalize = 'characters'
    confirmInput.autocomplete = 'off'

    confirmBox.appendChild(
      action(
        'Erase everything',
        'Deletes the app AND all of your saved lists. This cannot be undone. Export first.',
        true,
        function (report) {
          if (confirmInput.value.trim().toUpperCase() !== 'RESET') {
            report(false, 'Type RESET in the box below to confirm.')
            return
          }
          report(true, 'Erasing…')
          return deleteCachesMatching('slp.')
            .then(function () {
              clearBootKeys()
              return unregisterSW()
            })
            .then(function () {
              return new Promise(function (resolve) {
                if (!('indexedDB' in window)) return resolve()
                var req
                try {
                  req = indexedDB.deleteDatabase(DATA_DB)
                } catch (e) {
                  return resolve()
                }
                req.onsuccess = req.onerror = req.onblocked = function () {
                  resolve()
                }
              })
            })
            .then(function () {
              report(true, 'Erased. Reloading…')
              setTimeout(reload, 600)
            })
        },
      ),
    )
    confirmBox.appendChild(confirmInput)
    box.appendChild(confirmBox)

    return box
  }

  function buildDiagnostics(reason) {
    var lines = []
    function add(label, value) {
      lines.push(label + ': ' + (value == null || value === '' ? '—' : value))
    }

    add('Reason', reason)
    try {
      var active = boot ? boot.get('active') : null
      var mf = active && boot ? boot.manifestOf(active) : null
      add('Active build', active)
      add('Active version', mf && mf.version)
      add('Previous build', boot ? boot.get('previous') : null)
      add('Pending build', boot ? boot.get('pending') : null)
      add('Failed attempts', boot ? boot.get('attempts') || '0' : null)
      add('Rolled back', boot && boot.get('rolledBack') === '1' ? 'yes' : 'no')
    } catch (e) {
      add('Boot state', 'unreadable (' + e + ')')
    }
    add('URL', location.href)
    add('Online', navigator.onLine ? 'yes' : 'no')
    add('User agent', navigator.userAgent)

    var errors = []
    try {
      errors = (boot && boot.getJSON('errors', [])) || []
    } catch (e) {}
    if (slp && slp.errors && slp.errors.length) {
      errors = errors.concat(slp.errors)
    }
    if (errors.length) {
      lines.push('')
      lines.push('Recent errors (newest last):')
      errors.slice(-8).forEach(function (e) {
        lines.push(
          '  [' + new Date(e.t || Date.now()).toISOString() + '] ' + e.reason + ' — ' + (e.msg || ''),
        )
      })
    }

    var text = lines.join('\n')

    var pre = el(
      'pre',
      {
        font: '400 11px/1.45 ' + MONO,
        background: '#f2f2f2',
        color: '#000',
        border: '1px solid #ccc',
        borderRadius: '6px',
        padding: '10px',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        margin: '0 0 10px',
      },
      text,
    )

    var box = el('div')
    box.appendChild(pre)

    // Storage estimate is informational and frequently unavailable; never let it throw.
    try {
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(
          function (est) {
            var mb = function (n) {
              return n == null ? '?' : (n / 1048576).toFixed(1) + ' MB'
            }
            pre.textContent += '\nStorage used: ' + mb(est.usage) + ' of ' + mb(est.quota)
          },
          function () {},
        )
      }
    } catch (e) {}

    box.appendChild(
      action('Copy diagnostics', 'Copies the text above.', false, function (report) {
        var value = pre.textContent
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(value).then(
            function () {
              report(true, 'Copied.')
            },
            function () {
              report(false, 'The browser blocked copying. Select the text above instead.')
            },
          )
        }
        report(false, 'Copying is unavailable. Select the text above instead.')
      }),
    )

    return box
  }

  slp.rescue = { open: open }
})()
