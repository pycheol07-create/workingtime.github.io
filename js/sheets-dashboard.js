// === js/sheets-dashboard.js ===
// 📊 업무 시트 대시보드 — 여러 비공개 구글 시트(첫 탭)를 Apps Script Web App으로 읽어
// 요약/정리해서 보여주는 별도 페이지. 설정은 Firestore 단일 문서에 저장(동기화).

import { initializeFirebase } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { resolvePeriodRange, inDateRange } from './lib/calc.js';
import { showConfirm } from './utils.js';

const { db, auth } = initializeFirebase();
const CONFIG_REF = doc(db, 'artifacts', 'team-work-logger-v2', 'config', 'sheetDashboard');
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분 (수동 새로고침으로 즉시 갱신 가능)

let config = { scriptUrl: '', sheets: [] };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function extractSheetId(url) {
    if (!url) return '';
    const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : String(url).trim();
}

// ───────── 인증 게이트 ─────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        $('auth-gate').classList.remove('hidden');
        $('main').classList.add('hidden');
        return;
    }
    $('auth-gate').classList.add('hidden');
    $('main').classList.remove('hidden');
    await loadConfig();
    renderAll();
    loadFxRate().then(rerenderKpiCards); // 환율 로드되면 ₩ 반영해 KPI 다시 렌더
});

// ───────── 설정 로드/저장 (Firestore) ─────────
async function loadConfig() {
    try {
        const snap = await getDoc(CONFIG_REF);
        if (snap.exists()) {
            const d = snap.data();
            config = { scriptUrl: d.scriptUrl || '', sheets: Array.isArray(d.sheets) ? d.sheets : [] };
        }
    } catch (e) { console.warn('설정 로드 실패:', e); }
}
async function saveConfig() {
    try { await setDoc(CONFIG_REF, config); }
    catch (e) { alert('설정 저장 실패: ' + e.message); }
}

// ───────── Apps Script fetch (+ localStorage 캐시) ─────────
async function fetchSheet(sheetId, force) {
    if (!config.scriptUrl) throw new Error('Apps Script URL이 설정되지 않았습니다. (⚙️ 설정)');
    const cacheKey = 'sheetdash_' + sheetId;
    if (!force) {
        try {
            const c = JSON.parse(localStorage.getItem(cacheKey) || 'null');
            if (c && Date.now() - c.at < CACHE_TTL_MS && c.data) return c.data;
        } catch (_) {}
    }
    const url = config.scriptUrl + (config.scriptUrl.includes('?') ? '&' : '?') + 'id=' + encodeURIComponent(sheetId);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '읽기 실패');
    try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: json })); } catch (_) {}
    return json;
}

// ───────── 숫자 컬럼 감지 + 합계 ─────────
const parseNum = (v) => {
    if (typeof v === 'number') return v;
    let s = String(v == null ? '' : v).trim();
    if (!s || s === '-' || s.includes('#')) return null; // 빈칸, "$ -", #REF! 등
    const n = Number(s.replace(/[,\s$₩원]/g, ''));
    return isNaN(n) ? null : n;
};
const getTodayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
function numericColumns(headers, rows) {
    return headers.map((h, ci) => {
        let n = 0, ok = 0;
        rows.forEach(r => {
            const v = r[ci];
            if (v === '' || v == null) return;
            n++;
            if (parseNum(v) !== null) ok++;
        });
        return n >= 2 && ok / n >= 0.8; // 비어있지 않은 값의 80%+가 숫자면 숫자 컬럼
    });
}

// ───────── 주문/결제 장부 KPI (헤더명 자동 매핑) ─────────
const norm = (h) => String(h == null ? '' : h).replace(/[\s\n]/g, '');
const periodState = {}; // localId -> 'today'|'week'|'month'|'year'|'custom'
const periodRange = {}; // localId -> { from, to }  (custom 기간 조회용)

function detectOrderCols(headers) {
    const find = (pred) => { const i = (headers || []).findIndex(h => pred(norm(h))); return i < 0 ? null : i; };
    const idx = {
        date:    find(h => h.includes('일자') || h.includes('날짜')),
        reorder: find(h => h.includes('오더(리오더)')) ?? find(h => h.includes('리오더') && !h.includes('계약금')),
        newp:    find(h => h.includes('오더(신상)')) ?? find(h => h.includes('신상') && h.includes('오더') && !h.includes('계약금')),
        pay:     find(h => h.includes('결제') || h.includes('송금')),
        ship:    find(h => h.includes('출고예정금액') && h.includes('패킹')) ?? find(h => h.includes('출고예정금액')),
        unship:  find(h => h.includes('미출고') && h.includes('잔액')),
        pack:    (() => { const i = (headers||[]).findIndex(h => norm(h) === '패킹잔액'); return i < 0 ? find(h => h.includes('패킹잔액') && !h.includes('총')) : i; })()
    };
    const ok = idx.date != null && (idx.reorder != null || idx.newp != null || idx.pay != null);
    return ok ? idx : null;
}

// 기간 선택 드롭다운 옵션 (그룹별 전·현·후)
const PERIOD_GROUPS = [
    ['일', [['day:-1', '어제'], ['day:0', '오늘'], ['day:1', '내일']]],
    ['주', [['week:-1', '지난주'], ['week:0', '이번주'], ['week:1', '다음주']]],
    ['월', [['month:-1', '지난달'], ['month:0', '이번달'], ['month:1', '다음달']]],
    ['년', [['year:-1', '작년'], ['year:0', '올해'], ['year:1', '내년']]],
];
const periodLabelOf = (period) => {
    for (const [, items] of PERIOD_GROUPS) {
        const hit = items.find(([v]) => v === period);
        if (hit) return hit[1];
    }
    return '';
};

const fmtMoney = (n) => '$' + Math.round(n || 0).toLocaleString();
const fmtKrw = (n) => '₩' + Math.round(n || 0).toLocaleString();

// ───────── 환율 (USD→KRW, 자동, 6시간 캐시) ─────────
let usdKrw = null, fxUpdated = '';
async function loadFxRate() {
    const KEY = 'usdkrw_fx_v1', TTL = 6 * 60 * 60 * 1000;
    try {
        const c = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (c && Date.now() - c.at < TTL && c.rate) { usdKrw = c.rate; fxUpdated = c.upd || ''; return; }
    } catch (_) {}
    // 1차: open.er-api.com (무키/CORS)
    try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
        const j = await r.json();
        if (j && j.rates && j.rates.KRW) {
            usdKrw = j.rates.KRW;
            fxUpdated = j.time_last_update_unix ? (() => { const d = new Date(j.time_last_update_unix * 1000); return `${d.getMonth() + 1}/${d.getDate()}`; })() : '';
            try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rate: usdKrw, upd: fxUpdated })); } catch (_) {}
            return;
        }
    } catch (_) {}
    // 2차: jsdelivr currency-api
    try {
        const r = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', { cache: 'no-store' });
        const j = await r.json();
        if (j && j.usd && j.usd.krw) {
            usdKrw = j.usd.krw; fxUpdated = j.date ? j.date.slice(5).replace('-', '/') : '';
            try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rate: usdKrw, upd: fxUpdated })); } catch (_) {}
        }
    } catch (_) {}
}
// 환율 로드 후 KPI 카드들 다시 렌더(₩ 반영)
function rerenderKpiCards() {
    config.sheets.forEach(cfg => {
        const d = cardData[cfg.localId];
        if (!d) return;
        const ix = detectOrderCols(d.headers);
        if (ix) renderKpi(cfg, d, ix);
    });
}

// 선택 기간의 '날짜별 내역' 테이블 HTML (오더/결제/출고예정/미출고/패킹)
function buildDateBreakdown(rows, idx, inPeriod) {
    const dOf = (r) => String(r[idx.date] == null ? '' : r[idx.date]).slice(0, 10);
    const cols = [];
    if (idx.reorder != null || idx.newp != null) cols.push(['order', '오더', 'text-indigo-700']);
    if (idx.pay != null)    cols.push(['pay', '결제', 'text-emerald-700']);
    if (idx.ship != null)   cols.push(['ship', '출고예정', 'text-amber-700']);
    if (idx.unship != null) cols.push(['unship', '미출고', 'text-rose-600']);
    if (idx.pack != null)   cols.push(['pack', '패킹', 'text-slate-600']);

    const byDate = new Map();
    rows.forEach(r => {
        const d = dOf(r);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !inPeriod(r[idx.date])) return;
        const o = byDate.get(d) || { order: 0, pay: 0, ship: 0, unship: null, pack: null };
        if (idx.reorder != null) o.order += parseNum(r[idx.reorder]) || 0;
        if (idx.newp != null)    o.order += parseNum(r[idx.newp]) || 0;
        if (idx.pay != null)     o.pay   += parseNum(r[idx.pay]) || 0;
        if (idx.ship != null)    o.ship  += parseNum(r[idx.ship]) || 0;
        if (idx.unship != null)  { const v = parseNum(r[idx.unship]); if (v != null) o.unship = v; } // 잔액=스냅샷(마지막값)
        if (idx.pack != null)    { const v = parseNum(r[idx.pack]); if (v != null) o.pack = v; }
        byDate.set(d, o);
    });
    const dates = [...byDate.keys()].sort(); // 날짜 오름차순 (오래된 → 최신)
    if (dates.length === 0) return `<div class="p-4 text-center text-slate-400 text-sm">선택한 기간에 데이터가 없습니다.</div>`;

    const tot = { order: 0, pay: 0, ship: 0 };
    dates.forEach(d => { const o = byDate.get(d); tot.order += o.order; tot.pay += o.pay; tot.ship += o.ship; });

    const th = `<th class="px-2 py-1.5 text-left whitespace-nowrap">날짜</th>` +
        cols.map(([, l]) => `<th class="px-2 py-1.5 text-right whitespace-nowrap">${l}</th>`).join('');
    const trs = dates.map(d => {
        const o = byDate.get(d);
        const tds = cols.map(([k, , tone]) => {
            const v = o[k];
            return `<td class="num ${tone}">${v == null ? '<span class="text-slate-300">-</span>' : fmtMoney(v)}</td>`;
        }).join('');
        return `<tr><td class="font-bold text-slate-700 whitespace-nowrap">${esc(d)}</td>${tds}</tr>`;
    }).join('');
    const totTds = cols.map(([k, , tone]) =>
        (k === 'order' || k === 'pay' || k === 'ship')
            ? `<td class="num font-extrabold ${tone}">${fmtMoney(tot[k])}</td>`
            : `<td class="num text-slate-300">-</td>`
    ).join('');
    const totRow = `<tr style="background:#f1f5f9;"><td class="font-extrabold text-slate-600">합계</td>${totTds}</tr>`;

    return `<table class="data-table"><thead><tr>${th}</tr></thead><tbody>${trs}${totRow}</tbody></table>`;
}

function renderKpi(cfg, data, idx) {
    const body = $('body-' + cfg.localId);
    const summary = $('summary-' + cfg.localId);
    if (summary) summary.innerHTML = '';
    if ($('search-' + cfg.localId)) $('search-' + cfg.localId).style.display = 'none';
    const today = getTodayStr();
    const period = periodState[cfg.localId] || 'month:0';
    const rows = data.rows || [];
    const dOf = (r) => String(r[idx.date] == null ? '' : r[idx.date]).slice(0, 10);

    // 기간(custom) 기본 범위: 미설정 시 데이터의 최소~최대 날짜
    if (period === 'custom') {
        const c = periodRange[cfg.localId] || {};
        if (!c.from || !c.to) {
            const ds = rows.map(dOf).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
            periodRange[cfg.localId] = {
                from: c.from || ds[0] || (today.slice(0, 7) + '-01'),
                to:   c.to   || ds[ds.length - 1] || today
            };
        }
    }
    const range = period === 'custom' ? (periodRange[cfg.localId] || {}) : resolvePeriodRange(period, today);
    const inPeriod = (dStr) => inDateRange(dStr, range.from, range.to);

    const sumPeriod = (ci) => ci == null ? 0 : rows.reduce((a, r) => inPeriod(r[idx.date]) ? a + (parseNum(r[ci]) || 0) : a, 0);
    const reorder = sumPeriod(idx.reorder), newp = sumPeriod(idx.newp), pay = sumPeriod(idx.pay);
    const orderTotal = reorder + newp;

    // 현재 상태: 오늘 행(없으면 오늘 이하 최신 행)
    let cur = rows.find(r => dOf(r) === today);
    if (!cur) { const past = rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(dOf(r)) && dOf(r) <= today); cur = past[past.length - 1]; }
    const unship = cur && idx.unship != null ? (parseNum(cur[idx.unship]) || 0) : 0;
    const pack = cur && idx.pack != null ? (parseNum(cur[idx.pack]) || 0) : 0;
    const shipFuture = idx.ship == null ? 0 : rows.reduce((a, r) => { const d = dOf(r); return (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today) ? a + (parseNum(r[idx.ship]) || 0) : a; }, 0);

    // 기간 드롭다운 (일/주/월/년 그룹별 전·현·후 + 기간 지정)
    const optsHtml = PERIOD_GROUPS.map(([grp, items]) =>
        `<optgroup label="${grp}">` +
        items.map(([v, l]) => `<option value="${v}"${period === v ? ' selected' : ''}>${l}</option>`).join('') +
        `</optgroup>`
    ).join('') + `<option value="custom"${period === 'custom' ? ' selected' : ''}>기간 지정…</option>`;
    const pSelect = `<select data-period-sel="${cfg.localId}" class="text-xs font-bold border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-700 cursor-pointer">${optsHtml}</select>`;
    const rangeUI = `<span class="${period === 'custom' ? 'inline-flex' : 'hidden'} items-center gap-1 ml-1">
        <input type="date" data-range="${cfg.localId}:from" value="${range.from || ''}" class="text-xs border border-slate-300 rounded-md px-2 py-1">
        <span class="text-slate-400 text-xs">~</span>
        <input type="date" data-range="${cfg.localId}:to" value="${range.to || ''}" class="text-xs border border-slate-300 rounded-md px-2 py-1">
    </span>`;
    const rangeStr = range.from ? (range.from === range.to ? esc(range.from) : `${esc(range.from)} ~ ${esc(range.to || '')}`) : '';
    const periodLabel = period === 'custom'
        ? rangeStr
        : `${periodLabelOf(period)}${rangeStr ? ` · ${rangeStr}` : ''}`;

    const fxLine = (usd) => usdKrw ? `<div class="text-[12px] font-bold text-slate-500 mt-0.5">${fmtKrw(usd * usdKrw)}</div>` : '';
    const kcard = (label, usd, note, tone) => `<div class="rounded-xl border border-slate-200 p-3.5 bg-white"><div class="text-[11px] font-bold text-slate-400 mb-1">${label}</div><div class="text-xl font-extrabold ${tone || 'text-slate-800'}">${fmtMoney(usd)}</div>${fxLine(usd)}${note ? `<div class="text-[11px] text-slate-400 mt-0.5">${note}</div>` : ''}</div>`;
    const fxCap = usdKrw
        ? `<span class="text-[11px] text-slate-400 ml-auto">💱 1 USD ≈ ₩${Math.round(usdKrw).toLocaleString()}${fxUpdated ? ` · ${esc(fxUpdated)} 기준` : ''}</span>`
        : `<span class="text-[11px] text-slate-300 ml-auto">환율 불러오는 중…</span>`;

    const breakdownHtml = buildDateBreakdown(rows, idx, inPeriod);

    body.style.maxHeight = 'none';
    body.innerHTML = `
        <div class="p-4 space-y-4">
            <div class="flex items-center gap-1.5 flex-wrap"><span class="text-[11px] text-slate-400 mr-1">기간:</span>${pSelect}${rangeUI}${fxCap}</div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                ${kcard('오더 총합', orderTotal, '리오더 + 신상', 'text-indigo-700')}
                ${kcard('오더 (리오더)', reorder, '', 'text-slate-800')}
                ${kcard('오더 (신상)', newp, '', 'text-slate-800')}
                ${kcard('결제 (송금)', pay, '', 'text-emerald-700')}
            </div>
            <div class="text-[11px] font-bold text-slate-400 pt-1">현재 상태${cur ? ` · 기준일 ${esc(dOf(cur))}` : ''}</div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                ${kcard('출고 예정금액 (오늘 및 이후)', shipFuture, '', 'text-amber-700')}
                ${kcard('미출고 잔액', unship, '', 'text-rose-700')}
                ${kcard('패킹 잔액', pack, '', 'text-slate-800')}
            </div>
            <div class="pt-1">
                <div class="text-xs font-bold text-slate-500 mb-1.5">📅 날짜별 내역${periodLabel ? ` · ${periodLabel}` : ''}</div>
                <div class="overflow-auto border border-slate-200 rounded-lg" style="max-height:45vh;">${breakdownHtml}</div>
            </div>
            <details class="pt-1">
                <summary class="text-xs font-bold text-slate-500 cursor-pointer select-none">📋 원본 데이터 보기 (최근순)</summary>
                <div class="mt-2 overflow-auto border border-slate-200 rounded-lg" style="max-height:50vh;" id="rawtbl-${cfg.localId}"></div>
            </details>
        </div>`;
    renderRawTable(data, $('rawtbl-' + cfg.localId), idx.date);
}

function renderRawTable(data, mount, dateIdx) {
    if (!mount) return;
    const headers = data.headers || [], rows = data.rows || [];
    const isNum = numericColumns(headers, rows);
    // 날짜 컬럼 기준 최근 200행 (날짜 내림차순)
    let list = rows.slice();
    if (dateIdx != null) list = list.filter(r => String(r[dateIdx] || '').trim()).sort((a, b) => String(b[dateIdx]).localeCompare(String(a[dateIdx])));
    list = list.slice(0, 200);
    let html = '<table class="data-table"><thead><tr>';
    headers.forEach(h => { html += `<th>${esc(String(h).replace(/\n/g, ' '))}</th>`; });
    html += '</tr></thead><tbody>';
    list.forEach(r => { html += '<tr>' + headers.map((h, i) => `<td class="${isNum[i] ? 'num' : ''}">${esc(r[i])}</td>`).join('') + '</tr>'; });
    html += '</tbody></table>';
    mount.innerHTML = html;
}

// ───────── 질문형 조회 (규칙기반, 오프라인) ─────────
const PERIOD_KEYWORDS = [
    [/오늘|금일/, 'day:0'], [/어제|전일/, 'day:-1'], [/내일|익일/, 'day:1'],
    [/이번\s*주|금주|이주(?!일)/, 'week:0'], [/지난\s*주|저번\s*주|전주/, 'week:-1'], [/다음\s*주|차주|담주/, 'week:1'],
    [/이번\s*달|이달|금월|당월/, 'month:0'], [/지난\s*달|저번\s*달|전월/, 'month:-1'], [/다음\s*달|익월/, 'month:1'],
    [/올해|금년|당해/, 'year:0'], [/작년|전년/, 'year:-1'], [/내년|익년/, 'year:1'],
];
const detectPeriod = (q) => { for (const [re, p] of PERIOD_KEYWORDS) if (re.test(q)) return p; return 'month:0'; };

// 오더/결제 장부 시트에 대한 답변 (날짜×지표 집계)
function buildQnaAnswer(cfg, data, q) {
    const question = String(q || '').trim();
    const idx = detectOrderCols(data.headers);
    const period = detectPeriod(question);
    const range = resolvePeriodRange(period, getTodayStr());
    const inPeriod = (d) => inDateRange(d, range.from, range.to);
    const rangeStr = range.from === range.to ? range.from : `${range.from} ~ ${range.to || ''}`;
    const pLabel = periodLabelOf(period) || '';

    if (idx) {
        const cols = [];
        const has = (re) => re.test(question);
        if (has(/송금|결제|입금|지급/) && idx.pay != null) cols.push({ key: 'pay', ci: idx.pay, label: '송금(결제)' });
        if (has(/리오더/) && idx.reorder != null) cols.push({ key: 'reorder', ci: idx.reorder, label: '오더(리오더)' });
        if (has(/신상/) && idx.newp != null) cols.push({ key: 'newp', ci: idx.newp, label: '오더(신상)' });
        if (has(/오더|발주|주문/) && !cols.some(c => c.key === 'reorder' || c.key === 'newp')) {
            if (idx.reorder != null) cols.push({ key: 'reorder', ci: idx.reorder, label: '오더(리오더)' });
            if (idx.newp != null) cols.push({ key: 'newp', ci: idx.newp, label: '오더(신상)' });
        }
        if (has(/출고/) && !has(/미출고/) && idx.ship != null) cols.push({ key: 'ship', ci: idx.ship, label: '출고예정' });
        if (has(/미출고/) && idx.unship != null) cols.push({ key: 'unship', ci: idx.unship, label: '미출고 잔액' });
        if (has(/패킹/) && idx.pack != null) cols.push({ key: 'pack', ci: idx.pack, label: '패킹 잔액' });
        if (cols.length === 0) {
            if (idx.pay != null) cols.push({ key: 'pay', ci: idx.pay, label: '송금(결제)' });
            else if (idx.reorder != null) cols.push({ key: 'reorder', ci: idx.reorder, label: '오더(리오더)' });
        }

        const dOf = (r) => String(r[idx.date] == null ? '' : r[idx.date]).slice(0, 10);
        const byDate = new Map();
        (data.rows || []).forEach(r => {
            const d = dOf(r);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !inPeriod(r[idx.date])) return;
            const o = byDate.get(d) || {};
            cols.forEach(c => { o[c.key] = (o[c.key] || 0) + (parseNum(r[c.ci]) || 0); });
            byDate.set(d, o);
        });
        const dates = [...byDate.keys()].sort();
        const totals = {};
        cols.forEach(c => totals[c.key] = dates.reduce((s, d) => s + (byDate.get(d)[c.key] || 0), 0));
        const metricLabel = cols.map(c => c.label).join(', ');
        const headline = `<div class="text-xs font-bold text-slate-500">📌 ${esc(pLabel)}${rangeStr ? ` (${esc(rangeStr)})` : ''} · ${esc(metricLabel)}</div>`;

        if (dates.length === 0) {
            return `<div class="p-3">${headline}<div class="text-slate-400 text-sm mt-2">해당 기간에 데이터가 없습니다.</div></div>`;
        }
        const totalStr = cols.map(c => `<span class="inline-block mr-3"><span class="text-slate-500">${esc(c.label)}</span> <b class="text-emerald-700">${fmtMoney(totals[c.key])}</b>${usdKrw ? ` <span class="text-slate-400 text-xs">${fmtKrw(totals[c.key] * usdKrw)}</span>` : ''}</span>`).join('');
        const th = `<th class="px-2 py-1.5 text-left">날짜</th>` + cols.map(c => `<th class="px-2 py-1.5 text-right">${esc(c.label)}</th>`).join('');
        const trs = dates.map(d => {
            const o = byDate.get(d);
            return `<tr><td class="font-bold text-slate-700 whitespace-nowrap">${esc(d)}</td>` +
                cols.map(c => `<td class="num">${o[c.key] ? fmtMoney(o[c.key]) : '<span class="text-slate-300">-</span>'}</td>`).join('') + `</tr>`;
        }).join('');
        return `<div class="p-3 space-y-2">
            ${headline}
            <div class="text-base font-extrabold">${totalStr}</div>
            <div class="overflow-auto border border-slate-200 rounded-lg" style="max-height:40vh;">
                <table class="data-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
            </div>
        </div>`;
    }

    // 일반 시트: 날짜 컬럼 + 질문에 등장한 숫자 컬럼(헤더 일부 일치)로 기간 집계
    const headers = data.headers || [], rows = data.rows || [];
    const dateCi = headers.findIndex(h => /일자|날짜|date/i.test(norm(h)));
    const isNum = numericColumns(headers, rows);
    const matchedNumCols = headers.map((h, i) => ({ h, i }))
        .filter(({ h, i }) => isNum[i] && h && question.replace(/\s/g, '').includes(norm(h)));
    const useCols = matchedNumCols.length ? matchedNumCols : headers.map((h, i) => ({ h, i })).filter(({ i }) => isNum[i]);

    const inP = (r) => dateCi < 0 ? true : inDateRange(String(r[dateCi] == null ? '' : r[dateCi]).slice(0, 10), range.from, range.to);
    const filtered = rows.filter(inP);
    const headline = `<div class="text-xs font-bold text-slate-500">📌 ${esc(pLabel)}${rangeStr ? ` (${esc(rangeStr)})` : ''}${dateCi < 0 ? ' · (날짜 컬럼 없음 — 전체 기준)' : ''}</div>`;
    if (useCols.length === 0) {
        return `<div class="p-3">${headline}<div class="text-slate-400 text-sm mt-2">합계를 낼 숫자 컬럼을 찾지 못했습니다. 질문에 컬럼명을 포함해 보세요.</div></div>`;
    }
    const chips = useCols.map(({ h, i }) => {
        const sum = filtered.reduce((a, r) => a + (parseNum(r[i]) || 0), 0);
        return `<span class="text-sm px-2.5 py-1 rounded-full bg-amber-50 text-amber-800">${esc(h)} 합계 <b>${sum.toLocaleString()}</b></span>`;
    }).join(' ');
    return `<div class="p-3 space-y-2">${headline}<div class="flex flex-wrap gap-2">${chips}</div><div class="text-[11px] text-slate-400">해당 기간 ${filtered.length.toLocaleString()}행 기준</div></div>`;
}

function handleQna(localId) {
    const input = $('qna-input-' + localId);
    const out = $('qna-answer-' + localId);
    const cfg = config.sheets.find(s => s.localId === localId);
    const data = cardData[localId];
    if (!input || !out || !cfg || !data) return;
    const q = input.value.trim();
    if (!q) { out.classList.add('hidden'); out.innerHTML = ''; return; }
    try {
        out.innerHTML = buildQnaAnswer(cfg, data, q);
    } catch (e) {
        out.innerHTML = `<div class="p-3 text-red-500 text-sm">조회 중 오류: ${esc(e.message)}</div>`;
    }
    out.classList.remove('hidden');
}

// ───────── 렌더 ─────────
function renderAll() {
    const container = $('sheets-container');
    container.innerHTML = '';
    $('no-config').classList.toggle('hidden', !(config.sheets.length === 0));
    config.sheets.forEach(cfg => {
        const card = document.createElement('section');
        card.className = 'bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden';
        card.id = 'card-' + cfg.localId;
        card.innerHTML = `
            <div class="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                <div class="font-bold text-slate-800 flex items-center gap-2">📄 ${esc(cfg.name || '시트')}
                    <span id="cnt-${cfg.localId}" class="text-[11px] font-bold text-slate-400"></span>
                </div>
                <div class="flex items-center gap-1.5 flex-wrap justify-end">
                    <input id="search-${cfg.localId}" type="text" placeholder="검색…" class="text-xs px-2 py-1.5 border border-slate-200 rounded-md w-28 sm:w-32 focus:w-40 sm:focus:w-44 transition-all">
                    <button data-cols="${cfg.localId}" class="text-xs px-2 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600" title="컬럼 선택">🧩 컬럼</button>
                    <button data-edit="${cfg.localId}" class="text-xs px-2 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600" title="편집">✏️</button>
                    <button data-refresh="${cfg.localId}" class="text-xs px-2 py-1.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700" title="새로고침">🔄</button>
                </div>
            </div>
            <div id="summary-${cfg.localId}" class="px-4 py-2.5 flex flex-wrap gap-2 border-b border-slate-50 bg-slate-50/50"></div>
            <div class="px-4 py-2.5 border-b border-slate-100 bg-indigo-50/40">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-[11px] font-bold text-indigo-600 shrink-0">💬 질문</span>
                    <input id="qna-input-${cfg.localId}" data-qna-input="${cfg.localId}" type="text" placeholder="예: 이번주 예정 송금 일정과 금액은?" class="flex-1 min-w-[180px] text-xs px-2.5 py-1.5 border border-indigo-200 rounded-md focus:border-indigo-400 outline-none">
                    <button data-qna="${cfg.localId}" class="text-xs font-bold px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white shrink-0">조회</button>
                </div>
                <div id="qna-answer-${cfg.localId}" class="hidden mt-2 bg-white border border-indigo-200 rounded-lg overflow-hidden"></div>
            </div>
            <div id="body-${cfg.localId}" class="overflow-auto" style="max-height:60vh;">
                <div class="p-6 text-center text-slate-400 text-sm">불러오는 중…</div>
            </div>`;
        container.appendChild(card);
        loadCard(cfg, false);
    });
}

async function loadCard(cfg, force) {
    const body = $('body-' + cfg.localId);
    const summary = $('summary-' + cfg.localId);
    const cnt = $('cnt-' + cfg.localId);
    if (!body) return;
    try {
        body.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">불러오는 중…</div>`;
        const data = await fetchSheet(cfg.sheetId, force);
        cardData[cfg.localId] = data;
        const orderIdx = detectOrderCols(data.headers);
        if (orderIdx) renderKpi(cfg, data, orderIdx);
        else renderTableAndSummary(cfg, data);
        const ts = data.ts ? new Date(data.ts) : new Date();
        if (cnt) cnt.textContent = `· ${data.rows.length}행 · ${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')} 갱신`;
    } catch (e) {
        if (summary) summary.innerHTML = '';
        body.innerHTML = `<div class="p-6 text-center text-red-500 text-sm">⚠️ ${esc(e.message)}</div>`;
    }
}

const cardData = {}; // localId -> {headers, rows, sheetName}

function renderTableAndSummary(cfg, data) {
    const { headers, rows } = data;
    const hidden = new Set(cfg.hiddenCols || []);
    const visIdx = headers.map((h, i) => i).filter(i => !hidden.has(headers[i]));
    const isNum = numericColumns(headers, rows);

    // 검색 필터
    const q = ($('search-' + cfg.localId)?.value || '').trim().toLowerCase();
    const filtered = q ? rows.filter(r => visIdx.some(i => String(r[i] == null ? '' : r[i]).toLowerCase().includes(q))) : rows;

    // 요약 칩: 행 수 + 숫자 컬럼 합계(표시 컬럼만)
    const summary = $('summary-' + cfg.localId);
    let chips = `<span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">총 ${filtered.length.toLocaleString()}행${q ? ` / ${rows.length}` : ''}</span>`;
    visIdx.forEach(i => {
        if (!isNum[i]) return;
        const sum = filtered.reduce((a, r) => a + (parseNum(r[i]) || 0), 0);
        chips += `<span class="text-[11px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-800">${esc(headers[i])} 합계 <b>${sum.toLocaleString()}</b></span>`;
    });
    if (summary) summary.innerHTML = chips;

    // 표
    const body = $('body-' + cfg.localId);
    if (!filtered.length) { body.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">표시할 데이터가 없습니다.</div>`; return; }
    let html = '<table class="data-table"><thead><tr>';
    visIdx.forEach(i => { html += `<th>${esc(headers[i] || '')}</th>`; });
    html += '</tr></thead><tbody>';
    const MAX = 500; // 과도한 렌더 방지
    filtered.slice(0, MAX).forEach(r => {
        html += '<tr>';
        visIdx.forEach(i => { html += `<td class="${isNum[i] ? 'num' : ''}">${esc(r[i])}</td>`; });
        html += '</tr>';
    });
    html += '</tbody></table>';
    if (filtered.length > MAX) html += `<div class="p-2 text-center text-[11px] text-slate-400">상위 ${MAX}행만 표시 (검색으로 좁혀보세요)</div>`;
    body.innerHTML = html;
}

// ───────── 이벤트 ─────────
$('sheets-container').addEventListener('click', (e) => {
    const c = e.target.closest('[data-cols]'); const ed = e.target.closest('[data-edit]'); const rf = e.target.closest('[data-refresh]');
    const qa = e.target.closest('[data-qna]');
    if (qa) handleQna(qa.dataset.qna);
    else if (c) openColsModal(c.dataset.cols);
    else if (ed) openSheetModal(ed.dataset.edit);
    else if (rf) { const id = rf.dataset.refresh; const cfg = config.sheets.find(s => s.localId === id); if (cfg) loadCard(cfg, true); }
});
// 질문 입력에서 Enter → 조회
$('sheets-container').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const qi = e.target.closest('[data-qna-input]');
    if (qi) { e.preventDefault(); handleQna(qi.dataset.qnaInput); }
});
$('sheets-container').addEventListener('input', (e) => {
    const s = e.target.closest('[id^="search-"]');
    if (s) { const id = s.id.replace('search-', ''); const cfg = config.sheets.find(x => x.localId === id);
        if (cfg && cardData[id] && !detectOrderCols(cardData[id].headers)) renderTableAndSummary(cfg, cardData[id]); }
});
// 기간 드롭다운/날짜 입력 변경 → 해당 시트만 다시 렌더
$('sheets-container').addEventListener('change', (e) => {
    const rerender = (id) => {
        const cfg = config.sheets.find(s => s.localId === id);
        const d = cardData[id];
        const ix = d && detectOrderCols(d.headers);
        if (cfg && ix) renderKpi(cfg, d, ix);
    };
    const sel = e.target.closest('[data-period-sel]');
    if (sel) { periodState[sel.dataset.periodSel] = sel.value; rerender(sel.dataset.periodSel); return; }

    const ri = e.target.closest('[data-range]');
    if (ri) {
        const [id, which] = ri.dataset.range.split(':');
        periodRange[id] = periodRange[id] || {};
        periodRange[id][which] = ri.value;
        periodState[id] = 'custom';
        rerender(id);
    }
});

$('btn-refresh-all').onclick = () => config.sheets.forEach(cfg => loadCard(cfg, true));

// 창 닫기 — 별도 창/탭으로 열린 경우 닫고, 브라우저가 막으면 메인으로 복귀
$('btn-close').onclick = () => {
    window.close();
    setTimeout(() => { window.location.href = 'index.html'; }, 200);
};

// 설정 모달
$('btn-settings').onclick = () => { $('inp-script-url').value = config.scriptUrl || ''; show('settings-modal'); };
$('btn-save-settings').onclick = async () => { config.scriptUrl = $('inp-script-url').value.trim(); await saveConfig(); hide('settings-modal'); renderAll(); };

// 시트 추가/편집 모달
$('btn-add').onclick = () => openSheetModal(null);
function openSheetModal(localId) {
    const cfg = localId ? config.sheets.find(s => s.localId === localId) : null;
    $('sheet-modal-title').textContent = cfg ? '✏️ 시트 편집' : '➕ 시트 추가';
    $('inp-sheet-localid').value = cfg ? cfg.localId : '';
    $('inp-sheet-name').value = cfg ? cfg.name : '';
    $('inp-sheet-url').value = cfg ? cfg.sheetId : '';
    $('btn-delete-sheet').classList.toggle('hidden', !cfg);
    show('sheet-modal');
}
$('btn-save-sheet').onclick = async () => {
    const name = $('inp-sheet-name').value.trim();
    const sheetId = extractSheetId($('inp-sheet-url').value);
    if (!name || !sheetId) { alert('이름과 시트 URL을 입력하세요.'); return; }
    const localId = $('inp-sheet-localid').value;
    if (localId) {
        const cfg = config.sheets.find(s => s.localId === localId);
        if (cfg) { cfg.name = name; cfg.sheetId = sheetId; }
    } else {
        config.sheets.push({ localId: uid(), name, sheetId, hiddenCols: [] });
    }
    await saveConfig(); hide('sheet-modal'); renderAll();
};
$('btn-delete-sheet').onclick = async () => {
    const localId = $('inp-sheet-localid').value;
    if (!localId) return;
    if (!await showConfirm('이 시트를 대시보드에서 삭제할까요?', { title: '시트 삭제', okText: '삭제', danger: true })) return;
    config.sheets = config.sheets.filter(s => s.localId !== localId);
    await saveConfig(); hide('sheet-modal'); renderAll();
};

// 컬럼 선택 모달
function openColsModal(localId) {
    const cfg = config.sheets.find(s => s.localId === localId);
    const data = cardData[localId];
    if (!cfg || !data) { alert('먼저 데이터가 로드되어야 합니다.'); return; }
    $('inp-cols-localid').value = localId;
    const hidden = new Set(cfg.hiddenCols || []);
    $('cols-list').innerHTML = data.headers.map(h => `
        <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" value="${esc(h)}" ${hidden.has(h) ? '' : 'checked'} class="w-4 h-4">
            <span>${esc(h || '(빈 헤더)')}</span>
        </label>`).join('');
    show('cols-modal');
}
$('btn-save-cols').onclick = async () => {
    const localId = $('inp-cols-localid').value;
    const cfg = config.sheets.find(s => s.localId === localId);
    if (!cfg) return;
    const checks = [...$('cols-list').querySelectorAll('input[type=checkbox]')];
    cfg.hiddenCols = checks.filter(c => !c.checked).map(c => c.value);
    await saveConfig(); hide('cols-modal');
    if (cardData[localId]) renderTableAndSummary(cfg, cardData[localId]);
};

// 모달 공용 닫기
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.fixed').classList.add('hidden'));
document.querySelectorAll('.fixed').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));
