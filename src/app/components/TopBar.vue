<script>
import { ui } from '../ui/state'
import { pushLayer, popLayer } from '../ui/history'

/**
 * The top bar, in its three states: resting, search expanded, and catalog-delete mode.
 *
 * Every icon is composed from divs rather than an SVG or icon font. That is a handoff
 * requirement and it pays for itself: the strokes read `--text2`, so they are theme-aware
 * with no second asset and no flash on theme change.
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
    openSearch() {
      ui.searchOpen = true
      pushLayer()
      this.$nextTick(() => this.$refs.input?.focus())
    },
    // Closing goes through history only; the popstate handler clears the state. Doing
    // both here is what lets the two paths disagree.
    dismissSearch() {
      popLayer()
    },
    leaveSelection() {
      popLayer()
    },
  },
}
</script>

<template>
  <!-- Catalog-delete mode: the whole bar becomes accent with white content. -->
  <header v-if="ui.selecting" class="bar selecting">
    <button class="icon exit" type="button" aria-label="Cancel" @click="leaveSelection">×</button>
    <span class="count">{{ ui.selected.length }} selected</span>
    <button class="delete" type="button" :disabled="!canDelete" @click="$emit('delete-selected')">
      Delete
    </button>
  </header>

  <header v-else class="bar">
    <button
      v-if="showBack && !ui.searchOpen"
      class="icon back"
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
      <button class="icon clear" type="button" aria-label="Close search" @click="dismissSearch">
        ×
      </button>
    </template>

    <template v-else>
      <div class="titles">
        <span class="title">{{ title }}</span>
        <span v-if="version" class="version">{{ version }}</span>
      </div>
      <button class="icon" type="button" aria-label="Search" @click="openSearch">
        <span class="search-icon"><i class="ring" /><i class="handle" /></span>
      </button>
    </template>

    <button class="icon" type="button" aria-label="Menu" @click="$emit('menu')">
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

.title {
  font: 600 17px/1.15 var(--font);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version {
  font: 400 10.5px var(--mono);
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
}

.search-input::-webkit-search-cancel-button {
  display: none;
}

.clear {
  width: 38px;
  font: 300 24px/1 var(--font);
  color: var(--text2);
}

.search-icon {
  position: relative;
  width: 18px;
  height: 18px;
}

.ring {
  position: absolute;
  top: 0;
  left: 0;
  width: 13px;
  height: 13px;
  border: 1.7px solid var(--text2);
  border-radius: 50%;
  box-sizing: border-box;
}

.handle {
  position: absolute;
  right: 0;
  bottom: 1px;
  width: 7px;
  height: 1.7px;
  background: var(--text2);
  transform: rotate(45deg);
  transform-origin: right center;
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
}
</style>
