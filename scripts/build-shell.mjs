/*
 * Assembles the deployable shell: index.html (bootloader + rescue, fully inlined),
 * sw.js, reset.html, the web manifest, and the launcher icons.
 *
 * The rescue screen is inlined rather than linked because it has to already be resident
 * when it is needed -- fetching it on demand would fail in exactly the situations it
 * exists for. Nothing here is minified: this is the layer you read when everything else
 * has gone wrong, and being able to read it in devtools on a phone is worth the bytes.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateIcons } from './icons.mjs'

const shellDir = fileURLToPath(new URL('../src/shell/', import.meta.url))
const readShell = (name) => readFileSync(join(shellDir, name), 'utf8')

/** Replaces a placeholder, failing loudly if it has been renamed or removed. */
function inject(source, placeholder, code, where) {
  if (!source.includes(placeholder)) {
    throw new Error(`${where}: placeholder ${placeholder} not found. Did the template change?`)
  }
  // A replacer function, not a string: `$&` and friends inside the injected JavaScript
  // would otherwise be interpreted as replacement patterns and silently corrupt output.
  return source.replace(placeholder, () => code)
}

export function buildShell(distDir) {
  const template = readShell('index.template.html')
  const bootloader = readShell('bootloader.js')
  const rescue = readShell('rescue.js')
  const swSource = readShell('sw.js')
  const manifest = readShell('manifest.webmanifest')
  const reset = readShell('reset.html')

  // Hashed from the *sources*, before substitution, so sw.js can carry the value without
  // a circular dependency on its own content. Any shell edit changes this, which is what
  // makes the browser install an updated worker.
  const shellVersion = createHash('sha256')
    .update(template)
    .update(bootloader)
    .update(rescue)
    .update(swSource)
    .digest('hex')
    .slice(0, 12)

  let html = inject(template, '/*__RESCUE_JS__*/', rescue, 'index.template.html')
  html = inject(html, '/*__BOOTLOADER_JS__*/', bootloader, 'index.template.html')

  const sw = inject(swSource, "'__SHELL_VERSION__'", JSON.stringify(shellVersion), 'sw.js')

  mkdirSync(distDir, { recursive: true })
  writeFileSync(join(distDir, 'index.html'), html)
  writeFileSync(join(distDir, 'sw.js'), sw)
  writeFileSync(join(distDir, 'reset.html'), reset)
  writeFileSync(join(distDir, 'manifest.webmanifest'), manifest)

  // GitHub Pages runs Jekyll on branch deployments, which drops files and directories
  // beginning with an underscore. Nothing here starts with one today, but a future
  // bundler output could, and the failure would be a silent 404 in production only.
  writeFileSync(join(distDir, '.nojekyll'), '')

  const icons = generateIcons(join(distDir, 'icons'))

  return { shellVersion, icons }
}

export { shellDir }
