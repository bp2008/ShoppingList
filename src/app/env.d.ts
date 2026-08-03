/// <reference types="vite/client" />

/** Injected by vite.config.js `define`, sourced from package.json. */
declare const __APP_VERSION__: string

/**
 * Injected by vite.config.js `define`, sourced from `DROPBOX_APP_KEY` in the environment.
 *
 * Empty string in any build made without one, which hides the cloud backup feature
 * entirely -- so a fork builds with it dormant rather than linking users against this
 * project's Dropbox app.
 */
declare const __DROPBOX_APP_KEY__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
