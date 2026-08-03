<script>
import { catalogHits, listPreview } from '../core/selectors'
import { highlightRuns, previewLine, relativeTime, spineColor } from '../core/format'
import { isDark } from '../ui/theme'

/**
 * A home-screen tile.
 *
 * Two details from the handoff that read as bugs if you don't know them:
 *  - The badge counts the list's CATALOG, not the items on the list.
 *  - "Empty list" shows whenever the left list is empty, even when the catalog has items.
 *
 * WHILE A SEARCH IS RUNNING, A TILE HAS TO SAY WHY IT SURVIVED. Filtering alone is nearly
 * silent -- tiles vanish, the rest look untouched, and a match on a catalog item the list
 * is not currently holding leaves nothing on screen to point at. So the matched text is
 * marked wherever it already appears, and when it appears nowhere the catalog names that
 * matched are added as a line of their own.
 */
export default {
  name: 'ListTile',
  props: {
    list: { type: Object, required: true },
    now: { type: Number, required: true },
    /** The active home search, or '' when there is none. */
    query: { type: String, default: '' },
  },
  computed: {
    q() {
      return this.query.trim()
    },
    entries() {
      return listPreview(this.list)
    },
    preview() {
      return this.entries.map((e) => previewLine(e.name, e.qty))
    },
    nameRuns() {
      return highlightRuns(this.list.name, this.q)
    },
    previewRuns() {
      return this.preview.map((line) => highlightRuns(line, this.q))
    },
    /**
     * Matching catalog names the preview does not already show, as one line.
     *
     * Compared against the entry names rather than the rendered lines, which carry a `×N`
     * the catalog name does not have.
     */
    unshownHits() {
      if (!this.q) return ''
      const shown = new Set(this.entries.map((e) => e.name.trim().toLowerCase()))
      const missing = catalogHits(this.list, this.q).filter(
        (name) => !shown.has(name.trim().toLowerCase()),
      )
      return missing.join(', ')
    },
    unshownRuns() {
      return highlightRuns(this.unshownHits, this.q)
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
  <!-- `match` is the tile's half of the answer; the marks inside are the other half. -->
  <button class="tile tap slp-fade" :class="{ match: !!q }" type="button">
    <span class="spine" :style="{ background: spine }" />
    <span class="body">
      <span class="head">
        <span class="name">
          <template v-for="(run, i) in nameRuns" :key="i"
            ><mark v-if="run.hit">{{ run.text }}</mark
            ><template v-else>{{ run.text }}</template></template
          >
        </span>
        <span class="badge">{{ list.catalog.length }}</span>
      </span>

      <span v-if="preview.length === 0" class="empty">Empty list</span>
      <span v-for="(runs, i) in previewRuns" v-else :key="i" class="line">
        <template v-for="(run, j) in runs" :key="j"
          ><mark v-if="run.hit">{{ run.text }}</mark
          ><template v-else>{{ run.text }}</template></template
        >
      </span>

      <!-- The tile matched on the catalog, and nothing above shows it. -->
      <span v-if="unshownHits" class="line catalog">
        <span class="where">catalog:</span>
        <template v-for="(run, i) in unshownRuns" :key="i"
          ><mark v-if="run.hit">{{ run.text }}</mark
          ><template v-else>{{ run.text }}</template></template
        >
      </span>

      <span class="meta">{{ meta }}</span>
    </span>
  </button>
</template>

<style scoped>
.tile {
  position: relative;
  display: flex;
  text-align: left;
  /* The reset in tokens.css clears the button border but not its UA padding (1px 6px),
     which is what held the spine off the tile's edge. The body carries the padding. */
  padding: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
}

/* The border is the tile's edge, so hover moves it rather than adding a second one. */
:where(html[data-input='mouse']) .tile:hover {
  border-color: var(--accent);
}

/*
 * A search result. The border is the whole effect at tile level -- the tint belongs on the
 * matched words, not on the card, or a grid of results is one undifferentiated wash.
 */
.tile.match {
  border-color: var(--accent);
}

mark {
  color: var(--accent);
  background: var(--accent-bg);
  border-radius: 3px;
  /* The UA default is yellow-on-black; both halves have to go, and the box has to stay
     tight enough not to push the line box around. */
  padding: 0 1px;
}

/* Inset, because the grid clips at its padding and an outset ring would be cut off. */
.tile:focus-visible {
  outline-offset: -2px;
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

/*
 * Reads as an aside, so it cannot be mistaken for something on the list. The margin is the
 * gap after the colon: Vue's template compiler condenses the whitespace between two
 * elements away, so a literal space there would not survive.
 */
.where {
  margin-right: 4px;
  color: var(--text3);
}

.meta {
  margin-top: 6px;
  font: 400 10.5px var(--font);
  color: var(--text3);
}
</style>
