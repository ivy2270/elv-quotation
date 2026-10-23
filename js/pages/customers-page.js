import { api, toast, fmt, STATUS, STATUS_CLASS } from '../store.js';

const { ref, onMounted } = Vue;

const emptyCustomer = () => ({ name: '', contact: '', phone: '', tax_id: '', address: '', note: '' });

export default {
  name: 'CustomersPage',
  props: ['id'],
  setup(props) {
    // 列表
    const list = ref([]);
    const total = ref(0);
    const limit = 50;
    const offset = ref(0);
    const q = ref('');
    const loading = ref(false);
    // 詳情
    const cust = ref(null);
    const projects = ref([]);
    // 彈窗
    const edit = ref(null);
    const editError = ref('');
    const saving = ref(false);
    const np = ref(null);
    const npError = ref('');

    let timer = null;
    function onSearch() { clearTimeout(timer); timer = setTimeout(() => { offset.value = 0; load(); }, 300); }
    function page(dir) { offset.value = Math.max(0, offset.value + dir * limit); load(); }

    async function load() {
      loading.value = true;
      try {
        const p = new URLSearchParams({ limit, offset: offset.value });
        if (q.value.trim()) p.set('q', q.value.trim());
        const data = await api('/api/customers?' + p);
        list.value = data.customers;
        total.value = data.total;
      } catch (e) { toast(e.message); }
      loading.value = false;
    }

    async function loadDetail() {
      try {
        cust.value = (await api('/api/customers/' + props.id)).customer;
        projects.value = (await api('/api/projects?customer_id=' + props.id + '&limit=200')).projects;
      } catch (e) { toast(e.message); }
    }

    function openEdit(c) {
      editError.value = '';
      edit.value = c ? { ...c } : emptyCustomer();
    }

    async function saveEdit() {
      editError.value = '';
      saving.value = true;
      try {
        const e = edit.value;
        const body = JSON.stringify({
          name: e.name, contact: e.contact, phone: e.phone, tax_id: e.tax_id, address: e.address, note: e.note,
        });
        if (e.id) await api('/api/customers/' + e.id, { method: 'PATCH', body });
        else await api('/api/customers', { method: 'POST', body });
        edit.value = null;
        toast('已儲存');
        if (props.id) await loadDetail(); else await load();
      } catch (err) { editError.value = err.message; }
      saving.value = false;
    }

    function openNewProject() { npError.value = ''; np.value = { name: '', site_address: '' }; }

    async function createProject() {
      npError.value = '';
      try {
        const res = await api('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ customer_id: Number(props.id), name: np.value.name, site_address: np.value.site_address }),
        });
        np.value = null;
        location.hash = '#/projects/' + res.id;
      } catch (e) { npError.value = e.message; }
    }

    onMounted(() => { if (props.id) loadDetail(); else load(); });

    return {
      list, total, limit, offset, q, loading, cust, projects, edit, editError, saving, np, npError,
      fmt, STATUS, STATUS_CLASS,
      onSearch, page, openEdit, saveEdit, openNewProject, createProject,
    };
  },
  template: `
  <div>
    <!-- 列表 -->
    <div v-if="!id">
      <div class="flex flex-wrap gap-2 mb-3">
        <input class="inp md:w-96" v-model="q" @input="onSearch" placeholder="搜尋客戶名稱、聯絡人、電話、統編">
        <button class="btn btn-primary md:ml-auto" @click="openEdit(null)">＋ 新增客戶</button>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <a v-for="c in list" :key="c.id" :href="'#/customers/' + c.id" class="card block hover:shadow">
          <div class="font-medium">{{ c.name }}</div>
          <div class="text-sm text-gray-500">{{ [c.contact, c.phone].filter(Boolean).join('　') }}</div>
          <div class="text-xs text-gray-400 mt-1">{{ c.project_count }} 個案件</div>
        </a>
      </div>
      <p v-if="!list.length && !loading" class="text-center text-gray-400 py-10">沒有符合的客戶</p>
      <div class="flex items-center justify-between mt-3 text-sm text-gray-600">
        <span>共 {{ total }} 位</span>
        <div class="flex items-center gap-2">
          <button class="btn" :disabled="offset === 0" @click="page(-1)">上一頁</button>
          <span>{{ Math.floor(offset / limit) + 1 }} / {{ Math.max(1, Math.ceil(total / limit)) }}</span>
          <button class="btn" :disabled="offset + limit >= total" @click="page(1)">下一頁</button>
        </div>
      </div>
    </div>

    <!-- 詳情 -->
    <div v-else-if="cust">
      <a href="#/customers" class="text-sm text-blue-600">← 客戶列表</a>
      <div class="card mt-2">
        <div class="flex items-start justify-between gap-2">
          <h2 class="text-lg font-bold">{{ cust.name }}</h2>
          <button class="btn" @click="openEdit(cust)">編輯</button>
        </div>
        <dl class="mt-2 text-sm grid grid-cols-[5rem_1fr] gap-y-1">
          <dt class="text-gray-500">聯絡人</dt><dd>{{ cust.contact || '—' }}</dd>
          <dt class="text-gray-500">電話</dt>
          <dd><a v-if="cust.phone" :href="'tel:' + cust.phone" class="text-blue-600">{{ cust.phone }}</a><span v-else>—</span></dd>
          <dt class="text-gray-500">統編</dt><dd>{{ cust.tax_id || '—' }}</dd>
          <dt class="text-gray-500">地址</dt><dd>{{ cust.address || '—' }}</dd>
          <dt class="text-gray-500">備註</dt><dd class="whitespace-pre-line">{{ cust.note || '—' }}</dd>
        </dl>
      </div>

      <div class="flex items-center justify-between mt-5 mb-2">
        <h3 class="font-bold">案件（{{ projects.length }}）</h3>
        <button class="btn btn-primary" @click="openNewProject">＋ 新增案件</button>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <a v-for="p in projects" :key="p.id" :href="'#/projects/' + p.id" class="card block hover:shadow">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-mono text-gray-500">{{ p.project_no }}</span>
            <span class="text-xs px-2 py-0.5 rounded-full" :class="STATUS_CLASS[p.status]">{{ STATUS[p.status] }}</span>
          </div>
          <div class="font-medium mt-1">{{ p.name }}</div>
          <div class="text-sm text-gray-500">報價 {{ p.adopted_total === null ? '—' : fmt(p.adopted_total) }}</div>
        </a>
      </div>
      <p v-if="!projects.length" class="text-center text-gray-400 py-8">這位客戶還沒有案件</p>
    </div>

    <!-- 新增 / 編輯客戶 -->
    <div v-if="edit" class="modal-wrap" @click.self="edit = null">
      <div class="modal-box">
        <h2 class="text-lg font-bold mb-4">{{ edit.id ? '編輯客戶' : '新增客戶' }}</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label class="sm:col-span-2">客戶名稱 *<input v-model="edit.name" class="inp mt-1"></label>
          <label>聯絡人<input v-model="edit.contact" class="inp mt-1"></label>
          <label>電話<input v-model="edit.phone" type="tel" class="inp mt-1"></label>
          <label>統編（8 碼）<input v-model="edit.tax_id" inputmode="numeric" maxlength="8" class="inp mt-1"></label>
          <label>地址<input v-model="edit.address" class="inp mt-1"></label>
          <label class="sm:col-span-2">備註<textarea v-model="edit.note" rows="3" class="inp mt-1"></textarea></label>
        </div>
        <p v-if="editError" class="text-sm text-red-600 mt-3">{{ editError }}</p>
        <div class="flex justify-end gap-2 mt-5">
          <button class="btn" @click="edit = null">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="saveEdit">儲存</button>
        </div>
      </div>
    </div>

    <!-- 新增案件（客戶詳情內） -->
    <div v-if="np" class="modal-wrap" @click.self="np = null">
      <div class="modal-box">
        <h2 class="text-lg font-bold mb-4">新增案件 — {{ cust && cust.name }}</h2>
        <div class="grid gap-3 text-sm">
          <label>案件名稱 *<input v-model="np.name" class="inp mt-1" placeholder="例：一樓診所監視系統"></label>
          <label>施工地址<input v-model="np.site_address" class="inp mt-1"></label>
        </div>
        <p v-if="npError" class="text-sm text-red-600 mt-3">{{ npError }}</p>
        <div class="flex justify-end gap-2 mt-5">
          <button class="btn" @click="np = null">取消</button>
          <button class="btn btn-primary" @click="createProject">建立案件</button>
        </div>
      </div>
    </div>
  </div>
  `,
};
