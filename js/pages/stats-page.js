import { store, api, toast, fmt, STATUS, STATUS_CLASS, PAY_TYPE, PAY_METHOD } from '../store.js';

const { ref, reactive, computed, onMounted } = Vue;

const pct = (x) => (x === null || x === undefined ? '—' : (x * 100).toFixed(1) + '%');

// 圖上的金額縮寫：12,500 → 1.3萬
function short(v) {
  if (!v) return '';
  if (v >= 100000) return Math.round(v / 10000) + '萬';
  if (v >= 10000) return (v / 10000).toFixed(1) + '萬';
  return String(v);
}

function saveXlsx(rows, sheet, file) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, file);
}

function periodRange(p) {
  if (p === 'all') return {};
  const t = new Date(Date.now() + 8 * 3600 * 1000); // 台灣時間
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (p === 'month') return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
  return { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(new Date(Date.UTC(y, 11, 31))) };
}

export default {
  name: 'StatsPage',
  setup() {
    const canCost = computed(() => !!(store.user && store.user.can_see_cost));
    const tabs = computed(() => {
      const t = [
        { key: 'receivables', label: '應收帳款' },
        { key: 'payments', label: '月收款' },
        { key: 'pipeline', label: '成交與報價' },
        { key: 'followups', label: '待跟進' },
      ];
      if (canCost.value) t.push({ key: 'margin', label: '預估毛利' });
      return t;
    });

    const tab = ref('receivables');
    const overview = ref(null);
    const recv = ref(null);
    const pay = ref(null);
    const pipe = ref(null);
    const fu = ref(null);
    const margin = ref(null);
    const loaded = reactive({});

    const sortBy = ref('days');
    const period = ref('month');
    const payDetail = ref(null);

    const sortedRecv = computed(() => {
      if (!recv.value) return [];
      const rows = [...recv.value.rows];
      if (sortBy.value === 'amount') rows.sort((a, b) => b.outstanding - a.outstanding);
      return rows; // 預設就是依天數由多到少
    });

    const maxMonth = computed(() => (pay.value ? Math.max(1, ...pay.value.months.map((m) => m.total)) : 1));
    const barH = (v) => Math.round((v / maxMonth.value) * 72); // 最高的長條佔 72%，留空間給上下的文字
    const monthsDesc = computed(() => (pay.value ? [...pay.value.months].reverse() : []));

    const loaders = {
      async receivables() { recv.value = await api('/api/stats/receivables'); },
      async payments() { pay.value = await api('/api/stats/payments?months=12'); },
      async pipeline() {
        const r = periodRange(period.value);
        const p = new URLSearchParams();
        if (r.from) { p.set('from', r.from); p.set('to', r.to); }
        pipe.value = await api('/api/stats/pipeline?' + p);
      },
      async followups() { fu.value = await api('/api/stats/followups'); },
      async margin() { margin.value = await api('/api/stats/margin'); },
    };

    async function setTab(t) {
      tab.value = t;
      if (loaded[t]) return;
      try { await loaders[t](); loaded[t] = true; }
      catch (e) { toast(e.message); }
    }

    async function setPeriod(p) {
      period.value = p;
      try { await loaders.pipeline(); loaded.pipeline = true; }
      catch (e) { toast(e.message); }
    }

    async function refresh() {
      for (const k of Object.keys(loaded)) delete loaded[k];
      try { overview.value = await api('/api/stats/overview'); } catch (e) { toast(e.message); }
      await setTab(tab.value);
    }

    // ───── 月收款：當月明細與匯出 ─────
    async function openMonth(month) {
      try { payDetail.value = await api('/api/stats/payments/month?month=' + month); }
      catch (e) { toast(e.message); }
    }

    function receiptUrl(id) {
      return location.href.replace(/#.*$/, '').replace(/[^/]*$/, '') + 'receipt.html?p=' + id;
    }

    function exportMonths() {
      const rows = pay.value.months.map((m) => ({
        月份: m.month, 合計: m.total, 筆數: m.count,
        訂金: m.by_type.deposit, 期中款: m.by_type.milestone, 尾款: m.by_type.final, 追加款: m.by_type.extra,
        現金: m.by_method.cash, 匯款: m.by_method.transfer, 支票: m.by_method.check, 其他: m.by_method.other,
      }));
      saveXlsx(rows, '月收款彙總', '月收款彙總.xlsx');
    }

    function exportDetail() {
      const d = payDetail.value;
      const rows = d.receipts.map((r) => ({
        收據編號: r.receipt_no, 收款日期: r.paid_at, 客戶: r.customer_name, 案件編號: r.project_no, 案件: r.project_name,
        款項類型: PAY_TYPE[r.type], 付款方式: PAY_METHOD[r.method], 金額: r.amount, 狀態: r.voided ? '已作廢' : '有效', 備註: r.note,
      }));
      saveXlsx(rows, d.month, `收款明細_${d.month}.xlsx`);
    }

    onMounted(async () => {
      try { overview.value = await api('/api/stats/overview'); } catch (e) { toast(e.message); }
      await setTab('receivables');
    });

    return {
      tabs, tab, overview, recv, pay, pipe, fu, margin, sortBy, period, payDetail, sortedRecv, monthsDesc, canCost,
      fmt, pct, short, barH, STATUS, STATUS_CLASS, PAY_TYPE, PAY_METHOD,
      setTab, setPeriod, refresh, openMonth, receiptUrl, exportMonths, exportDetail,
    };
  },
  template: `
  <div>
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-bold">統計</h2>
      <button class="btn" @click="refresh">重新整理</button>
    </div>

    <!-- 總覽 -->
    <div v-if="overview" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <button class="card text-left" @click="setTab('payments')">
        <div class="text-xs text-gray-500">{{ overview.month }} 已收</div>
        <div class="text-xl font-bold mt-1">{{ fmt(overview.month_paid) }}</div>
      </button>
      <button class="card text-left" @click="setTab('receivables')">
        <div class="text-xs text-gray-500">應收總額（{{ overview.receivable_count }} 件）</div>
        <div class="text-xl font-bold mt-1" :class="overview.receivable_total > 0 ? 'text-red-600' : ''">{{ fmt(overview.receivable_total) }}</div>
        <div v-if="overview.overdue_count" class="text-xs text-red-600 mt-0.5">{{ overview.overdue_count }} 件逾期</div>
      </button>
      <button class="card text-left" @click="setTab('pipeline')">
        <div class="text-xs text-gray-500">洽談中報價（{{ overview.pipeline_count }} 件）</div>
        <div class="text-xl font-bold mt-1">{{ fmt(overview.pipeline_amount) }}</div>
      </button>
      <button class="card text-left" @click="setTab('followups')">
        <div class="text-xs text-gray-500">待跟進</div>
        <div class="text-xl font-bold mt-1" :class="overview.followup_count ? 'text-amber-600' : ''">{{ overview.followup_count }} 件</div>
      </button>
    </div>

    <!-- 分頁 -->
    <div class="flex gap-5 border-b mb-4 text-sm overflow-x-auto whitespace-nowrap">
      <button v-for="t in tabs" :key="t.key" class="pb-2" @click="setTab(t.key)"
              :class="tab === t.key ? 'border-b-2 border-blue-600 text-blue-600 font-medium' : 'text-gray-500'">{{ t.label }}</button>
    </div>

    <!-- 應收帳款 -->
    <div v-if="tab === 'receivables' && recv">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div class="text-sm text-gray-600">共 {{ recv.rows.length }} 件，未收合計 <b class="text-gray-900">{{ fmt(recv.total) }}</b></div>
        <div class="flex gap-2">
          <button class="btn" :class="{ 'btn-primary': sortBy === 'days' }" @click="sortBy = 'days'">依天數</button>
          <button class="btn" :class="{ 'btn-primary': sortBy === 'amount' }" @click="sortBy = 'amount'">依金額</button>
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <a v-for="r in sortedRecv" :key="r.project_id" :href="'#/projects/' + r.project_id" class="card block hover:shadow">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-mono text-gray-500">{{ r.project_no }}</span>
            <span class="text-xs px-2 py-0.5 rounded-full" :class="STATUS_CLASS[r.status]">{{ STATUS[r.status] }}</span>
          </div>
          <div class="font-medium mt-1 break-words">{{ r.project_name }}</div>
          <div class="text-sm text-gray-500">{{ r.customer_name }}</div>
          <div class="flex items-end justify-between mt-2">
            <div>
              <div class="text-xs text-gray-500">未收</div>
              <div class="text-lg font-bold text-red-600">{{ fmt(r.outstanding) }}</div>
            </div>
            <div class="text-right text-xs text-gray-500">
              <div>總額 {{ fmt(r.adopted_total) }}</div>
              <div>已收 {{ fmt(r.paid_total) }}</div>
            </div>
          </div>
          <div class="text-xs mt-2" :class="r.days > recv.overdue_days ? 'text-red-600 font-medium' : 'text-gray-500'">
            距{{ r.ref_kind === 'paid' ? '上次收款' : '採用日' }} {{ r.days }} 天<span v-if="r.days > recv.overdue_days">（逾期）</span>
          </div>
        </a>
      </div>
      <p v-if="!recv.rows.length" class="text-center text-gray-400 py-10">目前沒有未收的案件</p>

      <div v-if="recv.overpaid.length" class="mt-6">
        <h3 class="font-bold text-sm mb-2">多收（已收超過採用版本總額）</h3>
        <div class="space-y-2">
          <a v-for="r in recv.overpaid" :key="r.project_id" :href="'#/projects/' + r.project_id" class="card flex items-center justify-between gap-2">
            <div class="min-w-0"><div class="text-xs font-mono text-gray-500">{{ r.project_no }}</div>
              <div class="break-words">{{ r.project_name }}　<span class="text-gray-500 text-sm">{{ r.customer_name }}</span></div></div>
            <div class="text-amber-600 font-semibold shrink-0">多收 {{ fmt(-r.outstanding) }}</div>
          </a>
        </div>
      </div>
      <p class="text-xs text-gray-400 mt-4">只列有採用版本、且未成交以外的案件；帳齡從上次收款日算起，沒收過款則從採用日算起，超過 {{ recv.overdue_days }} 天標為逾期。</p>
    </div>

    <!-- 月收款 -->
    <div v-if="tab === 'payments' && pay">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div class="text-sm text-gray-600">近 12 個月實收合計 <b class="text-gray-900">{{ fmt(pay.grand_total) }}</b></div>
        <button class="btn" @click="exportMonths">匯出月彙總 Excel</button>
      </div>

      <div class="card">
        <div class="flex items-end gap-1 h-44">
          <button v-for="m in pay.months" :key="m.month" class="flex-1 min-w-0 flex flex-col items-center justify-end h-full" @click="openMonth(m.month)">
            <div class="text-[10px] text-gray-500 leading-none mb-0.5">{{ short(m.total) }}</div>
            <div class="w-full max-w-[28px] bg-blue-500 rounded-t" :style="{ height: barH(m.total) + '%', minHeight: m.total ? '2px' : '0' }"></div>
            <div class="text-[10px] text-gray-500 mt-1">{{ m.month.slice(5) }}</div>
          </button>
        </div>
        <p class="text-xs text-gray-400 mt-2">點長條或下方的月份，可看當月每一張收據。</p>
      </div>

      <!-- 電腦：表格 -->
      <div class="hidden md:block bg-white rounded-lg shadow overflow-x-auto mt-3">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-right">
            <tr><th class="px-3 py-2 text-left">月份</th><th class="px-3 py-2">合計</th><th class="px-3 py-2">筆數</th>
              <th class="px-3 py-2">訂金</th><th class="px-3 py-2">期中款</th><th class="px-3 py-2">尾款</th><th class="px-3 py-2">追加款</th>
              <th class="px-3 py-2">現金</th><th class="px-3 py-2">匯款</th><th class="px-3 py-2">支票</th></tr>
          </thead>
          <tbody>
            <tr v-for="m in monthsDesc" :key="m.month" class="border-t text-right hover:bg-gray-50 cursor-pointer" @click="openMonth(m.month)">
              <td class="px-3 py-2 text-left font-mono">{{ m.month }}<span v-if="m.voided_count" class="text-xs text-red-500 ml-1">（作廢 {{ m.voided_count }}）</span></td>
              <td class="px-3 py-2 font-semibold">{{ fmt(m.total) }}</td><td class="px-3 py-2">{{ m.count }}</td>
              <td class="px-3 py-2">{{ fmt(m.by_type.deposit) }}</td><td class="px-3 py-2">{{ fmt(m.by_type.milestone) }}</td>
              <td class="px-3 py-2">{{ fmt(m.by_type.final) }}</td><td class="px-3 py-2">{{ fmt(m.by_type.extra) }}</td>
              <td class="px-3 py-2">{{ fmt(m.by_method.cash) }}</td><td class="px-3 py-2">{{ fmt(m.by_method.transfer) }}</td>
              <td class="px-3 py-2">{{ fmt(m.by_method.check) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 手機：卡片 -->
      <div class="md:hidden space-y-2 mt-3">
        <button v-for="m in monthsDesc" :key="m.month" class="card w-full text-left" @click="openMonth(m.month)">
          <div class="flex items-center justify-between">
            <span class="font-mono">{{ m.month }}<span v-if="m.voided_count" class="text-xs text-red-500 ml-1">（作廢 {{ m.voided_count }}）</span></span>
            <span class="font-semibold">{{ fmt(m.total) }}</span>
          </div>
          <div class="text-xs text-gray-500 mt-1">{{ m.count }} 筆 · 訂金 {{ fmt(m.by_type.deposit) }} · 期中 {{ fmt(m.by_type.milestone) }} · 尾款 {{ fmt(m.by_type.final) }} · 追加 {{ fmt(m.by_type.extra) }}</div>
        </button>
      </div>
      <p class="text-xs text-gray-400 mt-3">統計的是實收金額；有開發票的案件，收款金額已含 5% 營業稅，不另外拆稅。已作廢的收據不計入。</p>
    </div>

    <!-- 成交與報價 -->
    <div v-if="tab === 'pipeline' && pipe">
      <div class="flex gap-2 mb-3">
        <button class="btn" :class="{ 'btn-primary': period === 'month' }" @click="setPeriod('month')">本月</button>
        <button class="btn" :class="{ 'btn-primary': period === 'year' }" @click="setPeriod('year')">今年</button>
        <button class="btn" :class="{ 'btn-primary': period === 'all' }" @click="setPeriod('all')">全部</button>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="card"><div class="text-xs text-gray-500">期間新增案件</div><div class="text-xl font-bold mt-1">{{ pipe.period.new_projects }}</div></div>
        <div class="card"><div class="text-xs text-gray-500">其中成交 / 未成交 / 洽談中</div>
          <div class="text-lg font-bold mt-1">{{ pipe.period.won }} / {{ pipe.period.lost }} / {{ pipe.period.open }}</div></div>
        <div class="card"><div class="text-xs text-gray-500">成交率</div><div class="text-xl font-bold mt-1">{{ pct(pipe.period.win_rate) }}</div></div>
        <div class="card"><div class="text-xs text-gray-500">期間成交 {{ pipe.period.adopted_count }} 件</div>
          <div class="text-lg font-bold mt-1">{{ fmt(pipe.period.adopted_net) }}</div><div class="text-xs text-gray-500">未稅（含稅 {{ fmt(pipe.period.adopted_total) }}）</div></div>
      </div>
      <p class="text-xs text-gray-400 mt-2">成交率 = 成交 ÷（成交 + 未成交），洽談中不計入；前三項依「案件建立日」落在期間內的案件計算。成交金額依「採用日」歸期間。</p>

      <h3 class="font-bold mt-5 mb-2">各狀態案件</h3>
      <div class="bg-white rounded-lg shadow overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100"><tr><th class="px-3 py-2 text-left">狀態</th><th class="px-3 py-2 text-right">件數</th><th class="px-3 py-2 text-right">金額（含稅）</th></tr></thead>
          <tbody>
            <tr v-for="s in pipe.statuses" :key="s.status" class="border-t">
              <td class="px-3 py-2"><span class="text-xs px-2 py-0.5 rounded-full" :class="STATUS_CLASS[s.status]">{{ STATUS[s.status] }}</span></td>
              <td class="px-3 py-2 text-right">{{ s.count }}</td><td class="px-3 py-2 text-right">{{ fmt(s.amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-gray-400 mt-2">洽談中、未成交的金額，是該案件「最新一版已送出報價」的總額；其他狀態是採用版本的總額。這張表不受上方期間影響。</p>

      <h3 class="font-bold mt-5 mb-2">近 12 個月成交金額（依採用日）</h3>
      <div class="bg-white rounded-lg shadow overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100"><tr><th class="px-3 py-2 text-left">月份</th><th class="px-3 py-2 text-right">件數</th><th class="px-3 py-2 text-right">未稅</th><th class="px-3 py-2 text-right">含稅</th></tr></thead>
          <tbody>
            <tr v-for="m in [...pipe.monthly].reverse()" :key="m.month" class="border-t">
              <td class="px-3 py-2 font-mono">{{ m.month }}</td><td class="px-3 py-2 text-right">{{ m.count }}</td>
              <td class="px-3 py-2 text-right">{{ fmt(m.net) }}</td><td class="px-3 py-2 text-right">{{ fmt(m.total) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 待跟進 -->
    <div v-if="tab === 'followups' && fu">
      <p class="text-sm text-gray-600 mb-3">案件洽談中、最新一版報價已送出超過 {{ fu.followup_days }} 天，還沒有被採用，也沒有新版本。</p>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div v-for="r in fu.rows" :key="r.quote_id" class="card">
          <a :href="'#/projects/' + r.project_id" class="block">
            <div class="text-xs font-mono text-gray-500">{{ r.project_no }}</div>
            <div class="font-medium break-words">{{ r.project_name }}</div>
            <div class="text-sm text-gray-500">{{ r.customer_name }}</div>
          </a>
          <div class="flex items-center justify-between mt-2">
            <a :href="'#/quotes/' + r.quote_id" class="text-sm text-blue-600 font-mono">{{ r.quote_no }}</a>
            <span class="font-semibold">{{ fmt(r.total_amount) }}</span>
          </div>
          <div class="text-xs text-amber-600 mt-1">已送出 {{ r.days_since }} 天</div>
        </div>
      </div>
      <p v-if="!fu.rows.length" class="text-center text-gray-400 py-10">目前沒有需要跟進的報價</p>
    </div>

    <!-- 預估毛利 -->
    <div v-if="tab === 'margin' && margin">
      <div class="bg-amber-50 text-amber-800 text-xs rounded-lg px-3 py-2 mb-3">
        這是「預估」毛利：未稅金額減去報價當時的成本，不包含施工時實際追加的材料、外包或工時。成交依採用日歸月份。
      </div>

      <div class="bg-white rounded-lg shadow overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-right">
            <tr><th class="px-3 py-2 text-left">月份</th><th class="px-3 py-2">件數</th><th class="px-3 py-2">未稅金額</th><th class="px-3 py-2">成本</th><th class="px-3 py-2">毛利</th><th class="px-3 py-2">毛利率</th></tr>
          </thead>
          <tbody>
            <tr v-for="m in [...margin.months].reverse()" :key="m.month" class="border-t text-right">
              <td class="px-3 py-2 text-left font-mono">{{ m.month }}</td><td class="px-3 py-2">{{ m.count }}</td>
              <td class="px-3 py-2">{{ fmt(m.net) }}</td><td class="px-3 py-2">{{ fmt(m.cost) }}</td>
              <td class="px-3 py-2 font-semibold">{{ fmt(m.gross) }}</td><td class="px-3 py-2">{{ pct(m.rate) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 class="font-bold mt-5 mb-2">成交案件（最近 100 件）</h3>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <a v-for="p in margin.projects" :key="p.project_id" :href="'#/projects/' + p.project_id" class="card block hover:shadow">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-mono text-gray-500">{{ p.project_no }}</span>
            <span class="text-xs text-gray-500">{{ p.adopted_date }}</span>
          </div>
          <div class="font-medium break-words">{{ p.project_name }}</div>
          <div class="text-sm text-gray-500">{{ p.customer_name }}</div>
          <div class="grid grid-cols-3 gap-2 mt-2 text-xs text-gray-500">
            <div>未稅<div class="text-sm text-gray-800">{{ fmt(p.net_amount) }}</div></div>
            <div>成本<div class="text-sm text-gray-800">{{ fmt(p.cost_total) }}</div></div>
            <div>毛利<div class="text-sm text-gray-800">{{ fmt(p.gross) }}（{{ pct(p.rate) }}）</div></div>
          </div>
          <div v-if="p.no_cost_lines" class="text-xs text-amber-600 mt-2">⚠ 有 {{ p.no_cost_lines }} 項明細沒有成本，毛利可能偏高</div>
        </a>
      </div>
    </div>

    <!-- 當月收據明細 -->
    <div v-if="payDetail" class="modal-wrap" @click.self="payDetail = null">
      <div class="modal-box">
        <div class="flex items-center justify-between mb-1">
          <h2 class="text-lg font-bold">{{ payDetail.month }} 收款明細</h2>
          <button class="btn" @click="payDetail = null">關閉</button>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div class="text-sm text-gray-600">有效合計 <b class="text-gray-900">{{ fmt(payDetail.total) }}</b>（{{ payDetail.receipts.filter(r => !r.voided).length }} 張）</div>
          <button class="btn" @click="exportDetail">匯出 Excel</button>
        </div>
        <div class="space-y-2">
          <div v-for="r in payDetail.receipts" :key="r.id" class="card" :class="{ 'opacity-50': r.voided }">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-sm"><span class="font-mono">{{ r.receipt_no }}</span><span v-if="r.voided" class="text-red-600 ml-1">（已作廢）</span></div>
                <div class="text-xs text-gray-500">{{ r.paid_at }} · {{ PAY_TYPE[r.type] }} · {{ PAY_METHOD[r.method] }}</div>
                <div class="text-sm break-words">{{ r.customer_name }}　<span class="text-gray-500">{{ r.project_name }}</span></div>
              </div>
              <div class="font-semibold shrink-0" :class="{ 'line-through': r.voided }">{{ fmt(r.amount) }}</div>
            </div>
            <a :href="receiptUrl(r.id)" target="_blank" class="text-xs text-blue-600 mt-1 inline-block">列印收據</a>
          </div>
          <p v-if="!payDetail.receipts.length" class="text-center text-gray-400 py-8">這個月沒有收款</p>
        </div>
      </div>
    </div>
  </div>
  `,
};
