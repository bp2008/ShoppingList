<script>
import { ui } from '../ui/state'

/**
 * Fired on every committed mutation, using the same label the undo stack records — so
 * the confirmation and the undo button always agree on what just happened.
 */
export default {
  name: 'Toast',
  data() {
    return { ui }
  },
}
</script>

<template>
  <div v-if="ui.toast" class="toast slp-fade">{{ ui.toast }}</div>
</template>

<style scoped>
/*
 * Anchored 22px above the bottom of the VISUAL viewport, not the layout one — see
 * ui/viewport.js. A toast pinned to `bottom` vanishes behind the on-screen keyboard, and
 * the toasts that fire while a dialog is open are the ones reporting that something did
 * not work.
 */
.toast {
  position: fixed;
  left: 50%;
  top: calc(var(--vv-top, 0px) + var(--vv-height, 100%) - 22px);
  transform: translate(-50%, -100%);
  max-width: calc(100vw - 32px);
  padding: 9px 16px;
  font: 500 12.5px var(--font);
  color: var(--bg);
  background: var(--text);
  border-radius: 20px;
  opacity: 0.94;
  pointer-events: none;
  z-index: 80;
  text-align: center;
}
</style>
