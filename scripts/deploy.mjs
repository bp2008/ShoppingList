/*
 * Copies dist/ into a destination directory.
 *
 *   node scripts/deploy.mjs docs        -> publish (npm run release)
 *   node scripts/deploy.mjs <dir>       -> staging (npm run stage -- <dir>)
 *
 * MERGES, never mirrors. Previous release directories in the destination are left in
 * place, because rollback depends on them still being served: a device that has to fall
 * back to its previous build re-fetches nothing, but "Download a fresh copy" from the
 * rescue screen and any device that lost its cache both need the older release to still
 * exist on the server.
 *
 * This is also why publishing does not use the GitHub Actions Pages source: its artifact
 * upload replaces the entire site on every run, which would delete exactly those
 * directories. Classic branch deployment serves whatever the branch contains.
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEEP_RELEASES = 3

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(repoRoot, 'dist')

const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/deploy.mjs <destination>')
  console.error('  npm run release          publish to docs/')
  console.error('  npm run stage -- <dir>   copy to a staging target')
  process.exit(1)
}

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('dist/ is missing or incomplete. Run `npm run build` first.')
  process.exit(1)
}

const destDir = join(repoRoot, target)

cpSync(distDir, destDir, { recursive: true, force: true })

// Prune old releases. Build ids are date-prefixed, so lexicographic order is
// chronological. The build referenced by latest.json is protected explicitly rather than
// relying on it sorting first -- a wrong guess here silently breaks the live site.
const releasesDir = join(destDir, 'releases')
let current = null
try {
  current = JSON.parse(readFileSync(join(releasesDir, 'latest.json'), 'utf8')).build
} catch {
  /* handled below */
}

const releases = readdirSync(releasesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .reverse()

const pruned = []
for (const name of releases.slice(KEEP_RELEASES)) {
  if (name === current) continue
  rmSync(join(releasesDir, name), { recursive: true, force: true })
  pruned.push(name)
}

const kept = releases.filter((r) => !pruned.includes(r))
const bytes = (dir) => {
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += statSync(join(e.parentPath ?? e.path, e.name)).size
  }
  return total
}

console.log(`deployed to ${target}/`)
console.log(`  current    ${current ?? '(unknown)'}`)
console.log(`  retained   ${kept.join(', ') || '(none)'}`)
if (pruned.length) console.log(`  pruned     ${pruned.join(', ')}`)
console.log(`  total      ${(bytes(destDir) / 1024).toFixed(0)} kB`)
if (target === 'docs') {
  console.log('')
  console.log('  Review with `git status`, then commit to publish.')
}
