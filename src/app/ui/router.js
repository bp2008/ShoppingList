import { createRouter, createWebHashHistory } from 'vue-router'
import HomeScreen from '../components/HomeScreen.vue'
import ListScreen from '../components/ListScreen.vue'
import { getList } from '../core/store'

/**
 * The route table.
 *
 * WHY THE URL OWNS THE UI. Before this existed the app pushed anonymous history entries
 * with no URL of their own, which meant the browser's own controls disagreed with the
 * app: Forward did nothing, and a refresh dropped the user on the home screen while the
 * history stack still claimed several entries were open, so the next few Back presses
 * appeared to do nothing at all. A route per screen and a query flag per overlay makes
 * every entry self-describing, so Back, Forward and Reload are all just "render this URL".
 *
 * WHY HASH HISTORY. The published site is static, is served from an arbitrary mount path
 * (Pages subpath, staging root, localhost), and its service worker deliberately knows
 * nothing about app URLs. Path routing would need every deep link to fall back to
 * index.html on the server, which GitHub Pages cannot do. The hash never reaches a
 * server, so `#/list/<id>` works identically everywhere, offline included.
 *
 * The bootloader's `#rescue` escape hatch is unaffected: it is matched before any app
 * code loads, and its pattern only accepts `rescue` at the very start of the hash.
 *
 * OVERLAYS ARE QUERY FLAGS, not routes: `?menu`, `?settings`, `?search`, `?select`,
 * `?dialog=<kind>`. They stack in the URL exactly as they stack on screen, and the
 * screen underneath stays mounted with its scroll position intact.
 */
export const routes = [
  { path: '/', name: 'home', component: HomeScreen },
  {
    path: '/list/:id',
    name: 'list',
    component: ListScreen,
    props: true,
    // A stale link, a deleted list, or an import that replaced everything. Refuse the
    // navigation rather than mounting a screen with nothing to show. `replace` matters:
    // without it the dead URL stays in the stack, and Back lands on it and bounces
    // straight home again, which reads as a Back press that did nothing.
    beforeEnter: (to) =>
      getList(String(to.params.id)) ? true : { name: 'home', replace: true },
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'home' } },
]

export function createAppRouter() {
  return createRouter({
    history: createWebHashHistory(),
    routes,
    // Every scroller in this app is an element, never the document, so there is nothing
    // for the router to restore. Returning false keeps it from touching scroll at all.
    scrollBehavior: () => false,
  })
}
