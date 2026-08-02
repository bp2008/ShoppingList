/// <reference types="vite/client" />

/** Injected by vite.config.js `define`, sourced from package.json. */
declare const __APP_VERSION__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
