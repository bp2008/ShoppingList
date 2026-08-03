import { createApp } from 'vue'
import App from './App.vue'
import { initialize } from './core/store'
import { signalReady } from './core/bootBridge'
import * as cloud from './core/cloud'
import { createAppRouter } from './ui/router'
import { installNavigation } from './ui/navigation'
import { installInputMode } from './ui/inputMode'

// Take an OAuth redirect out of the URL before the router is built, so the single-use code
// is gone from the address bar and cannot be retried by a reload. Synchronous and
// non-throwing by contract -- everything above signalReady() is inside the bootloader
// watchdog window, where an exception gets a healthy build rolled back. The network half
// of the exchange happens in cloud.init(), below the line.
cloud.captureRedirect()

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

// Finishes any pending Dropbox sign-in and backs up if one is due. Deliberately not
// awaited: the app is fully usable without it, and it resolves even when it fails.
void cloud.init()
