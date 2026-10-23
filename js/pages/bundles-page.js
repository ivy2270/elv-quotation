import { store, api, toast, fmt } from '../store.js';

const { ref, reactive, computed, onMounted } = Vue;

export default {
  name: 'BundlesPage',
  setup() {
    const isAdmin = computed(() => store.user && store.user.role === 'admin');

    const list = ref([]);
    const total = ref(0);
    const limit = 50;
    const offset = ref(0);
    const q = ref('');
    const showInactive = ref(false);
    const loading = ref(false);
    const open = reactive({}); // 展開查看成員：{ 套組id: 成員陣列 }

    const edit = ref(null);
    const editError = ref('');
    const saving = ref(false);

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
        const data = await api('/api/bundles?' + p);
        list.value = data.bundles;
        total.value = data.total;
      } catch (e) { toast(e.message); }
      loading.value = false;
    }

    async function toggleOpen(b) {
      if (open[b.id]) { delete open[b.id]; return; }
      try { open[b.id] = (await api('/api/bundles/' + b.id)).items; }
      catch (e) { toast(e.message); }
    }

    async function toggleActive(b) {
      try {
        await api('/api/bundles/' + b.id, { method: 'PATCH', body: JSON.stringify({ active: b.active ? 0 : 1 }) });
        toast(b.active ? '已停用' : '已啟用');
        await load();
      } catch (e) { toast(e.message); }
    }

    // ───── 新增 / 編輯 ─────
    async function openEdit(b) {
      editError.value = '';
      if (!b) {
        edit.value = { id: null, name: '', note: '', active: 1, members: [], q: '', results: [] };
        return;
      }
      try {
        const d = await api('/api/bundles/' + b.id);
        edit.value = {
          id: b.id, name: d.bundle.name, note: d.bundle.note, active: d.bundle.active, q: '', results: [],
          members: d.items.map((m) => ({
            item_id: m.item_id, name: m.name, unit: m.unit, unit_price: m.unit_price, qty: m.qty, active: m.active,
          })),
        };
      } catch (e) { toast(e.message); }
    }

    let stimer = null;
    function onMemberSearch() { clearTimeout(stimer); stimer = setTimeout(searchMember, 250); }

    async function searchMember() {
      const e = edit.value;
      if (!e) return;
      if (!e.q.trim()) { e.results = []; return; }
      try {
        const p = new URLSearchParams({ limit: 8, q: e.q.trim() });
        e.results = (await api('/api/items?' + p)).items;
      } catch (err) { toast(err.message); }
    }

    function addMember(it) {
      const e = edit.value;
      const found = e.members.find((m) => m.item_id === it.id);
      if (found) found.qty = Number(found.qty) + 1;
      else e.members.push({ item_id: it.id, name: it.name, unit: it.unit, unit_price: it.unit_price, qty: 1, active: 1 });
    }

    function removeMember(m) { edit.value.members.splice(edit.value.members.indexOf(m), 1); }

    const memberSum = computed(() =>
      edit.value ? edit.value.members.reduce((s, m) => s + Math.round((Number(m.qty) || 0) * m.unit_price), 0) : 0);

    async function saveEdit() {
      editError.value = '';
      const e = edit.value;
      if (!e.name.trim()) { editError.value = '請輸入套組名稱'; return; }
      if (!e.members.length) { editError.value = '套組至少要有一個品項'; return; }
      if (e.members.some((m) => !(Number(m.qty) > 0))) { editError.value = '每個成員的數量都要大於 0'; return; }
      saving.value = true;
      try {
        const body = JSON.stringify({
          name: e.name, note: e.note, active: e.active,
          items: e.members.map((m) => ({ item_id: m.item_id, qty: Number(m.qty) })),
        });
        if (e.id) await api('/api/bundles/' + e.id, { method: 'PUT', body });
        else await api('/api/bundles', { method: 'POST', body });
        edit.value = null;
        toast('已儲存');
        for (const k of Object.keys(open)) delete open[k];
        await load();
      } catch (err) { editError.value = err.message; }
      saving.value = false;
    }

    onMounted(load);

    return {
      isAdmin, list, total, limit, offset, q, showInactive, loading, open, edit, editError, saving, memberSum,
      fmt, catLabel,
      onSearch, reload, page, toggleOpen, toggleActive, openEdit, onMemberSearch, addMember, removeMember, saveEdit,
    };
  },
  template: `
  <div>
    <!-- 品項 / 套組 切換 -->
    <div class="flex gap-6 border-b mb-3 text-sm">
      <a href="#/items" class="pb-2 text-gray-500">品項</a>
      <a href="#/bundles" class="pb-2 border-b-2 border-blue-600 text-blue-600 font-medium">套組</a>
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-3">
      <input v-model="q" @input="onSearch" placeholder="搜尋套組名稱、備註" class="inp md:w-96">
      <label class="text-sm flex items-center gap-1">
        <input type="checkbox" v-model="showInactive" @change="reload"> 顯示已停用
      </label>
      <button v-if="isAdmin" class="btn btn-primary md:ml-auto" @click="openEdit(null)">＋ 新增套組</button>
    </div>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="b in list" :key="b.id" class="card" :class="{ 'opacity-50': !b.active }">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="font-medium break-words">{{ b.name }}<span v-if="!b.active" class="text-xs text-gray-400 ml-1">（已停用）</span></div>
            <div v-if="b.note" class="text-xs text-gray-500 break-words">{{ b.note }}</div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-semibold">{{ fmt(b.price_sum) }}</div>
            <div class="text-xs text-gray-500">{{ b.item_count }} 個品項</div>
          </div>
        </div>

        <div v-if="open[b.id]" class="mt-2 border-t pt-2 space-y-1 text-sm">
          <div v-for="m in open[b.id]" :key="m.item_id" class="flex justify-between gap-2" :class="{ 'text-gray-400': !m.active }">
            <span class="min-w-0 break-words">
              <span class="text-xs text-gray-400">{{ catLabel(m.category) }}</span> {{ m.name }}<span v-if="!m.active">（品項已停用）</span>
            </span>
            <span class="shrink-0">{{ Number(m.qty) }} {{ m.unit }} × {{ fmt(m.unit_price) }}</span>
          </div>
        </div>

        <div class="flex gap-5 mt-2 text-sm">
          <button class="text-blue-600 py-1" @click="toggleOpen(b)">{{ open[b.id] ? '收合內容' : '查看內容' }}</button>
          <template v-if="isAdmin">
            <button class="text-blue-600 py-1" @click="openEdit(b)">編輯</button>
            <button class="text-gray-600 py-1" @click="toggleActive(b)">{{ b.active ? '停用' : '啟用' }}</button>
          </template>
        </div>
      </div>
    </div>
    <p v-if="!list.length && !loading" class="text-center text-gray-400 py-10">還沒有套組<span v-if="isAdmin">，按「新增套組」建立第一個</span></p>

    <div class="flex items-center justify-between mt-3 text-sm text-gray-600">
      <span>共 {{ total }} 個</span>
      <div class="flex items-center gap-2">
        <button class="btn" :disabled="offset === 0" @click="page(-1)">上一頁</button>
        <span>{{ Math.floor(offset / limit) + 1 }} / {{ Math.max(1, Math.ceil(total / limit)) }}</span>
        <button class="btn" :disabled="offset + limit >= total" @click="page(1)">下一頁</button>
      </div>
    </div>

    <!-- 新增 / 編輯套組 -->
    <div v-if="edit" class="modal-wrap" @click.self="edit = null">
      <div class="modal-box">
        <h2 class="text-lg font-bold mb-4">{{ edit.id ? '編輯套組' : '新增套組' }}</h2>
        <div class="grid gap-3 text-sm">
          <label>套組名稱 *<input v-model="edit.name" class="inp mt-1" placeholder="例：單支攝影機含線與安裝"></label>
          <label>備註<input v-model="edit.note" class="inp mt-1"></label>

          <div>
            <div class="mb-1">成員品項（共 {{ edit.members.length }} 項，合計 {{ fmt(memberSum) }}）</div>
            <div class="space-y-2">
              <div v-for="m in edit.members" :key="m.item_id" class="border rounded-lg p-2 flex items-center gap-2" :class="{ 'bg-gray-50': !m.active }">
                <div class="min-w-0 flex-1">
                  <div class="break-words">{{ m.name }}<span v-if="!m.active" class="text-xs text-amber-600 ml-1">品項已停用，加入報價時會略過</span></div>
                  <div class="text-xs text-gray-500">{{ fmt(m.unit_price) }} / {{ m.unit }}</div>
                </div>
                <label class="text-xs text-gray-500">數量
                  <input v-model="m.qty" type="number" inputmode="decimal" min="0" step="any" class="inp w-20 px-2 py-1"></label>
                <button class="text-red-500 px-2 py-1" @click="removeMember(m)" aria-label="移除">✕</button>
              </div>
              <p v-if="!edit.members.length" class="text-gray-400">尚未加入品項，請在下方搜尋後點選</p>
            </div>
          </div>

          <div>
            <input v-model="edit.q" @input="onMemberSearch" class="inp" placeholder="搜尋要加入的品項（名稱、品牌、型號）">
            <div v-if="edit.results.length" class="border rounded-lg mt-1 max-h-56 overflow-y-auto divide-y">
              <button v-for="it in edit.results" :key="it.id" class="block w-full text-left px-3 py-2 hover:bg-gray-50 active:bg-blue-50" @click="addMember(it)">
                <div class="flex justify-between gap-2">
                  <span class="min-w-0 break-words"><span class="text-xs text-gray-400">{{ catLabel(it.category) }}</span> {{ it.name }}</span>
                  <span class="shrink-0 text-gray-600">{{ fmt(it.unit_price) }} / {{ it.unit }}</span>
                </div>
              </button>
            </div>
            <p class="text-xs text-gray-400 mt-1">點品項即加入；已在套組裡的品項再點一次，數量會 +1。</p>
          </div>
        </div>
        <p v-if="editError" class="text-sm text-red-600 mt-3">{{ editError }}</p>
        <div class="flex justify-end gap-2 mt-5">
          <button class="btn" @click="edit = null">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="saveEdit">儲存</button>
        </div>
      </div>
    </div>
  </div>
  `,
};
