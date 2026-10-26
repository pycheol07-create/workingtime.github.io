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
import { initializeFirebase } from './china-stock-config.js?v=202610261315'; // 게이트(china-stock-gate.js)와 '똑같은 주소' → 모듈 한 번만 생성
import { doc, getDoc, getDocFromServer, getDocs, setDoc, onSnapshot, collection, query, where, orderBy, limit, documentId, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { explain, FORMULA_VER } from './lib/mibal2-calc.js?v=202610261315';
import { sortMark } from './lib/china-stock-view.js?v=202610261315';
import {
    listShipDates, buildLocIndex, computeRows, summarize, compareRowsOf, FLAG_INFO, COMPARE_COLS, excelAoaOf,
    graceDaysFrom, legacyDatesFrom, selectedDatesFrom,
    oldMapFromScan, oldMapFromDaily, editedFromDaily, locFromDaily
} from './lib/mibal2-rows.js?v=202610261315';
import { setShellContext } from './app-shell-bridge.js?v=202610261315';
import { memberNameFor } from './app-shell-data.js?v=202610261315';
import { mountBusyBanner } from './busy-banner.js?v=202610261315';
import { latestDoneView, collectorQuiet } from './lib/busy-view.js?v=202610261315';
import { friendlyFirebaseError } from './utils.js?v=202610261315';

const { db, auth } = initializeFirebase();

const BASE = 'artifacts/team-work-logger-v2';
const LATEST_PATH = BASE + '/integrations/mibal2Latest';
const DAILY_PREFIX = BASE + '/integrations/mibal2Daily_';
const SETTINGS_PATH = BASE + '/mibal2/settings';
const REQUEST_PATH = BASE + '/mibal2/refreshRequest';
const LEASE_PATH = BASE + '/integrations/ezadminLease';   // 이지어드민 잠금(계약 A) — 미발수집·채우기가 쓰고 여기는 읽기만
const COMPARE_PREFIX = BASE + '/mibal2/compare_';
const CHINA_COLLECTION = 'ChinaStockGoods';

const DIFF_BIG = 5;                     // |3층−기존| 이 이 값 이상이면 빨강 강조 (사용자 결정 2026-10-07)
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
let stockRows = {};            // rowsJson: { code: { n, r, i, b } }  (b = 비축재고, 10/8 수집기부터 · 모르면 키 없음)
let ship = { items: {} };      // shipJson
let parseError = '';
let config = {};               // ChinaStockGoods/CONFIG
let graceDays = 1;
let legacyDates = [];          // CONFIG.savedDatesMibal
let legacyKnown = false;       // CONFIG 를 한 번이라도 읽었는지 — 못 읽었으면 '기존과 다름' 경고를 띄우지 않는다
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
let busyViews = {};            // '갱신 중' 띠 판정 { lease, mibalRequest } — js/busy-banner.js onState
let busyBannerStop = null;     // 띠 해제 함수(.refresh() 로 다시 그림)
let busyMsg = '';              // 띠 상태 때문에 refresh-msg 에 넣은 문구(상태가 풀리면 이것만 지운다)
let resultMsg = '';            // clearPending 안내(완료·실패·거절) — busy 문구가 덮었다가 풀리면 다시 보여 준다

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** 숫자 칸 — 값은 늘 Number() 로 강제해서 넣는다(수집 자료에 글자가 섞여도 HTML 이 되지 않게) */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? String(n) : '?'; };
const numOr = (v, dash = '–') => (v === null || v === undefined || v === '') ? `<span class="muted">${dash}</span>` : num(v);
// 오류 → 직원이 할 수 있는 일 한 줄(원시 Firebase 코드 대신). '관리자 확인 전'은 아래 저장 함수들이 직접 던지는 오류
function errText(e) {
    if (e && !e.code && e.message === '관리자 확인 전') return '관리자 확인 전입니다 — 잠시 뒤 다시 시도하세요';
    return friendlyFirebaseError(e);
}
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
async function loadConfig(fromServer = false) {
    const ref = doc(db, CHINA_COLLECTION, 'CONFIG');
    const snap = fromServer ? await getDocFromServer(ref) : await getDoc(ref);
    config = snap.exists() ? (snap.data() || {}) : {};
    legacyDates = legacyDatesFrom(config);   // china-stock-goods.js:2825 loadConfig 와 같은 규칙
    graceDays = graceDaysFrom(config);
    legacyKnown = true;
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
    if (r === undefined) parseError = '수집 자료(재고) 해석 실패'; else stockRows = r;
    const s = parseJsonSafe(data.shipJson || '{}', {});
    if (s === undefined) parseError = (parseError ? parseError + ' · ' : '') + '수집 자료(출고) 해석 실패';
    else { ship = s; if (!ship.items) ship.items = {}; }
}

// ─────────────────────────────────────────────────────────────
// 계산 — 입력 묶음 만들기 (보기마다) → computeRows
// ─────────────────────────────────────────────────────────────
// 플래그 글자·색은 lib/mibal2-rows.js FLAG_INFO 하나로(화면·엑셀이 같은 글자)

/** 수집기 counts 의 비축재고 실행 상태 → { status, missing, calls }. '비축상태' 칸이 없으면 null(10/8 수집기 갱신 전 사본) */
function reserveStatusOf(counts) {
    if (!counts || counts['비축상태'] === undefined || counts['비축상태'] === null) return null;
    return { status: String(counts['비축상태']), missing: counts['비축미응답'], calls: counts['비축호출'] };
}

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
        reserveStatus: reserveStatusOf(latest && latest.counts),
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
        reserveStatus: reserveStatusOf(data.counts),
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
    const checkOnly = $('chk-check-only').checked;
    viewRows = allRows.filter(r => {
        // 차이 = 둘 다 있으면 값이 다를 때, 한쪽만 있으면(기존에만·3층 모름) 그것도 차이로 본다
        const hasDiff = r.diff !== null ? r.diff !== 0 : (r.old !== null) !== (r.third !== null);
        if (diffOnly && !hasDiff) return false;
        if (checkOnly && !r.check) return false;
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
    // 정렬 표시 — 지금 정렬 열만 ▲/▼, 머리글마다 aria-sort
    const absDefault = sortConfig.key === 'diffAbs';   // 기본 정렬 = 차이 절댓값 큰 순 → '차이' 머리글에 표시
    document.querySelectorAll('.list-table th.sortable').forEach(th => {
        const isAbs = absDefault && th.dataset.sort === 'diff';
        const sm = isAbs ? { mark: '(절댓값 큰 순)', aria: 'descending' } : sortMark(th.dataset.sort, sortConfig);
        if (th.dataset.sort === 'diff') {
            if (isAbs) th.title = '지금은 기본 정렬 — 차이(피킹 배정−기존)의 절댓값이 큰 순입니다. 누르면 차이 값 순으로 정렬합니다';
            else th.title = '차이 = 피킹 배정수량 − 기존 계산기 미발수량';
        }
        th.setAttribute('aria-sort', sm.aria);
        let mk = th.querySelector('.sort-mark');
        if (sm.mark) {
            if (!mk) { mk = document.createElement('span'); mk.className = 'sort-mark'; th.appendChild(mk); }
            mk.textContent = ' ' + sm.mark;
        } else if (mk) mk.remove();
    });
}

function flagsHtml(r) {
    return r.flags.map(f => { const [t, c] = FLAG_INFO[f] || [f, '']; return `<span class="flag ${c}">${esc(t)}</span>`; }).join('');
}
function oldSourceText(os) {
    if (!os) return '기존 계산기 미발수량 자료 없음';
    return os.kind === 'version'
        ? `버전기록 ${os.atMs ? mdhm(os.atMs) : '?'} (${esc(os.trigger)}${os.note ? ' · ' + esc(os.note) : ''})`
        : `현재 스캔 기록 ${os.atMs ? mdhm(os.atMs) : ''}`;
}

function detailHtml(r) {
    const c = ctx || {};
    const range = c.range || {};
    const fmtEntry = (e) => `${esc(e[0])} 출고 ${e[1] ? '→ ' + esc(e[1]) + ' 본사도착' : '(도착일 없음)'} · ${num(parseInt(e[2]) || 0)}장`;
    const used = r.arrUsed.length ? r.arrUsed.map(fmtEntry).join('<br>') : '<span class="muted">선택한 출고일에 해당 없음</span>';
    const skipped = r.arrSkipped.length ? `<br><span class="t-risk">유예 지나 제외: ${r.arrSkipped.map(fmtEntry).join(' / ')}</span>` : '';
    const li = r.locInfo;
    const loc = li
        ? `${esc(li.id)}${li.count > 1 ? ` (이 코드 자리 ${num(li.count)}곳 중 ${li.etcOnly ? '기타 자리' : '피킹용'} 첫 자리)` : ''}${li.count === null ? ' (그날 수집 사본의 대표 자리)' : ''}`
        : '로케이션관리에 이 코드가 없음 → 미지정';
    const oldTxt = r.old === null
        ? '기존 비교값에 이 코드 없음'
        : `${num(r.old)} — 기존 mibalQty = 스캐너가 피킹으로 보내는 양 → 신규 피킹 배정수량과 비교 (${oldSourceText(c.oldSource)}${r.oldArr !== null ? ` · 그때 도착 ${num(r.oldArr)}` : ''})`;
    const oldNewTxt = r.oldNew === null ? '입력 모름 → 계산 안 함'
        : `총재고 ${num(r.stock)} · 적재량 ${num(r.cap)} · 도착 ${num(r.arr)} · 부족수량 max(${num(r.recv)}+${num(r.inv)}−${num(r.stock)},0)=${num(r.shortage)} · 직진 0 → ${num(r.oldNew)}`;
    return `<div class="formula">${esc(explain(r.input, r.res))}</div>
        <ul>
            <li><b>총재고·비축</b>: 총재고에 비축 포함 · 피킹재고 = 총재고 − 비축
                — 총재고 ${numOr(r.stock)} · 비축 ${numOr(r.bstock)}${r.bstock === null || r.bstock === undefined ? ' (모름 — 이 날 수집에 비축재고가 없거나 이 코드 응답 없음)' : ''} · 피킹재고 ${numOr(r.pstock)}</li>
            <li><b>접수·송장</b>: 이지어드민 → Apps Script 수집 (${c.okMs ? mdhm(c.okMs) : '시각 모름'} 성공분 · 접수 ${esc(range['접수From'] || '?')}~ · 송장 ${esc(range['송장From'] || '?')}~)
                — 접수 ${numOr(r.recv)} · 송장 ${numOr(r.inv)}</li>
            <li><b>도착 ${num(r.arr)}</b>: 오더/사입리스트 출고 기록(shipJson ${esc(c.asOf || '?')}) 중 선택 출고일 · 본사도착 유예 ${num(c.graceDays)}일<br>${used}${skipped}</li>
            <li><b>로케이션</b>: ${loc} (로케이션관리 Locations)</li>
            <li><b>적재량 ${num(r.cap)}</b>: ${esc(r.capSrc)}</li>
            <li><b>기존 계산기 미발수량</b>: ${oldTxt}</li>
            <li><b>기존공식×신규입력</b>: ${oldNewTxt}</li>
        </ul>`;
}

function renderTable() {
    const tb = $('table-body');
    $('row-count').textContent = `${viewRows.length}행 / 전체 ${allRows.length}행`;
    if (viewMode === 'daily') {
        if (!daily) { tb.innerHTML = `<tr><td colspan="${colSpan()}" class="t-3" style="padding:50px;">날짜를 고르세요.</td></tr>`; return; }
        if (!daily.ok) { tb.innerHTML = `<tr><td colspan="${colSpan()}" class="t-risk" style="padding:50px;">${esc(daily.msg)}</td></tr>`; return; }
    } else {
        if (!latest) { tb.innerHTML = `<tr><td colspan="${colSpan()}" class="t-risk" style="padding:50px;">수집 자료가 아직 없습니다. [지금 갱신]을 누르거나 07:30 자동 수집을 기다리세요.</td></tr>`; return; }
        if (selectedDates.length === 0 && allRows.length === 0) { tb.innerHTML = `<tr><td colspan="${colSpan()}" class="t-3" style="padding:50px;">출고일을 선택하세요.</td></tr>`; return; }
    }
    if (viewRows.length === 0) { tb.innerHTML = `<tr><td colspan="${colSpan()}" class="t-3" style="padding:50px;">조건에 맞는 행이 없습니다.</td></tr>`; return; }
    let html = '';
    viewRows.forEach((r, i) => {
        const cls = ['data-row'];
        if (r.diff !== null && Math.abs(r.diff) >= DIFF_BIG) cls.push('diff-big');
        else if (r.diff !== null && r.diff !== 0) cls.push('diff-some');
        if (r.check) cls.push('need-check');
        const diffTxt = r.diff === null ? numOr(null) : (r.diff > 0 ? '+' + num(r.diff) : num(r.diff));
        const warnNum = (v) => (v > 0 ? `<b class="t-warn">${num(v)}</b>` : numOr(v));
        html += `<tr class="${cls.join(' ')}" data-code="${esc(r.code)}">
            <td>${i + 1}</td>
            <td class="code-cell">${esc(r.code)}</td>
            <td class="name-cell" title="${esc(r.name + (r.option ? ' / ' + r.option : ''))}">${esc(r.name)}${r.option ? ` <span class="t-3">/ ${esc(r.option)}</span>` : ''}</td>
            <td>${r.locInfo ? esc(r.loc) : '<span class="t-risk">미지정</span>'}</td>
            <td title="${esc(r.capSrc)}">${num(r.cap)}<span class="cap-kind">${esc(r.capKind)}</span></td>
            <td><b>${num(r.arr)}</b></td>
            <td>${numOr(r.stock)}</td>
            <td>${numOr(r.bstock)}</td>
            <td>${r.pstock < 0 ? `<b class="t-risk">${num(r.pstock)}</b>` : numOr(r.pstock)}</td>
            <td>${numOr(r.recv)}</td>
            <td>${numOr(r.inv)}</td>
            <td>${numOr(r.out)}</td>
            <td>${numOr(r.short)}</td>
            <td class="new-mibal">${numOr(r.mibal)}</td>
            <td>${warnNum(r.unres)}</td>
            <td>${numOr(r.room)}</td>
            <td class="new-mibal">${numOr(r.third)}</td>
            <td>${numOr(r.pick)}</td>
            <td>${numOr(r.resv)}</td>
            <td>${warnNum(r.refill)}</td>
            <td>${numOr(r.old)}</td>
            <td class="diff-cell">${diffTxt}</td>
            <td>${flagsHtml(r)}</td>
        </tr>`;
        if (expanded.has(r.code)) html += `<tr class="detail-row"><td colspan="${colSpan()}">${detailHtml(r)}</td></tr>`;
    });
    tb.innerHTML = html;
}

function renderSummary() {
    const s = summarize(viewRows);
    $('sum-sku').textContent = s.sku;
    $('sum-arrival').textContent = s.arr.toLocaleString();
    $('sum-mibal').textContent = s.mibal.toLocaleString();
    $('sum-unres').textContent = s.unres.toLocaleString();
    $('sum-third').textContent = s.third.toLocaleString();
    // 비축을 모르는 행은 3층을 계산하지 않아 합에서 빠진다 — 몇 행 빠졌는지 꼭 보인다
    $('sum-third-note').textContent = s.thirdUnknown > 0 ? `비축모름 ${s.thirdUnknown}행 제외` : '';
    $('sum-pick-note').textContent = $('sum-third-note').textContent;   // 간단히 보기에서는 피킹 배정 카드가 숨어 여기에도 보인다
    $('sum-pick').textContent = s.pick.toLocaleString();
    $('sum-reserve').textContent = s.resv.toLocaleString();
    $('sum-refill').textContent = s.refill;
    $('sum-check').textContent = s.check;
    $('sum-old').textContent = s.old.toLocaleString();
    $('sum-diff').textContent = (s.diff > 0 ? '+' : '') + s.diff.toLocaleString();
}

function renderSourceNote() {
    const box = $('src-note');
    if (viewMode === 'daily' && (!daily || !daily.ok)) {
        box.innerHTML = daily
            ? `<b class="t-accent">${esc(daily.id)}</b>${daily.okMs ? ` · 수집 ${mdhm(daily.okMs)}` : ''}<br><span class="t-risk">${esc(daily.msg)}</span>`
            : '';
        return;
    }
    const c = ctx || {};
    const parts = [];
    if (c.mode === 'daily') {
        parts.push(`<b class="t-accent">${esc(daily.id)} 수집 사본 (읽기 전용)</b>`);
        // 비교 기준 시점 = 수집기가 비교 입력을 읽은 시각(기존 업로드 뒤). 기존 미발 버전 시각은 아래 '기존 미발' 에 나온다
        parts.push(`<b>비교 기준</b> ${c.compareAtMs ? mdhm(c.compareAtMs) : '시각 모름'}${c.compareStatus && c.compareStatus !== 'ok' ? ' · ' + esc(c.compareStatus) : ''}`);
    }
    parts.push(`<b>정상·접수·송장</b> ${c.okMs ? mdhm(c.okMs) + ' 수집' : '수집 없음'}`);
    parts.push(`<b>도착</b> 시트 기준일 ${esc(c.asOf || '?')} · 유예 ${num(c.graceDays)}일`);
    parts.push(`<b>적재량</b> 구역 설정 + 개별값 ${num(c.editedCount)}개`);
    parts.push(`<b>로케이션</b> 로케이션관리 ${num(c.locCount)}개 코드`);
    if (c.oldSource) parts.push(`<b>기존 계산기 미발수량</b> ${oldSourceText(c.oldSource)}${c.oldSource.kind === 'live' ? ' — ⚠ 스캐너 입고분이 이미 빠져 있을 수 있음' : ''}`);
    const warns = [];
    if (c.parseError) warns.push(c.parseError);
    const keep = parseInt(c.keepArrivedDays) || 0;
    if (keep && c.graceDays > keep) warns.push(`유예 ${c.graceDays}일이 수집 보관 ${keep}일보다 커서 오래 전 도착분은 빠집니다`);
    if (c.shipStaleDays) warns.push(`도착일 없이 출고 ${num(c.shipStaleDays)}일 넘은 기록은 수집에서 빠집니다(기존 화면은 포함)`);
    const os = c.oldSource;
    if (os && os.atMs && c.refDate && !sameDay(new Date(os.atMs), c.refDate)) warns.push(c.mode === 'daily' ? '기존 계산기 미발수량 비교값이 그날 것이 아닙니다' : '기존 계산기 미발수량 비교값이 오늘 것이 아닙니다');
    if (os && os.noUpload) warns.push(`최근 버전기록 ${VERSIONS_LIMIT}개 안에 '업로드' 버전이 없어 ${os.kind === 'version' ? `'${os.trigger}' 버전` : '현재 ScanDB'}로 비교합니다 — 스캐너 입고분이 빠져 있을 수 있음`);
    const rs = c.reserveStatus;
    if (!rs) warns.push((c.mode === 'daily' ? '이 날 사본에는' : '이 수집 자료에는') + ' 비축재고 없음 → 피킹 적재·비축 적재·피킹 배정수량을 계산 못 함(확인 필요)');
    else if (rs.status !== 'ok' || Number(rs.missing) > 0) warns.push(`비축재고 수집 ${rs.status} — 비축 미응답 코드 ${num(rs.missing)}개(그 코드는 비축재고 없음 → 피킹 적재·비축 적재·피킹 배정수량을 계산 못 함(확인 필요))`);
    box.innerHTML = parts.join(' · ') + (warns.length ? `<br><span class="t-risk">⚠ ${warns.map(esc).join(' / ')}</span>` : '');
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
    if (!list.length) { c.innerHTML = '<div class="t-3" style="font-size:12px;">출고 데이터 없음</div>'; }
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
        setDateDiffWarn(false);
        return;
    }
    const same = JSON.stringify([...selectedDates].sort()) === JSON.stringify([...legacyDates].sort());
    $('date-src').textContent = dateSource === 'own'
        ? (same ? '이 화면에서 고른 출고일 (기존과 같음)' : '이 화면에서 고른 출고일 (기존 계산기와 다름)')
        : '기존 계산기와 같은 출고일';
    setDateDiffWarn(legacyKnown && dateSource === 'own' && !same);   // CONFIG 를 못 읽었으면(기존 출고일 모름) 경고·버튼 숨김
}
// 출고일이 기존 계산기와 다르면 #date-src 를 경고색·굵게 + 날짜 바에 '기존 계산기 선택 따르기' 버튼
function setDateDiffWarn(on) {
    $('date-src').classList.toggle('t-warn', on);
    const btn = $('btn-date-legacy-out');
    if (btn) btn.hidden = !on;
}
let popupSnapshot = null;
let popupBackup = [];   // 팝업을 열 때의 선택 — ESC 로 닫으면 이것으로 되돌린다(저장 안 함)
async function onDatePopupClosed() {
    const now = JSON.stringify([...selectedDates].sort());
    if (popupSnapshot !== null && now !== popupSnapshot) {
        dateSource = 'own';
        recomputeAndRender();
        try {
            if (!isAdminOk) throw new Error('관리자 확인 전');
            await setDoc(doc(db, SETTINGS_PATH), { useOwnDates: true, shipDates: selectedDates.map(String), updatedAt: serverTimestamp() }, { merge: true });
            showToast('✅ 출고일 선택 저장 (이 화면 전용 — 기존 계산기에는 영향 없음)');
        } catch (e) { showToast('⚠️ 출고일 선택 저장 실패 — ' + errText(e)); }
    }
    popupSnapshot = null;
}
// 기존 계산기 출고일을 따른다 — 팝업 안 #btn-date-legacy · 날짜 바 #btn-date-legacy-out 둘 다 이것을 부른다
async function followLegacyDates() {
    const popup = $('date-dropdown-popup');
    // 기존 계산기가 그사이 출고일을 바꿨을 수 있으니 CONFIG 를 서버에서 다시 읽고 따른다. 못 읽으면 아무것도 안 바꿈
    try { await loadConfig(true); }
    catch (e) { showToast('⚠️ 기존 계산기 출고일을 다시 읽지 못해 바꾸지 않았습니다 — ' + errText(e)); return; }
    selectedDates = legacyDates.map(String);
    dateSource = 'legacy';
    popup.style.display = 'none'; popupSnapshot = null;
    renderDateList();
    recomputeAndRender();
    try {
        if (!isAdminOk) throw new Error('관리자 확인 전');
        await setDoc(doc(db, SETTINGS_PATH), { useOwnDates: false, updatedAt: serverTimestamp() }, { merge: true });
        showToast('✅ 기존 계산기 출고일을 따릅니다');
    } catch (e) { showToast('⚠️ 설정 저장 실패 — ' + errText(e)); }
}
function setupDatePopup() {
    const popup = $('date-dropdown-popup');
    $('btn-date-dropdown').addEventListener('click', (e) => {
        e.stopPropagation();
        if (viewMode !== 'live') return;
        if (popup.style.display === 'block') { popup.style.display = 'none'; onDatePopupClosed(); }
        else { popup.style.display = 'block'; popupSnapshot = JSON.stringify([...selectedDates].sort()); popupBackup = [...selectedDates]; }
    });
    popup.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => {
        if (popup.style.display === 'block') { popup.style.display = 'none'; onDatePopupClosed(); }
    });
    // ESC = 바꾼 선택을 버리고 닫기(열기 전 선택으로 되돌림, 저장·재계산 없음)
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || popup.style.display !== 'block') return;
        selectedDates = [...popupBackup];
        popupSnapshot = null;
        popup.style.display = 'none';
        renderDateList();
        renderDateTags();
        if (viewMode === 'live') recomputeAndRender();
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
    $('btn-date-legacy').addEventListener('click', followLegacyDates);
    $('btn-date-legacy-out').addEventListener('click', followLegacyDates);
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
        result = { id, ok: false, msg: '불러오기 실패 — ' + errText(e) };
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
/** 다른 곳에서 이미 갱신 중인가 — 잠금(mibal)이 잡혀 있거나 남의 요청이 처리 대기 중 */
function busyRefreshing() {
    const l = busyViews.lease;
    return !!((l && l.active && l.kind === 'mibal') || busyViews.mibalRequest);
}
function renderRefreshUI() {
    const btn = $('btn-refresh');
    const msg = $('refresh-msg');
    const setBusyMsg = (t) => {
        if (t) { msg.textContent = t; busyMsg = t; }
        else if (busyMsg) { if (msg.textContent === busyMsg) msg.textContent = resultMsg; busyMsg = ''; }
    };
    const l = busyViews.lease;
    const q = collectorQuiet(Date.now());
    const quietNote = q ? ` · ${q.from}~${q.to} 수집기 쉬는 시간(${q.why}) — ${q.to} 뒤 처리` : '';
    if (pending) {
        btn.disabled = true;
        btn.textContent = '⏳ 갱신 중…';
        msg.textContent = `요청됨 ${hhmm(pending.atMs)} — 최대 약 8분${quietNote}`;
        busyMsg = '';
    } else if (busyRefreshing()) {
        // 남이 요청했거나 수집기가 이미 읽는 중 — 또 요청하지 않게 잠근다(끝나면 띠·버튼이 같이 풀린다)
        btn.disabled = true;
        btn.textContent = '⏳ 갱신 중…';
        setBusyMsg(l && l.active && l.kind === 'mibal'
            ? `다른 곳에서 갱신 중${l.eta ? ' — ' + l.eta : ''}`
            : `다른 사람이 ${hhmm(busyViews.mibalRequest.sinceMs)}에 갱신을 요청함 — 처리 대기 중${quietNote}`);
    } else {
        btn.disabled = false;
        btn.textContent = '지금 갱신';
        // 채우기가 이지어드민을 쓰는 중이면 요청은 받되 끝난 뒤 처리된다(최대 15분) — 막지 않고 안내만
        setBusyMsg(l && l.active && l.kind === 'refill' ? '채우기가 이지어드민 사용 중 — 요청은 끝난 뒤 처리' : '');
    }
}
function clearPending(message) {
    resultMsg = message || '';
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
    if (pending || !isAdminOk || busyRefreshing()) return;
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
        showToast('⚠️ 갱신 요청 실패 — ' + errText(e));
        return;
    }
    pending = { atMs: Date.now(), baseRun, baseNoteAt };
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch (e) {}
    renderRefreshUI();
    const q = collectorQuiet(Date.now());
    showToast((isAuto ? '오늘 수집 자료가 없어 갱신을 자동 요청했습니다' : '갱신 요청 — 5분마다 확인하는 수집기가 처리합니다')
        + (q ? ` (${q.to} 뒤 처리 — 수집기 쉬는 시간)` : ''));
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
            formulaVer: FORMULA_VER,                      // 2 = 피킹 → 비축 → 입고분 공식(10/20~). 없으면 옛 7칸(v1)
            cols: [...COMPARE_COLS],                      // rowsJson 배열 칸 이름
            shipDates: [...selectedDates].map(String).sort(),
            dateSource,                                   // 'legacy'(기존 계산기 출고일) | 'own'(이 화면에서 고름)
            graceDays,
            oldSource: oldSnap ? { kind: oldSnap.kind, atMs: oldSnap.atMs || 0, trigger: oldSnap.trigger || '' } : null,
            latestOkAtMs: latest ? tsMs(latest.lastOkAt) : 0
        });
        showToast(`저장 완료 (${allRows.length}행)`);
    } catch (e) { showToast('⚠️ 저장 실패 — ' + errText(e)); }
}

// ── 엑셀 받기 (지금 보이는 행 — 검색·필터·정렬 반영. 내 PC 로 다운로드만) ──────────
function downloadExcel() {
    const X = window.XLSX;
    if (!X) { showToast('⚠️ 엑셀 라이브러리를 못 불러옴'); return; }
    if (!viewRows.length) { showToast('받을 행이 없습니다'); return; }
    const id = viewMode === 'daily' && daily && daily.ok ? daily.id : ymd();
    const ws = X.utils.aoa_to_sheet(excelAoaOf(viewRows));
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, '부족수량관리');
    X.writeFile(wb, `부족수량관리_신규_${id}.xlsx`);
}

// ── 보기 항목: 간단히(기본) / 전체 — 열·카드 숨김은 CSS(body[data-cols]). 고른 것은 이 브라우저에만 기억 ──
const COLS_KEY = 'mibal2.cols';
const colSpan = () => (document.body.dataset.cols === 'simple' ? 12 : 23);   // 간단히에서 보이는 열 수
function setCols(mode, save) {
    const simple = mode !== 'full';
    document.body.dataset.cols = simple ? 'simple' : 'full';
    $('btn-cols-simple').classList.toggle('on', simple);
    $('btn-cols-full').classList.toggle('on', !simple);
    if (simple) {
        $('chk-diff-only').checked = false;                                   // 숨긴 거르기가 남지 않게
        if (sortConfig.key === 'diffAbs' || sortConfig.key === 'diff') sortConfig = { key: 'mibal', dir: 'desc' };   // 숨긴 '차이' 열 정렬 → 미발수량 큰 순
    }
    if (allRows.length) applyFilters();                                       // 칸 수(colspan)·정렬을 새로 반영
    applyColWidths();                                                         // 보기마다 따로 기억한 열 너비
    if (save) { try { localStorage.setItem(COLS_KEY, simple ? 'simple' : 'full'); } catch (e) { /* 기억 못 해도 보기는 바뀐다 */ } }
}

// ── 열 너비 조절 — 머리글 오른쪽 끝(.col-grip)을 끌면 그 열 너비가 바뀐다 ──
// 처음 끌 때 보이는 열 너비를 모두 재서 고정 너비 표(.cols-fixed)로 바꾼다(자동 너비 표는 내용보다 좁게 못 줄인다).
// 보기(간단히/전체)마다 { 열 이름: px } 로 이 브라우저에 기억 — 열 이름 = th 의 data-sort(No·플래그는 'no'·'flags').
// 열 번호가 아니라 이름이라 나중에 열을 중간에 넣어도 기억한 너비가 옆 열로 밀리지 않는다.
const WIDTH_KEY = 'mibal2.colWidths';
const COL_MIN = 36;
const DRAG_START_PX = 3;   // 이만큼 움직여야 끌기로 본다(누르기만 하면 아무것도 바꾸지 않는다)
let justResized = false;   // 끌기를 막 끝낸 직후의 click 이 정렬로 새지 않게
const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function loadColWidths() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(WIDTH_KEY) || '{}'); } catch (e) { raw = null; }
    const out = {};
    if (!isPlainObj(raw)) return out;
    ['simple', 'full'].forEach(mode => {
        if (!isPlainObj(raw[mode])) return;
        const m = {};
        Object.entries(raw[mode]).forEach(([k, v]) => { if (Number.isFinite(v) && v >= COL_MIN) m[k] = Math.round(v); });
        if (Object.keys(m).length) out[mode] = m;
    });
    return out;
}
let colWidths = loadColWidths();
const headCells = () => [...document.querySelectorAll('.list-table thead th')];
const colKey = (th, i, all) => th.dataset.sort || (i === 0 ? 'no' : (i === all.length - 1 ? 'flags' : 'c' + i));
const isShown = (el) => getComputedStyle(el).display !== 'none';
const curMode = () => (document.body.dataset.cols === 'simple' ? 'simple' : 'full');
function saveColWidths() { try { localStorage.setItem(WIDTH_KEY, JSON.stringify(colWidths)); } catch (e) { /* 기억 못 해도 지금 화면은 바뀐다 */ } }
function applyColWidths() {
    const table = document.querySelector('.list-table');
    if (!table) return;
    const saved = colWidths[curMode()];
    const ths = headCells();
    table.classList.remove('cols-fixed');
    table.style.width = '';
    ths.forEach(th => { th.style.width = ''; });   // 기본 너비는 CSS 에만 둔다(No 36px 포함)
    const has = !!saved && Object.keys(saved).length > 0;
    const reset = $('btn-col-reset');
    if (reset) reset.style.display = has ? '' : 'none';
    if (!has) return;
    // 기억에 없는 열(나중에 생긴 열 등)은 지금 자동 너비를 그대로 쓴다
    const w = ths.map((th, i, all) => (isShown(th) ? (saved[colKey(th, i, all)] || Math.ceil(th.getBoundingClientRect().width)) : 0));
    ths.forEach((th, i) => { if (w[i]) th.style.width = w[i] + 'px'; });
    table.style.width = w.reduce((x, y) => x + y, 0) + 'px';
    table.classList.add('cols-fixed');
}
function setupColResize() {
    const table = document.querySelector('.list-table');
    headCells().forEach((th, idx, all) => {
        const key = colKey(th, idx, all);
        const grip = document.createElement('span');
        grip.className = 'col-grip';
        grip.title = '끌어서 열 너비 조절';
        grip.addEventListener('click', (e) => e.stopPropagation());
        grip.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            const mode = curMode();
            const startX = e.clientX;
            let started = false, startW = 0, startT = 0;
            const begin = () => {
                started = true;
                if (!table.classList.contains('cols-fixed')) {
                    // 처음 끄는 것 — 지금 보이는 열 너비를 다 재서 기억하고 고정 너비로 바꾼다
                    const snap = {};
                    headCells().forEach((h, i, a) => { if (isShown(h)) snap[colKey(h, i, a)] = Math.ceil(h.getBoundingClientRect().width); });
                    colWidths[mode] = snap;
                    applyColWidths();
                }
                startW = th.getBoundingClientRect().width;
                startT = table.getBoundingClientRect().width;
                grip.classList.add('dragging');
                document.body.classList.add('col-resizing');
            };
            const move = (ev) => {
                if (!started) {
                    if (Math.abs(ev.clientX - startX) < DRAG_START_PX) return;
                    begin();
                }
                const nw = Math.max(COL_MIN, Math.round(startW + ev.clientX - startX));
                th.style.width = nw + 'px';
                table.style.width = Math.round(startT + nw - startW) + 'px';
            };
            // 창(window)에 건다 — 포인터가 7px 손잡이를 벗어나도, 포커스가 바뀌어도 끌기가 끝까지 정리된다
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
                window.removeEventListener('blur', up);
                if (!started) return;   // 누르기만 했다 — 아무것도 바꾸지 않는다
                grip.classList.remove('dragging');
                document.body.classList.remove('col-resizing');
                (colWidths[mode] = colWidths[mode] || {})[key] = Math.round(th.getBoundingClientRect().width);
                saveColWidths();
                justResized = true;
                setTimeout(() => { justResized = false; }, 0);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
            window.addEventListener('pointercancel', up);
            window.addEventListener('blur', up);
        });
        th.appendChild(grip);
    });
    $('btn-col-reset').addEventListener('click', () => {
        delete colWidths[curMode()];
        saveColWidths();
        applyColWidths();
    });
}

// ── 이벤트 ───────────────────────────────────────────────────
function setupEvents() {
    setupColResize();
    let savedCols = null;
    try { savedCols = localStorage.getItem(COLS_KEY); } catch (e) { /* 무시 */ }
    setCols(savedCols, false);
    $('btn-cols-simple').addEventListener('click', () => setCols('simple', true));
    $('btn-cols-full').addEventListener('click', () => setCols('full', true));
    setupDatePopup();
    $('search-input').addEventListener('input', applyFilters);
    $('chk-diff-only').addEventListener('change', applyFilters);
    $('chk-check-only').addEventListener('change', applyFilters);
    $('btn-excel').addEventListener('click', downloadExcel);
    $('btn-refresh').addEventListener('click', () => requestRefresh(false));
    $('btn-save-compare').addEventListener('click', saveCompare);
    $('btn-view-live').addEventListener('click', () => setView('live'));
    $('btn-view-daily').addEventListener('click', () => setView('daily'));
    $('daily-select').addEventListener('change', (e) => loadDaily(e.target.value));
    document.querySelectorAll('.list-table th.sortable').forEach(th => th.addEventListener('click', () => {
        if (justResized) return;   // 열 너비를 끌다 놓은 click
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
    // 공통 상단바 개인 알림(P2) — 같은 문서의 memberEmails 로 이름을 찾아 넘긴다(추가 읽기 없음). 이름은 메모리에만.
    const memberName = memberNameFor(snap.exists() ? snap.data().memberEmails : null, user.email);
    if (memberName && auth.currentUser && auth.currentUser.uid === user.uid) setShellContext({ signedIn: true, uid: user.uid, memberName });
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
    setLoading(true, '설정·로케이션·기존 계산기 미발수량 불러오는 중...');
    try { const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); if (p && p.atMs) pending = p; } catch (e) {}
    renderRefreshUI();
    const results = await Promise.allSettled([loadConfig(), loadEditedCells(), loadLocations(), loadOldSnapshot().then(s => { oldSnap = s; }), loadSettings()]);
    const names = ['CONFIG', 'EDITED_CELLS', 'Locations', '기존 계산기 미발수량', 'settings'];
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
        if (busyBannerStop) busyBannerStop.refresh();   // 요청 대기·'방금 갱신됨'은 latest 로 판정한다
        if (!firstServerSeen && !snap.metadata.fromCache) { firstServerSeen = true; maybeAutoRequest(); }
    }, (err) => {
        setLoading(false);
        console.error('[mibal2] mibal2Latest 구독 실패:', err);
        $('status-chip').className = 'status-chip red';
        $('status-chip').textContent = '● 수집 자료 읽기 실패';
        $('status-err').textContent = errText(err);
    });
    // '갱신 중' 띠 — 이지어드민 잠금 + 갱신 요청 문서. '방금 갱신됨'은 이미 구독 중인 mibal2Latest 로(추가 구독 없음)
    busyBannerStop = mountBusyBanner({ db, el: $('busy-banner'), sources: [
        { path: LEASE_PATH, kind: 'lease' },
        { path: REQUEST_PATH, kind: 'mibalRequest', latest: () => latest }
    ], extra: (now) => [latestDoneView(latest, now)], onState: (v) => { busyViews = v || {}; renderRefreshUI(); } });
}

document.body.dataset.view = 'live';
setupEvents();
if (auth) onAuthStateChanged(auth, (user) => { if (user) start(user); });
else { setLoading(false); $('status-err').textContent = 'Firebase 초기화 실패 — 새로고침해 보세요'; }
