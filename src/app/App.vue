<script>
import TopBar from './components/TopBar.vue'
import Drawer from './components/Drawer.vue'
import SettingsSheet from './components/SettingsSheet.vue'
import Dialogs from './components/Dialogs.vue'
import Toast from './components/Toast.vue'

import * as store from './core/store'
import { listAsText } from './core/format'
import { criticalSection } from './core/bootBridge'
import { ui, showToast } from './ui/state'
import { installTheme } from './ui/theme'
import { installViewport } from './ui/viewport'
import { closeLayer, goHome, openLayer, replaceLayer, replaceWithList } from './ui/navigation'

/**
 * Drawer actions that swap the drawer for another layer, and the layer each one opens.
 *
 * They REPLACE the drawer's history entry instead of closing it and pushing a new one, so
 * one Back returns to the screen rather than reopening the menu.
 */
const DRAWER_LAYERS = {
  'new-list': { dialog: 'new-list' },
  settings: { settings: null },
  about: { dialog: 'about' },
  'import-text': { dialog: 'import-text' },
  rename: { dialog: 'rename' },
  'delete-list': { dialog: 'delete-list' },
  'select-catalog': { select: null },
}

/**
 * Root component: the top bar, the routed screen, and the overlay layers.
 *
 * CONTRACT WITH THE BOOTLOADER: the element carrying `data-app-topbar` is what the boot
 * health check measures. It must exist and have a non-zero offsetHeight once rendered, or
 * a working build is judged broken and rolled back. Do not remove the attribute.
 *
 * Overlays live here rather than in the routes because they are drawn OVER the screen:
 * routing them would unmount the list underneath and lose its scroll position.
 */
export default {
  name: 'App',
  components: { TopBar, Drawer, SettingsSheet, Dialogs, Toast },
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
    // Publishes the usable viewport, which is what keeps a dialog off the keyboard.
    installViewport()

    // Row height is a token so every row reads it without prop drilling.
    this.$watch(
      () => store.state.settings.rowHeight,
      (px) => document.documentElement.style.setProperty('--row-height', `${px}px`),
      { immediate: true },
    )

    // The list in the URL can disappear underneath us -- deleted, undone, or replaced by
    // an import. The route guard only covers arriving; this covers already being there.
    this.$watch(
      () => ui.view === 'list' && !this.list,
      (orphaned) => {
        if (orphaned) goHome()
      },
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

    // Every close routes through the router; syncUi() does the closing. Doing both here
    // is what lets in-app close and hardware Back disagree.
    back() {
      closeLayer()
    },

    openMenu() {
      criticalSection('open-menu', () => openLayer({ menu: null }))
    },

    deleteSelected() {
      store.deleteCatalogItems(ui.listId, [...ui.selected])
      closeLayer()
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
     * Three shapes: undo and redo leave the drawer standing, because they are the two
     * things a user is likely to want twice in a row and reopening the menu between
     * presses is the whole complaint; anything that opens a layer inherits the drawer's
     * history entry; everything else closes the drawer and acts.
     */
    onDrawerAction(action) {
      if (action === 'undo') {
        store.undo()
        return
      }
      if (action === 'redo') {
        store.redo()
        return
      }

      const layer = DRAWER_LAYERS[action]
      if (layer) {
        replaceLayer(layer)
        return
      }

      const id = ui.listId
      closeLayer()

      switch (action) {
        case 'apply-update':
          location.reload()
          break
        case 'sort':
          store.sortLeftAZ(id)
          break
        case 'toggle-others':
          store.toggleShowOthers(id)
          break
        case 'copy-text':
          this.copyAsText()
          break
        default:
          break
      }
    },

    /**
     * Creating a list opens it, per the handoff.
     *
     * The dialog's history entry is REUSED as the list screen's entry rather than closed
     * and re-pushed: one Back should return to the home screen, not reopen the dialog
     * that created the list.
     */
    onCreated(id) {
      replaceWithList(id)
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
        <button class="tap-inv" type="button" @click="reload">Check for update</button>
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

      <RouterView />

      <Drawer
        v-if="ui.drawerOpen"
        :view="ui.view"
        :list="list"
        :version="version"
        @close="back"
        @action="onDrawerAction"
      />

      <SettingsSheet v-if="ui.settingsOpen" @close="back" />

      <Dialogs v-if="ui.dialog" :list="list" :version="version" @close="back" @created="onCreated" />

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
