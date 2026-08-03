<script>
import DialogShell from './DialogShell.vue'
import CloudRestoreDialog from './CloudRestoreDialog.vue'
import ExportDialog from './ExportDialog.vue'
import ImportDialog from './ImportDialog.vue'
import TextImportDialog from './TextImportDialog.vue'
import * as store from '../core/store'
import * as cloudApi from '../core/cloud'
import { clampQty } from '../core/types'
import { ui, showToast } from '../ui/state'
import { goHome } from '../ui/navigation'

/**
 * The small modals, plus the dispatch to the three that are not small.
 *
 * Backdrop click and Escape cancel — both owned by DialogShell — and Enter submits the
 * text dialogs. Duplicate catalog names are rejected with a toast rather than inline
 * validation: the handoff is specific about that, and it keeps the dialog from growing a
 * second layout state.
 *
 * Import and export are components of their own because each is a workflow rather than a
 * field: which lists, from where, and what to do about a name that already exists. They
 * share this shell, not this file.
 */

/** Kinds this component draws itself. Anything else dispatches above. */
const SIMPLE = [
  'new-list',
  'add-catalog',
  'quantity',
  'rename',
  'delete-list',
  'cloud-disconnect',
  'about',
]

/** Kinds whose primary button is destructive, and is coloured to say so. */
const DESTRUCTIVE = ['delete-list', 'cloud-disconnect']

export default {
  name: 'Dialogs',
  components: { DialogShell, CloudRestoreDialog, ExportDialog, ImportDialog, TextImportDialog },
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
    }
  },
  computed: {
    kind() {
      return ui.dialog
    },
    simple() {
      return SIMPLE.includes(this.kind)
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
        'cloud-disconnect': 'Disconnect Dropbox',
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
        'cloud-disconnect': 'Disconnect',
        about: 'Close',
      }[this.kind]
    },
    destructive() {
      return DESTRUCTIVE.includes(this.kind)
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
      this.$nextTick(() => this.$refs.field?.focus())
    },
    // Escape belongs to DialogShell; handling it here as well would emit two closes and
    // walk two entries back out of history.
    onKey(e) {
      if (e.key === 'Enter' && this.isText) this.submit()
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
          // Deliberately no 'close': the screen behind this dialog is the list that no
          // longer exists. One navigation home replaces both, where closing first and
          // then leaving would be two navigations racing over the same history entry.
          goHome()
          return
        case 'cloud-disconnect':
          // Resolves even when the revoke cannot reach Dropbox, so the dialog closes on
          // the same tick either way and the card reports the outcome in its own time.
          void cloudApi.disconnect()
          break
        default:
          break
      }
      this.$emit('close')
    },
  },
}
</script>

<template>
  <ExportDialog v-if="kind === 'export'" @close="$emit('close')" />
  <ImportDialog v-else-if="kind === 'import'" @close="$emit('close')" />
  <CloudRestoreDialog v-else-if="kind === 'cloud-restore'" @close="$emit('close')" />
  <TextImportDialog
    v-else-if="kind === 'import-text' && list"
    :list="list"
    @close="$emit('close')"
  />

  <DialogShell v-else-if="simple" :title="title" @close="$emit('close')">
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
      <button class="tap" type="button" aria-label="Less" @click="bump(-1)">−</button>
      <span class="count">{{ qty }}</span>
      <button class="tap" type="button" aria-label="More" @click="bump(1)">+</button>
    </div>

    <p v-else-if="kind === 'delete-list'" class="body">
      The list and its catalog are removed. You can undo this.
    </p>

    <!--
      Says what survives as well as what stops, because the alarming reading of
      "disconnect" is that the backups go with it. They do not: they are files in the
      user's own Dropbox and this app has never been able to reach anything else.
    -->
    <p v-else-if="kind === 'cloud-disconnect'" class="body">
      This device stops backing up, and Shopping List gives up its access to your Dropbox.
      The backups already there are kept — you can reconnect and restore from them at any
      time.
    </p>

    <template v-else-if="kind === 'about'">
      <p class="body">
        Shopping List v{{ version }}<br />
        Offline-first. Your lists are stored on this device, and go nowhere else unless you
        turn on cloud backup.
      </p>
      <!--
        `target="_blank"` is what hands this to the real browser. An installed app has no
        address bar and no tabs, so following a link in place would strand the user on a
        page they cannot leave except by Back, with nothing on screen saying where they
        are. `rel` because a new context must never get a handle on this one.
      -->
      <a
        class="repo tap"
        href="https://github.com/bp2008/ShoppingList"
        target="_blank"
        rel="noopener noreferrer"
      >
        github.com/bp2008/ShoppingList
      </a>
    </template>

    <template #actions>
      <button v-if="kind === 'about'" class="link tap" type="button" @click="openTroubleshooting">
        Troubleshooting…
      </button>
      <span class="spacer" />
      <button v-if="kind !== 'about'" class="link tap" type="button" @click="$emit('close')">
        Cancel
      </button>
      <button
        class="primary tap"
        :class="{ danger: destructive }"
        type="button"
        @click="kind === 'about' ? $emit('close') : submit()"
      >
        {{ primaryLabel }}
      </button>
    </template>
  </DialogShell>
</template>

<style scoped>
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

/*
 * A row of its own rather than a run of text: it is the one tap target in this dialog, and
 * the negative margin pulls its label back into line with the paragraph above so that the
 * padding buying it a finger-sized height does not show as an indent.
 */
.repo {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  margin: 0 0 0 -8px;
  padding: 0 8px;
  font: 500 12.5px var(--font);
  color: var(--accent);
  text-decoration: none;
  border-radius: 7px;
  overflow-wrap: anywhere;
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
</style>
