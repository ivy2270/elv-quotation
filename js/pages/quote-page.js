import { store, api, toast, fmt, QUOTE_STATUS, QUOTE_STATUS_CLASS } from '../store.js';

const { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } = Vue;

const SECTIONS = [
  { key: 'equipment', label: '設備' },
  { key: 'labor', label: '安裝工資' },
];

let seq = 0;

export default {
  name: 'QuotePage',
  props: ['id'],
  setup(props) {
    const data = ref(null);
    const dirty = ref(false);
    const saving = ref(false);
    const picker = ref(null);

    const form = reactive({
      invoice_flag: false,
      valid_until: '',
      terms: '',
      note: '',
      show_discount_line: true,
      discount: 0,        // 折讓金額（差額），資料庫存的是這個
      finalInput: '',     // 使用者輸入的「議價後未稅金額」原始字串
      typedSubtotal: 0,   // 輸入議價金額當下的明細小計，用來偵測之後小計是否變動
      items: [],
    });

    const canCost = computed(() => !!store.user.can_see_cost);
    const editable = computed(() => !!data.value && data.value.quote.status === 'draft');

    // ───── 載入 / 填入表單 ─────
    const toLine = (it) => ({
      _k: ++seq, id: it.id || null, item_id: it.item_id || null, category: it.category,
      subcategory: it.subcategory || '', name: it.name || '', spec: it.spec || '', unit: it.unit || '式',
      qty: it.qty, unit_price: it.unit_price, cost_price: it.cost_price, note: it.note || '', open: false,
    });

    function fill(d) {
      data.value = d;
      const q = d.quote;
      form.invoice_flag = !!q.invoice_flag;
      form.valid_until = q.valid_until || '';
      form.terms = q.terms_snapshot || '';
      form.note = q.note || '';
      form.show_discount_line = !!q.show_discount_line;
      form.discount = q.discount_amount;
      form.typedSubtotal = q.subtotal;
      form.finalInput = q.discount_amount > 0 ? String(q.net_amount) : '';
      form.items = d.items.map(toLine);
      nextTick(() => (dirty.value = false));
    }

    async function load() {
      try { fill(await api('/api/quotes/' + props.id)); }
      catch (e) { toast(e.message); }
    }

    watch(form, () => { dirty.value = true; }, { deep: true });

    function warnLeave(e) {
      if (dirty.value && editable.value) { e.preventDefault(); e.returnValue = ''; }
    }
    onMounted(() => { window.addEventListener('beforeunload', warnLeave); load(); });
    onBeforeUnmount(() => window.removeEventListener('beforeunload', warnLeave));

    // ───── 計算（與後端同一套公式） ─────
    const lineAmount = (it) => Math.round((Number(it.qty) || 0) * (Number(it.unit_price) || 0));
    const linesOf = (cat) => form.items.filter((i) => i.category === cat);

    const sumEq = computed(() => linesOf('equipment').reduce((s, i) => s + lineAmount(i), 0));
    const sumLb = computed(() => linesOf('labor').reduce((s, i) => s + lineAmount(i), 0));
    const subtotal = computed(() => sumEq.value + sumLb.value);
    const net = computed(() => subtotal.value - form.discount);
    const tax = computed(() => (form.invoice_flag ? Math.round(net.value * 0.05) : 0));
    const total = computed(() => net.value + tax.value);
    const discountInvalid = computed(() => form.discount < 0 || form.discount > subtotal.value);
    const discountPct = computed(() =>
      form.discount > 0 && subtotal.value > 0 ? ((form.discount / subtotal.value) * 100).toFixed(1) : '');
    const subtotalChanged = computed(() => form.discount > 0 && subtotal.value !== form.typedSubtotal);

    // 輸入框顯示：有折讓時顯示目前的議價後金額（明細變動時會跟著變），否則顯示使用者輸入的字
    const finalShown = computed(() => (form.discount > 0 ? String(net.value) : form.finalInput));

    function onFinal(ev) {
      form.finalInput = ev.target.value;
      const v = form.finalInput.trim();
      if (v === '') form.discount = 0;
      else {
        const n = Math.round(Number(v));
        form.discount = Number.isFinite(n) ? subtotal.value - n : 0;
      }
      form.typedSubtotal = subtotal.value;
    }

    const costTotal = computed(() =>
      form.items.reduce((s, i) => s + Math.round((Number(i.qty) || 0) * (Number(i.cost_price) || 0)), 0));

    // 顯示用：草稿用即時計算，其他狀態用資料庫的值
    const T = computed(() => {
      if (editable.value || !data.value) {
        return { eq: sumEq.value, lb: sumLb.value, sub: subtotal.value, disc: form.discount, net: net.value, tax: tax.value, total: total.value };
      }
      const q = data.value.quote;
      return { eq: q.subtotal_equipment, lb: q.subtotal_labor, sub: q.subtotal, disc: q.discount_amount, net: q.net_amount, tax: q.tax_amount, total: q.total_amount };
    });

    const margin = computed(() => {
      if (!canCost.value) return null;
      if (!editable.value && data.value && data.value.margin) {
        const m = data.value.margin;
        return { cost: m.cost_total, gross: m.gross, rate: m.rate };
      }
      const gross = net.value - costTotal.value;
      return { cost: costTotal.value, gross, rate: net.value > 0 ? gross / net.value : null };
    });

    // ───── 明細操作 ─────
    function addBlank(category) {
      form.items.push(toLine({ category, qty: 1, unit_price: 0, unit: '式', cost_price: 0 }));
      form.items[form.items.length - 1].open = true;
    }

    function remove(it) { form.items.splice(form.items.indexOf(it), 1); }

    // 只在同一個分類內上下移動
    function move(it, dir) {
      const same = form.items.filter((i) => i.category === it.category);
      const j = same.indexOf(it) + dir;
      if (j < 0 || j >= same.length) return;
      const a = form.items.indexOf(it);
      const b = form.items.indexOf(same[j]);
      [form.items[a], form.items[b]] = [form.items[b], form.items[a]];
    }

    // ───── 品項搜尋帶入 ─────
    function openPicker(category) {
      picker.value = { category, mode: 'items', q: '', results: [], mult: {}, loading: false, added: 0 };
      searchPicker();
    }

    function setPickerMode(mode) {
      picker.value.mode = mode;
      picker.value.results = [];
      searchPicker();
    }

    let ptimer = null;
    function onPickerSearch() { clearTimeout(ptimer); ptimer = setTimeout(searchPicker, 250); }

    async function searchPicker() {
      const p = picker.value;
      if (!p) return;
      p.loading = true;
      try {
        const qs = new URLSearchParams({ limit: 30 });
        if (p.q.trim()) qs.set('q', p.q.trim());
        if (p.mode === 'bundles') {
          p.results = (await api('/api/bundles?' + qs)).bundles;
        } else {
          qs.set('category', p.category);
          p.results = (await api('/api/items?' + qs)).items;
        }
      } catch (e) { toast(e.message); }
      p.loading = false;
    }

    // 套組：依套數展開成一般明細行（設備與工資各自進對應的區塊），之後每一行都能照常修改
    async function addBundle(b) {
      const p = picker.value;
      const m = Number(p.mult[b.id] || 1);
      if (!(m > 0)) { toast('套數必須大於 0'); return; }
      try {
        const r = await api('/api/bundles/' + b.id + '/expand?multiplier=' + encodeURIComponent(m));
        for (const l of r.lines) form.items.push(toLine({ ...l, cost_price: l.cost_price ?? 0 }));
        p.added += r.lines.length;
        toast(`已加入「${r.bundle.name}」${r.lines.length} 項` + (r.skipped.length ? `；略過已停用：${r.skipped.join('、')}` : ''));
      } catch (e) { toast(e.message); }
    }

    function addFromItem(it) {
      // 名稱、規格、單價都是複製一份，之後品項庫調價不會影響這份報價
      form.items.push(toLine({
        category: it.category, item_id: it.id, subcategory: it.subcategory, name: it.name, spec: it.spec,
        unit: it.unit, qty: 1, unit_price: it.unit_price, cost_price: it.cost_price ?? 0,
      }));
      picker.value.added += 1;
    }

    // ───── 儲存 / 送出 ─────
    function payload() {
      return {
        invoice_flag: form.invoice_flag,
        valid_until: form.valid_until,
        terms: form.terms,
        note: form.note,
        show_discount_line: form.show_discount_line,
        discount_amount: form.discount,
        items: form.items.map((it) => ({
          id: it.id, item_id: it.item_id, category: it.category, subcategory: it.subcategory,
          name: it.name, spec: it.spec, unit: it.unit, qty: Number(it.qty) || 0,
          unit_price: Number(it.unit_price) || 0, note: it.note,
          ...(canCost.value ? { cost_price: Number(it.cost_price) || 0 } : {}),
        })),
      };
    }

    function check() {
      if (discountInvalid.value) { toast('議價後金額不能高於明細小計'); return false; }
      const bad = form.items.findIndex((i) => !i.name.trim());
      if (bad >= 0) { toast('有明細缺少品名，請填寫或刪除'); return false; }
      return true;
    }

    async function save(quiet) {
      if (!check()) return false;
      saving.value = true;
      try {
        fill(await api('/api/quotes/' + props.id, { method: 'PUT', body: JSON.stringify(payload()) }));
        if (!quiet) toast('已儲存');
        saving.value = false;
        return true;
      } catch (e) { toast(e.message); }
      saving.value = false;
      return false;
    }

    async function send() {
      if (!form.items.length) { toast('請先加入明細'); return; }
      if (!confirm('送出後這份報價單會鎖定，無法再修改（要修改請複製為新版本）。確定送出？')) return;
      if (!(await save(true))) return;
      try {
        fill(await api('/api/quotes/' + props.id + '/send', { method: 'POST', body: '{}' }));
        toast('已送出並鎖定');
      } catch (e) { toast(e.message); }
    }

    async function deleteDraft() {
      if (!confirm('確定刪除這份草稿？')) return;
      try {
        const r = await api('/api/quotes/' + props.id, { method: 'DELETE' });
        dirty.value = false;
        location.hash = '#/projects/' + r.project_id;
      } catch (e) { toast(e.message); }
    }

    // ───── 已送出後的操作 ─────
    async function copyNew() {
      try {
        const r = await api('/api/projects/' + data.value.quote.project_id + '/quotes', {
          method: 'POST', body: JSON.stringify({ copy_from: Number(props.id) }),
        });
        location.hash = '#/quotes/' + r.id;
      } catch (e) { toast(e.message); }
    }

    // ───── 客戶版面：預覽、列印 / PDF、分享連結 ─────
    // share.html 和主程式放在同一個資料夾，所以用目前網址推出它的位置
    function viewUrl(query) {
      return location.href.replace(/#.*$/, '').replace(/[^/]*$/, '') + 'share.html?' + query;
    }

    function openView() { window.open(viewUrl('q=' + props.id), '_blank'); }

    async function previewDraft() {
      if (dirty.value && !(await save(true))) return; // 先儲存，預覽才會是最新內容
      openView();
    }

    async function copyLink() {
      const url = viewUrl('t=' + data.value.quote.share_token);
      try {
        await navigator.clipboard.writeText(url);
        toast('已複製分享連結');
      } catch { prompt('請複製這個連結', url); }
    }

    async function toggleShare() {
      const on = !data.value.quote.share_enabled;
      if (!on && !confirm('停用後，客戶用這個連結會看不到報價單。確定停用？')) return;
      try {
        fill(await api('/api/quotes/' + props.id + '/share', { method: 'POST', body: JSON.stringify({ enabled: on }) }));
        toast(on ? '分享連結已啟用' : '分享連結已停用');
      } catch (e) { toast(e.message); }
    }

    async function adopt() {
      if (!confirm('採用這個版本？客戶的應收金額會以這一版的總額為準。')) return;
      try {
        await api('/api/projects/' + data.value.quote.project_id + '/adopt', {
          method: 'POST', body: JSON.stringify({ quote_id: Number(props.id) }),
        });
        toast('已採用此版本');
        await load();
      } catch (e) { toast(e.message); }
    }

    async function voidQuote() {
      if (!confirm('確定作廢這個版本？')) return;
      try {
        fill(await api('/api/quotes/' + props.id + '/void', { method: 'POST', body: '{}' }));
        toast('已作廢');
      } catch (e) { toast(e.message); }
    }

    return {
      data, form, dirty, saving, picker, editable, canCost, sections: SECTIONS,
      fmt, QUOTE_STATUS, QUOTE_STATUS_CLASS,
      lineAmount, linesOf, sumEq, sumLb, subtotal, discountInvalid, discountPct, subtotalChanged, finalShown, T, margin,
      onFinal, addBlank, remove, move, openPicker, setPickerMode, onPickerSearch, addFromItem, addBundle,
      save, send, deleteDraft, copyNew, adopt, voidQuote,
      openView, previewDraft, copyLink, toggleShare,
    };
  },
  template: `
  <div v-if="data" class="pb-28">
    <a :href="'#/projects/' + data.quote.project_id" class="text-sm text-blue-600">← {{ data.quote.project_no }} {{ data.quote.project_name }}</a>

    <!-- 表頭 -->
    <div class="card mt-2">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="font-mono text-lg font-bold">{{ data.quote.quote_no }}</div>
          <div class="text-sm text-gray-500">{{ data.quote.customer_name }} · {{ data.quote.project_name }}</div>
        </div>
        <div class="text-right shrink-0">
          <span class="text-xs px-2 py-0.5 rounded-full" :class="QUOTE_STATUS_CLASS[data.quote.status]">{{ QUOTE_STATUS[data.quote.status] }}</span>
          <div v-if="data.quote.is_adopted" class="text-xs text-green-700 mt-1">✔ 採用中</div>
          <div v-if="editable && dirty" class="text-xs text-amber-600 mt-1">尚未儲存</div>
        </div>
      </div>
      <div v-if="!editable" class="flex flex-wrap gap-2 mt-3">
        <button class="btn" @click="openView">列印 / PDF</button>
        <button v-if="data.quote.share_token" class="btn" @click="copyLink">複製分享連結</button>
        <button class="btn" @click="copyNew">複製為新版本</button>
        <button v-if="(data.quote.status === 'sent' || data.quote.status === 'accepted') && !data.quote.is_adopted"
                class="btn btn-primary" @click="adopt">採用此版本</button>
        <button v-if="data.quote.status === 'sent' || data.quote.status === 'accepted'" class="btn text-red-600" @click="voidQuote">作廢</button>
      </div>
      <p v-if="!editable && data.quote.share_token" class="text-xs text-gray-500 mt-2">
        分享連結：{{ data.quote.share_enabled ? '啟用中' : '已停用' }}
        <button class="text-blue-600 ml-1" @click="toggleShare">{{ data.quote.share_enabled ? '停用' : '重新啟用' }}</button>
      </p>
      <p v-if="!editable && data.quote.status !== 'void'" class="text-xs text-gray-400 mt-1">已鎖定，不能直接修改；需要調整請「複製為新版本」。</p>
      <div v-if="editable" class="mt-3 flex items-center gap-5">
        <button class="text-sm text-blue-600 py-1" @click="previewDraft">預覽客戶版面</button>
        <button class="text-sm text-red-600 py-1" @click="deleteDraft">刪除此草稿</button>
      </div>
    </div>

    <!-- 明細：設備 / 安裝工資 -->
    <section v-for="sec in sections" :key="sec.key" class="mt-5">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 class="font-bold">{{ sec.label }}（小計 {{ fmt(sec.key === 'equipment' ? T.eq : T.lb) }}）</h3>
        <div v-if="editable" class="flex gap-2">
          <button class="btn" @click="openPicker(sec.key)">＋ 從品項庫加入</button>
          <button class="btn" @click="addBlank(sec.key)">＋ 自訂</button>
        </div>
      </div>

      <div class="space-y-2">
        <template v-if="editable">
          <div v-for="it in linesOf(sec.key)" :key="it._k" class="card">
            <div class="flex items-start gap-2">
              <div class="flex-1 min-w-0 space-y-2">
                <input v-model="it.name" class="inp" placeholder="品名">
                <div class="grid grid-cols-3 md:grid-cols-4 gap-2">
                  <label class="text-xs text-gray-500">數量
                    <input v-model="it.qty" type="number" inputmode="decimal" min="0" step="any" class="inp"></label>
                  <label class="text-xs text-gray-500">單位
                    <input v-model="it.unit" class="inp"></label>
                  <label class="text-xs text-gray-500">單價
                    <input v-model="it.unit_price" type="number" inputmode="numeric" min="0" class="inp"></label>
                  <div class="text-xs text-gray-500 col-span-3 md:col-span-1">金額
                    <div class="text-base font-semibold text-gray-800 pt-1">{{ fmt(lineAmount(it)) }}</div></div>
                </div>
              </div>
              <div class="flex flex-col text-gray-500">
                <button class="px-2 py-1" @click="move(it, -1)" aria-label="上移">↑</button>
                <button class="px-2 py-1" @click="move(it, 1)" aria-label="下移">↓</button>
                <button class="px-2 py-1 text-red-500" @click="remove(it)" aria-label="刪除">✕</button>
              </div>
            </div>
            <button class="text-xs text-blue-600 mt-2" @click="it.open = !it.open">{{ it.open ? '收合' : '類別 / 規格 / 備註' }}</button>
            <div v-if="it.open" class="mt-2 space-y-2">
              <input v-model="it.subcategory" class="inp" placeholder="類別（例：DVR、Camera）">
              <textarea v-model="it.spec" rows="3" class="inp" placeholder="規格說明（可多行）"></textarea>
              <input v-model="it.note" class="inp" placeholder="備註">
              <label v-if="canCost" class="text-xs text-gray-500 block">成本單價（內部，客戶看不到）
                <input v-model="it.cost_price" type="number" inputmode="numeric" min="0" class="inp"></label>
            </div>
            <div v-else-if="it.spec" class="text-xs text-gray-500 mt-1 line-clamp-2 whitespace-pre-line">{{ it.spec }}</div>
          </div>
        </template>

        <template v-else>
          <div v-for="it in linesOf(sec.key)" :key="it._k" class="card">
            <div class="flex justify-between gap-2">
              <div class="min-w-0">
                <div v-if="it.subcategory" class="text-xs text-gray-500">{{ it.subcategory }}</div>
                <div class="font-medium break-words">{{ it.name }}</div>
              </div>
              <div class="font-semibold shrink-0">{{ fmt(lineAmount(it)) }}</div>
            </div>
            <div class="text-xs text-gray-500">{{ it.qty }} {{ it.unit }} × {{ fmt(it.unit_price) }}</div>
            <div v-if="it.spec" class="text-xs text-gray-500 whitespace-pre-line mt-1">{{ it.spec }}</div>
            <div v-if="it.note" class="text-xs text-gray-400 mt-1">備註：{{ it.note }}</div>
          </div>
        </template>

        <p v-if="!linesOf(sec.key).length" class="text-sm text-gray-400">尚無{{ sec.label }}項目</p>
      </div>
    </section>

    <!-- 報價資訊 -->
    <div class="card mt-5 space-y-3 text-sm">
      <h3 class="font-bold">報價資訊</h3>
      <label class="block">有效期限
        <input v-model="form.valid_until" type="date" :disabled="!editable" class="inp mt-1 md:w-60"></label>
      <label class="block">條款 / 備註說明（客戶看得到）
        <textarea v-model="form.terms" rows="4" :disabled="!editable" class="inp mt-1" placeholder="例：付款方式、保固、施工時程…"></textarea></label>
      <label class="block">內部備註（客戶看不到）
        <input v-model="form.note" :disabled="!editable" class="inp mt-1"></label>
    </div>

    <!-- 金額 -->
    <div class="card mt-5 text-sm">
      <h3 class="font-bold mb-2">金額</h3>
      <div class="space-y-1">
        <div class="flex justify-between"><span class="text-gray-500">設備小計</span><span>{{ fmt(T.eq) }}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">工資小計</span><span>{{ fmt(T.lb) }}</span></div>
        <div class="flex justify-between border-t pt-1"><span class="text-gray-500">明細小計</span><span>{{ fmt(T.sub) }}</span></div>
      </div>

      <div v-if="editable" class="mt-3">
        <label class="block">議價後未稅金額（不用折讓就留空）
          <input :value="finalShown" @input="onFinal" type="number" inputmode="numeric" min="0" class="inp mt-1 md:w-60" :placeholder="String(T.sub)"></label>
        <p v-if="discountInvalid" class="text-red-600 text-xs mt-1">議價後金額不能高於明細小計</p>
        <p v-else-if="T.disc > 0" class="text-xs text-gray-500 mt-1">折讓 −{{ fmt(T.disc) }}（約 {{ discountPct }}%）</p>
        <p v-if="subtotalChanged && !discountInvalid" class="text-xs text-amber-600 mt-1">
          ⚠ 明細小計已變動：折讓金額固定為 {{ fmt(T.disc) }}，議價後金額現在是 {{ fmt(T.net) }}。若要維持原本的議價金額，請重新輸入。
        </p>
        <label class="flex items-center gap-2 mt-3"><input type="checkbox" v-model="form.show_discount_line"> 給客戶的報價單顯示折讓那一行</label>
        <label class="flex items-center gap-2 mt-2"><input type="checkbox" v-model="form.invoice_flag"> 開立發票（加 5% 營業稅）</label>
      </div>
      <div v-else class="mt-1 space-y-1">
        <div v-if="T.disc > 0" class="flex justify-between"><span class="text-gray-500">折讓</span><span>−{{ fmt(T.disc) }}</span></div>
      </div>

      <div class="space-y-1 mt-3 border-t pt-2">
        <div class="flex justify-between"><span class="text-gray-500">未稅金額</span><span>{{ fmt(T.net) }}</span></div>
        <div v-if="(editable ? form.invoice_flag : data.quote.invoice_flag)" class="flex justify-between">
          <span class="text-gray-500">營業稅 5%</span><span>{{ fmt(T.tax) }}</span></div>
        <div v-else class="flex justify-between text-gray-400"><span>不開發票（未加稅）</span><span></span></div>
        <div class="flex justify-between text-lg font-bold pt-1"><span>總計</span><span>{{ fmt(T.total) }}</span></div>
      </div>

      <div v-if="margin" class="mt-3 border-t pt-2 text-xs text-gray-500 space-y-1">
        <div class="font-medium text-gray-600">內部：成本與毛利（客戶看不到）</div>
        <div class="flex justify-between"><span>成本合計</span><span>{{ fmt(margin.cost) }}</span></div>
        <div class="flex justify-between"><span>毛利（未稅金額 − 成本）</span><span>{{ fmt(margin.gross) }}</span></div>
        <div class="flex justify-between"><span>毛利率</span><span>{{ margin.rate === null ? '—' : (margin.rate * 100).toFixed(1) + '%' }}</span></div>
      </div>
    </div>

    <!-- 固定在底部：總計與儲存 -->
    <div v-if="editable" class="sticky-bar bg-white border-t">
      <div class="max-w-7xl mx-auto px-3 md:px-4 py-2 flex items-center gap-2">
        <div class="mr-auto">
          <div class="text-xs text-gray-500">總計<span v-if="dirty" class="text-amber-600 ml-1">（未儲存）</span></div>
          <div class="text-lg font-bold leading-tight">{{ fmt(T.total) }}</div>
        </div>
        <button class="btn" :disabled="saving" @click="save(false)">儲存</button>
        <button class="btn btn-primary" :disabled="saving" @click="send">送出報價</button>
      </div>
    </div>

    <!-- 品項搜尋（手機全螢幕） -->
    <div v-if="picker" class="modal-wrap" @click.self="picker = null">
      <div class="modal-box flex flex-col">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-bold">{{ picker.mode === 'bundles' ? '加入套組' : '加入' + (picker.category === 'equipment' ? '設備' : '安裝工資') }}</h2>
          <button class="btn btn-primary" @click="picker = null">完成{{ picker.added ? '（已加 ' + picker.added + '）' : '' }}</button>
        </div>
        <div class="flex gap-2 mb-2">
          <button class="btn flex-1" :class="{ 'btn-primary': picker.mode === 'items' }" @click="setPickerMode('items')">品項</button>
          <button class="btn flex-1" :class="{ 'btn-primary': picker.mode === 'bundles' }" @click="setPickerMode('bundles')">套組</button>
        </div>
        <input v-model="picker.q" @input="onPickerSearch" class="inp"
               :placeholder="picker.mode === 'bundles' ? '搜尋套組名稱' : '搜尋名稱、品牌、型號、類別（可輸入多個關鍵字）'">
        <div class="mt-3 flex-1 overflow-y-auto divide-y border rounded-lg">
          <template v-if="picker.mode === 'items'">
          <button v-for="it in picker.results" :key="it.id" class="block w-full text-left px-3 py-3 hover:bg-gray-50 active:bg-blue-50"
                  @click="addFromItem(it)">
            <div class="flex justify-between gap-3">
              <div class="min-w-0">
                <div class="text-xs text-gray-500">{{ it.subcategory }}<span v-if="it.brand"> · {{ it.brand }} {{ it.model }}</span></div>
                <div class="font-medium break-words">{{ it.name }}</div>
              </div>
              <div class="text-right shrink-0">
                <div class="font-semibold">{{ fmt(it.unit_price) }}</div>
                <div class="text-xs text-gray-500">/ {{ it.unit }}</div>
              </div>
            </div>
          </button>
          </template>

          <template v-else>
            <div v-for="b in picker.results" :key="b.id" class="px-3 py-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="font-medium break-words">{{ b.name }}</div>
                  <div class="text-xs text-gray-500">{{ b.item_count }} 個品項 · 成員合計 {{ fmt(b.price_sum) }}<span v-if="b.note"> · {{ b.note }}</span></div>
                </div>
                <div class="flex items-end gap-2 shrink-0">
                  <label class="text-xs text-gray-500">套數
                    <input v-model="picker.mult[b.id]" type="number" inputmode="decimal" min="0" step="any" placeholder="1" class="inp w-16 px-2 py-1"></label>
                  <button class="btn btn-primary" @click="addBundle(b)">加入</button>
                </div>
              </div>
            </div>
          </template>

          <p v-if="!picker.results.length && !picker.loading" class="px-3 py-6 text-center text-gray-400">{{ picker.mode === 'bundles' ? '沒有符合的套組' : '沒有符合的品項' }}</p>
        </div>
        <p class="text-xs text-gray-400 mt-2">品項：點一下就加入一項。套組：先填套數（預設 1），再按「加入」。可連續加入，加完按「完成」。</p>
      </div>
    </div>
  </div>
  `,
};
