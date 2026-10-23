import { store, api, toast, fmt, dateStr, STATUS, STATUS_CLASS, QUOTE_STATUS, QUOTE_STATUS_CLASS, PAY_TYPE, PAY_METHOD } from '../store.js';

const { ref, computed, onMounted } = Vue;

export default {
  name: 'ProjectsPage',
  props: ['id'],
  setup(props) {
    const statusOptions = Object.entries(STATUS).map(([value, label]) => ({ value, label }));

    // 列表
    const list = ref([]);
    const total = ref(0);
    const limit = 50;
    const offset = ref(0);
    const q = ref('');
    const statusFilter = ref('');
    const loading = ref(false);
    // 詳情
    const detail = ref(null);
    // 彈窗
    const np = ref(null);
    const npError = ref('');
    const edit = ref(null);
    const editError = ref('');

    let timer = null;
    function onSearch() { clearTimeout(timer); timer = setTimeout(reload, 300); }
    function reload() { offset.value = 0; load(); }
    function page(dir) { offset.value = Math.max(0, offset.value + dir * limit); load(); }

    async function load() {
      loading.value = true;
      try {
        const p = new URLSearchParams({ limit, offset: offset.value });
        if (q.value.trim()) p.set('q', q.value.trim());
        if (statusFilter.value) p.set('status', statusFilter.value);
        const data = await api('/api/projects?' + p);
        list.value = data.projects;
        total.value = data.total;
      } catch (e) { toast(e.message); }
      loading.value = false;
    }

    async function loadDetail() {
      try { detail.value = await api('/api/projects/' + props.id); }
      catch (e) { toast(e.message); }
    }

    async function changeStatus(ev) {
      try {
        await api('/api/projects/' + props.id, { method: 'PATCH', body: JSON.stringify({ status: ev.target.value }) });
        toast('狀態已更新');
        await loadDetail();
      } catch (e) { toast(e.message); await loadDetail(); }
    }

    // ───── 報價：新增空白報價，或把某一版複製為新版本 ─────
    async function newQuote(copyFrom) {
      try {
        const r = await api('/api/projects/' + props.id + '/quotes', {
          method: 'POST', body: JSON.stringify(copyFrom ? { copy_from: copyFrom } : {}),
        });
        location.hash = '#/quotes/' + r.id;
      } catch (e) { toast(e.message); }
    }

    // ───── 收款 ─────
    const isAdmin = computed(() => store.user && store.user.role === 'admin');
    const pay = ref(null);
    const payError = ref('');
    const paying = ref(false);

    const todayTW = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const activePayments = computed(() => (detail.value ? detail.value.payments.filter((p) => !p.voided) : []));

    // 已收齊但案件還沒標記已結清時，提示一鍵結清（不會自動改狀態）
    const showSettle = computed(() => {
      if (!detail.value) return false;
      const s = detail.value.summary;
      return s.outstanding !== null && s.outstanding <= 0 && s.paid_total > 0 && detail.value.project.status !== 'settled';
    });

    function openPay() {
      payError.value = '';
      const s = detail.value.summary;
      const hasPaid = activePayments.value.length > 0;
      pay.value = {
        type: hasPaid ? 'final' : 'deposit',
        amount: hasPaid && s.outstanding > 0 ? s.outstanding : '',
        paid_at: todayTW(),
        method: 'transfer',
        note: '',
      };
    }

    function receiptUrl(id) {
      return location.href.replace(/#.*$/, '').replace(/[^/]*$/, '') + 'receipt.html?p=' + id;
    }
    function openReceipt(id) { window.open(receiptUrl(id), '_blank'); }

    async function savePay() {
      payError.value = '';
      const p = pay.value;
      const amt = Math.round(Number(p.amount));
      if (!(amt > 0)) { payError.value = '請輸入大於 0 的金額'; return; }
      if (!p.paid_at) { payError.value = '請選擇收款日期'; return; }

      // 超過未收餘額：先讓使用者確認，確認後才帶 confirm_overpay 送出
      let confirmOver = false;
      const s = detail.value.summary;
      if (s.outstanding !== null && amt > s.outstanding) {
        const left = Math.max(s.outstanding, 0);
        if (!confirm(`這筆 ${fmt(amt)} 超過未收餘額 ${fmt(left)}，確定要登記嗎？`)) return;
        confirmOver = true;
      }

      paying.value = true;
      try {
        const res = await api('/api/projects/' + props.id + '/payments', {
          method: 'POST',
          body: JSON.stringify({ type: p.type, amount: amt, paid_at: p.paid_at, method: p.method, note: p.note, confirm_overpay: confirmOver }),
        });
        pay.value = null;
        toast('已登記收款，收據 ' + res.receipt_no);
        await loadDetail();
        if (confirm('收據 ' + res.receipt_no + ' 已開立，要現在列印嗎？')) openReceipt(res.id);
      } catch (e) { payError.value = e.message; }
      paying.value = false;
    }

    async function voidPay(pm) {
      const reason = prompt(`作廢收據 ${pm.receipt_no}（${fmt(pm.amount)}）\n請輸入作廢原因（必填）：`);
      if (reason === null) return;
      if (!reason.trim()) { toast('作廢原因必填'); return; }
      try {
        await api('/api/payments/' + pm.id + '/void', { method: 'POST', body: JSON.stringify({ reason }) });
        toast('已作廢');
        await loadDetail();
      } catch (e) { toast(e.message); }
    }

    async function markSettled() {
      try {
        await api('/api/projects/' + props.id, { method: 'PATCH', body: JSON.stringify({ status: 'settled' }) });
        toast('已標記為已結清');
        await loadDetail();
      } catch (e) { toast(e.message); }
    }

    // ───── 編輯案件資料 ─────
    function openEdit() {
      editError.value = '';
      const p = detail.value.project;
      edit.value = { name: p.name, site_address: p.site_address, note: p.note };
    }

    async function saveEdit() {
      editError.value = '';
      try {
        await api('/api/projects/' + props.id, { method: 'PATCH', body: JSON.stringify(edit.value) });
        edit.value = null;
        toast('已儲存');
        await loadDetail();
      } catch (e) { editError.value = e.message; }
    }

    // ───── 新增案件（可選既有客戶，或當場新增客戶） ─────
    function openNew() {
      npError.value = '';
      np.value = { customer: null, custQ: '', results: [], isNew: false, newName: '', newPhone: '', name: '', site_address: '' };
      searchCust();
    }

    let ctimer = null;
    function onCustSearch() { clearTimeout(ctimer); ctimer = setTimeout(searchCust, 250); }

    async function searchCust() {
      try {
        const p = new URLSearchParams({ limit: 8 });
        if (np.value.custQ.trim()) p.set('q', np.value.custQ.trim());
        np.value.results = (await api('/api/customers?' + p)).customers;
      } catch (e) { npError.value = e.message; }
    }

    async function createProject() {
      npError.value = '';
      const n = np.value;
      try {
        // 先檢查案件名稱，避免客戶建立了、案件卻失敗
        if (!n.name.trim()) throw new Error('案件名稱必填');
        if (n.isNew) {
          if (!n.newName.trim()) throw new Error('請輸入客戶名稱');
          const created = await api('/api/customers', {
            method: 'POST', body: JSON.stringify({ name: n.newName, phone: n.newPhone }),
          });
          n.customer = created.customer; // 若後面失敗，重試時沿用這位客戶，不會重複建立
          n.isNew = false;
        }
        if (!n.customer) throw new Error('請選擇或新增客戶');
        const res = await api('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ customer_id: n.customer.id, name: n.name, site_address: n.site_address }),
        });
        np.value = null;
        location.hash = '#/projects/' + res.id;
      } catch (e) { npError.value = e.message; }
    }

    onMounted(() => { if (props.id) loadDetail(); else load(); });

    return {
      list, total, limit, offset, q, statusFilter, loading, detail, np, npError, edit, editError, statusOptions,
      fmt, dateStr, STATUS, STATUS_CLASS, QUOTE_STATUS, QUOTE_STATUS_CLASS, PAY_TYPE, PAY_METHOD,
      onSearch, reload, page, changeStatus, openEdit, saveEdit, openNew, onCustSearch, createProject, newQuote,
      isAdmin, pay, payError, paying, showSettle, openPay, savePay, voidPay, openReceipt, markSettled,
    };
  },
  template: `
  <div>
    <!-- 列表 -->
    <div v-if="!id">
      <div class="flex flex-wrap gap-2 mb-3">
        <input class="inp md:w-96" v-model="q" @input="onSearch" placeholder="搜尋案件編號、案件名稱、客戶、地址">
        <select class="inp w-auto" v-model="statusFilter" @change="reload">
          <option value="">全部狀態</option>
          <option v-for="s in statusOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <button class="btn btn-primary md:ml-auto" @click="openNew">＋ 新增案件</button>
      </div>

      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <a v-for="p in list" :key="p.id" :href="'#/projects/' + p.id" class="card block hover:shadow">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-mono text-gray-500">{{ p.project_no }}</span>
            <span class="text-xs px-2 py-0.5 rounded-full" :class="STATUS_CLASS[p.status]">{{ STATUS[p.status] }}</span>
          </div>
          <div class="font-medium mt-1">{{ p.name }}</div>
          <div class="text-sm text-gray-500">{{ p.customer_name }}</div>
          <div class="grid grid-cols-3 gap-2 mt-2 text-xs text-gray-500">
            <div>報價<div class="text-sm text-gray-800">{{ p.adopted_total === null ? '—' : fmt(p.adopted_total) }}</div></div>
            <div>已收<div class="text-sm text-gray-800">{{ fmt(p.paid_total) }}</div></div>
            <div>未收<div class="text-sm" :class="p.outstanding > 0 ? 'text-red-600' : 'text-gray-800'">{{ p.outstanding === null ? '—' : fmt(p.outstanding) }}</div></div>
          </div>
        </a>
      </div>
      <p v-if="!list.length && !loading" class="text-center text-gray-400 py-10">沒有符合的案件</p>

      <div class="flex items-center justify-between mt-3 text-sm text-gray-600">
        <span>共 {{ total }} 件</span>
        <div class="flex items-center gap-2">
          <button class="btn" :disabled="offset === 0" @click="page(-1)">上一頁</button>
          <span>{{ Math.floor(offset / limit) + 1 }} / {{ Math.max(1, Math.ceil(total / limit)) }}</span>
          <button class="btn" :disabled="offset + limit >= total" @click="page(1)">下一頁</button>
        </div>
      </div>
    </div>

    <!-- 詳情 -->
    <div v-else-if="detail">
      <a href="#/projects" class="text-sm text-blue-600">← 案件列表</a>

      <div class="card mt-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-xs font-mono text-gray-500">{{ detail.project.project_no }}</div>
            <h2 class="text-lg font-bold break-words">{{ detail.project.name }}</h2>
          </div>
          <button class="btn shrink-0" @click="openEdit">編輯</button>
        </div>
        <div class="mt-2 flex items-center gap-2 text-sm">
          <span class="text-gray-500">狀態</span>
          <select class="inp w-auto" :value="detail.project.status" @change="changeStatus">
            <option v-for="s in statusOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </div>
        <dl class="mt-3 text-sm grid grid-cols-[5rem_1fr] gap-y-1">
          <dt class="text-gray-500">客戶</dt>
          <dd><a :href="'#/customers/' + detail.customer.id" class="text-blue-600">{{ detail.customer.name }}</a></dd>
          <dt class="text-gray-500">聯絡</dt>
          <dd>
            {{ detail.customer.contact }}
            <a v-if="detail.customer.phone" :href="'tel:' + detail.customer.phone" class="text-blue-600 ml-2">{{ detail.customer.phone }}</a>
          </dd>
          <dt class="text-gray-500">施工地址</dt><dd>{{ detail.project.site_address || '—' }}</dd>
          <dt class="text-gray-500">備註</dt><dd class="whitespace-pre-line">{{ detail.project.note || '—' }}</dd>
        </dl>
      </div>

      <div class="grid grid-cols-3 gap-2 mt-3 text-center">
        <div class="card"><div class="text-xs text-gray-500">採用版本總額</div>
          <div class="font-bold">{{ detail.summary.adopted_total === null ? '—' : fmt(detail.summary.adopted_total) }}</div></div>
        <div class="card"><div class="text-xs text-gray-500">已收</div>
          <div class="font-bold">{{ fmt(detail.summary.paid_total) }}</div></div>
        <div class="card"><div class="text-xs text-gray-500">未收</div>
          <div class="font-bold" :class="detail.summary.outstanding > 0 ? 'text-red-600' : ''">{{ detail.summary.outstanding === null ? '—' : fmt(detail.summary.outstanding) }}</div></div>
      </div>

      <div class="flex items-center justify-between mt-5 mb-2">
        <h3 class="font-bold">報價單（{{ detail.quotes.length }}）</h3>
        <button class="btn btn-primary" @click="newQuote()">＋ 新增報價</button>
      </div>
      <div class="space-y-2">
        <div v-for="qt in detail.quotes" :key="qt.id" class="card" :class="{ 'opacity-60': qt.status === 'void' }">
          <a :href="'#/quotes/' + qt.id" class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="font-mono text-sm">{{ qt.quote_no }}</div>
              <div class="text-xs text-gray-500 flex flex-wrap items-center gap-1 mt-0.5">
                <span class="px-2 py-0.5 rounded-full" :class="QUOTE_STATUS_CLASS[qt.status]">{{ QUOTE_STATUS[qt.status] }}</span>
                <span v-if="qt.is_adopted" class="text-green-700">✔ 採用中</span>
                <span>{{ dateStr(qt.created_at) }}</span>
              </div>
            </div>
            <div class="font-semibold shrink-0">{{ fmt(qt.total_amount) }}</div>
          </a>
          <button class="text-xs text-blue-600 mt-2" @click="newQuote(qt.id)">複製為新版本</button>
        </div>
        <p v-if="!detail.quotes.length" class="text-sm text-gray-400">尚無報價單，按「新增報價」開始</p>
      </div>

      <div class="flex items-center justify-between mt-5 mb-2">
        <h3 class="font-bold">收款記錄（{{ detail.payments.length }}）</h3>
        <button class="btn btn-primary" @click="openPay">＋ 新增收款</button>
      </div>

      <div v-if="showSettle" class="bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2 mb-2">
        <span>已收齊，要標記為「已結清」嗎？</span>
        <button class="btn" @click="markSettled">標記已結清</button>
      </div>

      <div class="space-y-2">
        <div v-for="pm in detail.payments" :key="pm.id" class="card">
          <div class="flex items-start justify-between gap-2" :class="{ 'opacity-50': pm.voided }">
            <div class="min-w-0">
              <div class="text-sm">{{ PAY_TYPE[pm.type] }}<span v-if="pm.voided" class="text-red-600 ml-1">（已作廢）</span></div>
              <div class="text-xs text-gray-500">{{ pm.paid_at }} · {{ PAY_METHOD[pm.method] }} · <span class="font-mono">{{ pm.receipt_no }}</span></div>
              <div v-if="pm.note" class="text-xs text-gray-500 mt-0.5 break-words">{{ pm.note }}</div>
              <div v-if="pm.voided && pm.void_reason" class="text-xs text-red-600 mt-0.5 break-words">作廢原因：{{ pm.void_reason }}</div>
            </div>
            <div class="font-semibold shrink-0" :class="{ 'line-through': pm.voided }">{{ fmt(pm.amount) }}</div>
          </div>
          <div class="flex gap-5 mt-2 text-sm">
            <button class="text-blue-600 py-1" @click="openReceipt(pm.id)">列印收據</button>
            <button v-if="isAdmin && !pm.voided" class="text-red-600 py-1" @click="voidPay(pm)">作廢</button>
          </div>
        </div>
        <p v-if="!detail.payments.length" class="text-sm text-gray-400">尚無收款記錄，按「新增收款」登記並開立收據</p>
      </div>
    </div>

    <!-- 新增收款 -->
    <div v-if="pay" class="modal-wrap" @click.self="pay = null">
      <div class="modal-box">
        <h2 class="text-lg font-bold mb-1">新增收款</h2>
        <p class="text-xs text-gray-500 mb-4">儲存後會同時開立收據，收據開立後不能修改，只能作廢重開。</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label>款項類型
            <select v-model="pay.type" class="inp mt-1">
              <option v-for="(label, key) in PAY_TYPE" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <label>付款方式
            <select v-model="pay.method" class="inp mt-1">
              <option v-for="(label, key) in PAY_METHOD" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <label>金額
            <input v-model="pay.amount" type="number" inputmode="numeric" min="1" class="inp mt-1">
          </label>
          <label>收款日期
            <input v-model="pay.paid_at" type="date" class="inp mt-1">
          </label>
          <label class="sm:col-span-2">備註（例：匯款帳號後五碼、支票號碼）
            <input v-model="pay.note" class="inp mt-1">
          </label>
        </div>
        <p v-if="detail.summary.outstanding !== null" class="text-xs text-gray-500 mt-3">
          採用版本總額 {{ fmt(detail.summary.adopted_total) }}，已收 {{ fmt(detail.summary.paid_total) }}，未收 {{ fmt(Math.max(detail.summary.outstanding, 0)) }}
        </p>
        <p v-else class="text-xs text-amber-600 mt-3">這個案件還沒有採用的報價版本，收款可以先登記，但「未收」要等採用版本後才會計算。</p>
        <p v-if="payError" class="text-sm text-red-600 mt-3">{{ payError }}</p>
        <div class="flex justify-end gap-2 mt-5">
          <button class="btn" @click="pay = null">取消</button>
          <button class="btn btn-primary" :disabled="paying" @click="savePay">儲存並開立收據</button>
        </div>
      </div>
    </div>

    <!-- 編輯案件 -->
    <div v-if="edit" class="modal-wrap" @click.self="edit = null">
      <div class="modal-box">
        <h2 class="text-lg font-bold mb-4">編輯案件</h2>
        <div class="grid gap-3 text-sm">
          <label>案件名稱 *<input v-model="edit.name" class="inp mt-1"></label>
          <label>施工地址<input v-model="edit.site_address" class="inp mt-1"></label>
          <label>備註<textarea v-model="edit.note" rows="4" class="inp mt-1"></textarea></label>
        </div>
        <p v-if="editError" class="text-sm text-red-600 mt-3">{{ editError }}</p>
        <div class="flex justify-end gap-2 mt-5">
          <button class="btn" @click="edit = null">取消</button>
          <button class="btn btn-primary" @click="saveEdit">儲存</button>
        </div>
      </div>
    </div>

    <!-- 新增案件 -->
    <div v-if="np" class="modal-wrap" @click.self="np = null">
      <div class="modal-box">
        <h2 class="text-lg font-bold mb-4">新增案件</h2>
        <div class="grid gap-3 text-sm">
          <div>
            <div class="mb-1">客戶 *</div>
            <div v-if="np.customer" class="flex items-center justify-between border rounded-lg px-3 py-2 bg-blue-50">
              <span>{{ np.customer.name }}</span>
              <button class="text-blue-600 text-sm" @click="np.customer = null; np.custQ = ''; onCustSearch()">更換</button>
            </div>
            <div v-else-if="np.isNew" class="space-y-2">
              <input v-model="np.newName" class="inp" placeholder="新客戶名稱 *">
              <input v-model="np.newPhone" type="tel" class="inp" placeholder="電話（可之後再補）">
              <button class="text-blue-600 text-sm" @click="np.isNew = false">改選既有客戶</button>
            </div>
            <div v-else>
              <input v-model="np.custQ" @input="onCustSearch" class="inp" placeholder="搜尋客戶名稱、電話">
              <div class="border rounded-lg mt-1 max-h-48 overflow-y-auto">
                <button v-for="c in np.results" :key="c.id" class="block w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-gray-50"
                        @click="np.customer = c">
                  {{ c.name }}<span class="text-xs text-gray-400 ml-2">{{ c.phone }}</span>
                </button>
                <div v-if="!np.results.length" class="px-3 py-2 text-gray-400">沒有符合的客戶</div>
              </div>
              <button class="text-blue-600 text-sm mt-2" @click="np.isNew = true">＋ 新客戶</button>
            </div>
          </div>
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
