<script>
import Fab from './Fab.vue'
import ListTile from './ListTile.vue'
import { state } from '../core/store'
import { filterLists, listsByRecency } from '../core/selectors'
import { criticalSection } from '../core/bootBridge'
import { ui } from '../ui/state'
import { openLayer, openList } from '../ui/navigation'

export default {
  name: 'HomeScreen',
  components: { Fab, ListTile },
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
  methods: {
    // Opening a list is on the short list of paths whose failure leaves the app unusable,
    // so it escalates to the rescue screen rather than failing silently.
    open(id) {
      criticalSection('open-list', () => openList(id))
    },
    newList() {
      openLayer({ dialog: 'new-list' })
    },
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
        :query="ui.query"
        @click="open(list.id)"
      />
    </div>

    <Fab label="New list" @click="newList" />
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
</style>
