<script>
/**
 * The shell every modal is drawn in: scrim, card, title, and the actions row.
 *
 * IT IS CENTRED IN THE *VISUAL* VIEWPORT, NOT THE LAYOUT ONE. The on-screen keyboard
 * shrinks the visual viewport and leaves the layout viewport alone, so a scrim pinned to
 * `inset: 0` keeps centring the card behind the keyboard — precisely when a dialog with a
 * text field is on screen. `ui/viewport.js` publishes the usable area as --vv-height /
 * --vv-top and the scrim sizes itself from those, with the full layout viewport as the
 * fallback for a browser that has no `visualViewport`.
 *
 * Escape lives here and NOWHERE ELSE. Two handlers for one key means two `close` emits,
 * and because closing is a router `back()`, that would walk two entries out of history.
 */
export default {
  name: 'DialogShell',
  props: {
    title: { type: String, required: true },
    /** Roomier card for the transfer dialogs, which carry a list of choices. */
    wide: { type: Boolean, default: false },
  },
  emits: ['close'],
  mounted() {
    document.addEventListener('keydown', this.onKey)
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.onKey)
  },
  methods: {
    onKey(e) {
      if (e.key === 'Escape') this.$emit('close')
    },
  },
}
</script>

<template>
  <div class="scrim slp-fade" @click.self="$emit('close')">
    <div class="card slp-pop" :class="{ wide }" role="dialog" aria-modal="true">
      <h2>{{ title }}</h2>
      <slot />
      <div class="actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  left: 0;
  right: 0;
  top: var(--vv-top, 0px);
  height: var(--vv-height, 100%);
  /* The height is the usable area, so the padding has to come out of it, not add to it. */
  box-sizing: border-box;
  z-index: 70;
  display: flex;
  padding: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--scrim);
}

/*
 * `margin: auto` rather than align-items/justify-content on the scrim. Both centre the
 * card, but auto margins go to zero once the free space does, so a card taller than the
 * usable area lands at the top with the scrim's padding intact and scrolls. Centring via
 * the flex properties would instead push its head above the scroll origin, out of reach.
 */
.card {
  margin: auto;
  width: min(320px, 100%);
  padding: 18px 18px 14px;
  background: var(--surface);
  border-radius: 12px;
  box-shadow: var(--shadow);
}

.card.wide {
  width: min(440px, 100%);
}

h2 {
  margin: 0 0 10px;
  font: 600 15px/1.3 var(--font);
  color: var(--text);
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 14px;
}

/*
 * Slot content carries the PARENT's scope id, so these rules have to opt in with
 * :slotted(). Only the shared chrome lives here — the buttons, the text controls and the
 * explanatory paragraph, which every dialog draws identically. Anything that is one
 * dialog's own layout stays in that dialog.
 */
:slotted(.spacer) {
  flex: 1;
}

:slotted(.link) {
  padding: 10px 10px;
  font: 500 13px var(--font);
  color: var(--text2);
  border-radius: 7px;
  cursor: pointer;
}

:slotted(.primary) {
  padding: 10px 14px;
  font: 600 13.5px var(--font);
  color: var(--accent);
  border-radius: 7px;
  cursor: pointer;
}

:slotted(.primary.danger) {
  color: var(--danger);
}

:slotted(.link:disabled),
:slotted(.primary:disabled) {
  opacity: 0.4;
  cursor: default;
}

:slotted(.body) {
  margin: 0 0 12px;
  font: 400 12.5px/1.45 var(--font);
  color: var(--text2);
}

:slotted(.field) {
  width: 100%;
  height: 46px;
  padding: 0 12px;
  font: 400 15px var(--font);
  color: var(--text);
  border: 1.5px solid var(--accent);
  border-radius: 8px;
  box-sizing: border-box;
}

:slotted(.paste) {
  display: block;
  width: 100%;
  height: 132px;
  padding: 8px;
  font: 400 11.5px/1.4 var(--mono);
  color: var(--text);
  border: 1.5px solid var(--accent);
  border-radius: 8px;
  box-sizing: border-box;
  resize: none;
}
</style>
