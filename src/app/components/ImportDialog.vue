<script>
import DialogShell from './DialogShell.vue'
import ListChoice from './ListChoice.vue'
import * as store from '../core/store'
import { parseTransfer } from '../core/transfer'
import { ui, showToast } from '../ui/state'

/**
 * Import lists from exported JSON, in two steps.
 *
 * STEP ONE is getting the text in — typed, pasted, read off the clipboard, or loaded from
 * a file. The box starts EMPTY: the old combined dialog pre-filled it with everything you
 * already had, so the field you were meant to paste into first had to be cleared, and a
 * half-cleared paste was an import of mangled data.
 *
 * STEP TWO is the decisions, and they can only be asked once the text has been read,
 * because until then there are no list names to ask about. A name that already exists here
 * is a conflict, and merge is the default: it is the only one of the two that cannot lose
 * anything the user already had.
 */
export default {
  name: 'ImportDialog',
  components: { DialogShell, ListChoice },
  emits: ['close'],
  data() {
    return {
      /** 'paste' | 'choose' */
      stage: 'paste',
      text: '',
      error: '',
      /** Coerced incoming lists. Their ids are the keys for every map below. */
      parsed: [],
      chosen: [],
      /** incoming id -> the local list it collides with, by name. */
      conflicts: {},
      /** incoming id -> 'merge' | 'overwrite'. Only meaningful for a conflict. */
      modes: {},
    }
  },
  computed: {
    canRead() {
      return this.text.trim() !== ''
    },
    selectedCount() {
      return this.chosen.length
    },
  },
  /**
   * A cloud restore arrives already holding the JSON, so it skips straight to the
   * decisions. Everything after this point is the paste path, unchanged — which is the
   * whole point: a restore is an import, and gets the same merge/overwrite choice, the
   * same single commit, and the same one-press undo.
   */
  mounted() {
    if (ui.pendingImportText) {
      this.text = ui.pendingImportText
      ui.pendingImportText = ''
      this.read()
      return
    }
    this.$nextTick(() => this.$refs.field?.focus())
  },
  methods: {
    // States the fact, not the outcome: the mode buttons below say what will happen, and
    // they are hidden while the row is unselected, when this is the only signal there is.
    metaFor(list) {
      return this.conflicts[list.id] ? 'already exists' : 'new list'
    },

    toggle(id) {
      const at = this.chosen.indexOf(id)
      if (at === -1) this.chosen.push(id)
      else this.chosen.splice(at, 1)
    },

    async pasteFromClipboard() {
      if (!navigator.clipboard?.readText) {
        showToast('Clipboard blocked by browser')
        return
      }
      try {
        const text = await navigator.clipboard.readText()
        if (!text.trim()) {
          showToast('Clipboard is empty')
          return
        }
        this.text = text
        this.error = ''
      } catch {
        showToast('Clipboard blocked by browser')
      }
    },

    chooseFile() {
      this.$refs.file?.click()
    },

    async onFile(event) {
      const file = event.target.files?.[0]
      // Cleared so that picking the same file twice still fires `change`.
      event.target.value = ''
      if (!file) return
      try {
        this.text = await file.text()
        this.error = ''
      } catch {
        showToast('Could not read that file')
      }
    },

    read() {
      const result = parseTransfer(this.text)
      if (!result.ok) {
        this.error = result.reason
        return
      }

      this.parsed = result.lists
      this.chosen = result.lists.map((l) => l.id)
      this.conflicts = {}
      this.modes = {}
      for (const list of result.lists) {
        const existing = store.findListByName(list.name)
        if (!existing) continue
        this.conflicts[list.id] = existing.id
        this.modes[list.id] = 'merge'
      }
      this.error = ''
      this.stage = 'choose'
    },

    back() {
      this.stage = 'paste'
    },

    submit() {
      const plans = this.parsed
        .filter((list) => this.chosen.includes(list.id))
        .map((list) => {
          const targetId = this.conflicts[list.id]
          return targetId
            ? { list, mode: this.modes[list.id], targetId }
            : { list, mode: 'create' }
        })

      if (plans.length === 0) {
        showToast('Nothing selected')
        return
      }
      // applyImport toasts through commit() when anything changed; a merge that finds
      // everything already present changes nothing, and silence would read as a failure.
      if (store.applyImport(plans) === 0) showToast('Nothing new to import')
      this.$emit('close')
    },
  },
}
</script>

<template>
  <DialogShell title="Import lists" wide @close="$emit('close')">
    <template v-if="stage === 'paste'">
      <p class="body">Paste exported JSON, or load a file you saved earlier.</p>

      <textarea
        ref="field"
        v-model="text"
        class="paste"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        placeholder="{ &quot;lists&quot;: [ … ] }"
        @input="error = ''"
      />

      <div class="sources">
        <button class="source tap" type="button" @click="pasteFromClipboard">Paste</button>
        <button class="source tap" type="button" @click="chooseFile">Load file…</button>
        <input
          ref="file"
          class="hidden"
          type="file"
          accept="application/json,.json,text/plain"
          @change="onFile"
        />
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </template>

    <template v-else>
      <p class="body">
        Choose what to bring in. Anything not selected is left behind.
      </p>

      <div class="picker">
        <ListChoice
          v-for="list in parsed"
          :key="list.id"
          :name="list.name"
          :meta="metaFor(list)"
          :checked="chosen.includes(list.id)"
          @toggle="toggle(list.id)"
        >
          <!-- Only a name that already exists here has a decision to make. -->
          <div v-if="conflicts[list.id] && chosen.includes(list.id)" class="modes">
            <button
              v-for="opt in [
                { id: 'merge', label: 'Merge', hint: 'adds what is missing, keeps everything' },
                { id: 'overwrite', label: 'Overwrite', hint: 'replaces this list entirely' },
              ]"
              :key="opt.id"
              class="mode tap"
              type="button"
              :class="{ on: modes[list.id] === opt.id, danger: opt.id === 'overwrite' }"
              @click="modes[list.id] = opt.id"
            >
              <span class="mode-label">{{ opt.label }}</span>
              <span class="mode-hint">{{ opt.hint }}</span>
            </button>
          </div>
        </ListChoice>
      </div>
    </template>

    <template #actions>
      <span class="spacer" />
      <template v-if="stage === 'paste'">
        <button class="link tap" type="button" @click="$emit('close')">Cancel</button>
        <button class="primary tap" type="button" :disabled="!canRead" @click="read">Next</button>
      </template>
      <template v-else>
        <button class="link tap" type="button" @click="back">Back</button>
        <button class="primary tap" type="button" :disabled="!selectedCount" @click="submit">
          Import
        </button>
      </template>
    </template>
  </DialogShell>
</template>

<style scoped>
.sources {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.source {
  flex: 1;
  min-height: 40px;
  font: 500 13px var(--font);
  color: var(--text2);
  background: var(--chip);
  border-radius: 8px;
  cursor: pointer;
}

.hidden {
  display: none;
}

.error {
  margin: 10px 0 0;
  font: 500 12px/1.4 var(--font);
  color: var(--danger);
}

.picker {
  max-height: 44vh;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.modes {
  display: flex;
  gap: 8px;
  padding: 0 10px 10px 40px;
}

.mode {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  text-align: left;
  background: var(--chip);
  border: 1.5px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}

.mode.on {
  background: var(--accent-bg);
  border-color: var(--accent);
}

.mode-label {
  font: 600 12.5px var(--font);
  color: var(--text2);
}

.mode.on .mode-label {
  color: var(--accent);
}

.mode.on.danger {
  background: transparent;
  border-color: var(--danger);
}

.mode.on.danger .mode-label {
  color: var(--danger);
}

.mode-hint {
  font: 400 10px/1.25 var(--font);
  color: var(--text3);
}
</style>
