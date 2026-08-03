<script>
import DialogShell from './DialogShell.vue'
import { fetchBackup, listBackups } from '../core/cloud'
import { relativeTime } from '../core/format'
import { ui } from '../ui/state'
import { replaceLayer } from '../ui/navigation'

/**
 * Pick a snapshot out of Dropbox and hand it to the import dialog.
 *
 * DELIBERATELY NOT A RESTORE. This dialog downloads bytes and gets out of the way: the
 * decisions — which lists, and merge or overwrite for the ones that collide — belong to
 * the import dialog, which already asks them and already commits the whole thing as one
 * undoable action. Duplicating any of that here would be a second, less careful path for
 * the only operation in the app that can destroy data.
 *
 * Every file in the folder is offered, not just ones matching our naming pattern, so a
 * snapshot the user renamed or dropped in by hand still restores. Anything unreadable is
 * caught by `parseTransfer` on the other side with its own message.
 */
export default {
  name: 'CloudRestoreDialog',
  components: { DialogShell },
  emits: ['close'],
  data() {
    // `listed` is not the same question as `files.length === 0`: a listing that FAILED
    // knows nothing about whether backups exist, and must not answer "there are none".
    return { loading: true, listed: false, error: '', files: [], busyPath: '' }
  },
  async mounted() {
    try {
      this.files = await listBackups()
      this.listed = true
    } catch (err) {
      this.error = err?.message || 'Could not reach Dropbox'
    } finally {
      this.loading = false
    }
  },
  methods: {
    when(file) {
      return file.modified ? relativeTime(file.modified) : ''
    },
    size(file) {
      return `${Math.max(1, Math.round(file.size / 1024))} KB`
    },

    async pick(file) {
      if (this.busyPath) return
      this.busyPath = file.path
      this.error = ''
      try {
        const text = await fetchBackup(file.path)
        // Consumed by ImportDialog on mount. replaceLayer rather than push, so this
        // dialog's history entry becomes the import dialog's and one Back returns to
        // Settings instead of reopening a file list the user has finished with.
        ui.pendingImportText = text
        replaceLayer({ dialog: 'import' })
      } catch (err) {
        this.error = err?.message || 'Could not download that backup'
        this.busyPath = ''
      }
    },
  },
}
</script>

<template>
  <DialogShell title="Restore from Dropbox" wide @close="$emit('close')">
    <p v-if="loading" class="body">Looking for backups…</p>

    <!-- The listing failed, so the only honest thing to show is why. -->
    <p v-else-if="!listed" class="body">Could not read your Dropbox folder.</p>

    <template v-else-if="files.length === 0">
      <p class="body">
        There are no backups in Dropbox yet. One is made automatically after you change a
        list.
      </p>
    </template>

    <template v-else>
      <p class="body">
        Choose a backup to load. Nothing changes until you pick what to bring in on the next
        step.
      </p>

      <div class="picker">
        <button
          v-for="file in files"
          :key="file.path"
          class="file tap"
          type="button"
          :disabled="busyPath !== ''"
          @click="pick(file)"
        >
          <span class="texts">
            <span class="name">{{ file.name }}</span>
            <span class="meta">{{ when(file) }} · {{ size(file) }}</span>
          </span>
          <span class="chev">{{ busyPath === file.path ? '…' : '›' }}</span>
        </button>
      </div>
    </template>

    <p v-if="error" class="error">{{ error }}</p>

    <template #actions>
      <span class="spacer" />
      <button class="link tap" type="button" @click="$emit('close')">Cancel</button>
    </template>
  </DialogShell>
</template>

<style scoped>
.picker {
  max-height: 46vh;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.file {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 46px;
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--line2);
  cursor: pointer;
}

.file:last-child {
  border-bottom: 0;
}

.file:disabled {
  opacity: 0.5;
}

.file:focus-visible {
  outline-offset: -2px;
}

:where(html[data-input='mouse']) .file:not(:disabled):hover {
  background: var(--chip);
}

.texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.name {
  font: 400 13.5px/1.3 var(--font);
  color: var(--text);
  overflow-wrap: anywhere;
}

.meta {
  font: 400 10.5px var(--mono);
  color: var(--text3);
}

.chev {
  flex: 0 0 auto;
  font: 300 20px/1 var(--font);
  color: var(--text3);
}

.error {
  margin: 10px 0 0;
  font: 500 12px/1.4 var(--font);
  color: var(--danger);
}
</style>
