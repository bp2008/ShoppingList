<script>
/**
 * The floating add button, shared by both screens.
 *
 * The plus is two divs rather than a `+` glyph. A glyph is centred on the font's own
 * metrics -- the plus sits on the maths axis, above the middle of the em box -- so it
 * always renders slightly high in a circle no matter what line-height it is given. Bars
 * are centred on the pixels the user actually sees. An SVG would centre just as exactly and
 * is the better tool for anything more involved -- see "Icons and graphics" in
 * DEVELOPING.md -- but for two rectangles it would only be more markup.
 */
export default {
  name: 'Fab',
  props: {
    label: { type: String, required: true },
  },
  emits: ['click'],
}
</script>

<template>
  <button class="fab" type="button" :aria-label="label" @click="$emit('click')">
    <span class="plus"><i /><i /></span>
  </button>
</template>

<style scoped>
.fab {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  border-radius: 50%;
  box-shadow: 0 3px 12px rgba(37, 99, 235, 0.38);
  cursor: pointer;
}

.plus {
  position: relative;
  width: 18px;
  height: 18px;
}

.plus i {
  position: absolute;
  background: #fff;
  border-radius: 1px;
}

.plus i:first-child {
  top: 8px;
  left: 0;
  width: 18px;
  height: 2px;
}

.plus i:last-child {
  top: 0;
  left: 8px;
  width: 2px;
  height: 18px;
}

/*
 * Its own rules rather than the .tap-inv utility: the wash has to be listed alongside the
 * drop shadow, or setting one would drop the other.
 */
:where(html[data-input='mouse']) .fab:hover {
  box-shadow:
    0 4px 16px rgba(37, 99, 235, 0.5),
    inset 0 0 0 999px var(--hover-inv);
}

.fab:active {
  box-shadow:
    0 2px 7px rgba(37, 99, 235, 0.42),
    inset 0 0 0 999px var(--press-inv);
}
</style>
