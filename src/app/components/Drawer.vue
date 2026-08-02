<script>
import * as store from '../core/store'
import { ui } from '../ui/state'

/**
 * The hamburger sheet.
 *
 * Undo and redo sit at the very top and NAME the action they would reverse — the handoff
 * is emphatic that every accidental action is undoable and that the button says which
 * one. Labels wrap rather than truncate, because a truncated undo label defeats the point.
 *
 * Theme lives in Settings, not here, and there is no "Manage catalog" entry.
 */
export default {
  name: 'Drawer',
  props: {
    view: { type: String, required: true },
    list: { type: Object, default: null },
    version: { type: String, default: '' },
  },
  emits: ['close', 'action'],
  data() {
    return { ui, store }
  },
  computed: {
    title() {
      return this.view === 'list' && this.list ? this.list.name : 'Shopping List'
    },
    undoLabel() {
      return store.undoStack.at(-1)?.label ?? ''
    },
    redoLabel() {
      return store.redoStack.at(-1)?.label ?? ''
    },
  },
  methods: {
    run(action) {
      this.$emit('action', action)
    },
  },
}
</script>

<template>
  <div class="scrim slp-fade" @click.self="$emit('close')">
    <aside class="sheet slp-pop">
      <header class="head">{{ title }}</header>

      <div class="history">
        <button class="step" type="button" :disabled="!undoLabel" @click="run('undo')">
          <span class="verb">Undo</span>
          <span class="desc">{{ undoLabel || 'Nothing to undo' }}</span>
        </button>
        <button class="step" type="button" :disabled="!redoLabel" @click="run('redo')">
          <span class="verb">Redo</span>
          <span class="desc">{{ redoLabel || 'Nothing to redo' }}</span>
        </button>
      </div>

      <nav class="menu">
        <!-- Only present once an update is fully staged on this device. -->
        <button v-if="ui.updateReady" class="item accent" type="button" @click="run('apply-update')">
          Update ready — restart
        </button>

        <template v-if="view === 'home'">
          <button class="item" type="button" @click="run('new-list')">New list</button>
          <hr />
          <button class="item" type="button" @click="run('data')">Import / export data</button>
          <button class="item" type="button" @click="run('settings')">Settings</button>
          <button class="item" type="button" @click="run('about')">About</button>
        </template>

        <template v-else>
          <button class="item" type="button" @click="run('sort')">Sort left column A–Z</button>
          <button class="item toggle-row" type="button" @click="run('toggle-others')">
            <span>Show catalog items from other lists</span>
            <span class="toggle" :class="{ on: list && list.showOthers }"><i /></span>
          </button>
          <button class="item" type="button" @click="run('select-catalog')">
            Remove items from catalog…
          </button>
          <hr />
          <button class="item" type="button" @click="run('rename')">Rename list</button>
          <button class="item" type="button" @click="run('copy-text')">Copy list as text</button>
          <button class="item" type="button" @click="run('data')">Import / export data</button>
          <button class="item" type="button" @click="run('settings')">Settings</button>
          <hr />
          <button class="item danger" type="button" @click="run('delete-list')">
            Delete this list
          </button>
        </template>
      </nav>

      <footer class="foot">Shopping List · v{{ version }}</footer>
    </aside>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  display: flex;
  justify-content: flex-end;
  z-index: 50;
}

.sheet {
  width: min(320px, 86vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.head {
  flex: 0 0 auto;
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  font: 600 15px var(--font);
  color: var(--text);
  border-bottom: 1px solid var(--line);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.step {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 10px;
  text-align: left;
  background: var(--chip);
  border-radius: 8px;
  cursor: pointer;
}

.step:disabled {
  opacity: 0.45;
  cursor: default;
}

.verb {
  font: 600 12.5px var(--font);
  color: var(--text);
}

.desc {
  font: 400 10.5px/1.3 var(--font);
  color: var(--text2);
  overflow-wrap: anywhere;
}

.menu {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 9px 16px;
  text-align: left;
  font: 400 14.5px/1.3 var(--font);
  color: var(--text);
  cursor: pointer;
}

.item.danger {
  color: var(--danger);
}

.item.accent {
  color: var(--accent);
  font-weight: 600;
}

hr {
  margin: 4px 0;
  border: 0;
  border-top: 1px solid var(--line2);
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

.foot {
  flex: 0 0 auto;
  height: 38px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  font: 400 11px var(--mono);
  color: var(--text3);
  border-top: 1px solid var(--line);
}
</style>
