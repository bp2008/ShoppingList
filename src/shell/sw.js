/*
 * Shopping List service worker.
 *
 * ============================================================================
 * THIS FILE MUST NOT CHANGE WHEN APP CODE CHANGES.
 * ============================================================================
 *
 * That is the whole point of it. A conventional precaching service worker (Workbox
 * `generateSW`, for instance) bakes a list of hashed asset URLs into itself, so it is a
 * different file on every release -- which means every buggy release also ships a brand
 * new copy of the layer you are relying on to rescue you.
 *
 * This worker instead knows nothing about app versions. It precaches a tiny fixed shell
 * and serves `releases/<buildId>/*` cache-first, because those paths are content-hashed
 * and therefore immutable. The bootloader (src/shell/bootloader.js) owns everything to do
 * with which build is active, staging updates, and rolling back.
 *
 * If you find yourself wanting to edit this file to ship an app feature, the design has
 * gone wrong somewhere. There is a verification step for exactly this: sw.js must be
 * byte-identical across two consecutive app-only releases.
 */

// Stamped by scripts/build-shell.mjs from a hash of the shell sources. Changing the
// bootloader or this file produces a new value, which is what makes the browser install
// an updated worker.
const SHELL_VERSION = '__SHELL_VERSION__'
const SHELL_CACHE = 'slp.shell.' + SHELL_VERSION

// Everything is resolved against the worker's own directory, never a hardcoded path, so
// the same file works at a GitHub Pages subpath, at a staging root, and on localhost.
const SCOPE = new URL('./', self.location.href)
const at = (path) => new URL(path, SCOPE).href

const SHELL_ASSETS = [
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // addAll is all-or-nothing: if any asset fails, the promise rejects, install fails,
      // and this worker is discarded while the previous one keeps serving.
      await cache.addAll(SHELL_ASSETS.map(at))
      // Safe here only because this worker's behaviour is fixed. A worker whose routing
      // changed between versions could not do this without risking a mixed-version page.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          // Only ever our own shell caches. Release caches (slp.release.*) belong to the
          // bootloader and hold the staged/previous builds that rollback depends on --
          // deleting one here would silently destroy the ability to recover.
          .filter((n) => n.startsWith('slp.shell.') && n !== SHELL_CACHE)
          .map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return

  const path = url.pathname

  // Tier-3 escape hatch. Never intercepted under any circumstance, so it still works
  // when everything else -- including a corrupt cached index.html -- has failed.
  if (path.endsWith('/reset.html')) return

  // The update pointer. Always live; caching it would defeat update discovery.
  if (path.endsWith('/releases/latest.json')) return

  // Navigations always get the bootloader out of cache. The network is never consulted,
  // so a slow or dead connection cannot delay startup or half-load the page.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches
        .match(at('index.html'), { cacheName: SHELL_CACHE })
        .then((hit) => hit || fetch(req)),
    )
    return
  }

  // Release assets and shell assets alike: cache-first, no revalidation.
  //
  // caches.match() without a cacheName searches every cache, which is exactly right --
  // each build has its own slp.release.<buildId> bucket and the URLs carry the build id,
  // so there is no possibility of one build's asset answering another's request.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)))
})
