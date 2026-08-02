<script>
/**
 * One row in either column.
 *
 * GRIP PLACEMENT IS A DELIBERATE DEVIATION FROM THE HANDOFF. The handoff puts grips on
 * the left of both columns; here the LEFT column's grip is on its RIGHT edge, so both
 * grip columns sit against the centre gutter. The dominant gesture is catalog → my list,
 * and mirroring turns that from a cross-screen sweep into a short inward move — which
 * matters most in one-handed portrait, where a thumb reaches the centre far more easily
 * than the opposite edge. Do not "fix" this back to match the handoff's screenshots.
 *
 * `touch-action` comes from static classes in tokens.css (`grip` = none, `row-text` =
 * pan-y) and is never set from JavaScript, so an interrupted drag cannot strand a value
 * that kills scrolling.
 */
export default {
  name: 'ItemRow',
  props: {
    side: { type: String, required: true },
    name: { type: String, required: true },
    qty: { type: Number, default: 1 },
    /** Catalog item already on the list: dimmed, but still draggable to set a quantity. */
    faded: { type: Boolean, default: false },
    /** Owning list name, for rows borrowed from another list's catalog. */
    source: { type: String, default: '' },
    showGrip: { type: Boolean, default: true },
    selecting: { type: Boolean, default: false },
    selected: { type: Boolean, default: false },
    dragging: { type: Boolean, default: false },
  },
  emits: ['grip-down', 'row-down', 'qty-tap', 'toggle'],
  computed: {
    isLeft() {
      return this.side === 'left'
    },
  },
}
</script>

<template>
  <div class="row" :class="{ faded, dragging }" @pointerdown="$emit('row-down', $event)">
    <!-- Right column: checkbox in selection mode, otherwise the grip, both 44px. -->
    <template v-if="!isLeft">
      <button
        v-if="selecting"
        class="cell check tap"
        type="button"
        :aria-pressed="selected"
        @click.stop="$emit('toggle')"
      >
        <span class="box" :class="{ on: selected }">
          <svg v-if="selected" class="tick" viewBox="0 0 17 17" aria-hidden="true">
            <path d="M4.2 8.9 L7 11.7 L12.8 5.3" />
          </svg>
        </span>
      </button>
      <span
        v-else-if="showGrip"
        class="cell grip tap"
        @pointerdown.stop="$emit('grip-down', $event)"
      >
        <i /><i /><i />
      </span>
    </template>

    <span class="text row-text">{{ name }}</span>

    <span v-if="!isLeft && source" class="source">{{ source }}</span>

    <!-- Left column: quantity then grip, so the grip lands against the centre gutter. -->
    <template v-if="isLeft">
      <button v-if="qty > 1" class="qty tap" type="button" @click.stop="$emit('qty-tap')">
        ×{{ qty }}
      </button>
      <span v-if="showGrip" class="cell grip tap" @pointerdown.stop="$emit('grip-down', $event)">
        <i /><i /><i />
      </span>
    </template>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  /* A floor, not a fixed height: long names wrap and the row grows. */
  min-height: var(--row-height);
  border-bottom: 1px solid var(--line2);
}

.row.faded .text {
  color: var(--fade);
}

.row.faded .grip i {
  background: var(--grip2);
}

.row.dragging {
  opacity: 0.32;
}

/*
 * Hover only, no press state: a press on a row body is usually the start of a scroll, and
 * flashing the row every time the user swipes the column would be noise. The grip and the
 * quantity chip are the two things a press here is unambiguously aimed at, and they carry
 * `.tap` themselves.
 */
:where(html[data-input='mouse']) .row:hover {
  box-shadow: inset 0 0 0 999px var(--hover);
}

:where(html[data-input='mouse']) .row:hover .grip i {
  background: var(--text3);
}

.text {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  font: 400 14.5px/1.32 var(--font);
  color: var(--text);
  overflow-wrap: anywhere;
}

.cell {
  flex: 0 0 44px;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2.5px;
}

/* No background fill and no divider — the bars alone read as the affordance. */
.grip i {
  display: block;
  width: 12px;
  height: 1.5px;
  background: var(--grip);
  border-radius: 1px;
}

.qty {
  flex: 0 0 auto;
  margin-right: 2px;
  padding: 1px 5px;
  font: 600 11px var(--mono);
  color: var(--accent);
  background: var(--accent-bg);
  border-radius: 4px;
  cursor: pointer;
}

.source {
  flex: 0 0 auto;
  padding-right: 8px;
  font: 400 9.5px var(--mono);
  color: var(--text3);
  text-align: right;
}

.check {
  cursor: pointer;
}

/* Both live inside a row with its own hover wash, so their rings sit inside the row. */
.check:focus-visible,
.qty:focus-visible {
  outline-offset: -2px;
}

.box {
  display: block;
  width: 20px;
  height: 20px;
  border: 1.5px solid var(--text3);
  border-radius: 4px;
  box-sizing: border-box;
}

.box.on {
  background: var(--accent);
  border-color: var(--accent);
  /* The tick strokes currentColor; white is what reads on accent, as on the accent bar. */
  color: #fff;
}

/*
 * The tick fills the box's content area, and its viewBox is that area's size in px — so the
 * path coordinates are just pixels, and the whole thing rescales if the box ever does.
 */
.tick {
  display: block;
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
