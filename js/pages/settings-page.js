import { store, api, toast } from '../store.js';

const { ref, reactive, computed, onMounted } = Vue;

const FIELDS = ['name', 'tax_id', 'owner', 'contact', 'phone', 'email', 'address', 'bank_name', 'bank_branch', 'bank_account', 'bank_holder'];

export default {
  name: 'SettingsPage',
  setup() {
    const isAdmin = computed(() => store.user && store.user.role === 'admin');
    const form = reactive({
      company: Object.fromEntries(FIELDS.map((f) => [f, ''])),
      stamp: '',
      stampChanged: false,
      default_terms: '',
      validity_days: 30,
    });
    const saving = ref(false);
    const error = ref('');

    async function load() {
      try {
        const s = await api('/api/settings');
        for (const f of FIELDS) form.company[f] = (s.company && s.company[f]) || '';
        form.stamp = (s.company && s.company.stamp) || '';
        form.stampChanged = false;
        form.default_terms = s.default_terms || '';
        form.validity_days = s.validity_days;
      } catch (e) { toast(e.message); }
    }

    // 印章圖片：在瀏覽器先縮小成不超過 300px 的 PNG，檔案才不會太大
    async function onStamp(ev) {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      error.value = '';
      try {
        const bmp = await createImageBitmap(file);
        for (const max of [300, 220, 160]) {
          const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(bmp.width * scale));
          c.height = Math.max(1, Math.round(bmp.height * scale));
          c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/png');
          if (url.length <= 140000) { form.stamp = url; form.stampChanged = true; return; }
        }
        error.value = '這張圖片太複雜，縮小後仍然太大，請換一張（建議去背的簡單印章圖）';
      } catch { error.value = '無法讀取這個圖片檔'; }
    }

    function clearStamp() { form.stamp = ''; form.stampChanged = true; }

    async function save() {
      error.value = '';
      saving.value = true;
      try {
        const company = { ...form.company };
        if (form.stampChanged) company.stamp = form.stamp; // 沒更換印章就不傳，沿用原本的
        await api('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            company,
            default_terms: form.default_terms,
            validity_days: Number(form.validity_days) || 0,
          }),
        });
        toast('設定已儲存');
        await load();
      } catch (e) { error.value = e.message; }
      saving.value = false;
    }

    onMounted(load);
    return { isAdmin, form, saving, error, onStamp, clearStamp, save };
  },
  template: `
  <div>
    <h2 class="text-lg font-bold mb-3">設定</h2>
    <p v-if="!isAdmin" class="text-gray-500">只有管理者可以修改設定。</p>
    <div v-else class="space-y-4">
      <div class="card">
        <h3 class="font-bold mb-3">公司資訊（會印在報價單上）</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label class="sm:col-span-2">公司抬頭<input v-model="form.company.name" class="inp mt-1"></label>
          <label>統編（8 碼）<input v-model="form.company.tax_id" inputmode="numeric" maxlength="8" class="inp mt-1"></label>
          <label>負責人<input v-model="form.company.owner" class="inp mt-1"></label>
          <label>聯絡人<input v-model="form.company.contact" class="inp mt-1"></label>
          <label>電話<input v-model="form.company.phone" type="tel" class="inp mt-1"></label>
          <label class="sm:col-span-2">Email<input v-model="form.company.email" type="email" class="inp mt-1"></label>
          <label class="sm:col-span-2">地址<input v-model="form.company.address" class="inp mt-1"></label>
        </div>
      </div>

      <div class="card">
        <h3 class="font-bold mb-3">匯款資訊</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label>銀行<input v-model="form.company.bank_name" class="inp mt-1"></label>
          <label>分行<input v-model="form.company.bank_branch" class="inp mt-1"></label>
          <label>帳號<input v-model="form.company.bank_account" inputmode="numeric" class="inp mt-1"></label>
          <label>戶名<input v-model="form.company.bank_holder" class="inp mt-1"></label>
        </div>
      </div>

      <div class="card">
        <h3 class="font-bold mb-3">公司印章</h3>
        <div class="flex items-center gap-4">
          <div class="w-28 h-28 border rounded-lg flex items-center justify-center bg-gray-50 overflow-hidden">
            <img v-if="form.stamp" :src="form.stamp" class="max-w-full max-h-full object-contain" alt="">
            <span v-else class="text-xs text-gray-400">尚未設定</span>
          </div>
          <div class="text-sm space-y-2">
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="onStamp">
            <div><button v-if="form.stamp" class="text-red-600" @click="clearStamp">移除印章</button></div>
            <p class="text-xs text-gray-500">建議使用去背的 PNG。系統會自動縮小。更換印章只影響之後送出的報價單，已送出的版本維持當時的印章。</p>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="font-bold mb-3">新報價單的預設值</h3>
        <div class="grid gap-3 text-sm">
          <label>預設有效天數（0 = 不預設）
            <input v-model="form.validity_days" type="number" inputmode="numeric" min="0" max="365" class="inp mt-1 md:w-40"></label>
          <label>預設條款 / 說明事項
            <textarea v-model="form.default_terms" rows="6" class="inp mt-1" placeholder="例：1. 付款方式：簽約付 50% 訂金，完工驗收後付尾款&#10;2. 保固：…"></textarea></label>
        </div>
        <p class="text-xs text-gray-500 mt-2">只影響「新增的空白報價」；複製出來的新版本沿用原本內容。</p>
      </div>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <button class="btn btn-primary" :disabled="saving" @click="save">儲存設定</button>
    </div>
  </div>
  `,
};
