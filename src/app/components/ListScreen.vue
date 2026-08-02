<script>
import { markRaw } from 'vue'
import ItemRow from './ItemRow.vue'
import * as store from '../core/store'
import { foreignCatalog, isOnList, matchesQuery, sortedCatalog } from '../core/selectors'
import { DragController } from '../core/dragController'
import { CHIP_GAP, chipCenterX, dropHint, gripsVisible } from '../core/dragMath'
import { ui } from '../ui/state'
import { pushLayer } from '../ui/history'

/**
 * The shopping list screen: two columns, side by side, at every width.
 *
 * There is one layout. No tabs, no stacking, no bottom sheet. Below ~340px the grip
 * columns are dropped and drag falls back to long-press, but the columns stay.
 */
export default {
  name: 'ListScreen',
  components: { ItemRow },
  props: {
    list: { type: Object, required: true },
  },
  emits: ['add-catalog'],
  data() {
    // `controller` is deliberately NOT declared here. Anything returned from data() is
    // wrapped in a reactive Proxy, and DragController uses private class fields (#host,
    // #abort), which are unreachable through a Proxy -- every method would throw
    // "Cannot read private member". It is assigned in mounted() as a plain instance
    // property, with markRaw as a second guard.
    return { ui, state: store.state }
  },
  computed: {
    grips() {
      return gripsVisible(ui.width, store.state.settings.showGrips)
    },
    query() {
      return ui.query.trim()
    },
    leftRows() {
      return this.list.items
        .map((it, index) => ({
          cid: it.cid,
          qty: it.qty,
          name: store.catalogName(this.list, it.cid),
          index,
        }))
        .filter((r) => matchesQuery(r.name, this.query))
    },
    ownCatalog() {
      return sortedCatalog(this.list)
        .filter((c) => matchesQuery(c.name, this.query))
        .map((c) => ({ cid: c.id, name: c.name, faded: isOnList(this.list, c.id), source: '' }))
    },
    foreignRows() {
      if (!this.list.showOthers) return []
      return foreignCatalog(this.list, store.state.lists)
        .filter((e) => matchesQuery(e.name, this.query))
        .map((e) => ({ cid: '', name: e.name, faded: false, source: e.source }))
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
      const chip = this.$refs.chip
      if (chip) {
        // Measured once per drag. Reading offsetWidth every pointermove would force a
        // synchronous reflow on every frame, which is exactly the per-move work the
        // handoff warns against; the chip's text does not change mid-drag.
        if (!this.chipHalf) this.chipHalf = chip.offsetWidth / 2
        const x = chipCenterX(s.x, this.chipHalf * 2, window.innerWidth)
        // translate(-50%, -100%) is applied after the positioning translate, so the chip
        // ends up centred horizontally on the pointer with its bottom edge above it.
        chip.style.transform = `translate3d(${x}px, ${s.y - CHIP_GAP}px, 0) translate(-50%, -100%)`
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
            ui.dialogArg = { cid, value: Math.min(99, (entry?.qty ?? 1) + 1) }
            ui.dialog = 'quantity'
            pushLayer()
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

    openQty(row) {
      ui.dialogArg = { cid: row.cid, value: row.qty }
      ui.dialog = 'quantity'
      pushLayer()
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
  <div class="screen">
    <div class="columns">
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
              side="left"
              :name="row.name"
              :qty="row.qty"
              :show-grip="grips"
              :dragging="!!dragging && dragging.origin === 'left' && dragging.cid === row.cid"
              @grip-down="onGrip($event, 'left', row)"
              @row-down="onRow($event, 'left', row)"
              @qty-tap="openQty(row)"
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
            side="right"
            :name="row.name"
            :faded="row.faded"
            :show-grip="grips"
            :selecting="ui.selecting"
            :selected="ui.selected.includes(row.cid)"
            :dragging="!!dragging && dragging.origin !== 'left' && dragging.cid === row.cid"
            @grip-down="onGrip($event, 'right', row)"
            @row-down="onRow($event, 'right', row)"
            @toggle="toggleSelect(row.cid)"
          />

          <template v-if="foreignRows.length">
            <div class="subhead">From other lists</div>
            <ItemRow
              v-for="row in foreignRows"
              :key="'f-' + row.name"
              class="foreign"
              side="right"
              :name="row.name"
              :source="row.source"
              :show-grip="grips"
              @grip-down="onGrip($event, 'right', row)"
              @row-down="onRow($event, 'right', row)"
            />
          </template>

          <div v-if="ownCatalog.length === 0 && foreignRows.length === 0" class="empty">
            {{ query ? 'No matches in the catalog' : 'Tap + to add your first catalog item' }}
          </div>
        </div>
      </section>
    </div>

    <button
      v-if="!ui.selecting"
      class="fab"
      type="button"
      aria-label="Add to catalog"
      @click="$emit('add-catalog')"
    >
      +
    </button>

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

.fab {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 52px;
  height: 52px;
  font: 300 30px/1 var(--font);
  color: #fff;
  background: var(--accent);
  border-radius: 26px;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);
  cursor: pointer;
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
}
</style>
