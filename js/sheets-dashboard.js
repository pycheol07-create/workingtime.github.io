// === js/sheets-dashboard.js ===
// 📊 업무 시트 대시보드 — 여러 비공개 구글 시트(첫 탭)를 Apps Script Web App으로 읽어
// 요약/정리해서 보여주는 별도 페이지. 설정은 Firestore 단일 문서에 저장(동기화).

import { initializeFirebase } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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
    const n = Number(String(v == null ? '' : v).replace(/[, ₩]/g, ''));
    return isNaN(n) ? null : n;
};
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
                <div class="flex items-center gap-1.5">
                    <input id="search-${cfg.localId}" type="text" placeholder="검색…" class="text-xs px-2 py-1.5 border border-slate-200 rounded-md w-32 focus:w-44 transition-all">
                    <button data-cols="${cfg.localId}" class="text-xs px-2 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600" title="컬럼 선택">🧩 컬럼</button>
                    <button data-edit="${cfg.localId}" class="text-xs px-2 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600" title="편집">✏️</button>
                    <button data-refresh="${cfg.localId}" class="text-xs px-2 py-1.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700" title="새로고침">🔄</button>
                </div>
            </div>
            <div id="summary-${cfg.localId}" class="px-4 py-2.5 flex flex-wrap gap-2 border-b border-slate-50 bg-slate-50/50"></div>
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
        renderTableAndSummary(cfg, data);
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
    if (c) openColsModal(c.dataset.cols);
    else if (ed) openSheetModal(ed.dataset.edit);
    else if (rf) { const id = rf.dataset.refresh; const cfg = config.sheets.find(s => s.localId === id); if (cfg) loadCard(cfg, true); }
});
$('sheets-container').addEventListener('input', (e) => {
    const s = e.target.closest('[id^="search-"]');
    if (s) { const id = s.id.replace('search-', ''); const cfg = config.sheets.find(x => x.localId === id); if (cfg && cardData[id]) renderTableAndSummary(cfg, cardData[id]); }
});

$('btn-refresh-all').onclick = () => config.sheets.forEach(cfg => loadCard(cfg, true));

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
    if (!localId || !confirm('이 시트를 대시보드에서 삭제할까요?')) return;
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
