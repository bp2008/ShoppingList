import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))
const appRoot = fileURLToPath(new URL('./src/app', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/**
 * The Dropbox app key. PUT IT HERE, IN THE REPO, AND COMMIT IT.
 *
 * It is a public client id, not a credential. PKCE is what secures the flow -- there is no
 * app secret anywhere in this project -- and the key ships in readable JavaScript inside
 * `docs/releases/<buildId>/assets/*.js`, which is tracked. Hiding it in an ignored file
 * would keep it out of exactly nowhere while guaranteeing that a fresh clone, a second
 * machine, or a lost file silently builds a bundle with cloud backup missing and no error
 * to say so.
 *
 * What actually stops someone else's site from using this key is the registered redirect
 * URI list in the Dropbox console: an authorisation code can only ever come back to a URI
 * registered there. Guard that list, not this string.
 *
 * Empty means the feature is compiled out entirely, which is the right default for a fork.
 */
const DROPBOX_APP_KEY = 'l0215qrdyvdvfun'

/**
 * `.env` / the environment can override the constant above, for testing against a
 * throwaway Dropbox app without editing a tracked file. The empty `loadEnv` prefix returns
 * unprefixed names -- this is not a `VITE_` var, because it is injected through `define`
 * rather than read off `import.meta.env`.
 *
 * An override is announced on stderr. Publishing a release built against the wrong Dropbox
 * app because of a `.env` left lying around is precisely the kind of silent mistake this
 * whole arrangement exists to avoid.
 */
function dropboxAppKey(mode) {
  const override = process.env.DROPBOX_APP_KEY || loadEnv(mode, repoRoot, '').DROPBOX_APP_KEY
  if (override && override !== DROPBOX_APP_KEY) {
    console.warn(`[vite] Dropbox app key overridden by .env / environment: ${override}`)
    return override
  }
  return DROPBOX_APP_KEY
}

// The app builds to a self-contained, path-independent bundle that the bootloader loads
// from releases/<buildId>/. Nothing here may bake in a deployment URL: the same dist/
// has to run at the GitHub Pages subpath, at a staging root, and on localhost.
// See "One artifact, any URL" in the architecture plan.
export default defineConfig(({ mode }) => ({
  base: './',
  root: appRoot,
  plugins: [vue()],
  // Single source of truth for the version string the UI renders (top bar, drawer
  // footer, About dialog) and for the release manifest.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // The Dropbox app key is a PUBLIC client id -- PKCE is what secures the flow, so this
    // is meant to be readable in the bundle. It is build-time config rather than a
    // constant so a fork builds without it (and with cloud backup hidden) by default,
    // instead of linking its users against this project's Dropbox app.
    __DROPBOX_APP_KEY__: JSON.stringify(dropboxAppKey(mode)),
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
}))
