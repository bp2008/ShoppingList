<script>
import DialogShell from './DialogShell.vue'
import ListChoice from './ListChoice.vue'
import * as store from '../core/store'
import { buildExport, exportFileName } from '../core/transfer'
import { showToast } from '../ui/state'

/**
 * Export chosen lists, to the clipboard or to a file.
 *
 * DELIBERATELY NO TEXT BOX. The old combined dialog showed the JSON in an editable
 * textarea, which invited editing something that was only ever meant to be carried
 * somewhere else, and made "which lists?" unanswerable — it was all of them or nothing.
 * What the user actually decides here is *which lists* and *where to*, so that is all this
 * asks. Reading the JSON is what the import dialog's box is for.
 */
export default {
  name: 'ExportDialog',
  components: { DialogShell, ListChoice },
  emits: ['close'],
  data() {
    // Everything is chosen to begin with: a backup of one list is the exception, and the
    // whole-of-my-data case should not need any taps at all.
    return { chosen: store.state.lists.map((l) => l.id) }
  },
  computed: {
    lists() {
      return store.state.lists
    },
    selected() {
      return this.lists.filter((l) => this.chosen.includes(l.id))
    },
    allChosen() {
      return this.lists.length > 0 && this.chosen.length === this.lists.length
    },
    summary() {
      if (this.selected.length === 0) return 'Nothing selected'
      const lists = this.selected.length === 1 ? '1 list' : `${this.selected.length} lists`
      const items = this.selected.reduce((n, l) => n + l.catalog.length, 0)
      return `${lists} · ${items === 1 ? '1 catalog item' : `${items} catalog items`}`
    },
  },
  methods: {
    countOf(list) {
      return `${list.items.length}/${list.catalog.length}`
    },
    toggle(id) {
      const at = this.chosen.indexOf(id)
      if (at === -1) this.chosen.push(id)
      else this.chosen.splice(at, 1)
    },
    toggleAll() {
      this.chosen = this.allChosen ? [] : this.lists.map((l) => l.id)
    },

    payload() {
      return buildExport(this.selected)
    },

    copy() {
      navigator.clipboard?.writeText(this.payload()).then(
        () => {
          showToast(`Copied ${this.selected.length === 1 ? '1 list' : `${this.selected.length} lists`}`)
          this.$emit('close')
        },
        () => showToast('Copy blocked by browser'),
      )
    },

    /**
     * Save as a file, via a throwaway object URL.
     *
     * The anchor is put in the document before it is clicked and revoked a beat later:
     * some browsers ignore a click on a detached node, and revoking in the same tick can
     * cancel the download before it has started.
     */
    download() {
      const url = URL.createObjectURL(new Blob([this.payload()], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = exportFileName()
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      showToast('Exported to a file')
      this.$emit('close')
    },
  },
}
</script>

<template>
  <DialogShell title="Export lists" wide @close="$emit('close')">
    <template v-if="lists.length === 0">
      <p class="body">There are no lists to export yet.</p>
    </template>

    <template v-else>
      <div class="head">
        <button class="all tap" type="button" @click="toggleAll">
          {{ allChosen ? 'Select none' : 'Select all' }}
        </button>
        <span class="summary">{{ summary }}</span>
      </div>

      <div class="picker">
        <ListChoice
          v-for="list in lists"
          :key="list.id"
          :name="list.name"
          :meta="countOf(list)"
          :checked="chosen.includes(list.id)"
          @toggle="toggle(list.id)"
        />
      </div>

      <p class="body note">Counts are items on the list over items in its catalog.</p>
    </template>

    <template #actions>
      <span class="spacer" />
      <button v-if="lists.length === 0" class="primary tap" type="button" @click="$emit('close')">
        Close
      </button>
      <template v-else>
        <button class="link tap" type="button" @click="$emit('close')">Cancel</button>
        <button class="link tap" type="button" :disabled="!selected.length" @click="copy">
          Copy
        </button>
        <button class="primary tap" type="button" :disabled="!selected.length" @click="download">
          Save file
        </button>
      </template>
    </template>
  </DialogShell>
</template>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.all {
  padding: 4px 8px;
  margin-left: -8px;
  font: 500 12.5px var(--font);
  color: var(--accent);
  border-radius: 6px;
  cursor: pointer;
}

.summary {
  font: 400 11px var(--mono);
  color: var(--text3);
}

.picker {
  max-height: 46vh;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.note {
  margin: 10px 0 0;
}
</style>
