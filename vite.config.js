import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const appRoot = fileURLToPath(new URL('./src/app', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// The app builds to a self-contained, path-independent bundle that the bootloader loads
// from releases/<buildId>/. Nothing here may bake in a deployment URL: the same dist/
// has to run at the GitHub Pages subpath, at a staging root, and on localhost.
// See "One artifact, any URL" in the architecture plan.
export default defineConfig({
  base: './',
  root: appRoot,
  plugins: [vue()],
  // Single source of truth for the version string the UI renders (top bar, drawer
  // footer, About dialog) and for the release manifest.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': appRoot },
  },
  // Honour PORT so more than one dev server can run on the same machine. Vite does not
  // read it on its own, and 5173 is the only port it will otherwise offer.
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    // Intermediate output. scripts/build-release.mjs relocates this into
    // dist/releases/<buildId>/ and derives the precache manifest from it.
    outDir: fileURLToPath(new URL('./.build/app', import.meta.url)),
    emptyOutDir: true,
    // Modern smartphones only, no Babel. Keep in sync with tsconfig.json target/lib.
    target: 'es2022',
    manifest: true,
    // Modern smartphones only; the polyfill would inject a script we don't need.
    modulePreload: { polyfill: false },
    // Shipped but deliberately excluded from the precache manifest, so they cost
    // nothing on device and are still there when a production bug needs tracing.
    sourcemap: true,
  },
})
