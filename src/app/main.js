import { createApp } from 'vue'
import App from './App.vue'
import { initialize } from './core/store'
import { signalReady } from './core/bootBridge'

// Data is loaded before the first render so the app never flashes an empty home screen
// on top of existing lists. Top-level await is fine at the es2022 build target.
const initResult = await initialize()

createApp(App, { initResult }).mount('#app')

// Disarms the bootloader watchdog. Nothing above this line may throw, or a healthy
// build is judged broken; nothing below it may be required for the app to function.
signalReady()
