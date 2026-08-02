import { createApp } from 'vue'
import App from './App.vue'
import { initialize } from './core/store'
import { signalReady } from './core/bootBridge'
import { createAppRouter } from './ui/router'
import { installNavigation } from './ui/navigation'
import { installInputMode } from './ui/inputMode'

// Data is loaded before the first render so the app never flashes an empty home screen
// on top of existing lists. Top-level await is fine at the es2022 build target.
const initResult = await initialize()

// After initialize(), because the list route's guard asks the store whether the list in
// the URL still exists.
const router = createAppRouter()
installNavigation(router)
installInputMode()

const app = createApp(App, { initResult })
app.use(router)
// Resolve the URL before the first render, so a reload into a list paints that list
// rather than the home screen followed by a jump.
await router.isReady()
app.mount('#app')

// Disarms the bootloader watchdog. Nothing above this line may throw, or a healthy
// build is judged broken; nothing below it may be required for the app to function.
signalReady()
