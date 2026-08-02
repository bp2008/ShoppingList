<script>
import * as store from '../core/store'
import { UNDO_LIMIT } from '../core/types'
import { openLayer } from '../ui/navigation'

export default {
  name: 'SettingsSheet',
  emits: ['close'],
  data() {
    return { state: store.state, UNDO_LIMIT }
  },
  computed: {
    rowHeight: {
      get() {
        return store.state.settings.rowHeight
      },
      set(v) {
        store.setRowHeight(Number(v))
      },
    },
  },
  methods: {
    setTheme: store.setTheme,
    toggleGrips() {
      store.setShowGrips(!store.state.settings.showGrips)
    },
    toggleAskQty() {
      store.setAskQty(!store.state.settings.askQty)
    },

    /**
     * Opened as a layer ON TOP of this sheet, not in place of it.
     *
     * The sheet is `?settings`; this pushes `?settings&dialog=export`, so one Back closes
     * the dialog and leaves Settings standing — which is where the user was, and where
     * they will want to be after a backup.
     */
    openTransfer(kind) {
      openLayer({ dialog: kind })
    },
  },
}
</script>

<template>
  <div class="sheet slp-fade">
    <header class="bar">
      <button class="back tap" type="button" aria-label="Back" @click="$emit('close')">‹</button>
      <span class="title">Settings</span>
    </header>

    <div class="body">
      <section class="card">
        <h2>Appearance</h2>
        <div class="segmented">
          <button
            v-for="opt in [
              { id: 'light', label: 'Light' },
              { id: 'oled', label: 'OLED black' },
              { id: 'system', label: 'System' },
            ]"
            :key="opt.id"
            class="tap"
            type="button"
            :class="{ on: state.settings.theme === opt.id }"
            @click="setTheme(opt.id)"
          >
            {{ opt.label }}
          </button>
        </div>
      </section>

      <section class="card">
        <h2>Item height</h2>
        <div class="slider-head">
          <span class="label">Minimum row height</span>
          <span class="value">{{ rowHeight }} px</span>
        </div>
        <input v-model="rowHeight" type="range" min="32" max="60" step="2" />
        <div class="ends"><span>32</span><span>60</span></div>
      </section>

      <section class="card">
        <h2>Behaviour</h2>
        <button class="toggle-row tap" type="button" @click="toggleGrips">
          <span class="texts">
            <span class="label">Show drag grips</span>
            <span class="hint">Off, or on narrow screens: long-press a row to drag</span>
          </span>
          <span class="toggle" :class="{ on: state.settings.showGrips }"><i /></span>
        </button>
        <button class="toggle-row tap" type="button" @click="toggleAskQty">
          <span class="texts">
            <span class="label">Ask quantity on duplicate drag</span>
            <span class="hint">Otherwise a repeat drag just increments</span>
          </span>
          <span class="toggle" :class="{ on: state.settings.askQty }"><i /></span>
        </button>
      </section>

      <section class="card">
        <h2>Your data</h2>
        <button class="link-row tap" type="button" @click="openTransfer('export')">
          <span class="texts">
            <span class="label">Export lists…</span>
            <span class="hint">Copy to the clipboard, or save a JSON file</span>
          </span>
          <span class="chev">›</span>
        </button>
        <button class="link-row tap" type="button" @click="openTransfer('import')">
          <span class="texts">
            <span class="label">Import lists…</span>
            <span class="hint">Paste or load a file, then choose what to bring in</span>
          </span>
          <span class="chev">›</span>
        </button>
      </section>

      <p class="note">
        Undo history keeps the last {{ UNDO_LIMIT }} actions. All data is stored on this device
        only, so an export is the only backup there is.
      </p>
    </div>
  </div>
</template>

<style scoped>
.sheet {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 4px;
  background: var(--topbar);
  border-bottom: 1px solid var(--line);
}

.back {
  width: 38px;
  height: 44px;
  font: 300 26px/1 var(--font);
  color: var(--text);
  cursor: pointer;
}

.title {
  font: 600 17px var(--font);
  color: var(--text);
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.card {
  margin-bottom: 12px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 9px;
}

h2 {
  margin: 0 0 10px;
  font: 600 9.5px var(--font);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text3);
}

.segmented {
  display: flex;
  gap: 8px;
}

.segmented button {
  flex: 1;
  min-height: 40px;
  padding: 8px 6px;
  font: 400 13px var(--font);
  color: var(--text2);
  background: var(--chip);
  border: 1.5px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}

.segmented button.on {
  color: var(--accent);
  font-weight: 600;
  background: var(--accent-bg);
  border-color: var(--accent);
}

:where(html[data-input='mouse']) .segmented button:not(.on):hover {
  border-color: var(--line);
}

/*
 * The row is only the shape of the setting; the toggle is the control. Both react, so it
 * is obvious that the whole row is the target and not just the switch.
 */
:where(html[data-input='mouse']) .toggle-row:hover .toggle:not(.on) {
  background: var(--grip2);
}

.slider-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}

.label {
  font: 400 14px var(--font);
  color: var(--text);
}

.value {
  font: 600 12px var(--mono);
  color: var(--text2);
}

input[type='range'] {
  width: 100%;
}

.ends {
  display: flex;
  justify-content: space-between;
  font: 400 10.5px var(--mono);
  color: var(--text3);
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 46px;
  padding: 6px 0;
  text-align: left;
  border-radius: 6px;
  cursor: pointer;
}

.toggle-row:focus-visible,
.link-row:focus-visible {
  outline-offset: -1px;
}

/* Same shape as a toggle row; the chevron is what says it opens something instead. */
.link-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 46px;
  padding: 6px 0;
  text-align: left;
  border-radius: 6px;
  cursor: pointer;
}

.chev {
  flex: 0 0 auto;
  font: 300 20px/1 var(--font);
  color: var(--text3);
}

.texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.hint {
  font: 400 11px/1.3 var(--font);
  color: var(--text3);
}

.toggle {
  flex: 0 0 auto;
  position: relative;
  width: 38px;
  height: 22px;
  background: var(--chip);
  border-radius: 11px;
}

.toggle.on {
  background: var(--accent);
}

.toggle i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: #fff;
  border-radius: 50%;
  transition: left 120ms ease;
}

.toggle.on i {
  left: 18px;
}

.note {
  margin: 4px 2px;
  font: 400 11.5px/1.45 var(--font);
  color: var(--text3);
}
</style>
