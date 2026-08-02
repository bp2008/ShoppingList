<script>
import { listPreview } from '../core/selectors'
import { previewLine, relativeTime, spineColor } from '../core/format'
import { isDark } from '../ui/theme'

/**
 * A home-screen tile.
 *
 * Two details from the handoff that read as bugs if you don't know them:
 *  - The badge counts the list's CATALOG, not the items on the list.
 *  - "Empty list" shows whenever the left list is empty, even when the catalog has items.
 */
export default {
  name: 'ListTile',
  props: {
    list: { type: Object, required: true },
    now: { type: Number, required: true },
  },
  computed: {
    preview() {
      return listPreview(this.list).map((e) => previewLine(e.name, e.qty))
    },
    remaining() {
      return Math.max(0, this.list.items.length - this.preview.length)
    },
    meta() {
      const time = relativeTime(this.list.modified, this.now)
      return this.remaining > 0 ? `+${this.remaining} more · ${time}` : time
    },
    // Recency encoded as colour, fading to transparent at 180 days. No setting disables it.
    spine() {
      return spineColor(this.list.modified, isDark(), this.now)
    },
  },
}
</script>

<template>
  <button class="tile slp-fade" type="button">
    <span class="spine" :style="{ background: spine }" />
    <span class="body">
      <span class="head">
        <span class="name">{{ list.name }}</span>
        <span class="badge">{{ list.catalog.length }}</span>
      </span>

      <span v-if="preview.length === 0" class="empty">Empty list</span>
      <span v-for="(line, i) in preview" v-else :key="i" class="line">{{ line }}</span>

      <span class="meta">{{ meta }}</span>
    </span>
  </button>
</template>

<style scoped>
.tile {
  position: relative;
  display: flex;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
}

.spine {
  flex: 0 0 4px;
  align-self: stretch;
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 11px 11px;
}

.head {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.name {
  flex: 1;
  min-width: 0;
  font: 600 13.5px/1.25 var(--font);
  color: var(--text);
  overflow-wrap: anywhere;
}

.badge {
  flex: 0 0 auto;
  padding: 1px 5px;
  font: 600 9.5px var(--mono);
  color: var(--text2);
  background: var(--chip);
  border-radius: 4px;
}

.line,
.empty {
  margin-top: 3px;
  font: 400 11.5px/1.35 var(--font);
  color: var(--text2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  font-style: italic;
  color: var(--text3);
}

.meta {
  margin-top: 6px;
  font: 400 10.5px var(--font);
  color: var(--text3);
}
</style>
