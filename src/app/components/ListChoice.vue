<script>
/**
 * One selectable list in the export and import dialogs.
 *
 * The whole head is the hit target, not just the box — these rows are 44px of otherwise
 * dead space, and a 20px checkbox is a poor thing to aim a thumb at. The box itself
 * matches the one in ItemRow: hollow when off, accent-filled with a white SVG tick when on.
 *
 * The default slot carries anything that belongs to this row but only makes sense once it
 * is chosen, which today means the import dialog's merge/overwrite switch.
 */
export default {
  name: 'ListChoice',
  props: {
    name: { type: String, required: true },
    /** Right-aligned detail — item counts, or what the import will do to this list. */
    meta: { type: String, default: '' },
    checked: { type: Boolean, default: false },
  },
  emits: ['toggle'],
}
</script>

<template>
  <div class="choice">
    <button class="head tap" type="button" :aria-pressed="checked" @click="$emit('toggle')">
      <span class="box" :class="{ on: checked }" aria-hidden="true">
      <svg v-if="checked" class="tick" viewBox="0 0 17 17">
        <path d="M4.2 8.9 L7 11.7 L12.8 5.3" />
      </svg>
    </span>
      <span class="name">{{ name }}</span>
      <span v-if="meta" class="meta">{{ meta }}</span>
    </button>
    <slot />
  </div>
</template>

<style scoped>
.choice {
  border-bottom: 1px solid var(--line2);
}

.choice:last-child {
  border-bottom: 0;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 6px 10px;
  text-align: left;
  cursor: pointer;
}

.head:focus-visible {
  outline-offset: -2px;
}

.box {
  flex: 0 0 auto;
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
  color: #fff;
}

/* The same tick as ItemRow — see the note there. */
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

.name {
  flex: 1;
  min-width: 0;
  font: 400 14px/1.3 var(--font);
  color: var(--text);
  overflow-wrap: anywhere;
}

.meta {
  flex: 0 0 auto;
  font: 400 10.5px var(--mono);
  color: var(--text3);
}
</style>
