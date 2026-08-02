<script>
import { markRaw } from 'vue'
import Fab from './Fab.vue'
import ItemRow from './ItemRow.vue'
import * as store from '../core/store'
import { foreignCatalog, isOnList, matchesQuery, sortedCatalog } from '../core/selectors'
import { DragController } from '../core/dragController'
import { CHIP_GAP, chipCenterX, dropHint, gripsVisible } from '../core/dragMath'
import { ui } from '../ui/state'
import { closeLayer, openLayer } from '../ui/navigation'

/** Scroll-to-result travel time. Short enough to read as a jump you can follow. */
const REVEAL_MS = 160
/** Two pulses. Kept in step with the slp-flash keyframes below. */
const FLASH_MS = 900

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The shopping list screen: two columns, side by side, at every width.
 *
 * There is one layout. No tabs, no stacking, no bottom sheet. Below ~340px the grip
 * columns are dropped and drag falls back to long-press, but the columns stay.
 *
 * The list id comes from the route, and the list is looked up on every render rather than
 * passed in: undo and import replace the stored list objects wholesale, so anything
 * holding one from before would be showing a detached copy. A missing list renders
 * nothing for the instant it takes App to route back home.
 */
export default {
  name: 'ListScreen',
  components: { Fab, ItemRow },
  props: {
    id: { type: String, required: true },
  },
  data() {
    // `controller` is deliberately NOT declared here. Anything returned from data() is
    // wrapped in a reactive Proxy, and DragController uses private class fields (#host,
    // #abort), which are unreachable through a Proxy -- every method would throw
    // "Cannot read private member". It is assigned in mounted() as a plain instance
    // property, with markRaw as a second guard.
    return { ui, state: store.state, flashKey: '' }
  },
  computed: {
    list() {
      return store.getList(this.id) ?? null
    },
    grips() {
      return gripsVisible(ui.width, store.state.settings.showGrips)
    },
    query() {
      return ui.query.trim()
    },
    /*
     * `rowKey` identifies a row across the re-render that closing search causes, so
     * reveal() can find the same row again once the filter is gone. It cannot be the cid
     * alone: the same catalog item appears in both columns, and foreign rows have no
     * local cid at all.
     */
    leftRows() {
      if (!this.list) return []
      return this.list.items
        .map((it, index) => ({
          cid: it.cid,
          qty: it.qty,
          name: store.catalogName(this.list, it.cid),
          index,
          rowKey: `left:${it.cid}`,
        }))
        .filter((r) => matchesQuery(r.name, this.query))
    },
    ownCatalog() {
      if (!this.list) return []
      return sortedCatalog(this.list)
        .filter((c) => matchesQuery(c.name, this.query))
        .map((c) => ({
          cid: c.id,
          name: c.name,
          faded: isOnList(this.list, c.id),
          source: '',
          rowKey: `right:${c.id}`,
        }))
    },
    foreignRows() {
      if (!this.list || !this.list.showOthers) return []
      return foreignCatalog(this.list, store.state.lists)
        .filter((e) => matchesQuery(e.name, this.query))
        .map((e) => ({
          cid: '',
          name: e.name,
          faded: false,
          source: e.source,
          rowKey: `foreign:${e.name}`,
        }))
    },
    dragging() {
      return ui.drag
    },
    leftHeader() {
      const hint = this.dragging ? dropHint(this.dragging.origin, this.dragging.target) : ''
      return hint && this.dragging.target === 'left' ? hint : 'My list'
    },
    rightHeader() {
      const hint = this.dragging ? dropHint(this.dragging.origin, this.dragging.target) : ''
      return hint && this.dragging.target === 'right' ? hint : 'This list’s catalog'
    },
    insertionAt() {
      const d = this.dragging
      return d && d.target === 'left' ? d.index : -1
    },
  },
  mounted() {
    // Non-reactive on purpose: cached chip geometry must not trigger re-renders.
    this.chipHalf = 0
    // The row a search result asked for, held until the search layer is actually gone.
    this.pending = null
    this.revealFrame = 0
    this.flashTimer = null

    /*
     * The reveal cannot run at click time: the row is still inside the filtered view, and
     * the position it needs is the one it will have once every row is back. Closing the
     * layer is a router navigation, so the wait is for syncUi() to land, not for a tick.
     */
    this.$watch(
      () => ui.searchOpen,
      (open) => {
        if (open) this.pending = null
        else if (this.pending) this.$nextTick(() => this.reveal())
      },
    )

    this.controller = markRaw(
      new DragController({
      columns: () => [
        { side: 'left', rect: this.rectOf('left'), scroller: this.$refs.leftScroll },
        { side: 'right', rect: this.rectOf('right'), scroller: this.$refs.rightScroll },
      ],
      leftRowSpans: () =>
        Array.from(this.$refs.leftScroll?.querySelectorAll('[data-row]') ?? []).map((el) => {
          const r = el.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom }
        }),
      alreadyOnList: (source) => this.resolveCid(source) !== null,
      commit: (action, source) => this.applyDrop(action, source),
      update: (s) => this.renderDrag(s),
        // Reordering a filtered view is ambiguous, so drag is inert while searching.
        locked: () => this.query !== '',
      }),
    )
  },
  beforeUnmount() {
    this.controller?.destroy()
    cancelAnimationFrame(this.revealFrame)
    clearTimeout(this.flashTimer)
  },
  methods: {
    rectOf(side) {
      const el = side === 'left' ? this.$refs.leftCol : this.$refs.rightCol
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    },

    /** Foreign rows carry no local cid; resolve by name against this list's catalog. */
    resolveCid(source) {
      if (source.cid) return isOnList(this.list, source.cid) ? source.cid : null
      const match = this.list.catalog.find(
        (c) => c.name.trim().toLowerCase() === source.name.trim().toLowerCase(),
      )
      return match && isOnList(this.list, match.id) ? match.id : null
    },

    /**
     * The chip is moved by writing transform straight to the node, not by re-rendering.
     * Only the fields that change rarely -- hovered column and insertion index -- go
     * through reactivity, so a drag does not re-render the row tree on every pointermove.
     */
    renderDrag(s) {
      if (!s) {
        ui.drag = null
        this.chipHalf = 0
        return
      }

      const d = ui.drag
      if (!d || d.target !== s.target || d.index !== s.index || d.name !== s.source.name) {
        ui.drag = {
          name: s.source.name,
          origin: s.source.origin,
          cid: s.source.cid,
          fromIndex: s.source.fromIndex,
          target: s.target,
          index: s.index,
          x: s.x,
          y: s.y,
        }
      }

      // The FIRST call is what creates the chip, so there is no node to write to yet.
      // Placing it on the next tick instead of skipping the frame is what keeps the chip
      // from appearing in the top-left corner and snapping into place on the first move.
      // `s` is the controller's live state object, so the deferred read is never stale.
      if (this.$refs.chip) this.placeChip(s)
      else this.$nextTick(() => this.placeChip(s))
    },

    placeChip(s) {
      const chip = this.$refs.chip
      if (!chip) return
      // Measured once per drag. Reading offsetWidth every pointermove would force a
      // synchronous reflow on every frame, which is exactly the per-move work the handoff
      // warns against; the chip's text does not change mid-drag.
      if (!this.chipHalf) this.chipHalf = chip.offsetWidth / 2
      const x = chipCenterX(s.x, this.chipHalf * 2, window.innerWidth)
      // translate(-50%, -100%) is applied after the positioning translate, so the chip
      // ends up centred horizontally on the pointer with its bottom edge above it.
      chip.style.transform = `translate3d(${x}px, ${s.y - CHIP_GAP}px, 0) translate(-50%, -100%)`
      // It renders hidden (see .chip) so that no frame can ever paint it unplaced.
      chip.style.visibility = 'visible'
    },

    applyDrop(action, source) {
      const id = this.list.id
      switch (action.kind) {
        case 'add':
          store.addToList(id, source.cid, action.index)
          break
        case 'adopt':
          store.adoptForeignItem(id, source.name, action.index)
          break
        case 'increment': {
          const cid = this.resolveCid(source)
          if (!cid) break
          if (store.state.settings.askQty) {
            const entry = this.list.items.find((it) => it.cid === cid)
            this.askQty(cid, Math.min(99, (entry?.qty ?? 1) + 1))
          } else {
            store.incrementQty(id, cid)
          }
          break
        }
        case 'remove':
          store.removeFromList(id, source.cid)
          break
        case 'move':
          store.moveItem(id, source.fromIndex, action.index)
          break
        default:
          break
      }
    },

    sourceFor(side, row) {
      return {
        origin: side === 'left' ? 'left' : row.source ? 'foreign' : 'right',
        cid: row.cid,
        name: row.name,
        fromIndex: side === 'left' ? row.index : -1,
      }
    },

    onGrip(event, side, row) {
      this.controller?.startFromGrip(event, this.sourceFor(side, row))
    },

    onRow(event, side, row) {
      // Long press is the fallback whenever grips are unavailable. With grips showing,
      // the row body is reserved for vertical scrolling.
      if (this.grips || ui.selecting) return
      this.controller?.startFromLongPress(event, this.sourceFor(side, row))
    },

    /**
     * A search result is a pointer to a row, not a destination of its own.
     *
     * Filtering both columns told the user the item exists but not where it lives, which
     * is the half of the answer that matters once search closes. Tapping a result now
     * dismisses search and takes them to the row in place, so the surrounding items --
     * the whole reason to look at a list -- come back with it.
     *
     * Only while a query is active. That is also exactly when the controller is locked,
     * so a click here can never be the tail of a drag.
     */
    onRowClick(side, row) {
      if (!this.query || ui.selecting) return
      this.pending = { side, rowKey: row.rowKey }
      closeLayer()
    },

    reveal() {
      const target = this.pending
      this.pending = null
      if (!target) return

      const scroller = target.side === 'left' ? this.$refs.leftScroll : this.$refs.rightScroll
      const row = scroller && this.findRow(scroller, target.rowKey)
      if (!row) return

      this.scrollRowIntoView(scroller, row)
      this.flash(target.rowKey)
    },

    findRow(scroller, rowKey) {
      // Compared as data rather than built into a selector: names go into these keys, and
      // escaping arbitrary text for an attribute selector is a bug waiting to happen.
      return Array.from(scroller.querySelectorAll('[data-row-key]')).find(
        (el) => el.dataset.rowKey === rowKey,
      )
    },

    /**
     * Centre the row in its own column.
     *
     * Hand-rolled rather than scrollIntoView({ behavior: 'smooth' }) because the browser
     * picks that duration and it is roughly three times longer than this wants to be.
     */
    scrollRowIntoView(scroller, row) {
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      const centred = delta - (scroller.clientHeight - row.offsetHeight) / 2
      const to = Math.min(max, Math.max(0, scroller.scrollTop + centred))
      const from = scroller.scrollTop

      cancelAnimationFrame(this.revealFrame)
      if (from === to) return
      if (reducedMotion()) {
        scroller.scrollTop = to
        return
      }

      const start = performance.now()
      const step = (now) => {
        const t = Math.min(1, (now - start) / REVEAL_MS)
        scroller.scrollTop = from + (to - from) * (1 - (1 - t) ** 3)
        this.revealFrame = t < 1 ? requestAnimationFrame(step) : 0
      }
      this.revealFrame = requestAnimationFrame(step)
    },

    /**
     * Pulse the row twice.
     *
     * The class is dropped and re-applied across a tick because CSS will not replay an
     * animation for a class that never left -- without it, revealing the same row a
     * second time would flash nothing.
     */
    flash(rowKey) {
      clearTimeout(this.flashTimer)
      this.flashKey = ''
      this.$nextTick(() => {
        this.flashKey = rowKey
        this.flashTimer = setTimeout(() => {
          this.flashKey = ''
          this.flashTimer = null
        }, FLASH_MS)
      })
    },

    /** The dialog's subject travels in the URL, so a reload reopens the same one. */
    askQty(cid, value) {
      openLayer({ dialog: 'quantity', cid, qty: value })
    },

    addCatalog() {
      openLayer({ dialog: 'add-catalog' })
    },

    toggleSelect(cid) {
      const i = ui.selected.indexOf(cid)
      if (i === -1) ui.selected.push(cid)
      else ui.selected.splice(i, 1)
    },
  },
}
</script>

<template>
  <div v-if="list" class="screen">
    <!-- `searching` is what makes rows read as clickable; see onRowClick(). -->
    <div class="columns" :class="{ searching: !!query && !ui.selecting }">
      <!-- Left: the user's list. Its order is the stored order. -->
      <section
        ref="leftCol"
        class="column"
        :class="{ hot: dragging && dragging.target === 'left' }"
      >
        <div ref="leftScroll" class="scroll">
          <!-- Headers are inside the scroller so they scroll away with the content. -->
          <div class="head" :class="{ hot: dragging && dragging.target === 'left' }">
            <span>{{ leftHeader }}</span>
            <span class="tally">{{ list.items.length }}</span>
          </div>

          <template v-for="(row, i) in leftRows" :key="row.cid">
            <div v-if="insertionAt === i" class="insertion" />
            <ItemRow
              data-row
              :data-row-key="row.rowKey"
              side="left"
              :class="{ flash: flashKey === row.rowKey }"
              :name="row.name"
              :qty="row.qty"
              :show-grip="grips"
              :dragging="!!dragging && dragging.origin === 'left' && dragging.cid === row.cid"
              @grip-down="onGrip($event, 'left', row)"
              @row-down="onRow($event, 'left', row)"
              @click="onRowClick('left', row)"
              @qty-tap="askQty(row.cid, row.qty)"
            />
          </template>
          <div v-if="insertionAt >= leftRows.length" class="insertion" />

          <div v-if="leftRows.length === 0" class="empty">
            {{ query ? 'No matches in this list' : 'Drag items across from the catalog' }}
          </div>
        </div>
      </section>

      <!-- Right: the catalog. Its order is derived, never stored. -->
      <section
        ref="rightCol"
        class="column"
        :class="{ hot: dragging && dragging.target === 'right' }"
      >
        <div ref="rightScroll" class="scroll">
          <div class="head" :class="{ hot: dragging && dragging.target === 'right' }">
            <span>{{ rightHeader }}</span>
            <span class="tally">A–Z</span>
          </div>

          <ItemRow
            v-for="row in ownCatalog"
            :key="row.cid"
            :data-row-key="row.rowKey"
            side="right"
            :class="{ flash: flashKey === row.rowKey }"
            :name="row.name"
            :faded="row.faded"
            :show-grip="grips"
            :selecting="ui.selecting"
            :selected="ui.selected.includes(row.cid)"
            :dragging="!!dragging && dragging.origin !== 'left' && dragging.cid === row.cid"
            @grip-down="onGrip($event, 'right', row)"
            @row-down="onRow($event, 'right', row)"
            @click="onRowClick('right', row)"
            @toggle="toggleSelect(row.cid)"
          />

          <template v-if="foreignRows.length">
            <div class="subhead">From other lists</div>
            <ItemRow
              v-for="row in foreignRows"
              :key="'f-' + row.name"
              :data-row-key="row.rowKey"
              class="foreign"
              side="right"
              :class="{ flash: flashKey === row.rowKey }"
              :name="row.name"
              :source="row.source"
              :show-grip="grips"
              @grip-down="onGrip($event, 'right', row)"
              @row-down="onRow($event, 'right', row)"
              @click="onRowClick('right', row)"
            />
          </template>

          <div v-if="ownCatalog.length === 0 && foreignRows.length === 0" class="empty">
            {{ query ? 'No matches in the catalog' : 'Tap + to add your first catalog item' }}
          </div>
        </div>
      </section>
    </div>

    <Fab v-if="!ui.selecting" label="Add to catalog" @click="addCatalog" />

    <!-- Never interactive. Centred above the finger so it covers neither column. -->
    <div v-if="dragging" ref="chip" class="chip">{{ dragging.name }}</div>
  </div>
</template>

<style scoped>
.screen {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
}

.columns {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 8px;
  padding: 8px;
}

/* Always two columns. Reduce padding before ever reducing the column count. */
@media (max-width: 340px) {
  .columns {
    gap: 6px;
    padding: 4px;
  }
}

.column {
  flex: 1;
  min-width: 0;
  display: flex;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 9px;
  overflow: hidden;
}

.column.hot {
  background: var(--accent-bg);
  border: 1.5px solid var(--accent);
}

.scroll {
  flex: 1;
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding: 9px 10px 7px;
  font: 600 10px var(--font);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text3);
}

.head.hot {
  color: var(--accent);
}

.tally {
  font-family: var(--mono);
  letter-spacing: 0;
}

.subhead {
  padding: 7px 10px 5px;
  background: var(--surface2);
  font: 600 9.5px var(--font);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text3);
}

.foreign {
  background: var(--surface2);
}

/* Scoped styles reach a child component's root element, and ItemRow's root is the row. */
.searching .row {
  cursor: pointer;
}

/*
 * The landing marker: two pulses, ending exactly where the row started. Declared after
 * .foreign so the reduced-motion fallback outranks it.
 */
.flash {
  animation: slp-flash 900ms ease-in-out;
}

@keyframes slp-flash {
  0%,
  50%,
  100% {
    background: transparent;
  }
  25%,
  75% {
    background: var(--accent-bg);
  }
}

/* Still marks the row, with no motion. flash() clears it on the same 900ms timer. */
@media (prefers-reduced-motion: reduce) {
  .flash {
    animation: none;
    background: var(--accent-bg);
  }
}

.insertion {
  height: 5px;
  margin: 4px 10px;
  background: var(--accent);
  border-radius: 3px;
}

.empty {
  padding: 22px 14px;
  text-align: center;
  font: 400 12px/1.4 var(--font);
  color: var(--text3);
}

.chip {
  position: fixed;
  top: 0;
  left: 0;
  min-width: 96px;
  max-width: 230px;
  padding: 8px 11px;
  font: 500 13px var(--font);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  pointer-events: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  z-index: 40;
  /* placeChip() reveals it. Hidden rather than transparent so it can still be measured. */
  visibility: hidden;
}
</style>
