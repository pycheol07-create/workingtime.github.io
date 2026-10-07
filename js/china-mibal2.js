// === js/china-mibal2.js ===
// 신규 미발계산기(시험) — 기존 '중국제작 미발계산기'와 나란히 비교하는 화면. 설계: 업무자동화\앱\미발계산기2\설계.md
//
// 보기 두 가지 — 계산은 둘 다 js/lib/mibal2-rows.js computeRows(입력 묶음 → 행) 하나로 한다.
//   · 오늘(실시간): integrations/mibal2Latest + 지금의 CONFIG·EDITED_CELLS·Locations·기존 미발
//   · 날짜별 비교: integrations/mibal2Daily_YYYYMMDD — 수집기가 그날 첫 성공 때 기존 쪽 입력까지 함께 저장한 사본(읽기 전용)
//
// 읽기: integrations/mibal2Latest·mibal2Daily_* (Apps Script 가 씀) · ChinaStockGoods/CONFIG · ChinaStockGoods/EDITED_CELLS ·
//       Locations(ZONE_*) · ChinaStockGoods_ScanDB_Versions(없으면 ChinaStockGoods_ScanDB) · mibal2/settings ·
//       config/mainConfig(관리자 확인만)
// 쓰기: artifacts/team-work-logger-v2/mibal2/{settings, refreshRequest, compare_YYYYMMDD} 3종만. 그 외 쓰기 0건.
//       이메일 등 사용자 정보는 어디에도 저장하지 않는다.
//
// ⚠️ js/china-stock-goods.js 는 import 하지 않는다 — 로드만 해도 ScanDB 를 지우고 다시 쓴다.
//    도착수량 규칙(applyDates·withinGrace)은 그 파일을 읽고 lib/mibal2-rows.js 에 같게 옮겼다.
import { initializeFirebase } from './china-stock-config.js?v=202610071546'; // 게이트(china-stock-gate.js)와 '똑같은 주소' → 모듈 한 번만 생성
import { doc, getDoc, getDocFromServer, getDocs, setDoc, onSnapshot, collection, query, where, orderBy, limit, documentId, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { explain } from './lib/mibal2-calc.js?v=202610071546';
import {
    listShipDates, buildLocIndex, computeRows, summarize, compareRowsOf,
    graceDaysFrom, legacyDatesFrom, selectedDatesFrom,
    oldMapFromScan, oldMapFromDaily, editedFromDaily, locFromDaily
} from './lib/mibal2-rows.js?v=202610071546';

const { db, auth } = initializeFirebase();

const BASE = 'artifacts/team-work-logger-v2';
const LATEST_PATH = BASE + '/integrations/mibal2Latest';
const DAILY_PREFIX = BASE + '/integrations/mibal2Daily_';
const SETTINGS_PATH = BASE + '/mibal2/settings';
const REQUEST_PATH = BASE + '/mibal2/refreshRequest';
const COMPARE_PREFIX = BASE + '/mibal2/compare_';
const CHINA_COLLECTION = 'ChinaStockGoods';

const DIFF_BIG = 5;                     // |신규−기존| 이 이 값 이상이면 빨강 강조 (사용자 결정 2026-10-07)
const REQUEST_IGNORE_MS = 10 * 60000;   // 수집기 REQUEST_IGNORE_MS 와 같다 — 마지막 성공 후 이 안의 요청은 수집기가 무시한다
const WORK_HOUR_FROM = 7, WORK_HOUR_TO = 19;   // 수집기 요청확인() 이 도는 시간(월~토)
const VERSIONS_LIMIT = 30;              // 최근 버전 몇 개 안에서 'upload' 를 찾을지 (china-stock-goods.js:1935 MAX_SCANDB_VERSIONS 와 같은 수). 수집기도 같은 수
const DAILY_DAYS = 30;                  // 날짜별 비교 목록 — 오늘부터 며칠 전까지
const REFRESH_TIMEOUT_MS = 15 * 60000;  // 요청 후 이만큼 지나도 소식이 없으면 잠금을 푼다
const PENDING_KEY = 'mibal2_refresh_pending';
const AUTO_KEY = 'mibal2_auto_requested';

/** Firestore Timestamp / Date / 숫자 → ms (없으면 0) */
function tsMs(v) {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    const t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
}
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const mdhm = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(ms)}`; };
const ymd = (d = new Date()) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;

/**
 * 갱신 상태 칩: 오늘 07:00 이후 성공 → 초록 / 성공한 지 3시간 넘음(또는 오늘 07시 전 자료) → 노랑 / 오늘 성공 없음 → 빨강.
 */
function judgeStatus(latest, now = new Date()) {
    if (!latest) return { cls: 'red', text: '● 수집 자료 없음' };
    const okMs = tsMs(latest.lastOkAt);
    if (!okMs) return { cls: 'red', text: '● 성공한 수집 없음' };
    const okD = new Date(okMs);
    if (!sameDay(okD, now)) return { cls: 'red', text: `● 오늘 갱신 없음 (마지막 ${mdhm(okMs)})` };
    const seven = new Date(now); seven.setHours(7, 0, 0, 0);
    const ageMin = Math.max(0, Math.round((now.getTime() - okMs) / 60000));
    const ago = ageMin >= 60 ? `${Math.floor(ageMin / 60)}시간 ${ageMin % 60}분 전` : `${ageMin}분 전`;
    if (okMs < seven.getTime() || ageMin > 180) return { cls: 'yellow', text: `● ${hhmm(okMs)} 갱신 (${ago})` };
    return { cls: 'green', text: `● ${hhmm(okMs)} 갱신 (${ago})` };
}

// 전역 상태 — 오늘(실시간)
let latest = null;             // mibal2Latest 문서
let stockRows = {};            // rowsJson: { code: { n, r, i } }
let ship = { items: {} };      // shipJson
let parseError = '';
let config = {};               // ChinaStockGoods/CONFIG
let graceDays = 1;
let legacyDates = [];          // CONFIG.savedDatesMibal
let editedCells = {};          // ChinaStockGoods/EDITED_CELLS.cells
let locIndex = {};             // code → {id, count, etcOnly}
let oldSnap = null;            // { kind:'version'|'live', atMs, trigger, note, map, noUpload }
let settings = null;           // mibal2/settings
let selectedDates = [];
let dateSource = 'legacy';     // 'legacy' | 'own'
// 보기
let viewMode = 'live';         // 'live' | 'daily'
let daily = null;              // 날짜별 보기 상태 { id, ok, msg, ctx, rows, dates, dateInfo, dateSource }
let ctx = null;                // 지금 보기의 근거 표시용 정보(detail·안내줄)
let allRows = [];
let viewRows = [];
let sortConfig = { key: 'diffAbs', dir: 'desc' };
let expanded = new Set();
let pending = null;            // 지금 갱신 요청 대기 { atMs, baseRun, baseNoteAt }
let firstServerSeen = false;   // 서버에서 온 첫 mibal2Latest 를 봤는지(자동 요청 판단용)
let started = false;
let isAdminOk = false;         // 관리자 확인 통과 전에는 어떤 쓰기도 하지 않는다

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** 숫자 칸 — 값은 늘 Number() 로 강제해서 넣는다(수집 자료에 글자가 섞여도 HTML 이 되지 않게) */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? String(n) : '?'; };
const numOr = (v, dash = '–') => (v === null || v === undefined || v === '') ? `<span class="muted">${dash}</span>` : num(v);
function showToast(msg) {
    const t = $('toast'); if (!t) return;
    t.innerText = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
}
function setLoading(on, text) {
    const o = $('loading-overlay'); if (!o) return;
    if (text) $('loading-text').textContent = text;
    o.style.display = on ? 'flex' : 'none';
}
const parseJsonSafe = (s, fallback) => { try { const v = JSON.parse(s); return v == null ? fallback : v; } catch (e) { return undefined; } };

// ─────────────────────────────────────────────────────────────
// 읽기 (오늘)
// ─────────────────────────────────────────────────────────────
async function loadConfig() {
    const snap = await getDoc(doc(db, CHINA_COLLECTION, 'CONFIG'));
    config = snap.exists() ? (snap.data() || {}) : {};
    legacyDates = legacyDatesFrom(config);   // china-stock-goods.js:2825 loadConfig 와 같은 규칙
    graceDays = graceDaysFrom(config);
}
async function loadEditedCells() {
    // china-stock-goods.js:2827 loadEditedCells 와 같다
    const snap = await getDoc(doc(db, CHINA_COLLECTION, 'EDITED_CELLS'));
    editedCells = snap.exists() ? (snap.data().cells || {}) : {};
}
async function loadLocations() {
    // location.js:524 와 같은 범위(ZONE_ 문서). 한 번만 읽는다(실시간 구독 안 함). 대표 자리 규칙은 buildLocIndex.
    const qs = await getDocs(query(collection(db, 'Locations'), where(documentId(), '>=', 'ZONE_'), where(documentId(), '<=', 'ZONE_\uf8ff')));
    locIndex = buildLocIndex(qs.docs.map(ds => ({ id: ds.id, data: ds.data() || {} })));
}
/**
 * 기존 미발(비교값). 수집기 loadOldInputs_ 도 같은 규칙.
 * '기존 화면의 미발' = tableData.mibalQty(china-stock-goods.js:2262). 이것은 어디에도 그대로 저장되지 않는다.
 *  · ScanDB(:1825) = 화면 미발 − 입고확인 수량, 그 뒤 스캐너가 입고할 때마다 또 뺀다(scan.html:714) → 작업 중엔 계속 줄어든다.
 *  · ScanDB_Versions(:1941) = 그 시점 ScanDB 사본. 'upload' 버전(:1977)은 미발재고로그 업로드 직후 동기화한 값이라
 *    그때까지 입고확인이 0 이면 화면 미발과 같다. → upload 버전을 우선, 없으면 최근 버전, 그것도 없으면 현재 ScanDB.
 */
async function loadOldSnapshot() {
    try {
        const qs = await getDocs(query(collection(db, 'ChinaStockGoods_ScanDB_Versions'), orderBy('atMs', 'desc'), limit(VERSIONS_LIMIT)));
        const vs = qs.docs.map(d => ({ id: d.id, ...d.data() }));
        const up = vs.find(v => v.trigger === 'upload');
        const pick = up || vs[0];
        if (pick && pick.data && typeof pick.data === 'object') {
            // noUpload: upload 버전을 못 찾아 다른 버전(수동·초기화 직전 등 — 스캔 차감이 들어갔을 수 있음)을 썼다
            return { kind: 'version', atMs: pick.atMs || tsMs(pick.at), trigger: pick.trigger || '', note: pick.note || '', map: pick.data, noUpload: !up };
        }
    } catch (e) { console.warn('[mibal2] 버전 기록 읽기 실패 — 현재 ScanDB 로 비교:', e && e.code); }
    const snap = await getDocs(collection(db, 'ChinaStockGoods_ScanDB'));
    const map = {}; let maxMs = 0;
    snap.forEach(d => {
        const v = d.data() || {};
        map[d.id] = { mibalQty: v.mibalQty, arrivalQty: v.arrivalQty };
        maxMs = Math.max(maxMs, tsMs(v.updatedAt));
    });
    return { kind: 'live', atMs: maxMs, trigger: '', note: '', map, noUpload: true };
}
async function loadSettings() {
    try {
        const snap = await getDoc(doc(db, SETTINGS_PATH));
        settings = snap.exists() ? (snap.data() || {}) : null;
    } catch (e) { settings = null; console.warn('[mibal2] settings 읽기 실패:', e && e.code); }
}
function applyLatest(data) {
    latest = data;
    parseError = '';
    stockRows = {}; ship = { items: {} };
    if (!data) return;
    const r = parseJsonSafe(data.rowsJson || '{}', {});
    if (r === undefined) parseError = 'rowsJson 해석 실패'; else stockRows = r;
    const s = parseJsonSafe(data.shipJson || '{}', {});
    if (s === undefined) parseError = (parseError ? parseError + ' · ' : '') + 'shipJson 해석 실패';
    else { ship = s; if (!ship.items) ship.items = {}; }
}

// ─────────────────────────────────────────────────────────────
// 계산 — 입력 묶음 만들기 (보기마다) → computeRows
// ─────────────────────────────────────────────────────────────
const FLAG_LABEL = {
    zeroCapacity: ['적재량0', 'warn'], backlog: ['밀린주문', 'warn'], noStock: ['재고모름', 'bad'], noOrders: ['주문모름', 'bad'],
    needRefill: ['보충필요', 'warn'], noLoc: ['로케이션없음', 'bad'], etcLoc: ['기타자리만', 'warn'], multiLoc: ['여러자리', ''],
    onlyOld: ['기존에만', 'bad'], noOld: ['신규에만', 'warn'], arrDiff: ['도착다름', 'warn']
};

function liveBundle() {
    return {
        stockRows, shipItems: ship.items || {},
        oldMap: oldSnap ? oldMapFromScan(oldSnap.map) : null,
        zoneConfig: config, edited: editedCells, loc: locIndex,
        selectedDates, graceDays, now: new Date()
    };
}
function liveCtx() {
    return {
        mode: 'live',
        okMs: latest ? tsMs(latest.lastOkAt) : 0,
        range: (latest && latest.range) || {},
        asOf: ship.asOf || '', keepArrivedDays: ship.keepArrivedDays, shipStaleDays: ship.shipStaleDays,
        graceDays, parseError,
        editedCount: Object.keys(editedCells).filter(c => editedCells[c] && editedCells[c].capacity !== undefined && editedCells[c].capacity !== '').length,
        locCount: Object.keys(locIndex).length,
        oldSource: oldSnap ? { kind: oldSnap.kind, atMs: oldSnap.atMs, trigger: oldSnap.trigger, note: oldSnap.note, noUpload: oldSnap.noUpload } : null,
        refDate: new Date()
    };
}

/**
 * 날짜별 보기 — Daily 문서 하나 → { ok, msg, ctx, rows, dates, dateInfo, dateSource }.
 * oldJson·cfgJson·editedJson·locJson 이 하나라도 없으면 비교 자료 없음(수집기 업데이트 전 날, 크기 초과·읽기 실패한 날).
 */
function buildDaily(id, data) {
    if (!data) return { id, ok: false, msg: '이 날은 수집 사본이 없습니다(수집이 성공하지 않은 날).' };
    const rows = parseJsonSafe(data.rowsJson || '{}', {});
    const sh = parseJsonSafe(data.shipJson || '{}', {});
    if (rows === undefined || sh === undefined) return { id, ok: false, msg: '이 날 사본의 rowsJson/shipJson 을 해석하지 못했습니다.' };
    const has = ['oldJson', 'cfgJson', 'editedJson', 'locJson'].every(k => typeof data[k] === 'string');
    if (!has) {
        // 사유 — 수집기 writeDaily_ 의 compareStatus
        const st = data.compareStatus || '';
        const why = st === '기존 업로드 대기'
            ? '기존 미발계산기에 그날 미발재고로그가 올라오기 전에 찍힌 사본입니다. 업로드되면 수집기가 5분 안에 다시 찍습니다(월~토 07~19시).'
            : st === '크기 초과' ? (data.compareError || '비교 입력을 넣으면 문서 크기 한도를 넘어 빠졌습니다.')
            : st === '비교 입력 실패' ? `비교 입력을 읽지 못했습니다 — ${data.compareError || '이유 없음'} (수집기가 하루 3번까지 다시 시도)`
            : (data.compareError || '수집기가 비교 입력을 저장하기 전 날짜입니다.');
        return { id, ok: false, msg: '이 날은 비교 자료 없음 — ' + why, okMs: tsMs(data.lastOkAt) };
    }
    const old = parseJsonSafe(data.oldJson, {}), cfg = parseJsonSafe(data.cfgJson, {}), ed = parseJsonSafe(data.editedJson, {}), loc = parseJsonSafe(data.locJson, {});
    if ([old, cfg, ed, loc].some(v => v === undefined)) return { id, ok: false, msg: '이 날은 비교 자료 없음 — 저장된 비교 입력을 해석하지 못했습니다.' };
    // 유예 판정 기준일 = 그날 수집 시각(없으면 그날 정오). 오늘 날짜로 판정하면 지난날의 도착분이 다 빠진다.
    const okMs = tsMs(data.lastOkAt);
    const refDate = okMs ? new Date(okMs) : new Date(+id.slice(0, 4), +id.slice(4, 6) - 1, +id.slice(6, 8), 12);
    const sel = selectedDatesFrom(cfg, { useOwnDates: cfg.useOwnDates, shipDates: cfg.shipDates });
    const g = graceDaysFrom(cfg);
    const items = (sh && sh.items) || {};
    const bundle = {
        stockRows: rows, shipItems: items, oldMap: oldMapFromDaily(old),
        zoneConfig: { zoneCapacity: cfg.zoneCapacity || {} }, edited: editedFromDaily(ed), loc: locFromDaily(loc),
        selectedDates: sel.dates, graceDays: g, now: refDate
    };
    const os = data.oldSource || null;
    const dctx = {
        mode: 'daily', okMs, range: data.range || {}, asOf: sh.asOf || '', keepArrivedDays: sh.keepArrivedDays, shipStaleDays: sh.shipStaleDays,
        graceDays: g, parseError: '', editedCount: Object.keys(ed).length, locCount: Object.keys(loc).length,
        oldSource: os ? { kind: os.kind, atMs: Number(os.atMs) || 0, trigger: os.trigger || '', note: '', noUpload: !!os.noUpload } : null,
        compareAtMs: tsMs(data.compareAt), compareStatus: data.compareStatus || '',
        refDate
    };
    const dateInfo = {};
    listShipDates(items, g, refDate).forEach(x => { dateInfo[x.date] = x; });
    return { id, ok: true, msg: '', ctx: dctx, rows: computeRows(bundle), dates: sel.dates, dateInfo, dateSource: sel.source };
}

// ─────────────────────────────────────────────────────────────
// 화면
// ─────────────────────────────────────────────────────────────
function sortKeyVal(r, key) {
    if (key === 'name') return (r.name + ' ' + r.option).toLowerCase();
    if (key === 'code' || key === 'loc') return String(r[key] || '');
    return r[key];
}
function applyFilters() {
    const q = ($('search-input').value || '').trim().toLowerCase();
    const diffOnly = $('chk-diff-only').checked;
    viewRows = allRows.filter(r => {
        // 차이 = 둘 다 있으면 값이 다를 때, 한쪽만 있으면(기존에만·신규에만) 그것도 차이로 본다
        const hasDiff = r.diff !== null ? r.diff !== 0 : (r.old !== null) !== (r.mibal !== null);
        if (diffOnly && !hasDiff) return false;
        if (!q) return true;
        return r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.option.toLowerCase().includes(q);
    });
    const { key, dir } = sortConfig;
    const m = dir === 'asc' ? 1 : -1;
    viewRows.sort((a, b) => {
        const va = sortKeyVal(a, key), vb = sortKeyVal(b, key);
        const na = va === null || va === undefined, nb = vb === null || vb === undefined;
        if (na || nb) return na === nb ? a.code.localeCompare(b.code) : (na ? 1 : -1);   // 모르는 값은 늘 아래로
        if (typeof va === 'string') return va.localeCompare(vb) * m || a.code.localeCompare(b.code);
        return (va - vb) * m || a.code.localeCompare(b.code);
    });
    renderTable();
    renderSummary();
}

function flagsHtml(r) {
    return r.flags.map(f => { const [t, c] = FLAG_LABEL[f] || [f, '']; return `<span class="flag ${c}">${esc(t)}</span>`; }).join('');
}
function oldSourceText(os) {
    if (!os) return '기존 미발 자료 없음';
    return os.kind === 'version'
        ? `버전기록 ${os.atMs ? mdhm(os.atMs) : '?'} (${esc(os.trigger)}${os.note ? ' · ' + esc(os.note) : ''})`
        : `현재 ScanDB ${os.atMs ? mdhm(os.atMs) : ''}`;
}

function detailHtml(r) {
    const c = ctx || {};
    const range = c.range || {};
    const fmtEntry = (e) => `${esc(e[0])} 출고 ${e[1] ? '→ ' + esc(e[1]) + ' 본사도착' : '(도착일 없음)'} · ${num(parseInt(e[2]) || 0)}장`;
    const used = r.arrUsed.length ? r.arrUsed.map(fmtEntry).join('<br>') : '<span class="muted">선택한 출고일에 해당 없음</span>';
    const skipped = r.arrSkipped.length ? `<br><span style="color:#c62828;">유예 지나 제외: ${r.arrSkipped.map(fmtEntry).join(' / ')}</span>` : '';
    const li = r.locInfo;
    const loc = li
        ? `${esc(li.id)}${li.count > 1 ? ` (이 코드 자리 ${num(li.count)}곳 중 ${li.etcOnly ? '기타 자리' : '피킹용'} 첫 자리)` : ''}${li.count === null ? ' (그날 수집 사본의 대표 자리)' : ''}`
        : '로케이션관리에 이 코드가 없음 → 미지정';
    const oldTxt = r.old === null
        ? '기존 비교값에 이 코드 없음'
        : `${num(r.old)} (${oldSourceText(c.oldSource)}${r.oldArr !== null ? ` · 그때 도착 ${num(r.oldArr)}` : ''})`;
    const oldNewTxt = r.oldNew === null ? '입력 모름 → 계산 안 함'
        : `총재고 ${num(r.stock)} · 적재량 ${num(r.cap)} · 도착 ${num(r.arr)} · 부족수량 max(${num(r.recv)}+${num(r.inv)}−${num(r.stock)},0)=${num(r.shortage)} · 직진 0 → ${num(r.oldNew)}`;
    return `<div class="formula">${esc(explain(r.input, r.res))}</div>
        <ul>
            <li><b>정상·접수·송장</b>: 이지어드민 → Apps Script 수집 (${c.okMs ? mdhm(c.okMs) : '시각 모름'} 성공분 · 접수 ${esc(range['접수From'] || '?')}~ · 송장 ${esc(range['송장From'] || '?')}~)
                — 정상 ${numOr(r.stock)} · 접수 ${numOr(r.recv)} · 송장 ${numOr(r.inv)}</li>
            <li><b>도착 ${num(r.arr)}</b>: 오더/사입리스트 출고 기록(shipJson ${esc(c.asOf || '?')}) 중 선택 출고일 · 본사도착 유예 ${num(c.graceDays)}일<br>${used}${skipped}</li>
            <li><b>로케이션</b>: ${loc} (로케이션관리 Locations)</li>
            <li><b>적재량 ${num(r.cap)}</b>: ${esc(r.capSrc)}</li>
            <li><b>기존 미발</b>: ${oldTxt}</li>
            <li><b>기존공식×신규입력</b>: ${oldNewTxt}</li>
        </ul>`;
}

function renderTable() {
    const tb = $('table-body');
    $('row-count').textContent = `${viewRows.length}행 / 전체 ${allRows.length}행`;
    if (viewMode === 'daily') {
        if (!daily) { tb.innerHTML = `<tr><td colspan="20" style="padding:50px; color:#888;">날짜를 고르세요.</td></tr>`; return; }
        if (!daily.ok) { tb.innerHTML = `<tr><td colspan="20" style="padding:50px; color:#c62828;">${esc(daily.msg)}</td></tr>`; return; }
    } else {
        if (!latest) { tb.innerHTML = `<tr><td colspan="20" style="padding:50px; color:#c62828;">수집 자료(mibal2Latest)가 아직 없습니다. [지금 갱신]을 누르거나 07:30 자동 수집을 기다리세요.</td></tr>`; return; }
        if (selectedDates.length === 0 && allRows.length === 0) { tb.innerHTML = `<tr><td colspan="20" style="padding:50px; color:#888;">출고일을 선택하세요.</td></tr>`; return; }
    }
    if (viewRows.length === 0) { tb.innerHTML = `<tr><td colspan="20" style="padding:50px; color:#888;">조건에 맞는 행이 없습니다.</td></tr>`; return; }
    let html = '';
    viewRows.forEach((r, i) => {
        const cls = ['data-row'];
        if (r.diff !== null && Math.abs(r.diff) >= DIFF_BIG) cls.push('diff-big');
        else if (r.diff !== null && r.diff !== 0) cls.push('diff-some');
        const diffTxt = r.diff === null ? numOr(null) : (r.diff > 0 ? '+' + num(r.diff) : num(r.diff));
        html += `<tr class="${cls.join(' ')}" data-code="${esc(r.code)}">
            <td>${i + 1}</td>
            <td class="code-cell">${esc(r.code)}</td>
            <td class="name-cell" title="${esc(r.name + (r.option ? ' / ' + r.option : ''))}">${esc(r.name)}${r.option ? ` <span style="color:#777;">/ ${esc(r.option)}</span>` : ''}</td>
            <td>${r.locInfo ? esc(r.loc) : '<span style="color:#c62828;">미지정</span>'}</td>
            <td>${num(r.cap)}</td>
            <td><b>${num(r.arr)}</b></td>
            <td>${numOr(r.stock)}</td>
            <td>${numOr(r.recv)}</td>
            <td>${numOr(r.inv)}</td>
            <td>${numOr(r.out)}</td>
            <td>${numOr(r.remain)}</td>
            <td>${r.backlog ? `<b style="color:#6a1b9a;">${num(r.backlog)}</b>` : numOr(r.backlog)}</td>
            <td>${numOr(r.old)}</td>
            <td>${numOr(r.oldNew)}</td>
            <td class="new-mibal">${numOr(r.mibal)}</td>
            <td class="diff-cell">${diffTxt}</td>
            <td>${numOr(r.pick)}</td>
            <td>${numOr(r.reserve)}</td>
            <td>${r.refill ? `<b style="color:#e65100;">${num(r.refill)}</b>` : numOr(r.refill)}</td>
            <td>${flagsHtml(r)}</td>
        </tr>`;
        if (expanded.has(r.code)) html += `<tr class="detail-row"><td colspan="20">${detailHtml(r)}</td></tr>`;
    });
    tb.innerHTML = html;
}

function renderSummary() {
    const s = summarize(viewRows);
    $('sum-sku').textContent = s.sku;
    $('sum-arrival').textContent = s.arr.toLocaleString();
    $('sum-new').textContent = s.mibal.toLocaleString();
    $('sum-old').textContent = s.old.toLocaleString();
    $('sum-diff').textContent = (s.diff > 0 ? '+' : '') + s.diff.toLocaleString();
    $('sum-pick').textContent = s.pick.toLocaleString();
    $('sum-reserve').textContent = s.reserve.toLocaleString();
    $('sum-refill').textContent = s.refill;
    $('sum-backlog').textContent = (s.backlog || 0).toLocaleString();
}

function renderSourceNote() {
    const box = $('src-note');
    if (viewMode === 'daily' && (!daily || !daily.ok)) {
        box.innerHTML = daily
            ? `<b style="color:#6a1b9a;">📅 ${esc(daily.id)}</b>${daily.okMs ? ` · 수집 ${mdhm(daily.okMs)}` : ''}<br><span style="color:#c62828;">${esc(daily.msg)}</span>`
            : '';
        return;
    }
    const c = ctx || {};
    const parts = [];
    if (c.mode === 'daily') {
        parts.push(`<b style="color:#6a1b9a;">📅 ${esc(daily.id)} 수집 사본 (읽기 전용)</b>`);
        // 비교 기준 시점 = 수집기가 비교 입력을 읽은 시각(기존 업로드 뒤). 기존 미발 버전 시각은 아래 '기존 미발' 에 나온다
        parts.push(`<b>비교 기준</b> ${c.compareAtMs ? mdhm(c.compareAtMs) : '시각 모름'}${c.compareStatus && c.compareStatus !== 'ok' ? ' · ' + esc(c.compareStatus) : ''}`);
    }
    parts.push(`<b>정상·접수·송장</b> ${c.okMs ? mdhm(c.okMs) + ' 수집' : '수집 없음'}`);
    parts.push(`<b>도착</b> 시트 기준일 ${esc(c.asOf || '?')} · 유예 ${num(c.graceDays)}일`);
    parts.push(`<b>적재량</b> 구역 설정 + 개별값 ${num(c.editedCount)}개`);
    parts.push(`<b>로케이션</b> 로케이션관리 ${num(c.locCount)}개 코드`);
    if (c.oldSource) parts.push(`<b>기존 미발</b> ${oldSourceText(c.oldSource)}${c.oldSource.kind === 'live' ? ' — ⚠ 스캐너 입고분이 이미 빠져 있을 수 있음' : ''}`);
    const warns = [];
    if (c.parseError) warns.push(c.parseError);
    const keep = parseInt(c.keepArrivedDays) || 0;
    if (keep && c.graceDays > keep) warns.push(`유예 ${c.graceDays}일이 수집 보관 ${keep}일보다 커서 오래 전 도착분은 빠집니다`);
    if (c.shipStaleDays) warns.push(`도착일 없이 출고 ${num(c.shipStaleDays)}일 넘은 기록은 수집에서 빠집니다(기존 화면은 포함)`);
    const os = c.oldSource;
    if (os && os.atMs && c.refDate && !sameDay(new Date(os.atMs), c.refDate)) warns.push(c.mode === 'daily' ? '기존 미발 비교값이 그날 것이 아닙니다' : '기존 미발 비교값이 오늘 것이 아닙니다');
    if (os && os.noUpload) warns.push(`최근 버전기록 ${VERSIONS_LIMIT}개 안에 '업로드' 버전이 없어 ${os.kind === 'version' ? `'${os.trigger}' 버전` : '현재 ScanDB'}로 비교합니다 — 스캐너 입고분이 빠져 있을 수 있음`);
    box.innerHTML = parts.join(' · ') + (warns.length ? `<br><span style="color:#c62828;">⚠ ${warns.map(esc).join(' / ')}</span>` : '');
}

/** 지금 보기 기준으로 다시 계산·그리기 */
function recomputeAndRender() {
    if (viewMode === 'live') {
        ctx = liveCtx();
        allRows = computeRows(liveBundle());
    } else {
        ctx = daily && daily.ok ? daily.ctx : null;
        allRows = daily && daily.ok ? daily.rows : [];
    }
    renderDateTags();
    applyFilters();
    renderSourceNote();
}

// ── 출고일 선택 ──────────────────────────────────────────────
/** '2026-09-08' → '9.8'. 결과는 HTML 에 바로 넣으므로 늘 esc() 한 값을 돌려준다(설정·CONFIG 에서 온 문자열 포함) */
const fmtMD = (d) => { const s = String(d == null ? '' : d); const p = s.split('-'); return esc(p.length === 3 ? `${+p[1]}.${+p[2]}` : s); };
let dateInfo = {};
function renderDateList() {
    const list = listShipDates(ship.items, graceDays, new Date());
    dateInfo = {}; list.forEach(x => { dateInfo[x.date] = x; });
    const c = $('date-checklist-container');
    if (!list.length) { c.innerHTML = '<div style="font-size:12px; color:#8d6e63;">출고 데이터 없음</div>'; }
    else {
        c.innerHTML = list.map(x => {
            const arr = x.arrivals.length ? ' → ' + x.arrivals.map(fmtMD).join(',') + ' 입고' : '';
            return `<label class="date-item"><input type="checkbox" class="date-check" value="${esc(x.date)}" ${selectedDates.includes(x.date) ? 'checked' : ''}><span>${fmtMD(x.date)} 출고${arr} (${num(x.skus)}종 / ${esc(x.qty.toLocaleString())}장)</span></label>`;
        }).join('');
        c.querySelectorAll('.date-check').forEach(ck => ck.addEventListener('change', () => {
            selectedDates = [...c.querySelectorAll('.date-check:checked')].map(x => x.value);
            renderDateTags();
        }));
    }
    renderDateTags();
}
function renderDateTags() {
    const box = $('date-tags-container');
    const isDaily = viewMode === 'daily';
    const dates = isDaily ? (daily && daily.ok ? daily.dates : []) : selectedDates;
    const info = isDaily ? (daily && daily.ok ? daily.dateInfo : {}) : dateInfo;
    const src = isDaily ? (daily && daily.ok ? daily.dateSource : '') : dateSource;
    $('btn-date-dropdown').textContent = selectedDates.length ? `▼ ${selectedDates.length}개 선택됨` : '▼ 출고일 선택';
    if (!dates.length) box.innerHTML = '선택된 출고일 없음';
    else box.innerHTML = [...dates].sort((a, b) => b.localeCompare(a)).map(d => {
        const x = info[d];
        const arr = x && x.arrivals.length ? ' → ' + x.arrivals.map(fmtMD).join(',') : '';
        return `<span class="date-tag">${fmtMD(d)} 출고${arr}${x ? '' : ' (유예 지남/없음)'}</span>`;
    }).join('');
    if (isDaily) {
        $('date-src').textContent = !src ? '' : (src === 'own' ? '그날 이 화면에서 고른 출고일' : '그날 기존 계산기 출고일');
        return;
    }
    const same = JSON.stringify([...selectedDates].sort()) === JSON.stringify([...legacyDates].sort());
    $('date-src').textContent = dateSource === 'own'
        ? (same ? '이 화면에서 고른 출고일 (기존과 같음)' : '이 화면에서 고른 출고일 (기존 계산기와 다름)')
        : '기존 계산기와 같은 출고일';
}
let popupSnapshot = null;
async function onDatePopupClosed() {
    const now = JSON.stringify([...selectedDates].sort());
    if (popupSnapshot !== null && now !== popupSnapshot) {
        dateSource = 'own';
        recomputeAndRender();
        try {
            if (!isAdminOk) throw new Error('관리자 확인 전');
            await setDoc(doc(db, SETTINGS_PATH), { useOwnDates: true, shipDates: selectedDates.map(String), updatedAt: serverTimestamp() }, { merge: true });
            showToast('✅ 출고일 선택 저장 (이 화면 전용 — 기존 계산기에는 영향 없음)');
        } catch (e) { showToast('⚠️ 출고일 선택 저장 실패: ' + (e && e.code || e)); }
    }
    popupSnapshot = null;
}
function setupDatePopup() {
    const popup = $('date-dropdown-popup');
    $('btn-date-dropdown').addEventListener('click', (e) => {
        e.stopPropagation();
        if (viewMode !== 'live') return;
        if (popup.style.display === 'block') { popup.style.display = 'none'; onDatePopupClosed(); }
        else { popup.style.display = 'block'; popupSnapshot = JSON.stringify([...selectedDates].sort()); }
    });
    popup.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => {
        if (popup.style.display === 'block') { popup.style.display = 'none'; onDatePopupClosed(); }
    });
    $('btn-date-all').addEventListener('click', () => {
        popup.querySelectorAll('.date-check').forEach(c => { c.checked = true; });
        selectedDates = [...popup.querySelectorAll('.date-check:checked')].map(x => x.value);
        renderDateTags();
    });
    $('btn-date-none').addEventListener('click', () => {
        popup.querySelectorAll('.date-check').forEach(c => { c.checked = false; });
        selectedDates = [];
        renderDateTags();
    });
    $('btn-date-legacy').addEventListener('click', async () => {
        selectedDates = legacyDates.map(String);
        dateSource = 'legacy';
        popup.style.display = 'none'; popupSnapshot = null;
        renderDateList();
        recomputeAndRender();
        try {
            if (!isAdminOk) throw new Error('관리자 확인 전');
            await setDoc(doc(db, SETTINGS_PATH), { useOwnDates: false, updatedAt: serverTimestamp() }, { merge: true });
            showToast('✅ 기존 계산기 출고일을 따릅니다');
        } catch (e) { showToast('⚠️ 설정 저장 실패: ' + (e && e.code || e)); }
    });
}

// ── 보기 전환: 오늘(실시간) / 날짜별 비교 ───────────────────────
function fillDailySelect() {
    const sel = $('daily-select');
    if (sel.options.length) return;
    const wd = ['일', '월', '화', '수', '목', '금', '토'];
    let html = '<option value="">날짜 선택…</option>';
    for (let i = 0; i < DAILY_DAYS; i++) {
        const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
        html += `<option value="${ymd(d)}">${d.getMonth() + 1}/${d.getDate()}(${wd[d.getDay()]})${i === 0 ? ' 오늘' : ''}</option>`;
    }
    sel.innerHTML = html;
}
function setView(mode) {
    viewMode = mode;
    document.body.dataset.view = mode;
    $('btn-view-live').classList.toggle('on', mode === 'live');
    $('btn-view-daily').classList.toggle('on', mode === 'daily');
    $('date-dropdown-popup').style.display = 'none'; popupSnapshot = null;
    expanded = new Set();
    if (mode === 'daily') fillDailySelect();
    recomputeAndRender();
}
/** Daily 문서 한 건만 읽는다(목록은 날짜로 만들고, 고른 날만 읽음 — 사본이 커서 30개를 한꺼번에 읽지 않는다) */
let dailyReq = 0;   // 날짜별 읽기 요청 번호 — 늦게 온 옛 응답이 화면을 덮지 않게
async function loadDaily(id) {
    const my = ++dailyReq;
    if (!id) { daily = null; setLoading(false); recomputeAndRender(); return; }
    setLoading(true, `${id} 수집 사본 불러오는 중...`);
    let result;
    try {
        const snap = await getDoc(doc(db, DAILY_PREFIX + id));
        result = buildDaily(id, snap.exists() ? snap.data() : null);
    } catch (e) {
        result = { id, ok: false, msg: '불러오기 실패: ' + ((e && e.code) || e) };
    }
    // 응답 경합: 기다리는 사이 다른 날짜를 골랐으면(더 새 요청이 있거나 선택값이 바뀜) 이 응답은 버린다
    if (my !== dailyReq || $('daily-select').value !== id) return;
    setLoading(false);
    daily = result;
    expanded = new Set();
    if (viewMode === 'daily') recomputeAndRender();
}

// ── 갱신 상태 · 지금 갱신 ─────────────────────────────────────
function renderStatus() {
    const st = judgeStatus(latest);
    const chip = $('status-chip');
    chip.className = 'status-chip ' + st.cls;
    chip.textContent = st.text;
    const sub = [];
    if (latest && latest.runMs) sub.push(`수집 ${Math.round(latest.runMs / 1000)}초`);
    if (latest && latest.counts && latest.counts.codes) sub.push(`대상 ${latest.counts.codes}개 코드`);
    if (latest && latest.note) sub.push('📝 ' + latest.note);
    $('status-sub').textContent = sub.join(' · ');
    const runMs = latest ? tsMs(latest.lastRunAt) : 0;
    $('status-err').textContent = (latest && latest.ok === false)
        ? `❌ 최근 실행 실패${runMs ? ' (' + mdhm(runMs) + ')' : ''}: ${latest.error || '이유 없음'} — 표는 마지막 성공 자료`
        : '';
}
function renderRefreshUI() {
    const btn = $('btn-refresh');
    const msg = $('refresh-msg');
    if (pending) {
        btn.disabled = true;
        btn.textContent = '⏳ 갱신 중…';
        msg.textContent = `요청됨 ${hhmm(pending.atMs)} — 최대 약 8분`;
    } else {
        btn.disabled = false;
        btn.textContent = '🔄 지금 갱신';
    }
}
function clearPending(message) {
    pending = null;
    try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {}
    $('refresh-msg').textContent = message || '';
    renderRefreshUI();
}
/**
 * 수집기가 어차피 무시할 요청이면 그 이유(쓰지 않고 안내만 한다). 아니면 ''.
 *  · 영업시간 밖 — 요청확인() 은 월~토 07~19시만 돈다(미발수집_apps_script.gs 요청확인 첫 줄)
 *  · 마지막 성공 후 10분 안 — 수집기 REQUEST_IGNORE_MS
 */
function refreshBlockReason(now = new Date()) {
    if (now.getDay() === 0 || now.getHours() < WORK_HOUR_FROM || now.getHours() >= WORK_HOUR_TO) {
        return `수집기는 월~토 ${WORK_HOUR_FROM}~${WORK_HOUR_TO}시에만 갱신 요청을 처리합니다 — 지금은 요청하지 않았습니다`;
    }
    const okMs = latest ? tsMs(latest.lastOkAt) : 0;
    if (okMs && now.getTime() - okMs < REQUEST_IGNORE_MS) {
        return `방금(${hhmm(okMs)}) 갱신된 자료입니다 — ${Math.round(REQUEST_IGNORE_MS / 60000)}분 뒤에 다시 요청할 수 있습니다`;
    }
    return '';
}
async function requestRefresh(isAuto) {
    if (pending || !isAdminOk) return;
    const block = refreshBlockReason();
    if (block) {
        if (!isAuto) { $('refresh-msg').textContent = block; showToast('ℹ️ ' + block); }
        return;
    }
    const baseRun = latest ? tsMs(latest.lastRunAt) : 0;
    const baseNoteAt = latest ? tsMs(latest.noteAt) : 0;
    try {
        // 사용자 정보(이메일 등)는 넣지 않는다 — 요청 시각만(서버 시각).
        await setDoc(doc(db, REQUEST_PATH), { requestedAt: serverTimestamp() });
    } catch (e) {
        showToast('⚠️ 갱신 요청 실패: ' + (e && e.code || e));
        return;
    }
    pending = { atMs: Date.now(), baseRun, baseNoteAt };
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch (e) {}
    renderRefreshUI();
    showToast(isAuto ? '🔄 오늘 수집 자료가 없어 갱신을 자동 요청했습니다' : '🔄 갱신 요청 — 5분마다 확인하는 수집기가 처리합니다');
}
/**
 * 수집 결과가 오면 잠금 해제.
 *  · lastRunAt 이 바뀌면 끝(성공/실패 모두)
 *  · noteAt 이 바뀌었는데 note 가 있으면 수집기가 요청을 거절한 것(한도·간격·방금 갱신됨) — 같은 문구가 연달아 와도 noteAt 으로 알아챈다
 *  · 그래도 15분 넘게 소식이 없으면 푼다(수집기가 noteAt 을 쓰기 전 버전이거나 트리거가 멈춘 경우)
 */
function checkPending() {
    if (!pending) return;
    const runMs = latest ? tsMs(latest.lastRunAt) : 0;
    if (runMs && runMs !== pending.baseRun) {
        clearPending(latest.ok === false ? `갱신 실패 ${hhmm(runMs)} — 아래 오류 확인` : `갱신 완료 ${hhmm(runMs)}`);
        return;
    }
    const noteAt = latest ? tsMs(latest.noteAt) : 0;
    const note = (latest && latest.note) || '';
    if (noteAt && noteAt !== pending.baseNoteAt && note) { clearPending('요청이 처리되지 않음: ' + note); return; }
    if (Date.now() - pending.atMs > REFRESH_TIMEOUT_MS) {
        clearPending('15분 동안 응답 없음 — 요청이 무시됐을 수 있습니다(월~토 07~19시만 처리 · 마지막 성공 후 10분 안 요청은 무시)');
    }
}
/**
 * 오늘 성공 자료가 없고 07:00 이후면 세션당 한 번 자동 요청. 수집기가 처리하지 않는 시간(일요일·19시 이후)엔 보내지 않는다.
 * ⚠️ 서버에서 받은 스냅샷(fromCache=false)으로만 판단한다 — 로컬 캐시의 어제 자료로 판단하면 오늘 이미 갱신됐어도 요청을 쏜다.
 */
function maybeAutoRequest() {
    const now = new Date();
    if (refreshBlockReason(now)) return;
    const okMs = latest ? tsMs(latest.lastOkAt) : 0;
    if (okMs && sameDay(new Date(okMs), now)) return;
    if (pending) return;
    try { if (sessionStorage.getItem(AUTO_KEY)) return; sessionStorage.setItem(AUTO_KEY, '1'); } catch (e) { return; }
    requestRefresh(true);
}

// ── 지금 상태로 한 번 더 저장 (날짜별 사본은 수집기가 자동으로 남긴다) ──────────
async function saveCompare() {
    if (!isAdminOk || viewMode !== 'live') return;
    if (!allRows.length) { showToast('저장할 행이 없습니다'); return; }
    const id = ymd();
    const ref = doc(db, COMPARE_PREFIX + id);
    try {
        const ex = await getDoc(ref);
        if (ex.exists() && !confirm(`오늘(${id}) 수동 저장본이 이미 있습니다. 지금 화면으로 덮어쓸까요?`)) return;
        // 상품명·금액은 넣지 않는다 — 코드별 숫자만. 어떤 조건으로 비교했는지도 함께(사용자 정보는 넣지 않는다)
        await setDoc(ref, {
            savedAt: serverTimestamp(),
            rowsJson: JSON.stringify(compareRowsOf(allRows)),
            shipDates: [...selectedDates].map(String).sort(),
            dateSource,                                   // 'legacy'(기존 계산기 출고일) | 'own'(이 화면에서 고름)
            graceDays,
            oldSource: oldSnap ? { kind: oldSnap.kind, atMs: oldSnap.atMs || 0, trigger: oldSnap.trigger || '' } : null,
            latestOkAtMs: latest ? tsMs(latest.lastOkAt) : 0
        });
        showToast(`💾 저장 완료 (compare_${id} · ${allRows.length}행)`);
    } catch (e) { showToast('⚠️ 저장 실패: ' + (e && e.code || e)); }
}

// ── 이벤트 ───────────────────────────────────────────────────
function setupEvents() {
    setupDatePopup();
    $('search-input').addEventListener('input', applyFilters);
    $('chk-diff-only').addEventListener('change', applyFilters);
    $('btn-refresh').addEventListener('click', () => requestRefresh(false));
    $('btn-save-compare').addEventListener('click', saveCompare);
    $('btn-view-live').addEventListener('click', () => setView('live'));
    $('btn-view-daily').addEventListener('click', () => setView('daily'));
    $('daily-select').addEventListener('change', (e) => loadDaily(e.target.value));
    document.querySelectorAll('.list-table th.sortable').forEach(th => th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortConfig.key === key) sortConfig.dir = sortConfig.dir === 'asc' ? 'desc' : 'asc';
        else sortConfig = { key, dir: (key === 'code' || key === 'name' || key === 'loc') ? 'asc' : 'desc' };
        applyFilters();
    }));
    $('table-body').addEventListener('click', (e) => {
        const tr = e.target.closest('tr.data-row'); if (!tr) return;
        const code = tr.dataset.code;
        if (expanded.has(code)) expanded.delete(code); else expanded.add(code);
        renderTable();
    });
    // 1분마다 상태 재판정 · 요청 시간초과 확인
    setInterval(() => { renderStatus(); checkPending(); }, 60000);
}

// ── 관리자 확인 ──────────────────────────────────────────────
/**
 * 기존 앱과 같은 판정: mainConfig.memberRoles[소문자 이메일] === 'admin'
 * (admin.js:57-61, firestore.rules isAdmin()). 읽기만 한다. 서버에서 읽지 못하면(오프라인·권한 오류) 차단한다.
 * 이메일은 비교에만 쓰고 저장·출력하지 않는다.
 */
async function checkAdmin(user) {
    const snap = await getDocFromServer(doc(db, BASE + '/config/mainConfig'));
    const roles = (snap.exists() && snap.data().memberRoles) || {};
    return roles[(user.email || '').toLowerCase()] === 'admin';
}
function showAdminBlock(msg) {
    isAdminOk = false;
    setLoading(false);
    $('app-main').style.display = 'none';
    $('admin-block').style.display = 'block';
    if (msg) $('admin-block-msg').textContent = msg;
}

// ── 시작 ─────────────────────────────────────────────────────
async function start(user) {
    if (started) return;
    started = true;
    setLoading(true, '권한 확인 중...');
    try {
        if (!(await checkAdmin(user))) { showAdminBlock('이 화면은 관리자만 열 수 있습니다. 관리자 계정으로 로그인해 주세요.'); return; }
    } catch (e) {
        console.error('[mibal2] 관리자 확인 실패:', e && e.code);
        showAdminBlock('권한을 확인하지 못해 화면을 열지 않았습니다(네트워크·권한 오류). 새로고침해 보세요.');
        return;
    }
    isAdminOk = true;
    $('admin-block').style.display = 'none';
    $('app-main').style.display = 'block';
    setLoading(true, '설정·로케이션·기존 미발 불러오는 중...');
    try { const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); if (p && p.atMs) pending = p; } catch (e) {}
    renderRefreshUI();
    const results = await Promise.allSettled([loadConfig(), loadEditedCells(), loadLocations(), loadOldSnapshot().then(s => { oldSnap = s; }), loadSettings()]);
    const names = ['CONFIG', 'EDITED_CELLS', 'Locations', '기존 미발', 'settings'];
    const fails = results.map((r, i) => r.status === 'rejected' ? `${names[i]}(${(r.reason && r.reason.code) || r.reason})` : '').filter(Boolean);
    if (fails.length) { console.error('[mibal2] 읽기 실패:', fails); showToast('⚠️ 읽기 실패: ' + fails.join(', ')); }

    // 출고일은 문자열로만 다룬다(설정·CONFIG 에 이상한 값이 들어 있어도 정렬·표시가 깨지지 않게)
    const sd = selectedDatesFrom(config, settings);
    selectedDates = sd.dates; dateSource = sd.source;

    // includeMetadataChanges: 캐시 → 서버 확인으로 넘어가는 순간도 이벤트로 받아, 서버 자료로만 자동 요청을 판단한다
    onSnapshot(doc(db, LATEST_PATH), { includeMetadataChanges: true }, (snap) => {
        applyLatest(snap.exists() ? snap.data() : null);
        renderStatus();
        checkPending();
        renderDateList();
        if (viewMode === 'live') recomputeAndRender();
        setLoading(false);
        if (!firstServerSeen && !snap.metadata.fromCache) { firstServerSeen = true; maybeAutoRequest(); }
    }, (err) => {
        setLoading(false);
        console.error('[mibal2] mibal2Latest 구독 실패:', err);
        $('status-chip').className = 'status-chip red';
        $('status-chip').textContent = '● 수집 자료 읽기 실패';
        $('status-err').textContent = String(err && err.code || err);
    });
}

document.body.dataset.view = 'live';
setupEvents();
if (auth) onAuthStateChanged(auth, (user) => { if (user) start(user); });
else { setLoading(false); $('status-err').textContent = 'Firebase 초기화 실패 — 새로고침해 보세요'; }
