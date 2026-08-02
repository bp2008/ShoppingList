/*
 * Produces dist/ -- the complete, path-independent site.
 *
 * The same artifact is what goes to staging and what goes to docs/. Nothing in it
 * encodes a deployment URL, so it runs unchanged at the GitHub Pages subpath, at a
 * staging server's root or a subfolder, and on localhost. Deploying is a separate,
 * explicit step (scripts/deploy.mjs); building never publishes anything.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildShell } from './build-shell.mjs'
import { buildRelease } from './build-release.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(repoRoot, 'dist')
const appBuildDir = join(repoRoot, '.build', 'app')

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

rmSync(distDir, { recursive: true, force: true })
rmSync(join(repoRoot, '.build'), { recursive: true, force: true })

console.log('· vite build')
// Vite's own entry, run directly by node. Going through `npx` needs shell:true on
// Windows, which is both slower and a documented injection hazard.
execFileSync(process.execPath, [join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
  cwd: repoRoot,
  stdio: 'inherit',
})

console.log('· shell')
const { shellVersion, icons } = buildShell(distDir)

console.log('· release')
const manifest = buildRelease(distDir, appBuildDir, pkg.version)

const kb = (p) => (statSync(join(distDir, p)).size / 1024).toFixed(1) + ' kB'

console.log('')
console.log(`  build      ${manifest.build}`)
console.log(`  version    ${manifest.version}${manifest.commit ? ` (${manifest.commit})` : ''}`)
console.log(`  shell      ${shellVersion}`)
console.log(`  index.html ${kb('index.html')}  (bootloader + rescue, inlined)`)
console.log(`  sw.js      ${kb('sw.js')}`)
console.log(`  icons      ${icons.length}`)
console.log(`  precached  ${manifest.assets.length} app asset(s)`)
console.log('')
console.log('  npm run release          publish to docs/')
console.log('  npm run stage -- <dir>   copy to a staging target')
