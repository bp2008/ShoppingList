/*
 * Turns Vite's output into an immutable release directory plus the manifest the
 * bootloader stages from.
 *
 * The build id is derived from the *content* of the emitted files, not from the git sha
 * or the clock. Two consequences, both deliberate:
 *
 *   - Rebuilding unchanged source produces the same id, so it does not look like an
 *     update and devices do not re-download it.
 *   - Building uncommitted work still produces a distinct id, so the update flow can be
 *     exercised locally without committing first.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'

/** Every file under `dir`, as paths relative to it, using forward slashes. */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const abs = join(entry.parentPath ?? entry.path, entry.name)
    out.push(relative(dir, abs).split(sep).join(posix.sep))
  }
  return out.sort()
}

function shortCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

export function buildRelease(distDir, appBuildDir, version) {
  const viteManifestPath = join(appBuildDir, '.vite', 'manifest.json')
  const viteManifest = JSON.parse(readFileSync(viteManifestPath, 'utf8'))

  const entryRecord = Object.values(viteManifest).find((r) => r.isEntry)
  if (!entryRecord) throw new Error('No entry chunk in Vite manifest — cannot build a release.')

  const all = walk(appBuildDir)

  // Shipped files. Vite's index.html is discarded (the bootloader replaces it), .vite/
  // is build metadata, and source maps stay local: at ~10x the bundle size they would
  // dominate the committed docs/ tree forever, and because builds are deterministic the
  // exact map can be regenerated from the same commit whenever one is needed.
  const shipped = all.filter(
    (f) => f !== 'index.html' && !f.startsWith('.vite/') && !f.endsWith('.map'),
  )

  // Everything the bootloader must have on device before a build may be activated.
  // This IS the atomicity boundary: if one of these fails to download, the whole
  // staged build is discarded.
  const assets = shipped

  const hash = createHash('sha256')
  for (const rel of shipped) {
    hash.update(rel)
    hash.update(readFileSync(join(appBuildDir, rel)))
  }
  const buildId = `${new Date().toISOString().slice(0, 10)}-${hash.digest('hex').slice(0, 8)}`

  const releaseDir = join(distDir, 'releases', buildId)
  mkdirSync(releaseDir, { recursive: true })
  for (const rel of shipped) {
    const dest = join(releaseDir, rel)
    mkdirSync(join(dest, '..'), { recursive: true })
    cpSync(join(appBuildDir, rel), dest)
  }

  const manifest = {
    build: buildId,
    version,
    commit: shortCommit(),
    builtAt: new Date().toISOString(),
    entry: entryRecord.file,
    css: entryRecord.css ?? [],
    assets,
  }

  const json = JSON.stringify(manifest, null, 1)

  mkdirSync(join(distDir, 'releases'), { recursive: true })
  writeFileSync(join(distDir, 'releases', 'latest.json'), json)

  // A copy inside the release itself. Nothing reads it today -- rollback uses the
  // manifest the device stored when it staged the build -- but it is the only way a
  // device that lost its local storage could ever be pointed back at an older release,
  // and it can only be added going forward. Retrofitting it to shipped releases is
  // impossible, so it goes in now.
  writeFileSync(join(releaseDir, 'manifest.json'), json)

  return manifest
}
