<script>
import * as store from '../core/store'
import { clampQty } from '../core/types'
import { ui, showToast } from '../ui/state'

/**
 * Every modal, sharing one shell.
 *
 * Backdrop click and Escape cancel; Enter submits the text dialogs. Duplicate catalog
 * names are rejected with a toast rather than inline validation — the handoff is
 * specific about that, and it keeps the dialog from growing a second layout state.
 */
export default {
  name: 'Dialogs',
  props: {
    list: { type: Object, default: null },
    version: { type: String, default: '' },
  },
  emits: ['close', 'created'],
  data() {
    return {
      ui,
      text: '',
      alsoAdd: true,
      qty: 1,
      json: '',
    }
  },
  computed: {
    kind() {
      return ui.dialog
    },
    isText() {
      return ['new-list', 'add-catalog', 'rename'].includes(this.kind)
    },
    title() {
      return {
        'new-list': 'New list',
        'add-catalog': 'Add to catalog',
        quantity: 'Quantity',
        rename: 'Rename list',
        'delete-list': 'Delete list',
        data: 'Import / export data',
        about: 'About',
      }[this.kind]
    },
    primaryLabel() {
      return {
        'new-list': 'Add',
        'add-catalog': 'Add',
        quantity: 'Set',
        rename: 'Rename',
        'delete-list': 'Delete',
        data: 'Import',
        about: 'Close',
      }[this.kind]
    },
  },
  mounted() {
    document.addEventListener('keydown', this.onKey)
    this.prime()
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.onKey)
  },
  watch: {
    kind() {
      this.prime()
    },
  },
  methods: {
    prime() {
      this.text = this.kind === 'rename' ? (this.list?.name ?? '') : ''
      this.alsoAdd = true
      this.qty = ui.dialogArg?.value ?? 1
      if (this.kind === 'data') {
        this.json = JSON.stringify({ lists: store.state.lists }, null, 1)
      }
      this.$nextTick(() => this.$refs.field?.focus())
    },
    onKey(e) {
      if (e.key === 'Escape') this.$emit('close')
      else if (e.key === 'Enter' && this.isText) this.submit()
    },
    bump(delta) {
      this.qty = clampQty(this.qty + delta)
    },
    /**
     * Manual route into the rescue screen, for when the app runs but misbehaves.
     * `window` is not in scope in templates, so this cannot be inlined there.
     */
    openTroubleshooting() {
      this.$emit('close')
      this.$nextTick(() => window.__rescue?.('manual'))
    },
    copyJson() {
      navigator.clipboard?.writeText(this.json).then(
        () => showToast('Copied'),
        () => showToast('Copy blocked by browser'),
      )
    },
    submit() {
      const id = this.list?.id
      switch (this.kind) {
        case 'new-list': {
          const made = store.createList(this.text)
          if (!made) return
          // Returns without emitting 'close': the parent reuses this dialog's history
          // layer for the list screen it opens.
          this.$emit('created', made)
          return
        }
        case 'add-catalog': {
          const name = this.text.trim()
          if (!name) return
          if (!store.addCatalogItem(id, name, this.alsoAdd)) {
            showToast(`“${name}” is already in the catalog`)
            return
          }
          break
        }
        case 'quantity':
          store.setQty(id, ui.dialogArg.cid, this.qty)
          break
        case 'rename':
          store.renameList(id, this.text)
          break
        case 'delete-list':
          store.deleteList(id)
          break
        case 'data': {
          let parsed
          try {
            parsed = JSON.parse(this.json)
          } catch {
            showToast('Could not read that data')
            return
          }
          if (store.importLists(parsed) === null) {
            showToast('Could not read that data')
            return
          }
          break
        }
        default:
          break
      }
      this.$emit('close')
    },
  },
}
</script>

<template>
  <div class="scrim slp-fade" @click.self="$emit('close')">
    <div class="card slp-pop" role="dialog" aria-modal="true">
      <h2>{{ title }}</h2>

      <template v-if="isText">
        <input
          ref="field"
          v-model="text"
          class="field"
          type="text"
          :placeholder="kind === 'add-catalog' ? 'Item name' : 'List name'"
          autocomplete="off"
        />
        <label v-if="kind === 'add-catalog'" class="check">
          <input v-model="alsoAdd" type="checkbox" />
          <span>Also add to my list now</span>
        </label>
      </template>

      <div v-else-if="kind === 'quantity'" class="stepper">
        <button type="button" aria-label="Less" @click="bump(-1)">−</button>
        <span class="count">{{ qty }}</span>
        <button type="button" aria-label="More" @click="bump(1)">+</button>
      </div>

      <p v-else-if="kind === 'delete-list'" class="body">
        The list and its catalog are removed. You can undo this.
      </p>

      <textarea v-else-if="kind === 'data'" ref="field" v-model="json" class="json" spellcheck="false" />

      <p v-else-if="kind === 'about'" class="body">
        Shopping List v{{ version }}<br />
        Offline-first. Everything is stored on this device — no account, no server.
      </p>

      <div class="actions">
        <button
          v-if="kind === 'about'"
          class="link"
          type="button"
          @click="openTroubleshooting"
        >
          Troubleshooting…
        </button>
        <button v-if="kind === 'data'" class="link" type="button" @click="copyJson">Copy</button>
        <span class="spacer" />
        <button v-if="kind !== 'about'" class="link" type="button" @click="$emit('close')">
          Cancel
        </button>
        <button
          class="primary"
          :class="{ danger: kind === 'delete-list' }"
          type="button"
          @click="kind === 'about' ? $emit('close') : submit()"
        >
          {{ primaryLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--scrim);
}

.card {
  width: min(320px, 100%);
  padding: 18px 18px 14px;
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow);
}

h2 {
  margin: 0 0 10px;
  font: 600 15px/1.3 var(--font);
  color: var(--text);
}

.body {
  margin: 0 0 12px;
  font: 400 12.5px/1.45 var(--font);
  color: var(--text2);
}

.field {
  width: 100%;
  height: 46px;
  padding: 0 12px;
  font: 400 15px var(--font);
  color: var(--text);
  border: 1.5px solid var(--accent);
  border-radius: 8px;
  box-sizing: border-box;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font: 400 13px var(--font);
  color: var(--text2);
}

.check input {
  width: 18px;
  height: 18px;
  -webkit-appearance: auto;
  accent-color: var(--accent);
}

.stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

.stepper button {
  width: 46px;
  height: 46px;
  font: 300 24px/1 var(--font);
  color: var(--text);
  background: var(--chip);
  border-radius: 8px;
  cursor: pointer;
}

.count {
  min-width: 46px;
  text-align: center;
  font: 600 19px var(--mono);
  color: var(--text);
}

.json {
  width: 100%;
  height: 150px;
  padding: 8px;
  font: 400 11.5px/1.35 var(--mono);
  color: var(--text);
  border: 1.5px solid var(--accent);
  border-radius: 8px;
  box-sizing: border-box;
  resize: none;
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 14px;
}

.spacer {
  flex: 1;
}

.link {
  padding: 10px 10px;
  font: 500 13px var(--font);
  color: var(--text2);
  border-radius: 7px;
  cursor: pointer;
}

.primary {
  padding: 10px 14px;
  font: 600 13.5px var(--font);
  color: var(--accent);
  border-radius: 7px;
  cursor: pointer;
}

.primary.danger {
  color: var(--danger);
}
</style>
