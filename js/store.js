import { CONFIG } from '../config.js';

const { reactive } = Vue;

export const store = reactive({
  token: localStorage.getItem('quote_token') || '',
  user: null,
  toast: '',
});

let toastTimer;
export function toast(msg) {
  store.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (store.toast = ''), 2500);
}

export function setSession(token, user) {
  store.token = token;
  store.user = user;
  localStorage.setItem('quote_token', token);
}

export function logout() {
  store.token = '';
  store.user = null;
  localStorage.removeItem('quote_token');
}

export async function api(path, opts = {}) {
  const res = await fetch(CONFIG.API_BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(store.token ? { Authorization: 'Bearer ' + store.token } : {}),
      ...(opts.headers || {}),
    },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 回應 */
  }
  if (res.status === 401 && store.token) {
    logout();
    throw new Error((data && data.error) || '請重新登入');
  }
  if (!res.ok) throw new Error((data && data.error) || `發生錯誤（${res.status}）`);
  return data;
}

export const fmt = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('zh-TW'));

// 資料庫存的是 UTC 時間，顯示成台灣日期
export const dateStr = (s) =>
  s ? new Date(String(s).replace(' ', 'T') + 'Z').toLocaleDateString('zh-TW') : '';

export const STATUS = {
  negotiating: '洽談中',
  won: '已成交',
  in_progress: '施工中',
  completed: '已完工',
  settled: '已結清',
  lost: '未成交',
};

export const STATUS_CLASS = {
  negotiating: 'bg-gray-100 text-gray-700',
  won: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  settled: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-red-100 text-red-700',
};

export const QUOTE_STATUS = { draft: '草稿', sent: '已送出', accepted: '已接受', void: '作廢' };
export const QUOTE_STATUS_CLASS = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  void: 'bg-red-100 text-red-700',
};
export const PAY_TYPE = { deposit: '訂金', milestone: '期中款', final: '尾款', extra: '追加款' };
export const PAY_METHOD = { cash: '現金', transfer: '匯款', check: '支票', other: '其他' };
