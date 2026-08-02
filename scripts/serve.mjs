/*
 * Static file server for testing a built site locally.
 *
 *   node scripts/serve.mjs [dir] [--port 8080] [--mount /some/path/]
 *
 * Exists because the things worth testing here are hard to test any other way:
 *
 *   - Service workers need a secure context, and localhost counts as one. Combined with
 *     `adb reverse tcp:8080 tcp:8080`, a phone sees this as localhost too, which gives
 *     real-device testing with no certificate.
 *   - `--mount` serves the site from a subpath, so the "one artifact, any URL" property
 *     can actually be verified rather than assumed. Run it twice, at / and at
 *     /ShoppingList/, and the same bytes must work in both.
 *   - It reproduces GitHub Pages' Cache-Control: max-age=600, which is the constraint
 *     that forces latest.json to be fetched no-store and cache-busted.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}

const dir = resolve(args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? 'dist')
const port = Number(flag('--port', 8080))
let mount = flag('--mount', '/')
if (!mount.startsWith('/')) mount = '/' + mount
if (!mount.endsWith('/')) mount += '/'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
}

createServer((req, res) => {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  } catch {
    res.writeHead(400).end('Bad request')
    return
  }

  if (!pathname.startsWith(mount)) {
    // Nudge toward the mount point rather than 404ing, which is confusing when testing
    // subpath deployment.
    res.writeHead(302, { Location: mount }).end()
    return
  }

  let rel = pathname.slice(mount.length)
  if (rel === '' || rel.endsWith('/')) rel += 'index.html'

  // Contain path traversal before touching the filesystem.
  const target = join(dir, normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!target.startsWith(dir + sep) && target !== dir) {
    res.writeHead(403).end('Forbidden')
    return
  }

  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + rel)
    return
  }

  res.writeHead(200, {
    'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
    // What GitHub Pages sends. Header control is not available there, so anything that
    // must be fresh has to opt out at the fetch call instead.
    'cache-control': 'max-age=600',
    'content-length': statSync(target).size,
  })
  createReadStream(target).pipe(res)
}).listen(port, () => {
  console.log(`serving ${dir}`)
  console.log(`  http://localhost:${port}${mount}`)
})
