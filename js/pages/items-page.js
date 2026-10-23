import { store, api, toast, fmt } from '../store.js';

const { ref, reactive, computed, onMounted } = Vue;

// 匯入/匯出的欄位對照（中文表頭 → API 欄位）
const HEADER_MAP = {
  分類: 'category', 類別: 'subcategory', 品牌: 'brand', 型號: 'model',
  名稱: 'name', 品名: 'name', 規格: 'spec', 單位: 'unit',
  成本: 'cost_price', 售價: 'unit_price', 單價: 'unit_price',
};

export default {
  name: 'ItemsPage',
  setup() {
    const user = computed(() => store.user);
    const isAdmin = computed(() => store.user && store.user.role === 'admin');

    const items = ref([]);
    const total = ref(0);
    const limit = 50;
    const offset = ref(0);
    const loading = ref(false);
    const q = ref('');
    const category = ref('');
    const showInactive = ref(false);
    const meta = reactive({ subcategories: [], brands: [], units: [] });

    const edit = ref(null);
    const editError = ref('');
    const saving = ref(false);
    const imp = ref(null);

    const catLabel = (c) => (c === 'equipment' ? '設備' : '安裝工資');

    let timer = null;
    function onSearch() { clearTimeout(timer); timer = setTimeout(reload, 300); }
    function reload() { offset.value = 0; load(); }
    function page(dir) { offset.value = Math.max(0, offset.value + dir * limit); load(); }

    async function load() {
      loading.value = true;
      try {
        const p = new URLSearchParams({ limit, offset: offset.value, active: showInactive.value ? 'all' : '1' });
        if (q.value.trim()) p.set('q', q.value.trim());
        if (category.value) p.set('category', category.value);
        const data = await api('/api/items?' + p);
        items.value = data.items;
        total.value = data.total;
      } catch (e) { toast(e.message); }
      loading.value = false;
    }

    async function loadMeta() {
      try { Object.assign(meta, await api('/api/items/meta')); } catch { /* 非必要 */ }
    }

    function openEdit(it) {
      editError.value = '';
      edit.value = it
        ? { ...it }
        : { category: 'equipment', subcategory: '', brand: '', model: '', name: '', spec: '', unit: '', unit_price: 0, cost_price: 0 };
    }

    async function saveEdit() {
      editError.value = '';
      saving.value = true;
      try {
        const e = edit.value;
        const payload = {
          category: e.category, subcategory: e.subcategory, brand: e.brand, model: e.model,
          name: e.name, spec: e.spec, unit: e.unit || '式', unit_price: e.unit_price === '' ? 0 : e.unit_price,
        };
        if (store.user.can_see_cost) payload.cost_price = e.cost_price === '' ? 0 : e.cost_price;
        if (e.id) await api('/api/items/' + e.id, { method: 'PATCH', body: JSON.stringify(payload) });
        else await api('/api/items', { method: 'POST', body: JSON.stringify(payload) });
        edit.value = null;
        toast('已儲存');
        await Promise.all([load(), loadMeta()]);
      } catch (err) { editError.value = err.message; }
      saving.value = false;
    }

    async function toggleActive(it) {
      try {
        await api('/api/items/' + it.id, { method: 'PATCH', body: JSON.stringify({ active: it.active ? 0 : 1 }) });
        toast(it.active ? '已停用' : '已啟用');
        await load();
      } catch (e) { toast(e.message); }
    }

    // ───── 匯入 ─────
    function openImport() { imp.value = { rows: [], result: null, error: '', busy: false }; }

    async function onFile(ev) {
      const file = ev.target.files[0];
      if (!file) return;
      imp.value.error = '';
      imp.value.result = null;
      try {
        const wb = XLSX.read(await file.arrayBuffer());
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const rows = raw.map((r, i) => {
          const o = { _row: i + 2 }; // 第 1 列是表頭
          for (const [k, v] of Object.entries(r)) {
            const key = HEADER_MAP[String(k).replace(/\s+/g, '')];
            if (key) o[key] = v;
          }
          return o;
        }).filter((o) => Object.entries(o).some(([k, v]) => k !== '_row' && String(v).trim() !== ''));
        if (!rows.length) { imp.value.error = '找不到可匯入的資料，請確認第一列是表頭（分類、名稱…）'; return; }
        imp.value.rows = rows;
        imp.value.busy = true;
        imp.value.result = await api('/api/items/import', { method: 'POST', body: JSON.stringify({ rows, dry_run: true }) });
      } catch (e) { imp.value.error = e.message; }
      imp.value.busy = false;
    }

    async function commitImport() {
      imp.value.busy = true;
      try {
        const res = await api('/api/items/import', { method: 'POST', body: JSON.stringify({ rows: imp.value.rows, dry_run: false }) });
        toast(`匯入完成：新增 ${res.summary.created}、更新 ${res.summary.updated}`);
        imp.value = null;
        await Promise.all([load(), loadMeta()]);
      } catch (e) { imp.value.error = e.message; imp.value.busy = false; }
    }

    // ───── 匯出 / 範本 ─────
    function headers() {
      return store.user.can_see_cost
        ? ['分類', '類別', '品牌', '型號', '名稱', '規格', '單位', '成本', '售價']
        : ['分類', '類別', '品牌', '型號', '名稱', '規格', '單位', '售價'];
    }

    async function exportXlsx() {
      try {
        const { items: all } = await api('/api/items/export');
        const rows = all.map((it) => {
          const r = {
            分類: it.category === 'equipment' ? '設備' : '工資', 類別: it.subcategory, 品牌: it.brand,
            型號: it.model, 名稱: it.name, 規格: it.spec, 單位: it.unit,
          };
          if (store.user.can_see_cost) r['成本'] = it.cost_price;
          r['售價'] = it.unit_price;
          return r;
        });
        const ws = XLSX.utils.json_to_sheet(rows, { header: headers() });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '品項');
        XLSX.writeFile(wb, '品項資料庫.xlsx');
      } catch (e) { toast(e.message); }
    }

    function downloadTemplate() {
      const ex = [
        { 分類: '設備', 類別: 'DVR', 品牌: 'Benelink', 型號: '', 名稱: 'Benelink 16 CH TVIHD+IPC',
          規格: 'Benelink 16ch TVIHD+IPC Hybrid H.265\n支援網路及智慧型手機即時監看、回放、備份', 單位: '台', 成本: '', 售價: 45000 },
        { 分類: '設備', 類別: 'Camera', 品牌: '', 型號: '', 名稱: '1080P TVI高解半球廣角型',
          規格: '帶紅外線夜視(內建收音)', 單位: '支', 成本: '', 售價: 2000 },
        { 分類: '工資', 類別: '', 品牌: '', 型號: '', 名稱: '區域網路環境整合架設費用',
          規格: '外網,健保網,區域內網整合', 單位: '式', 成本: '', 售價: 10000 },
      ];
      const ws = XLSX.utils.json_to_sheet(ex, { header: ['分類', '類別', '品牌', '型號', '名稱', '規格', '單位', '成本', '售價'] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '匯入範本');
      XLSX.writeFile(wb, '品項匯入範本.xlsx');
    }

    onMounted(() => { load(); loadMeta(); });

    return {
      user, isAdmin, items, total, limit, offset, loading, q, category, showInactive, meta,
      edit, editError, saving, imp, fmt, catLabel,
      onSearch, reload, page, openEdit, saveEdit, toggleActive,
      openImport, onFile, commitImport, exportXlsx, downloadTemplate,
    };
  },
  template: `
  <div>
    <!-- 品項 / 套組 切換 -->
    <div class="flex gap-6 border-b mb-3 text-sm">
      <a href="#/items" class="pb-2 border-b-2 border-blue-600 text-blue-600 font-medium">品項</a>
      <a href="#/bundles" class="pb-2 text-gray-500">套組</a>
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-3">
      <input v-model="q" @input="onSearch" placeholder="搜尋名稱、品牌、型號、類別、規格" class="inp md:w-96">
      <select v-model="category" @change="reload" class="inp w-auto">
        <option value="">全部分類</option>
        <option value="equipment">設備</option>
        <option value="labor">安裝工資</option>
      </select>
      <label class="text-sm flex items-center gap-1">
        <input type="checkbox" v-model="showInactive" @change="reload"> 顯示已停用
      </label>
      <div class="md:ml-auto flex flex-wrap gap-2">
        <button v-if="isAdmin" class="btn btn-primary" @click="openEdit(null)">＋ 新增品項</button>
        <button v-if="isAdmin" class="btn" @click="openImport">匯入</button>
        <button class="btn" @click="exportXlsx">匯出</button>
        <button v-if="isAdmin" class="btn" @click="downloadTemplate">匯入範本</button>
      </div>
    </div>

    <!-- 電腦：表格 -->
    <div class="hidden md:block bg-white rounded-lg shadow overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-100 text-left">
          <tr>
            <th class="px-3 py-2">分類</th><th class="px-3 py-2">類別</th><th class="px-3 py-2">品牌</th>
            <th class="px-3 py-2">型號</th><th class="px-3 py-2">名稱 / 規格</th><th class="px-3 py-2">單位</th>
            <th v-if="user.can_see_cost" class="px-3 py-2 text-right">成本</th>
            <th class="px-3 py-2 text-right">售價</th><th class="px-3 py-2">狀態</th><th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in items" :key="it.id" class="border-t align-top" :class="{ 'opacity-50': !it.active }">
            <td class="px-3 py-2 whitespace-nowrap">{{ catLabel(it.category) }}</td>
            <td class="px-3 py-2">{{ it.subcategory }}</td>
            <td class="px-3 py-2">{{ it.brand }}</td>
            <td class="px-3 py-2">{{ it.model }}</td>
            <td class="px-3 py-2">
              <div class="font-medium">{{ it.name }}</div>
              <div v-if="it.spec" class="text-xs text-gray-500 whitespace-pre-line max-w-sm">{{ it.spec }}</div>
            </td>
            <td class="px-3 py-2">{{ it.unit }}</td>
            <td v-if="user.can_see_cost" class="px-3 py-2 text-right">{{ fmt(it.cost_price) }}</td>
            <td class="px-3 py-2 text-right">{{ fmt(it.unit_price) }}</td>
            <td class="px-3 py-2 whitespace-nowrap">{{ it.active ? '啟用' : '已停用' }}</td>
            <td class="px-3 py-2 whitespace-nowrap text-right">
              <template v-if="isAdmin">
                <button class="text-blue-600 hover:underline mr-3" @click="openEdit(it)">編輯</button>
                <button class="text-gray-600 hover:underline" @click="toggleActive(it)">{{ it.active ? '停用' : '啟用' }}</button>
              </template>
            </td>
          </tr>
          <tr v-if="!items.length && !loading">
            <td :colspan="user.can_see_cost ? 10 : 9" class="px-3 py-8 text-center text-gray-400">沒有符合的品項</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 手機：卡片 -->
    <div class="md:hidden space-y-2">
      <div v-for="it in items" :key="it.id" class="card" :class="{ 'opacity-50': !it.active }">
        <div class="flex justify-between gap-3">
          <div class="min-w-0">
            <div class="text-xs text-gray-500">{{ catLabel(it.category) }}<span v-if="it.subcategory"> · {{ it.subcategory }}</span></div>
            <div class="font-medium break-words">{{ it.name }}</div>
            <div v-if="it.brand || it.model" class="text-xs text-gray-500">{{ it.brand }} {{ it.model }}</div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-semibold">{{ fmt(it.unit_price) }}</div>
            <div class="text-xs text-gray-500">/ {{ it.unit }}</div>
            <div v-if="user.can_see_cost" class="text-xs text-gray-400">成本 {{ fmt(it.cost_price) }}</div>
          </div>
        </div>
        <div v-if="it.spec" class="text-xs text-gray-500 mt-1 whitespace-pre-line line-clamp-3">{{ it.spec }}</div>
        <div v-if="isAdmin" class="flex gap-5 mt-2 text-sm">
          <button class="text-blue-600 py-1" @click="openEdit(it)">編輯</button>
          <button class="text-gray-600 py-1" @click="toggleActive(it)">{{ it.active ? '停用' : '啟用' }}</button>
          <span v-if="!it.active" class="text-xs text-gray-400 py-1">已停用</span>
        </div>
      </div>
      <p v-if="!items.length && !loading" class="text-center text-gray-400 py-10">沒有符合的品項</p>
    </div>

    <div class="flex items-center justify-between mt-3 text-sm text-gray-600">
      <span>共 {{ total }} 筆</span>
      <div class="flex items-center gap-2">
        <button class="btn" :disabled="offset === 0" @click="page(-1)">上一頁</button>
        <span>{{ Math.floor(offset / limit) + 1 }} / {{ Math.max(1, Math.ceil(total / limit)) }}</span>
        <button class="btn" :disabled="offset + limit >= total" @click="page(1)">下一頁</button>
      </div>
    </div>

    <!-- 新增 / 編輯 -->
    <div v-if="edit" class="modal-wrap" @click.self="edit = null">
      <div class="modal-box">
        <h2 class="text-lg font-bold mb-4">{{ edit.id ? '編輯品項' : '新增品項' }}</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label>分類
            <select v-model="edit.category" class="inp mt-1">
              <option value="equipment">設備</option>
              <option value="labor">安裝工資</option>
            </select>
          </label>
          <label>類別（例：DVR、Camera、網路設備）
            <input v-model="edit.subcategory" list="dl-sub" class="inp mt-1">
          </label>
          <label>品牌
            <input v-model="edit.brand" list="dl-brand" class="inp mt-1">
          </label>
          <label>型號
            <input v-model="edit.model" class="inp mt-1">
          </label>
          <label class="sm:col-span-2">名稱 *
            <input v-model="edit.name" class="inp mt-1">
          </label>
          <label class="sm:col-span-2">規格說明（可多行）
            <textarea v-model="edit.spec" rows="4" class="inp mt-1"></textarea>
          </label>
          <label>單位
            <input v-model="edit.unit" list="dl-unit" class="inp mt-1">
          </label>
          <label>售價
            <input v-model="edit.unit_price" type="number" inputmode="numeric" min="0" class="inp mt-1">
          </label>
          <label v-if="user.can_see_cost">成本
            <input v-model="edit.cost_price" type="number" inputmode="numeric" min="0" class="inp mt-1">
          </label>
        </div>
        <datalist id="dl-sub"><option v-for="v in meta.subcategories" :value="v"></option></datalist>
        <datalist id="dl-brand"><option v-for="v in meta.brands" :value="v"></option></datalist>
        <datalist id="dl-unit"><option v-for="v in meta.units" :value="v"></option></datalist>
        <p v-if="editError" class="text-sm text-red-600 mt-3">{{ editError }}</p>
        <div class="flex justify-end gap-2 mt-5">
          <button class="btn" @click="edit = null">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="saveEdit">儲存</button>
        </div>
      </div>
    </div>

    <!-- 匯入 -->
    <div v-if="imp" class="modal-wrap" @click.self="imp = null">
      <div class="modal-box">
        <h2 class="text-lg font-bold mb-1">匯入品項</h2>
        <p class="text-xs text-gray-500 mb-4">
          支援 .xlsx / .xls / .csv，欄位：分類、類別、品牌、型號、名稱、規格、單位、成本、售價（可先下載「匯入範本」）。<br>
          比對規則：有型號用「品牌＋型號」，沒有型號用「名稱＋規格」；比對到就更新（空白欄位不覆蓋），沒有就新增。
        </p>
        <input type="file" accept=".xlsx,.xls,.csv" @change="onFile" class="text-sm mb-4">

        <div v-if="imp.result">
          <p class="text-sm mb-2">
            預覽：新增 <b>{{ imp.result.summary.created }}</b> 筆、更新 <b>{{ imp.result.summary.updated }}</b> 筆、
            <span :class="imp.result.summary.errors ? 'text-red-600' : ''">錯誤 <b>{{ imp.result.summary.errors }}</b> 筆（不會寫入）</span>
          </p>
          <div class="border rounded max-h-72 overflow-y-auto text-sm">
            <table class="w-full">
              <tbody>
                <tr v-for="r in imp.result.rows" :key="r.row" class="border-b" :class="{ 'bg-red-50': r.action === 'error' }">
                  <td class="px-2 py-1 w-16 text-gray-500 whitespace-nowrap">第 {{ r.row }} 列</td>
                  <td class="px-2 py-1 w-12 whitespace-nowrap">{{ { create: '新增', update: '更新', error: '錯誤' }[r.action] }}</td>
                  <td class="px-2 py-1">{{ r.name }}<div v-if="r.message" class="text-red-600 text-xs">{{ r.message }}</div></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-if="imp.error" class="text-sm text-red-600 mt-3">{{ imp.error }}</p>

        <div class="flex justify-end gap-2 mt-5">
          <button class="btn" @click="imp = null">關閉</button>
          <button class="btn btn-primary"
                  :disabled="imp.busy || !imp.result || (imp.result.summary.created + imp.result.summary.updated === 0)"
                  @click="commitImport">確認匯入</button>
        </div>
      </div>
    </div>
  </div>
  `,
};
