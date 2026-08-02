<script>
import ListTile from './ListTile.vue'
import { state } from '../core/store'
import { filterLists, listsByRecency } from '../core/selectors'
import { ui } from '../ui/state'

export default {
  name: 'HomeScreen',
  components: { ListTile },
  emits: ['open', 'new-list'],
  data() {
    // Relative times are recomputed on a timer rather than per render, so "Just now"
    // becomes "2m ago" without the tile grid depending on Date.now() during rendering.
    return { ui, state, now: Date.now(), timer: null }
  },
  computed: {
    tiles() {
      return listsByRecency(filterLists(state.lists, ui.query))
    },
    emptyMessage() {
      if (state.lists.length === 0) return 'No lists yet — tap + to make one'
      return `No lists match “${ui.query.trim()}”`
    },
  },
  mounted() {
    this.timer = setInterval(() => {
      this.now = Date.now()
    }, 30000)
  },
  beforeUnmount() {
    clearInterval(this.timer)
  },
}
</script>

<template>
  <div class="home">
    <div v-if="tiles.length === 0" class="empty">{{ emptyMessage }}</div>
    <div v-else class="grid">
      <ListTile
        v-for="list in tiles"
        :key="list.id"
        :list="list"
        :now="now"
        @click="$emit('open', list.id)"
      />
    </div>

    <button class="fab" type="button" aria-label="New list" @click="$emit('new-list')">+</button>
  </div>
</template>

<style scoped>
.home {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: auto;
  overscroll-behavior: contain;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  gap: 10px;
  padding: 12px;
  align-content: start;
}

.empty {
  padding: 40px 24px;
  text-align: center;
  font: 400 13.5px/1.4 var(--font);
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
</style>
