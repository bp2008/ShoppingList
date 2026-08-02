<script>
import { ui } from '../ui/state'
import { closeLayer, openLayer } from '../ui/navigation'

/**
 * The top bar, in its three states: resting, search expanded, and catalog-delete mode.
 *
 * The search magnifier is an SVG; the hamburger is three divs. Both stroke `--text2`, so
 * both are theme-aware with no second asset and no flash on theme change -- see "Icons and
 * graphics" in DEVELOPING.md. The magnifier earned the SVG: as a positioned ring plus a
 * rotated bar its handle was 1.3px off the line through the ring's centre, which is not
 * something you fix with better offsets. As two shapes on y = x it is collinear by
 * construction.
 */
export default {
  name: 'TopBar',
  props: {
    title: { type: String, required: true },
    version: { type: String, default: '' },
    showBack: { type: Boolean, default: false },
    canDelete: { type: Boolean, default: false },
  },
  emits: ['back', 'menu', 'delete-selected'],
  data() {
    return { ui }
  },
  methods: {
    // The field does not exist until the navigation lands and the re-render flushes, so
    // the focus waits for the router rather than for the current tick.
    openSearch() {
      openLayer({ search: null }).then(() => this.$nextTick(() => this.$refs.input?.focus()))
    },
    // Closing goes through the router only; syncUi() clears the state. Doing both here is
    // what lets the two paths disagree.
    dismissSearch() {
      closeLayer()
    },
    leaveSelection() {
      closeLayer()
    },
  },
}
</script>

<template>
  <!-- Catalog-delete mode: the whole bar becomes accent with white content. -->
  <header v-if="ui.selecting" class="bar selecting">
    <button class="icon exit tap-inv" type="button" aria-label="Cancel" @click="leaveSelection">
      ×
    </button>
    <span class="count">{{ ui.selected.length }} selected</span>
    <button
      class="delete tap-inv"
      type="button"
      :disabled="!canDelete"
      @click="$emit('delete-selected')"
    >
      Delete
    </button>
  </header>

  <header v-else class="bar">
    <button
      v-if="showBack && !ui.searchOpen"
      class="icon back tap"
      type="button"
      aria-label="Back"
      @click="$emit('back')"
    >
      ‹
    </button>

    <!-- Search replaces the title in place; it is not a dropdown. -->
    <template v-if="ui.searchOpen">
      <input
        ref="input"
        v-model="ui.query"
        class="search-input"
        type="search"
        placeholder="Search"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
      <button
        class="icon clear tap"
        type="button"
        aria-label="Close search"
        @click="dismissSearch"
      >
        ×
      </button>
    </template>

    <template v-else>
      <div class="titles">
        <span class="title">{{ title }}</span>
        <span v-if="version" class="version">{{ version }}</span>
      </div>
      <button class="icon tap" type="button" aria-label="Search" @click="openSearch">
        <!-- Ring centred on 8.5,8.5 and a handle along y=x, so the two are collinear. -->
        <svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="6" />
          <path d="M13.1 13.1 L17.5 17.5" />
        </svg>
      </button>
    </template>

    <button class="icon tap" type="button" aria-label="Menu" @click="$emit('menu')">
      <span class="hamburger"><i /><i /><i /></span>
    </button>
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  height: 52px;
  padding: 0 2px 0 4px;
  background: var(--topbar);
  border-bottom: 1px solid var(--line);
}

/* Landscape phone is the primary target; the bar compresses rather than wrapping. */
@media (max-height: 420px) {
  .bar {
    height: 48px;
  }
}

.titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 8px;
}

/*
 * The line box has to clear the descenders. `overflow: hidden` is required for the
 * ellipsis, and it clips to the line box, not the glyphs -- at the 1.15 this started
 * with, the tails of p, g and y were sliced off.
 */
.title {
  font: 600 17px/1.45 var(--font);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version {
  font: 400 10.5px/1.3 var(--mono);
  color: var(--text3);
}

.icon {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  cursor: pointer;
}

/* Inset: the bar has 2px of padding, so an outset ring on the end button is clipped. */
.icon:focus-visible {
  outline-offset: -2px;
}

.back {
  width: 38px;
  font: 300 26px/1 var(--font);
  color: var(--text);
}

/* 16px minimum, or Android zooms the viewport on focus. */
.search-input {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 0 8px;
  font: 400 16px var(--font);
  color: var(--text);
  border-radius: 7px;
}

.search-input::-webkit-search-cancel-button {
  display: none;
}

.clear {
  width: 38px;
  font: 300 24px/1 var(--font);
  color: var(--text2);
}

/* 20 viewBox units drawn at 18px, so the 2-unit stroke lands at 1.8px. */
.search-icon {
  display: block;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: var(--text2);
  stroke-width: 2;
  stroke-linecap: round;
}

.hamburger {
  display: flex;
  flex-direction: column;
  gap: 3.5px;
}

.hamburger i {
  display: block;
  width: 16px;
  height: 2px;
  background: var(--text2);
  border-radius: 1px;
}

/* The icon strokes are the affordance, so they answer to hover as well as the wash. */
html[data-input='mouse'] .icon:hover .hamburger i {
  background: var(--text);
}

html[data-input='mouse'] .icon:hover .search-icon {
  stroke: var(--text);
}

/* --- catalog-delete mode ------------------------------------------------- */

.selecting {
  background: var(--accent);
  border-bottom-color: transparent;
  padding: 0 8px 0 4px;
}

.selecting .exit {
  width: 36px;
  font: 300 24px/1 var(--font);
  color: #fff;
}

.count {
  flex: 1;
  padding: 0 6px;
  font: 600 15px var(--font);
  color: #fff;
}

.delete {
  padding: 8px 13px;
  font: 600 13px var(--font);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 7px;
  cursor: pointer;
}

.delete:disabled {
  opacity: 0.5;
  cursor: default;
}

/* White content on an accent bar: the ring has to be white to be visible at all. */
.selecting :focus-visible {
  outline-color: #fff;
}
</style>
