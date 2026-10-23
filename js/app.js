import { CONFIG } from '../config.js';
import { store, api, setSession, logout, toast } from './store.js';
import ItemsPage from './pages/items-page.js';
import CustomersPage from './pages/customers-page.js';
import ProjectsPage from './pages/projects-page.js';
import QuotePage from './pages/quote-page.js';
import SettingsPage from './pages/settings-page.js';
import BundlesPage from './pages/bundles-page.js';
import StatsPage from './pages/stats-page.js';

const { createApp, ref, computed, onMounted, nextTick, watch } = Vue;

const PAGES = {
  projects: 'ProjectsPage', customers: 'CustomersPage', items: 'ItemsPage', quotes: 'QuotePage', settings: 'SettingsPage', bundles: 'BundlesPage', stats: 'StatsPage',
};
const NAV = [
  { key: 'projects', label: '案件', icon: '📁' },
  { key: 'customers', label: '客戶', icon: '👥' },
  { key: 'items', label: '品項', icon: '📦' },
  { key: 'stats', label: '統計', icon: '📊' },
];

createApp({
  components: { ItemsPage, CustomersPage, ProjectsPage, QuotePage, SettingsPage, BundlesPage, StatsPage },
  setup() {
    const loginError = ref('');

    // 路由：#/頁面 或 #/頁面/編號
    const parse = () => {
      const [, page = 'projects', id] = location.hash.split('/');
      return { page: PAGES[page] ? page : 'projects', id: id ? Number(id) : null };
    };
    const route = ref(parse());
    window.addEventListener('hashchange', () => {
      route.value = parse();
      window.scrollTo(0, 0);
    });
    const current = computed(() => PAGES[route.value.page]);
    const navItems = computed(() =>
      store.user && store.user.role === 'admin' ? [...NAV, { key: 'settings', label: '設定', icon: '⚙️' }] : NAV);
    const activeNav = computed(() => ({ quotes: 'projects', bundles: 'items' }[route.value.page] || route.value.page));

    // Google 登入
    async function onGoogle(resp) {
      loginError.value = '';
      try {
        const data = await api('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({ credential: resp.credential }),
        });
        setSession(data.token, data.user);
      } catch (e) {
        loginError.value = e.message;
      }
    }

    function initGoogle() {
      if (store.user) return;
      if (!window.google || !google.accounts || !google.accounts.id) {
        setTimeout(initGoogle, 200);
        return;
      }
      const el = document.getElementById('gbtn');
      if (!el) {
        setTimeout(initGoogle, 100);
        return;
      }
      google.accounts.id.initialize({ client_id: CONFIG.GOOGLE_CLIENT_ID, callback: onGoogle });
      el.innerHTML = '';
      google.accounts.id.renderButton(el, { theme: 'outline', size: 'large' });
    }

    watch(
      () => store.user,
      (u) => {
        if (!u) nextTick(initGoogle);
      }
    );

    onMounted(async () => {
      if (store.token) {
        try {
          store.user = (await api('/api/me')).user;
          return;
        } catch (e) {
          if (store.token) toast(e.message); // 非 401（例如網路問題）時 token 保留
        }
      }
      nextTick(initGoogle);
    });

    return { store, loginError, route, current, activeNav, nav: navItems, logout };
  },
  template: `
  <div v-if="!store.user" class="min-h-screen flex items-center justify-center p-4">
    <div class="bg-white rounded-xl shadow p-8 w-full max-w-sm text-center">
      <h1 class="text-xl font-bold mb-1">報價系統</h1>
      <p class="text-sm text-gray-500 mb-6">請使用已授權的 Google 帳號登入</p>
      <div id="gbtn" class="flex justify-center"></div>
      <p v-if="loginError" class="text-sm text-red-600 mt-4">{{ loginError }}</p>
    </div>
  </div>

  <div v-else class="min-h-screen pb-24 md:pb-8">
    <header class="bg-white border-b sticky top-0 z-10" style="padding-top: env(safe-area-inset-top)">
      <div class="max-w-7xl mx-auto px-3 md:px-4 h-12 flex items-center justify-between">
        <div class="flex items-center gap-6">
          <span class="font-bold">報價系統</span>
          <nav class="hidden md:flex gap-5 text-sm">
            <a v-for="n in nav" :key="n.key" :href="'#/' + n.key" class="py-1"
               :class="activeNav === n.key ? 'text-blue-600 font-medium' : 'text-gray-600'">{{ n.label }}</a>
          </nav>
        </div>
        <div class="text-sm text-gray-600 flex items-center gap-3">
          <span class="hidden sm:inline">{{ store.user.name || store.user.email }}</span>
          <button class="text-blue-600 py-2" @click="logout">登出</button>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-3 md:px-4 py-4">
      <component :is="current" :id="route.id" :key="route.page + ':' + (route.id || '')"></component>
    </main>

    <nav class="md:hidden fixed bottom-0 inset-x-0 bg-white border-t grid z-10"
         :style="{ paddingBottom: 'env(safe-area-inset-bottom)', gridTemplateColumns: 'repeat(' + nav.length + ', minmax(0, 1fr))' }">
      <a v-for="n in nav" :key="n.key" :href="'#/' + n.key"
         class="flex flex-col items-center py-2 text-xs" :class="activeNav === n.key ? 'text-blue-600 font-medium' : 'text-gray-500'">
        <span class="text-lg leading-none">{{ n.icon }}</span>{{ n.label }}
      </a>
    </nav>

    <div v-if="store.toast"
         class="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow z-50">
      {{ store.toast }}
    </div>
  </div>
  `,
}).mount('#app');
