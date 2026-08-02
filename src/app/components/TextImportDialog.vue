<script>
import DialogShell from './DialogShell.vue'
import * as store from '../core/store'
import { parseTextItems } from '../core/transfer'
import { showToast } from '../ui/state'

/**
 * Add items to the open list from a pasted plain-text list.
 *
 * ALWAYS A MERGE. There is no overwrite here and no prompt offering one: the user is
 * adding to the list they are looking at, and a paste that could silently clear it is not
 * a feature anyone asked for. Nothing is removed, nothing already on the list moves, and
 * no quantity is touched.
 *
 * Checkbox markup — `[ ]` / `[X]`, the shape a Google Keep checklist exports in — is
 * understood rather than imported literally. A ticked item is one they already have, so it
 * joins the catalog and stops there. See core/transfer.parseTextItems.
 */
export default {
  name: 'TextImportDialog',
  components: { DialogShell },
  props: {
    list: { type: Object, required: true },
  },
  emits: ['close'],
  data() {
    return { text: '' }
  },
  computed: {
    entries() {
      return parseTextItems(this.text)
    },
    ticked() {
      return this.entries.filter((e) => e.checked === true).length
    },
    summary() {
      const total = this.entries.length
      if (total === 0) return 'Nothing recognised yet'
      const found = total === 1 ? '1 item' : `${total} items`
      return this.ticked ? `${found} · ${this.ticked} already ticked` : found
    },
  },
  mounted() {
    this.$nextTick(() => this.$refs.field?.focus())
  },
  methods: {
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
      } catch {
        showToast('Clipboard blocked by browser')
      }
    },

    submit() {
      if (store.importTextItems(this.list.id, this.entries) === 0) {
        showToast('Nothing new to add')
      }
      this.$emit('close')
    },
  },
}
</script>

<template>
  <DialogShell title="Add items from text" wide @close="$emit('close')">
    <p class="body">
      One item per line. <code>[ ]</code> and <code>[X]</code> are understood — ticked items
      go to the catalog only. Nothing is removed.
    </p>

    <textarea
      ref="field"
      v-model="text"
      class="paste"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      placeholder=""
    />

    <div class="foot">
      <button class="source tap" type="button" @click="pasteFromClipboard">Paste</button>
      <span class="summary">{{ summary }}</span>
    </div>

    <template #actions>
      <span class="spacer" />
      <button class="link tap" type="button" @click="$emit('close')">Cancel</button>
      <button class="primary tap" type="button" :disabled="!entries.length" @click="submit">
        Add items
      </button>
    </template>
  </DialogShell>
</template>

<style scoped>
code {
  padding: 1px 4px;
  font: 400 11px var(--mono);
  color: var(--text2);
  background: var(--chip);
  border-radius: 4px;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}

.source {
  min-height: 36px;
  padding: 0 14px;
  font: 500 13px var(--font);
  color: var(--text2);
  background: var(--chip);
  border-radius: 8px;
  cursor: pointer;
}

.summary {
  font: 400 11px var(--mono);
  color: var(--text3);
  text-align: right;
}
</style>
