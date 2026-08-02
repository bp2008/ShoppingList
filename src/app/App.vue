<script>
import TopBar from './components/TopBar.vue'
import HomeScreen from './components/HomeScreen.vue'
import ListScreen from './components/ListScreen.vue'
import Drawer from './components/Drawer.vue'
import SettingsSheet from './components/SettingsSheet.vue'
import Dialogs from './components/Dialogs.vue'
import Toast from './components/Toast.vue'

import * as store from './core/store'
import { listAsText } from './core/format'
import { criticalSection } from './core/bootBridge'
import { ui, showToast, closeSearch } from './ui/state'
import { installTheme } from './ui/theme'
import { installHistory, popLayer, pushLayer, reuseLayer } from './ui/history'

/**
 * Root component: screen switching, overlays, and the drawer's action table.
 *
 * CONTRACT WITH THE BOOTLOADER: the element carrying `data-app-topbar` is what the boot
 * health check measures. It must exist and have a non-zero offsetHeight once rendered, or
 * a working build is judged broken and rolled back. Do not remove the attribute.
 */
export default {
  name: 'App',
  components: { TopBar, HomeScreen, ListScreen, Drawer, SettingsSheet, Dialogs, Toast },
  props: {
    initResult: { type: Object, required: true },
  },
  data() {
    return { ui, state: store.state, version: __APP_VERSION__, observer: null }
  },
  computed: {
    blocked() {
      return this.initResult.ok === false
    },
    list() {
      return ui.listId ? store.getList(ui.listId) : null
    },
    title() {
      return ui.view === 'list' && this.list ? this.list.name : 'Shopping List'
    },
  },
  created() {
    store.onToast(showToast)
  },
  mounted() {
    installTheme()
    installHistory()

    // Row height is a token so every row reads it without prop drilling.
    this.$watch(
      () => store.state.settings.rowHeight,
      (px) => document.documentElement.style.setProperty('--row-height', `${px}px`),
      { immediate: true },
    )

    // The narrow-viewport rule is about APP width, not viewport width.
    this.observer = new ResizeObserver(([entry]) => {
      ui.width = entry.contentRect.width
    })
    this.observer.observe(this.$el)
    ui.width = this.$el.clientWidth

    window.addEventListener('slp:update-ready', this.onUpdateReady)
  },
  beforeUnmount() {
    this.observer?.disconnect()
    window.removeEventListener('slp:update-ready', this.onUpdateReady)
  },
  methods: {
    onUpdateReady() {
      ui.updateReady = true
    },

    reload() {
      location.reload()
    },

    openList(id) {
      criticalSection('open-list', () => {
        ui.listId = id
        ui.view = 'list'
        closeSearch()
        pushLayer()
      })
    },

    // Every close routes through history; the popstate handler clears the state. Doing
    // both here is what lets in-app close and hardware Back disagree.
    back() {
      popLayer()
    },

    openMenu() {
      criticalSection('open-menu', () => {
        ui.drawerOpen = true
        pushLayer()
      })
    },

    /**
     * @param reuse true when replacing a layer that is already open (the drawer), so the
     *   history entry is inherited rather than pushed on top of a pending back().
     */
    openDialog(kind, arg = null, reuse = false) {
      ui.dialogArg = arg
      ui.dialog = kind
      if (!reuse) pushLayer()
    },

    closeDialog() {
      popLayer()
    },

    closeDrawer() {
      popLayer()
    },

    closeSettings() {
      popLayer()
    },

    deleteSelected() {
      store.deleteCatalogItems(ui.listId, [...ui.selected])
      popLayer()
    },

    copyAsText() {
      const entries = this.list.items.map((it) => ({
        name: store.catalogName(this.list, it.cid),
        qty: it.qty,
      }))
      navigator.clipboard?.writeText(listAsText(this.list.name, entries)).then(
        () => showToast('List copied'),
        () => showToast('Copy blocked by browser'),
      )
    },

    /**
     * The drawer emits intents; the mapping to behaviour lives here, in one table.
     *
     * Menu items that OPEN something inherit the drawer's history entry instead of
     * popping it and pushing a new one. popLayer() goes back asynchronously, so a
     * pushState in the same tick would be torn down by the popstate that arrives after
     * it — the new layer would flash open and immediately close.
     */
    onDrawerAction(action) {
      const id = ui.listId
      const opensLayer = [
        'new-list',
        'settings',
        'about',
        'data',
        'rename',
        'delete-list',
        'select-catalog',
      ].includes(action)

      if (opensLayer) {
        ui.drawerOpen = false
        reuseLayer()
      } else {
        this.closeDrawer()
      }

      switch (action) {
        case 'undo':
          store.undo()
          break
        case 'redo':
          store.redo()
          break
        case 'apply-update':
          location.reload()
          break
        case 'new-list':
          this.openDialog('new-list', null, true)
          break
        case 'settings':
          ui.settingsOpen = true
          break
        case 'about':
          this.openDialog('about', null, true)
          break
        case 'data':
          this.openDialog('data', null, true)
          break
        case 'sort':
          store.sortLeftAZ(id)
          break
        case 'toggle-others':
          store.toggleShowOthers(id)
          break
        case 'select-catalog':
          ui.selecting = true
          ui.selected = []
          break
        case 'rename':
          this.openDialog('rename', null, true)
          break
        case 'copy-text':
          this.copyAsText()
          break
        case 'delete-list':
          this.openDialog('delete-list', null, true)
          break
        default:
          break
      }
    },

    /**
     * Creating a list opens it, per the handoff.
     *
     * The dialog's history layer is REUSED as the list screen's layer rather than popped
     * and re-pushed: one Back should return to the home screen, not reopen the dialog
     * that created the list.
     */
    onCreated(id) {
      ui.dialog = null
      ui.dialogArg = null
      ui.listId = id
      ui.view = 'list'
      reuseLayer()
    },
  },
}
</script>

<template>
  <div class="app">
    <!--
      Data written by a newer build. Refuse to touch it rather than migrate downward:
      this is the guard that makes rolling back across a schema change non-destructive.
    -->
    <template v-if="blocked">
      <header class="topbar-fallback" data-app-topbar>Shopping List</header>
      <div class="blocked">
        <h1>This version is too old for your data</h1>
        <p>
          Your lists were saved by a newer version of Shopping List and have been left
          untouched. Update to open them.
        </p>
        <button type="button" @click="reload">Check for update</button>
      </div>
    </template>

    <template v-else>
      <TopBar
        data-app-topbar
        :title="title"
        :version="ui.view === 'home' ? 'v' + version : ''"
        :show-back="ui.view === 'list'"
        :can-delete="ui.selected.length > 0"
        @back="back"
        @menu="openMenu"
        @delete-selected="deleteSelected"
      />

      <HomeScreen
        v-if="ui.view === 'home'"
        @open="openList"
        @new-list="openDialog('new-list')"
      />
      <ListScreen
        v-else-if="list"
        :list="list"
        @add-catalog="openDialog('add-catalog')"
      />

      <Drawer
        v-if="ui.drawerOpen"
        :view="ui.view"
        :list="list"
        :version="version"
        @close="closeDrawer"
        @action="onDrawerAction"
      />

      <SettingsSheet v-if="ui.settingsOpen" @close="closeSettings" />

      <Dialogs
        v-if="ui.dialog"
        :list="list"
        :version="version"
        @close="closeDialog"
        @created="onCreated"
      />

      <Toast />
    </template>
  </div>
</template>

<style>
@import './styles/tokens.css';
</style>

<style scoped>
.app {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  touch-action: manipulation;
}

.topbar-fallback {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font: 600 17px var(--font);
  background: var(--topbar);
  border-bottom: 1px solid var(--line);
}

.blocked {
  flex: 1;
  padding: 24px;
}

.blocked h1 {
  font: 600 17px/1.3 var(--font);
  margin: 0 0 10px;
}

.blocked p {
  font: 400 13.5px/1.5 var(--font);
  color: var(--text2);
  margin: 0 0 18px;
}

.blocked button {
  min-height: 46px;
  padding: 12px 18px;
  font: 600 14px var(--font);
  color: #fff;
  background: var(--accent);
  border-radius: 8px;
  cursor: pointer;
}
</style>
