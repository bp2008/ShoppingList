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
.toast {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
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
