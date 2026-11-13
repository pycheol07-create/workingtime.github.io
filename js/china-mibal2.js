// === js/china-mibal2.js ===
// 신규 미발계산기(시험) — 기존 '중국제작 미발계산기'와 나란히 비교하는 화면. 설계: 업무자동화\앱\미발계산기2\설계.md
//
// 계산은 js/lib/mibal2-rows.js computeRows(입력 묶음 → 행) 하나로 한다.
//   · 오늘(실시간): integrations/mibal2Latest + 지금의 CONFIG·EDITED_CELLS·Locations·기존 미발
//   날짜별 비교(수집기 사본 mibal2Daily_*·수동 저장 compare_*)는 2026-10-28 사용자 결정으로 없앴다(이미 쌓인 문서는 그대로 둠)
//
// 읽기: integrations/mibal2Latest (Apps Script 가 씀) · ChinaStockGoods/CONFIG · ChinaStockGoods/EDITED_CELLS ·
//       Locations(ZONE_*) · ChinaStockGoods_ScanDB_Versions(없으면 ChinaStockGoods_ScanDB) · mibal2/settings ·
//       config/mainConfig(입장 판정만 — 관리자 또는 'china.mibal2' 권한, js/lib/mibal2-access.js)
//       + 스캐너 연동(시험 — 읽기 전용, js/china-mibal2-scan.js): ChinaStockGoods_InboundHistory 구독(입고확인 — 부족수량 보기에
//         처음 들어갈 때 한 번, 미리보기 엑셀도 이 값을 같이 씀) · [비축창고 보기] FLOOR2_STOCK·LOC_SHARD_0~7 구독 ·
//         [입고 오차 통계] ChinaStockGoods_InboundDiff 기간 읽기 · [스캐너 값 미리보기 엑셀] ChinaStockGoods_ScanDB 누를 때 1회 읽기
//       + 위치지정(시험 — 보기·엑셀 받기만, js/china-mibal2-loc.js): 그 보기에 처음 들어갈 때 비축창고·위치 구독(위와 공유)과
//         미발재고로그 1회 읽기. 이 파일은 그 자료를 직접 읽지 않는다. 보기 선택은 이 브라우저에만 기억(localStorage mibal2.view)
//       표의 입고확인·차이(도착−입고) 열·'선택 출고일 밖 입고' 행 — 2026-10-27 에 뺐다가 2026-10-28 다시 넣음(사용자 결정: 기능은 다 넣고 쓰기는 꺼 둠)
//       + live 에서 출고일을 바꿀 때 ChinaStockGoods_Archive(ships array-contains-any, 캐시) — 마감한 출고일이면 입고확인 = 보관함 기록(2026-11-12)
// 쓰기: artifacts/team-work-logger-v2/mibal2/{settings, refreshRequest} 2종만. 그 외 쓰기 0건.
//       운영 스캐너 자료(ScanDB·InboundHistory·FLOOR2_STOCK·FORCE_ALLOW·ScanDB_Versions·LOC_SHARD·InboundDiff)에는 쓰지 않는다
//       — 그 쓰기 버튼은 화면에서 disabled('시험 모드 — 꺼짐'). tests/mibal2-readonly.test.js 가 소스를 검사한다.
//       예외(2026-11-04 사용자 결정): 입고확인 칸을 고치고 아래 막대 [저장]을 누르면 js/inbound-fix-write.js(그때만 동적 import)가
//       입고이력 수정 문서(fix__{코드})와 스캐너 남은 도착(문서가 있을 때만 arrivalQty·mibalQty)에 쓴다 — 시험 화면에서도 운영 자료다(확인창에 알림).
//       이메일 등 사용자 정보는 어디에도 저장하지 않는다.
//
// ⚠️ js/china-stock-goods.js 는 import 하지 않는다 — 로드만 해도 ScanDB 를 지우고 다시 쓴다.
//    도착수량 규칙(applyDates·withinGrace)은 그 파일을 읽고 lib/mibal2-rows.js 에 같게 옮겼다.
//
// 단독 운영(live, 2026-10-28 준비 — 상수 js/lib/mibal2-mode.js MIBAL2_LIVE, 지금은 false):
//   live 일 때만 js/china-mibal2-live.js 를 동적 import 한다(스캐너에 반영·작업 마감·보관·입고오차·미발이력·위치 쓰기·관리 창).
//   이 파일에는 그 쓰기가 없다. live 면 출고일은 기존 계산기(CONFIG.savedDatesMibal)를 보지 않고 mibal2/settings 만 쓴다.
//   false(지금)면 아래 동작은 예전과 같다 — tests/mibal2-readonly.test.js 가 본다.
import { initializeFirebase } from './china-stock-config.js?v=202611130915'; // 게이트(china-stock-gate.js)와 '똑같은 주소' → 모듈 한 번만 생성
import { doc, getDoc, getDocFromServer, getDocs, getDocsFromServer, setDoc, onSnapshot, collection, query, where, orderBy, limit, documentId, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { explain } from './lib/mibal2-calc.js?v=202611130915';
import { sortMark } from './lib/china-stock-view.js?v=202611130915';
import {
    listShipDates, buildLocIndex, computeRows, summarize, FLAG_INFO, excelAoaOf,
    graceDaysFrom, legacyDatesFrom, selectedDatesFrom, oldMapFromScan
} from './lib/mibal2-rows.js?v=202611130915';
import { setShellContext } from './app-shell-bridge.js?v=202611130915';
import { memberNameFor } from './app-shell-data.js?v=202611130915';
import { mountBusyBanner } from './busy-banner.js?v=202611130915';
import { latestDoneView, collectorQuiet } from './lib/busy-view.js?v=202611130915';
import { friendlyFirebaseError } from './utils.js?v=202611130915';
import { diffOf } from './lib/inbound-diff.js?v=202611130915';
import { confirmedOf, outsideInboundOf, byShipOf } from './lib/scan-link.js?v=202611130915';
import { scanLogHtml } from './lib/mibal2-scanlog.js?v=202611130915';
import { fixTipOf, liveBaseOf, pendingSet, batchRowsOf, batchConfirmText, runBatch, pendingAfterBatch, batchResultText, failReasonText, failLinesOf } from './lib/inbound-fix.js?v=202611130915';
import { createFixBar, afterClick } from './inbound-fix-bar.js?v=202611130915';
import { mibal2Access, MIBAL2_DENIED_MSG } from './lib/mibal2-access.js?v=202611130915';
import { subscribeInbound, setupScanTools } from './china-mibal2-scan.js?v=202611130915';
import { setupLocMode } from './china-mibal2-loc.js?v=202611130915';
import { isMibal2Live } from './lib/mibal2-mode.js?v=202611130915';
import { liveDatesFrom } from './lib/mibal2-rows.js?v=202611130915';
import { stableSig, ARCHIVE_COLL } from './lib/mibal2-live.js?v=202611130915';
import { bestShipOf, mismatchLine, codeListText } from './lib/ship-mismatch.js?v=202611130915';   // 출고일 불일치(2026-11-10)
import { writeXls } from './lib/xls-limits.js?v=202611130915';
import { readHash, writeHash, onHashNav } from './hash-state.js?v=202611130915';   // live 때만 씀(빠른 이동 #tab=mibal|location)
import { refreshDoneAuto, claimOk, claimMine, autoStopText, serverBatchOpen, AUTO_CLAIM_KEY, AUTO_TOAST_MS } from './lib/mibal2-auto-apply.js?v=202611130915';
// 마감된 작업 보기(2026-11-12) — 마감한 출고일을 다시 고르면 입고확인 = 보관함 기록
import { closedQueryDates, closedCacheKey, closedViewOf, closedNoteLines } from './lib/mibal2-closed-view.js?v=202611130915';
import { COLS_PICK_KEY, LEGACY_COLS_KEY, DEFAULT_ON, REQUIRED, pickableCols, normalizeOn, colsFromStorage, serializeCols, toggleCol,
    hiddenCss, colsMode, visibleCount } from './lib/mibal2-cols.js?v=202611130915';

const { db, auth } = initializeFirebase();
const LIVE = isMibal2Live();   // 단독 운영인가(지금은 false — 에뮬레이터 시험 주소 ?emu=1&live=1 에서만 true)
const ALL_GRACE_DAYS = 36500;  // live 작업 마감 계산용 — 유예를 사실상 끈다

const BASE = 'artifacts/team-work-logger-v2';
const LATEST_PATH = BASE + '/integrations/mibal2Latest';
const SETTINGS_PATH = BASE + '/mibal2/settings';
const REQUEST_PATH = BASE + '/mibal2/refreshRequest';
const LEASE_PATH = BASE + '/integrations/ezadminLease';   // 이지어드민 잠금(계약 A) — 미발수집·채우기가 쓰고 여기는 읽기만
const CHINA_COLLECTION = 'ChinaStockGoods';

const DIFF_BIG = 5;                     // |3층−기존| 이 이 값 이상이면 빨강 강조 (사용자 결정 2026-10-07)
const REQUEST_IGNORE_MS = 10 * 60000;   // 수집기 REQUEST_IGNORE_MS 와 같다 — 마지막 성공 후 이 안의 요청은 수집기가 무시한다
const WORK_HOUR_FROM = 7, WORK_HOUR_TO = 19;   // 수집기 요청확인() 이 도는 시간(월~토)
const VERSIONS_LIMIT = 30;              // 최근 버전 몇 개 안에서 'upload' 를 찾을지 (china-stock-goods.js:1935 MAX_SCANDB_VERSIONS 와 같은 수)
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
let ctx = null;                // 지금 보기의 근거 표시용 정보(detail·안내줄)
let viewMode = 'live';         // 'live'(부족수량 오늘) | 'loc'(위치지정 시험)
let locTools = null;           // setupLocMode 반환 { enter, refresh } — 입장 판정 뒤에 만든다
let allRows = [];
let viewRows = [];
let sortConfig = LIVE ? { key: 'mibal', dir: 'desc' } : { key: 'diffAbs', dir: 'desc' };   // live 는 기존 비교 열이 없다
let expanded = new Set();
let pending = null;            // 지금 갱신 요청 대기 { atMs, baseRun, baseNoteAt }
let firstServerSeen = false;   // 서버에서 온 첫 mibal2Latest 를 봤는지(자동 요청 판단용)
let autoApplyDue = false;      // 이 PC 의 수동 갱신 요청이 성공으로 끝남 — 다음 서버 스냅샷에서 자동 [스캐너에 반영](live 만)
let autoApplyRid = '';         // 그 요청 id
const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);   // 이 탭(메모리에만 — 탭 복제해도 새로 만든다)
/**
 * 자동 반영 — 같은 PC 의 여러 탭(탭 복제로 대기 요청이 같이 복사됨) 중 요청 id 를 먼저 잡은 탭만(localStorage, 짧은 만료).
 * 동시에 잡으면 잠시 뒤 다시 읽어 마지막에 쓴 탭만 남는다. 서버 작업 표시 재확인은 live.autoApply 안에서(쓰기 직전)
 */
async function runAutoApply(rid) {
    const read = () => { try { return JSON.parse(localStorage.getItem(AUTO_CLAIM_KEY) || 'null'); } catch (e) { return undefined; } };
    const other = () => showToast('ℹ️ 갱신이 끝났습니다 — 이 PC 의 다른 탭이 스캐너에 반영합니다', AUTO_TOAST_MS);
    const cur = read();
    if (cur === undefined) { showToast(autoStopText('이 PC 의 다른 탭과 겹치는지 확인하지 못했습니다'), AUTO_TOAST_MS); return; }
    if (!claimOk(cur, rid, TAB_ID)) { other(); return; }
    try { localStorage.setItem(AUTO_CLAIM_KEY, JSON.stringify({ rid, tab: TAB_ID, at: Date.now() })); }
    catch (e) { showToast(autoStopText('이 PC 의 다른 탭과 겹치는지 확인하지 못했습니다'), AUTO_TOAST_MS); return; }
    await new Promise(r => setTimeout(r, 400));
    if (!claimMine(read(), rid, TAB_ID)) { other(); return; }
    live.autoApply();
}
let started = false;
let isAccessOk = false;        // 입장 판정(관리자 또는 china.mibal2 권한) 통과 전에는 어떤 쓰기도 하지 않는다
// 스캐너 연동(시험 — 읽기 전용)
let inboundMap = {};           // ChinaStockGoods_InboundHistory barcode 별 qty 합(미발 초기화 이후 전체)
let scanLogByCode = null;      // 상품별 스캔 내역(단독 운영만, 입고이력 구독과 같은 스냅샷 — lib/mibal2-scanlog.js liveScanLogOf)
let inboundKnown = false;      // 입고이력을 한 번이라도 받았는지
let inboundErr = '';           // 입고이력 구독 실패 문구
let inboundStarted = false;    // 입고이력 구독을 걸었는지(한 번만 — 부족수량 보기에 처음 들어갈 때)
let fixMap = {};               // 입고확인 수동 수정(fix__ 문서) { code: {qty, rev, log(마지막 1건)} } — js/lib/inbound-fix.js
let scanOnlyMap = {};          // 스캔 문서만의 합(툴팁용)
let scanProbeMap = {};         // 상품별 스캔 문서 id 하나 — 입고확인 대기 항목에 적어 [저장] 때 입고이력이 비워졌는지 본다
let fixBusy = false;           // 입고확인 수정 기록 중(두 번 기록 방지)
let pendingFix = {};           // 입고확인 저장 대기 { code: {after, shown, at, reason?} } — 표 자료와 따로(그릴 때 덧칠)
let fixBar = null;             // 화면 아래 '입고확인 수정 n건 [저장] [취소]' 막대(js/inbound-fix-bar.js)
let fixProgress = null;        // 저장 중 { done, total }
let renderDeferred = false;    // 입고확인 칸에 커서가 있어 미뤄 둔 다시 그리기
let busyViews = {};            // '갱신 중' 띠 판정 { lease, mibalRequest } — js/busy-banner.js onState
let busyBannerStop = null;     // 띠 해제 함수(.refresh() 로 다시 그림)
let busyMsg = '';              // 띠 상태 때문에 refresh-msg 에 넣은 문구(상태가 풀리면 이것만 지운다)
let accessIsAdmin = false;     // 입장 판정의 관리자 여부(live 관리 창의 관리자 전용 칸에만 씀)
let myMemberName = '';         // 직원 이름(메모리에만 — live 의 입고 오차 기록자·보관 기록자)
let live = null;               // 단독 운영 도구(js/china-mibal2-live.js startLive 반환) — live 일 때만
let resultMsg = '';            // clearPending 안내(완료·실패·거절) — busy 문구가 덮었다가 풀리면 다시 보여 준다
// 마감된 작업 보기(live 만) — null(입고이력) | { key, loading:true } | { key, view(closedViewOf) } | { key, error }
let closedView = null;
const closedCache = new Map();  // 캐시 키(출고일 + 마지막 마감 번호) → 보관 목록 [{id, ships, closedAtMs, rows:[{c,q}]}]
let closedOverrideKey = '';     // [지금 입고이력으로 보기]를 누른 키(이 화면에서만, 저장 안 함)
let closedOverrideView = null;  // 그 키의 보관함 판정(쓰기 전 '이미 마감된 작업 — 새 작업으로?' 확인창용)
let closedReq = 0;
let closedPending = null;       // 보관함 읽는 중(Promise) — closedSettled 가 기다린다
/** 입고확인을 고치거나 고른 출고일 기준으로 쓰면 안 되나 — 보관함 기록을 보는 중 · 읽는 중 · 못 읽음(fail-closed) */
const closedBlocks = () => !!(closedView && (closedView.loading || closedView.view || closedView.error));
/** 막는 까닭 '' | 'closed'(보관함 기록·읽는 중) | 'error'(보관함을 확인하지 못함) */
const closedKind = () => (!closedBlocks() ? '' : closedView.error ? 'error' : 'closed');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** 숫자 칸 — 값은 늘 Number() 로 강제해서 넣는다(수집 자료에 글자가 섞여도 HTML 이 되지 않게) */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? String(n) : '?'; };
const numOr = (v, dash = '–') => (v === null || v === undefined || v === '') ? `<span class="muted">${dash}</span>` : num(v);
// 오류 → 직원이 할 수 있는 일 한 줄(원시 Firebase 코드 대신). '권한 확인 전'은 아래 저장 함수들이 직접 던지는 오류
function errText(e) {
    if (e && !e.code && e.message === '권한 확인 전') return '권한 확인 전입니다 — 잠시 뒤 다시 시도하세요';
    return friendlyFirebaseError(e);
}
let toastTimer = 0;
function showToast(msg, ms = 2800) {   // ms — 자동 반영 결과처럼 길게 보일 때(js/lib/mibal2-auto-apply.js AUTO_TOAST_MS)
    const t = $('toast'); if (!t) return;
    t.innerText = msg; t.classList.add('show');
    clearTimeout(toastTimer);   // 앞 토스트의 타이머가 새 토스트를 일찍 지우지 않게
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
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

// ─────────────────────────────────────────────────────────────
// 화면
// ─────────────────────────────────────────────────────────────
function sortKeyVal(r, key) {
    if (key === 'name') return (r.name + ' ' + r.option).toLowerCase();
    if (key === 'code' || key === 'loc') return String(r[key] || '');
    if (key === 'conf') { const n = parseInt(r.conf); return isNaN(n) ? null : n; }   // 빈칸·수동 글자 → 모름(아래로)
    return r[key];
}
function applyFilters() {
    const q = ($('search-input').value || '').trim().toLowerCase();
    const diffOnly = !LIVE && $('chk-diff-only').checked;   // live 는 기존 비교값이 없어 이 거르기를 쓰지 않는다(받기 파일에서 상품이 빠지지 않게)
    const checkOnly = $('chk-check-only').checked;
    viewRows = allRows.filter(r => {
        // 차이 = 둘 다 있으면 값이 다를 때, 한쪽만 있으면(기존 값 없음·3층 모름) 그것도 차이로 본다. 기존에만 있는 상품은 행이 없다(10/28)
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
    return r.flags.map(f => { const [t, c] = FLAG_INFO[f] || [f, '']; return `<span class="flag ${esc(c)}">${esc(t)}</span>`; }).join('');
}
function oldSourceText(os) {
    if (!os) return '기존 계산기 미발수량 자료 없음';
    return os.kind === 'version'
        ? `버전기록 ${os.atMs ? mdhm(os.atMs) : '?'} (${esc(os.trigger)}${os.note ? ' · ' + esc(os.note) : ''})`
        : `현재 스캔 기록 ${os.atMs ? mdhm(os.atMs) : ''}`;
}

/** 행 상세의 스캔 내역 — 단독 운영(LIVE)일 때만 */
function scanLogDetail(r) {
    if (!LIVE || !scanLogByCode) return '';
    return `<div style="margin-top:8px;"><b>스캔 내역</b>${scanLogHtml(scanLogByCode[r.code], esc)}</div>`;
}
function detailHtml(r) {
    if (r.outside) {
        return `<ul><li><b>선택 출고일 밖 입고</b>: 선택한 출고일의 도착 목록에 없는 코드인데 앱 스캔 입고가 ${esc(num(r.conf))} 있습니다.
            다른 출고일 상품이거나 오더리스트에 없는 상품일 수 있습니다 — 신규 수집 자료에는 최근 출고 코드만 있어 구별하지 못합니다(기존 계산기 판정과 다를 수 있음).
            계산·스캐너 미리보기에서는 뺍니다.</li></ul>${scanLogDetail(r)}`;
    }
    const c = ctx || {};
    const range = c.range || {};
    const fmtEntry = (e) => `${esc(e[0])} 출고 ${e[1] ? '→ ' + esc(e[1]) + ' 본사도착' : '(도착일 없음)'} · ${num(parseInt(e[2]) || 0)}장`;
    const used = r.arrUsed.length ? r.arrUsed.map(fmtEntry).join('<br>') : '<span class="muted">선택한 출고일에 해당 없음</span>';
    const skipped = r.arrSkipped.length ? `<br><span class="t-risk">유예 지나 제외: ${r.arrSkipped.map(fmtEntry).join(' / ')}</span>` : '';
    const li = r.locInfo;
    const loc = li
        ? `${esc(li.id)}${li.count > 1 ? ` (이 코드 자리 ${num(li.count)}곳 중 ${li.etcOnly ? '기타 자리' : '피킹용'} 첫 자리)` : ''}`
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
            <li><b>접수·송장</b>: 이지어드민 → Apps Script 수집 (${esc(c.okMs ? mdhm(c.okMs) : '시각 모름')} 성공분 · 접수 ${esc(range['접수From'] || '?')}~ · 송장 ${esc(range['송장From'] || '?')}~)
                — 접수 ${numOr(r.recv)} · 송장 ${numOr(r.inv)}</li>
            <li><b>도착 ${esc(num(r.arr))}</b>: 오더/사입리스트 출고 기록(shipJson ${esc(c.asOf || '?')}) 중 선택 출고일 · 본사도착 유예 ${esc(num(c.graceDays))}일<br>${used}${skipped}</li>
            <li><b>로케이션</b>: ${loc} (로케이션관리 Locations)</li>
            <li><b>적재량 ${esc(num(r.cap))}</b>: ${esc(r.capSrc)}</li>
            <li><b>기존 계산기 미발수량</b>: ${oldTxt}</li>
            <li><b>기존공식×신규입력</b>: ${esc(oldNewTxt)}</li>
            ${confDetailHtml(r)}
        </ul>${scanLogDetail(r)}`;
}

/** 계산 근거의 입고확인 줄 — 출고일별 도착(byShip)과 함께 */
function confDetailHtml(r) {
    if (r.confSrc === undefined) return '';
    const srcTxt = (closedView && closedView.view && r.confSrc === 'scan') ? `보관함 마감 기록(작업 ${esc(closedView.view.ids.join(', '))})`
        : r.confSrc === 'scan' ? '앱 스캔 입고 합(미발 초기화 이후 전체 — 출고일 구분 없음)'
        : r.confSrc === 'manual' ? '기존 계산기에 손으로 넣은 값(EDITED_CELLS)' : '빈칸 = 미스캔';
    const bs = Object.entries(byShipOf(r.arrUsed)).sort((a, b) => a[0].localeCompare(b[0])).map(([d, q]) => `${esc(d)} ${num(q)}`).join(' · ');
    const dTxt = r.inDiff === null || r.inDiff === undefined ? '–' : r.noScan && r.inDiff > 0 ? `${num(r.inDiff)} (스캔 없음 — 전부 부족입고)` : (r.inDiff > 0 ? `${num(r.inDiff)} (부족입고)` : r.inDiff < 0 ? `${num(r.inDiff)} (과입고)` : '0');
    const cv = String(r.conf == null ? '' : r.conf);
    return `<li><b>입고확인</b>: ${cv.trim() === '' ? '<span class="muted">빈칸</span>' : esc(cv)} — ${esc(srcTxt)} · 차이(도착−입고확인) ${esc(dTxt)}${bs ? ` · 출고일별 도착 ${bs}` : ''}</li>`;
}

function renderTable() {
    // 입고확인 칸에 커서가 있으면 다시 그리기를 미룬다(구독 때문에 입력 중 글자가 날아가지 않게) — 칸을 나갈 때 한 번 그린다
    if (editingConfActive()) { renderDeferred = true; return; }
    renderDeferred = false;
    if (fixBar || Object.keys(pendingFix).length) updateFixBar();   // 표에 없는 대기 건수
    const tb = $('table-body');
    $('row-count').textContent = `${viewRows.length}행 / 전체 ${allRows.length}행`;
    // 안내 줄은 msg-row — [칸 설정] 열 숨김이 걸리지 않는다(js/lib/mibal2-cols.js hiddenCss)
    if (!latest) { tb.innerHTML = `<tr class="msg-row"><td colspan="${colSpan()}" class="t-risk" style="padding:50px;">수집 자료가 아직 없습니다. [지금 갱신]을 누르거나 07:30 자동 수집을 기다리세요.</td></tr>`; return; }
    if (selectedDates.length === 0 && allRows.length === 0) { tb.innerHTML = `<tr class="msg-row"><td colspan="${colSpan()}" class="t-3" style="padding:50px;">${(LIVE && settings && settings.lastClosedId && !settings.batch) ? '작업 마감됨 — 다음 출고일을 고르세요.' : '출고일을 선택하세요.'}</td></tr>`; return; }
    if (viewRows.length === 0) { tb.innerHTML = `<tr class="msg-row"><td colspan="${colSpan()}" class="t-3" style="padding:50px;">조건에 맞는 행이 없습니다.</td></tr>`; return; }
    let html = '';
    viewRows.forEach((r, i) => {
        const cls = ['data-row'];
        if (r.diff !== null && Math.abs(r.diff) >= DIFF_BIG) cls.push('diff-big');
        else if (r.diff !== null && r.diff !== 0) cls.push('diff-some');
        if (r.check) cls.push('need-check');
        const diffTxt = r.diff === null ? numOr(null) : (r.diff > 0 ? '+' + num(r.diff) : num(r.diff));
        const warnNum = (v) => (v > 0 ? `<b class="t-warn">${esc(num(v))}</b>` : numOr(v));
        html += `<tr class="${esc(cls.join(' '))}" data-code="${esc(r.code)}">
            <td>${i + 1}</td>
            <td class="code-cell">${esc(r.code)}</td>
            <td class="name-cell" title="${esc(r.name + (r.option ? ' / ' + r.option : ''))}">${esc(r.name)}${r.option ? ` <span class="t-3">/ ${esc(r.option)}</span>` : ''}</td>
            <td>${r.locInfo ? esc(r.loc) : '<span class="t-risk">미지정</span>'}</td>
            ${r.cap === null ? `<td>${numOr(null)}</td>` : `<td class="cap-cell" title="${esc(r.capSrc)}">${esc(num(r.cap))}<span class="cap-kind">${esc(r.capKind)}</span></td>`}
            <td><b>${esc(num(r.arr))}</b></td>
            ${confCellHtml(r)}
            ${inDiffCellHtml(r)}
            <td>${numOr(r.stock)}</td>
            <td>${numOr(r.bstock)}</td>
            <td>${r.pstock < 0 ? `<b class="t-risk">${esc(num(r.pstock))}</b>` : numOr(r.pstock)}</td>
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
    const c = ctx || {};
    const parts = [];
    parts.push(`<b>정상·접수·송장</b> ${esc(c.okMs ? mdhm(c.okMs) + ' 수집' : '수집 없음')}`);
    parts.push(`<b>도착</b> 시트 기준일 ${esc(c.asOf || '?')} · 유예 ${esc(num(c.graceDays))}일`);
    parts.push(`<b>적재량</b> 구역 설정 + 개별값 ${esc(num(c.editedCount))}개`);
    parts.push(`<b>로케이션</b> 로케이션관리 ${esc(num(c.locCount))}개 코드`);
    if (closedView && closedView.view) parts.push(`<b>입고확인</b> 보관함 마감 기록 ${esc(num(closedView.view.codes))}개 코드 · ${esc(num(closedView.view.total))}장(작업 ${esc(closedView.view.ids.join(', '))})`);
    else {
        const codes = Object.keys(inboundMap).filter(k => inboundMap[k]);
        const total = codes.reduce((x, k) => x + (inboundMap[k] || 0), 0);
        parts.push(`<b>입고확인</b> ${esc(inboundErr ? '읽기 실패' : inboundKnown ? `앱 스캔 ${num(codes.length)}개 코드 · ${num(total)}장(미발 초기화 이후 전체)` : '불러오는 중')} + 기존 계산기 수동값`);
    }
    if (c.oldSource) parts.push(`<b>기존 계산기 미발수량</b> ${oldSourceText(c.oldSource)}${c.oldSource.kind === 'live' ? ' — ⚠ 스캐너 입고분이 이미 빠져 있을 수 있음' : ''}`);
    const warns = [];
    if (c.parseError) warns.push(c.parseError);
    if (inboundErr) warns.push(`앱 입고이력을 읽지 못해 입고확인에 스캔분이 빠졌습니다 — ${inboundErr}`);
    const keep = parseInt(c.keepArrivedDays) || 0;
    if (keep && c.graceDays > keep) warns.push(`유예 ${c.graceDays}일이 수집 보관 ${keep}일보다 커서 오래 전 도착분은 빠집니다`);
    if (c.shipStaleDays) warns.push(`도착일 없이 출고 ${num(c.shipStaleDays)}일 넘은 기록은 수집에서 빠집니다(기존 화면은 포함)`);
    const os = c.oldSource;
    if (os && os.atMs && c.refDate && !sameDay(new Date(os.atMs), c.refDate)) warns.push('기존 계산기 미발수량 비교값이 오늘 것이 아닙니다');
    if (os && os.noUpload) warns.push(`최근 버전기록 ${VERSIONS_LIMIT}개 안에 '업로드' 버전이 없어 ${os.kind === 'version' ? `'${os.trigger}' 버전` : '현재 ScanDB'}로 비교합니다 — 스캐너 입고분이 빠져 있을 수 있음`);
    const rs = c.reserveStatus;
    if (!rs) warns.push('이 수집 자료에는 비축재고 없음 → 피킹 적재·비축 적재·피킹 배정수량을 계산 못 함(확인 필요)');
    else if (rs.status !== 'ok' || Number(rs.missing) > 0) warns.push(`비축재고 수집 ${rs.status} — 비축 미응답 코드 ${num(rs.missing)}개(그 코드는 비축재고 없음 → 피킹 적재·비축 적재·피킹 배정수량을 계산 못 함(확인 필요))`);
    box.innerHTML = parts.join(' · ') + (warns.length ? `<br><span class="t-risk">⚠ ${warns.map(esc).join(' / ')}</span>` : '');
}

// ── 스캐너 연동(시험 — 읽기 전용): 입고확인·차이(도착 − 입고확인) ──
// 입고확인 = 기존 계산기와 같은 규칙(lib/scan-link.js confirmedOf) — 앱 스캔 합(미발 초기화 이후 전체) → 수동값(EDITED_CELLS).
// 차이·색은 기존 화면 diffCellView 와 같다(lib/inbound-diff.js diffOf).
// opts.keepOutside — '선택 출고일 밖 입고' 행을 붙인다(live 계산 rowsFor: 작업 마감 보관(u:1)·입고 오차용). 화면 표는 붙이지 않는다(2026-11-10 — 고른 패킹 상품만, 대신 표 위 경고 줄)
function withScanLink(rows, im = inboundMap, opts) {
    rows.forEach(r => {
        // 단독 운영(live)에서는 손으로 넣은 입고확인(EDITED_CELLS.confirmed)을 쓰지 않는다 — 앱 스캔 기준만(문서는 그대로 둠)
        const c = confirmedOf(r.code, im, LIVE ? null : editedCells);
        const d = diffOf({ arrivalQty: r.arr, confirmed: c.confirmed, confSrc: c.confSrc });
        r.conf = c.confirmed;
        r.confSrc = d.src;                                  // 기존 setRowDiff 처럼 diffOf 결과(숫자 아닌 수동값 → none)
        r.inDiff = d.d;                      // 입고확인이 없으면 입고 0 으로 보고 차이 = 도착(2026-11-04 — 예전엔 '–')
        r.noScan = d.src === 'none';
    });
    // 표에 없는데 앱 스캔 입고가 있는 코드 — 신규 스냅샷에는 최근 출고 코드만 있어 '미등록' 인지는 모른다
    //   표에 아는 행이 하나도 없으면(출고일 미선택·수집 자료 없음·구독 순서) 붙이지 않는다 — 스캔 전부가 '출고일 밖'으로 보이고 '출고일을 선택하세요' 안내가 사라진다
    if (!rows.length) return rows;
    if (opts && opts.keepOutside) {
        outsideInboundOf(im, rows.map(r => r.code), null).forEach(({ code, qty }) => rows.push(outsideRow(code, qty)));
        return rows;
    }
    // 화면 표 — 기본은 입고확인을 손으로 고친 상품(수정 문서)만 남긴다(합 0 이어도 — 되돌릴 칸이 있게, 2026-11-04). 나머지 밖 입고는 표 위 경고 줄로.
    //   경고 줄의 [밖 입고 행 보기]를 켜면 전부 펼친다(입고확인을 고칠 수 있게 — 막힌 마감·반영을 푸는 길)
    if (im === inboundMap) outsideInboundOf(im, rows.map(r => r.code), fixMap).forEach(({ code, qty }) => { if (showOutside || fixMap[code]) rows.push(outsideRow(code, qty)); });
    return rows;
}
// ── 출고일 불일치(2026-11-10) — 입고 스캔에는 패킹(출고일) 표시가 없어, 다른 출고일을 고른 채 마감하면 그 이름으로 보관된다 ──
// 표에서 뺀 '선택 출고일 밖 입고' 상품 수 + 가장 잘 맞는 출고일(js/lib/ship-mismatch.js)을 표 위에 한 줄로
let mismatch = null;   // { outside, codes, best, bestInShips } — 표에 아는 행이 없거나(출고일 미선택 등) 밖 입고가 없으면 null
let showOutside = false;   // [밖 입고 행 보기] — 이 화면에서만(기본 숨김)
function computeMismatch() {
    if (closedBlocks()) { mismatch = null; return; }   // 마감된 작업 보기 — 지금 입고이력과 견주지 않는다
    const inRows = allRows.filter(r => !r.outside);
    if (!inRows.length) { mismatch = null; return; }
    // 수정 문서가 있는 밖 상품(표에 남은 행)도 센다
    const codes = outsideInboundOf(inboundMap, inRows.map(r => r.code), fixMap).map(x => x.code);
    if (!codes.length) { mismatch = null; return; }
    const best = bestShipOf(inboundMap, ship.items || {}, selectedDates);
    mismatch = { outside: codes.length, codes, best, bestInShips: !!best && selectedDates.includes(best.date) };
}
function renderMismatch() {
    let el = $('ship-mismatch');
    if (!el) {
        el = document.createElement('div');
        el.id = 'ship-mismatch';
        el.className = 'src-note live-only t-risk';
        el.setAttribute('role', 'status');
        const note = $('src-note');
        note.parentNode.insertBefore(el, note.nextSibling);
    }
    if (!mismatch || viewMode !== 'live') { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = mismatchLine(mismatch.outside, mismatch.best, mismatch.bestInShips) + ' ';
    const btn = (id, text, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.id = id; b.className = 'd-btn d-btn-sm'; b.textContent = text; b.style.marginLeft = '4px';
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        el.appendChild(b);
    };
    if (mismatch.best && !mismatch.bestInShips) { const d = mismatch.best.date; btn('btn-ship-mismatch', '그 출고일로 보기', () => pickDates([d])); }
    btn('btn-ship-outside', showOutside ? '밖 입고 행 숨기기' : '밖 입고 행 보기', () => { showOutside = !showOutside; recomputeAndRender(); });
    const list = document.createElement('div');
    list.id = 'ship-mismatch-codes';
    list.className = 't-3';
    list.textContent = '출고일 밖 상품: ' + codeListText(mismatch.codes);
    el.appendChild(list);
}
/** 출고일을 이것으로 바꾼다 — 출고일 창에서 고르고 닫은 것과 같다(저장 규칙 포함) */
function pickDates(dates) {
    if ($('date-dropdown-popup').style.display === 'block') return;
    popupSnapshot = JSON.stringify([...selectedDates].sort());
    selectedDates = dates.map(String);
    renderDateList();
    onDatePopupClosed();
}
/** '선택 출고일 밖 입고' 행 — 계산 칸은 모두 모름(–). 스캐너 미리보기에서는 뺀다(r.outside) */
function outsideRow(code, qty) {
    const it = (ship.items || {})[code] || {};
    const li = locIndex[code] || null;
    const d = diffOf({ arrivalQty: 0, confirmed: qty, confSrc: 'scan' });
    return {
        code, name: it.nm || '', option: it.op || '', loc: li ? li.id : '미지정', locInfo: li,
        cap: null, capSrc: '', capKind: '', arr: 0, arrUsed: [], arrSkipped: [],
        stock: null, bstock: null, pstock: null, recv: null, inv: null, out: null, short: null, mibal: null, unres: null,
        remArr: null, pickAfter: null, resAfter: null, room: null, pick: null, resv: null, refill: null, third: null,
        old: null, oldArr: null, oldNew: null, shortage: null, diff: null, diffAbs: -1,
        flags: ['outsideIn'], check: false, input: null, res: null,
        outside: true, conf: qty, confSrc: d.src, inDiff: d.d, noScan: d.src === 'none'
    };
}
/** 입고확인 칸 — 기존 화면과 같은 색: 도착과 다르면(빈칸=0 포함) 빨강, 같고 앱 스캔이면 파랑(서버 값 기준).
 *  칸 안에서 바로 고친다(conf-edit, 2026-11-04) — 저장 대기 값은 노랑으로 덧칠(conf-pending), 고친 적 있는 칸은 점선 테두리(conf-fixed) */
function confCellHtml(r) {
    if (r.confSrc === undefined) return `<td>${numOr(null)}</td>`;
    const mismatch = (parseInt(r.conf) || 0) !== (parseInt(r.arr) || 0);
    const fromApp = inboundMap[r.code] !== undefined;
    const fx = fixMap[r.code];
    const pd = pendingFix[r.code];
    const v = r.conf === null || r.conf === undefined ? '' : String(r.conf);
    if (closedBlocks()) {   // 마감된 작업 — 보관함 기록(회색, 고치기 없음). 읽는 중이면 '…', 못 읽었으면 입고이력 값(고치기 없음)
        const t = closedView.loading ? '보관함 기록 읽는 중' : closedView.error ? '보관함을 확인하지 못해 고치지 않습니다(연결 확인 후 출고일을 다시 고르세요)'
            : `보관함 기록(작업 ${closedView.view.ids.join(', ')}) — 마감된 작업이라 고치지 않습니다`;
        return `<td class="conf-closed" data-code="${esc(r.code)}" title="${esc(t)}">${closedView.loading ? '…' : esc(v)}</td>`;
    }
    const cls = ['conf-edit', mismatch ? 'conf-bad' : (fromApp ? 'conf-scan' : ''), fx ? 'conf-fixed' : '', pd ? 'conf-pending' : ''].filter(Boolean).join(' ');
    const title = [
        pd ? `저장 대기 — 원래 값 ${v === '' ? '빈칸' : v}` + (pd.reason ? ` · 지난 [저장] 때 기록 안 됨: ${failReasonText(pd.reason)}` : '') : '',
        mismatch ? '입고확인 ≠ 도착수량 — 수량 확인 필요' : (fromApp ? '앱 스캔 입고 합(미발 초기화 이후)' : (r.confSrc === 'manual' ? '기존 계산기 입고확인 수동값' : '')),
        fx ? fixTipOf(scanOnlyMap[r.code] || 0, fx) : '',
        '눌러서 고친 뒤 아래 [저장]'
    ].filter(Boolean).join('\n');
    const editable = isAccessOk ? ' contenteditable="true"' : '';
    return `<td class="${cls}" data-code="${esc(r.code)}"${editable} title="${esc(title)}">${esc(pd ? pd.after : v)}</td>`;
}

// ── 입고확인 수동 수정 — 여러 칸 고친 뒤 [저장] (2026-11-04 사용자 요청) ──
// 칸을 나가면 대기(pendingFix)에만 넣는다. [저장] 때 쓰기 모듈(js/inbound-fix-write.js)을 그때만 불러와 서버 값을 새로 읽고,
// 확인창 뒤 건마다 입고이력 수정 문서(fix__)와 스캐너 남은 도착(문서가 있을 때만)에 기록한다. 계산·문구는 js/lib/inbound-fix.js.
// 시험 화면에서도 운영 자료에 기록된다(확인창에 알림). EDITED_CELLS 는 건드리지 않는다.
function editingConfActive() {
    const a = document.activeElement;
    return !!(a && a.classList && a.classList.contains('conf-edit') && a.closest && a.closest('#table-body'));
}
function flushDeferredRender() {
    if (!renderDeferred) return;   // 미뤄 둔 그리기가 있을 때만 — 그리기는 지금 클릭이 끝난 뒤(첫 클릭이 사라지지 않게)
    afterClick(() => { if (renderDeferred && !editingConfActive()) renderTable(); });
}
function updateFixBar() {
    if (!fixBar) fixBar = createFixBar({ onSave: () => saveConfirmedBatch(), onCancel: cancelConfirmedBatch, note: '입고확인은 [저장]을 눌러야 기록됩니다.' });
    const codes = Object.keys(pendingFix);
    const shownCodes = new Set(viewRows.map(r => r.code));
    fixBar.update({ count: codes.length, outside: codes.filter(c => !shownCodes.has(c)).length, progress: fixProgress });
}
function confShown(code) {
    const r = allRows.find(x => x.code === code);
    return r && r.conf !== null && r.conf !== undefined ? String(r.conf) : '';
}
/** 입고확인 칸을 나갈 때 — 대기에 넣기(같은 값·빈칸이면 대기에서 뺌, 글자면 알림 후 되돌림) */
function onConfCellOut(code, text, td) {
    const shown = confShown(code);
    const cur = pendingFix[code];
    const back = () => { if (td && td.isConnected) td.textContent = cur ? String(cur.after) : shown; };
    if (fixBusy) { back(); showToast('⏳ 입고확인 기록 중입니다 — 끝난 뒤 고쳐 주세요'); return; }
    // 고칠 때 본 입고이력 기준(스캔 문서 하나·수정 rev) — [저장] 때 그사이 비워졌는지 본다
    const r = pendingSet(pendingFix, code, text, shown, Date.now(), { probe: scanProbeMap[code] || '', rev: fixMap[code] ? fixMap[code].rev : 0 });
    if (r.error) { alert(r.error); back(); return; }
    const nx = r.pending[code];
    const changed = (cur ? cur.after : null) !== (nx ? nx.after : null);
    pendingFix = r.pending;
    if (!changed) { if (td && td.isConnected && !nx) td.textContent = shown; return; }   // 값이 그대로면 다시 그리지 않는다
    if (td && td.isConnected) { td.classList.toggle('conf-pending', !!nx); if (!nx) td.textContent = shown; }
    renderDeferred = true;   // 툴팁·건수를 맞추려고 칸을 다 나가면(클릭이 끝난 뒤) 한 번 다시 그린다
    updateFixBar();
    const n = Object.keys(pendingFix).length;
    showToast(nx ? `✏️ 입고확인 대기 ${n}건 — 아래 [저장]을 눌러야 기록됩니다` : `↩ 입고확인 원래 값으로(대기 ${n}건)`);
}
function cancelConfirmedBatch() {
    if (fixBusy) return;
    const n = Object.keys(pendingFix).length;
    if (n && !confirm(`입고확인 수정 대기 ${n}건을 버릴까요? (기록하지 않습니다)`)) return;
    pendingFix = {};
    renderTable(); updateFixBar();
}
async function saveConfirmedBatch() {
    const codes = Object.keys(pendingFix);
    if (!isAccessOk || !codes.length || fixBusy) return;
    if (closedKind() === 'error') { alert('보관함을 확인하지 못해 막았습니다(연결 확인 후 출고일을 다시 고르세요) — 입고확인을 저장하지 않았습니다.'); return; }
    if (closedBlocks()) { alert('마감된 작업을 보는 중입니다 — 입고확인은 보관함 기록이라 저장하지 않습니다.\n진행 중인 출고일을 고르거나 표 위 [지금 입고이력으로 보기]를 누른 뒤 저장하세요.'); return; }
    if (!inboundKnown || inboundErr) { alert('앱 스캔 입고 기록을 아직 받지 못했습니다(또는 읽기 실패) — 잠시 뒤 다시 누르세요.'); return; }
    fixBusy = true;
    try {
        setLoading(true, `입고이력·스캐너 값 확인 중... (${codes.length}건)`);
        let mod, srvBy;
        try {
            mod = await import('./inbound-fix-write.js?v=202611130915');
            srvBy = await mod.readServerInboundMany(db, codes, 5);
        } finally { setLoading(false); }
        // 옛 수동값만 보이던 칸(시험 화면 — 입고이력에 키 없음): 같은 값이어도 기록해 입고확인을 그 값으로 고정
        const legacy = {};
        if (!LIVE) codes.forEach(c => { const v = String((editedCells[c] || {}).confirmed == null ? '' : editedCells[c].confirmed).trim(); if (inboundMap[c] === undefined && v !== '') legacy[c] = v; });
        const { rows, same, reset } = batchRowsOf(pendingFix, srvBy, legacy);
        const resetFailed = Object.fromEntries(reset.map(c => [c, 'reset']));   // 고친 뒤 입고이력이 비워짐(다른 탭·PC 의 마감 포함) → 대기에서 뺌
        // 스캐너 칸을 만든 기준 — 단독 운영에서 작업 출고일(settings.batch.ships)이 지금 고른 출고일과 같을 때만 그 행의 도착·피킹 배정. 시험은 모름
        const bases = {};
        rows.forEach(x => {
            const r = allRows.find(y => y.code === x.code);
            bases[x.code] = (LIVE && r) ? liveBaseOf({ batchShips: settings && settings.batch && settings.batch.ships, selected: selectedDates, arr: r.arr, third: r.third, outside: r.outside }) : null;
            // 남은 도착이 0 이하면 기준을 알아도(반영 뒤 재고·주문이 바뀌었을 수 있어) 경고
            x.maybeOff = !!x.srv.scanDb && x.srv.scanDb.arrivalQty <= 0;
        });
        if (!rows.length) {
            pendingFix = pendingAfterBatch(pendingFix, { same, failed: resetFailed });
            const m0 = batchResultText({ failed: reset.length, same: same.length });
            if (reset.length) alert(`${m0}\n\n${failLinesOf(resetFailed)}`); else showToast(m0);
            return;
        }
        if (!confirm(batchConfirmText({ rows, same: same.length, reset: reset.length, trial: !LIVE, live: LIVE }))) return;
        fixProgress = { done: 0, total: rows.length }; updateFixBar();
        const out = await runBatch(rows,
            (x) => mod.writeInboundFix(db, { code: x.code, before: x.before, after: x.after, seen: x.srv, base: bases[x.code], by: myMemberName, note: LIVE ? '신규 화면' : '신규 화면(시험)' }),
            (done, total) => { fixProgress = { done, total }; updateFixBar(); });
        const failed = { ...resetFailed, ...out.failed };
        pendingFix = pendingAfterBatch(pendingFix, { ok: out.ok, failed, same });
        const failCodes = Object.keys(failed);
        const msg = batchResultText({ saved: out.ok.length, failed: failCodes.length, same: same.length });
        if (failCodes.length) {
            alert(`${msg}\n\n다시 확인할 상품은 노란 칸으로 남겼습니다(입고이력이 비워진 상품은 대기에서 뺐습니다). 값을 확인한 뒤 [저장]을 다시 누르세요.\n`
                + failLinesOf(failed));
        } else showToast('✅ 입고확인 ' + msg);
    } catch (e) {
        console.error('[mibal2] 입고확인 저장 실패:', e && e.code);
        alert('입고확인을 기록하지 못했습니다(아무것도 쓰지 않았거나 일부만 썼습니다 — 노란 칸이 남은 상품을 확인하세요) — ' + errText(e));
    } finally {
        fixBusy = false; fixProgress = null;
        renderTable(); updateFixBar();
    }
}
/** 차이(도착 − 입고확인) 칸 — 기존 화면 diffCellView 와 같다: 양수 빨강(부족입고) · 음수 파랑(과입고) · 미스캔 '–' */
function inDiffCellHtml(r) {
    if (r.confSrc === undefined) return `<td>${numOr(null)}</td>`;
    const v = r.inDiff;
    if (v === null || v === undefined) return `<td class="in-diff-cell t-3" title="도착·입고확인을 모름">–</td>`;
    if (r.noScan && v > 0) return `<td class="in-diff-cell t-risk" title="입고확인 없음(스캔 0건) — 도착 ${esc(num(v))} 전부 부족입고">${esc(num(v))}</td>`;
    if (v > 0) return `<td class="in-diff-cell t-risk" title="부족입고 ${esc(num(v))}">${esc(num(v))}</td>`;
    if (v < 0) return `<td class="in-diff-cell t-accent" title="과입고 ${esc(num(-v))}">${esc(num(v))}</td>`;
    return `<td class="in-diff-cell" title="도착 = 입고확인">0</td>`;
}
/** 입고이력 구독 — 부족수량 보기에 처음 들어갈 때 한 번만(위치지정 보기만 여는 사람은 읽지 않는다). 입장 판정 뒤에만 */
function ensureInbound() {
    if (inboundStarted || !isAccessOk || viewMode !== 'live') return;
    inboundStarted = true;
    subscribeInbound(db, (m, fx, sc, pb, lg) => {
        inboundMap = m; fixMap = fx || {}; scanOnlyMap = sc || {}; scanProbeMap = pb || {}; scanLogByCode = lg || null; inboundKnown = true; inboundErr = '';
        recomputeAndRender();
    }, (err) => {
        console.error('[mibal2] 입고이력 구독 실패:', err && err.code);
        inboundErr = errText(err);
        // 오류로 구독이 끝났다 — 옛 값을 '받은 값'으로 쓰지 않게 되돌리고(미리보기는 새로 1회 읽음), 다음 보기 전환 때 다시 건다
        inboundKnown = false;
        inboundStarted = false;
        renderSourceNote();
    }, { withLog: LIVE });
}

/** 지금 보기 기준으로 다시 계산·그리기 */
function recomputeAndRender() {
    ctx = liveCtx();
    syncClosedView();
    // 마감된 작업 — 입고확인은 보관함 기록(읽는 중이면 빈 값). 입고이력(새 작업 스캔)은 섞지 않는다
    allRows = (closedView && (closedView.loading || closedView.view)) ? withScanLink(computeRows(liveBundle()), closedView.loading ? {} : closedView.view.map)
        : withScanLink(computeRows(liveBundle()));   // 못 읽음(error)은 입고이력 값으로 보이되 쓰기는 막는다
    computeMismatch();
    renderMismatch();
    renderClosedNote();
    if (live && live.setClosedUI) live.setClosedUI(closedBlocks());
    renderDateTags();
    applyFilters();
    renderSourceNote();
    if (locTools) locTools.refresh();   // 위치지정 보기의 상품명·옵션 출처가 이 표라서
}

// ── 보기 전환: 부족수량(오늘) / 위치지정(시험) ──────────────────────
const VIEW_KEY = 'mibal2.view';
function setView(mode, save) {
    viewMode = mode === 'loc' ? 'loc' : 'live';
    document.body.dataset.view = viewMode;
    $('btn-view-live').classList.toggle('on', viewMode === 'live');
    $('btn-view-loc').classList.toggle('on', viewMode === 'loc');
    $('date-dropdown-popup').style.display = 'none'; popupSnapshot = null;
    // 위치지정 보기에 처음 들어갈 때만 구독·1회 읽기를 시작한다(입장 판정 전이면 판정 뒤 startAfterAccess 가 부른다)
    if (viewMode === 'loc' && locTools) locTools.enter();
    ensureInbound();   // 부족수량 보기면 입고이력 구독(처음 한 번)
    if (save) { try { localStorage.setItem(VIEW_KEY, viewMode); } catch (e) { /* 기억 못 해도 보기는 바뀐다 */ } }
    if (LIVE && save) writeHash({ tab: viewMode === 'loc' ? 'location' : 'mibal' });   // 버튼으로 바꾼 뒤 새로고침해도 빠른 이동 해시로 되돌아가지 않게
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
            return `<label class="date-item"><input type="checkbox" class="date-check" value="${esc(x.date)}" ${selectedDates.includes(x.date) ? 'checked' : ''}><span>${fmtMD(x.date)} 출고${arr} (${esc(num(x.skus))}종 / ${esc(x.qty.toLocaleString())}장)</span></label>`;
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
    const dates = selectedDates;
    const info = dateInfo;
    $('btn-date-dropdown').textContent = selectedDates.length ? `▼ ${selectedDates.length}개 선택됨` : '▼ 출고일 선택';
    if (!dates.length) box.innerHTML = '선택된 출고일 없음';
    else box.innerHTML = [...dates].sort((a, b) => b.localeCompare(a)).map(d => {
        const x = info[d];
        const arr = x && x.arrivals.length ? ' → ' + x.arrivals.map(fmtMD).join(',') : '';
        return `<span class="date-tag">${fmtMD(d)} 출고${arr}${x ? '' : ' (유예 지남/없음)'}</span>`;
    }).join('');
    const same = JSON.stringify([...selectedDates].sort()) === JSON.stringify([...legacyDates].sort());
    // 입고확인은 출고일과 상관없이 미발 초기화 이후 스캔 전체 — 따로 고른 출고일이면 그 점을 덧붙인다
    const confNote = ' · 입고확인은 출고일 구분 없이 미발 초기화 이후 스캔 전체';
    if (LIVE) {   // 단독 운영 — 기존 계산기 출고일과 견주지 않는다
        $('date-src').textContent = '이 화면에서 고른 출고일 · 입고확인은 출고일 구분 없이 작업 마감 이후 스캔 전체';
        setDateDiffWarn(false);
        if (live) live.onDates();
        return;
    }
    $('date-src').textContent = dateSource === 'own'
        ? (same ? '이 화면에서 고른 출고일 (기존과 같음)' : '이 화면에서 고른 출고일 (기존 계산기와 다름)' + confNote)
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
    const snap = popupSnapshot;
    popupSnapshot = null;   // 아래 서버 읽기 동안 창을 다시 열어도 그 창의 기준을 지우지 않게 먼저 비운다
    if (snap !== null && now !== snap) {
        dateSource = 'own';
        recomputeAndRender();
        try {
            if (!isAccessOk) throw new Error('권한 확인 전');
            // live — 다른 PC 가 그사이 작업을 마감했으면(마감이 출고일 선택을 풀었다) 옛 화면의 선택으로 덮지 않는다. 못 읽으면 저장하지 않음
            // 저장하지 않으면 화면도 서버 값으로 — 저장 안 된 선택이 남으면 같은 날짜로 다시 골라도 '바뀐 것 없음'으로 저장되지 않는다
            if (LIVE && !(await sameClosedOnServer())) { revertUnsavedDates(); return; }
            await setDoc(doc(db, SETTINGS_PATH), { useOwnDates: true, shipDates: selectedDates.map(String), updatedAt: serverTimestamp() }, { merge: true });
            if (LIVE) settings = { ...(settings || {}), useOwnDates: true, shipDates: selectedDates.map(String) };
            showToast(LIVE ? '✅ 출고일 선택 저장 — 스캐너 숫자는 [스캐너에 반영]을 눌러야 바뀝니다' : '✅ 출고일 선택 저장 (이 화면 전용 — 기존 계산기에는 영향 없음)');
        } catch (e) { showToast('⚠️ 출고일 선택 저장 실패 — ' + errText(e)); }
    }
}
/** 저장하지 못한 출고일 선택을 되돌린다 — 다른 PC 마감으로 다시 맞췄으면(reloadShared) 그 값, 아니면 이 화면이 마지막으로 알던 서버 값 */
function revertUnsavedDates() {
    if ($('date-dropdown-popup').style.display === 'block') return;   // 창을 다시 열었다 — 그 창을 닫을 때 다시 판단
    const next = liveDatesFrom(settings).dates;
    if (JSON.stringify([...next].sort()) === JSON.stringify([...selectedDates].sort())) return;
    selectedDates = next;
    renderDateList();
    recomputeAndRender();
}
/** live 출고일 저장 전 — 서버 settings.lastClosedId 가 이 화면 값과 같은가. 다르면 다시 읽어 맞추고 안내, 못 읽으면 안내 → false(저장하지 않음) */
async function sameClosedOnServer() {
    let s;
    try { s = await getDocFromServer(doc(db, SETTINGS_PATH)); }
    catch (e) {
        console.error('[mibal2] 출고일 저장 전 설정 읽기 실패:', e && e.code);
        alert('서버에서 작업 상태를 읽지 못해 출고일 선택을 저장하지 않았습니다 — ' + errText(e) + '\n네트워크를 확인한 뒤 출고일을 다시 고르세요.');
        return false;
    }
    const server = String((s.exists() && (s.data() || {}).lastClosedId) || '');
    if (server === String((settings && settings.lastClosedId) || '')) return true;
    try { if ((await reloadShared()).popupOpen) return false; }   // 그사이 창을 다시 열었다 — 그 창을 닫을 때 다시 확인한다
    catch (e) {
        console.error('[mibal2] 다시 읽기 실패:', e && e.code);
        alert('다른 PC 에서 작업을 마감했지만 화면을 다시 맞추지 못했습니다(출고일 선택은 저장하지 않음) — ' + errText(e) + '\n새로고침해 주세요.');
        return false;
    }
    alert('다른 PC 에서 작업을 마감해 출고일을 다시 맞췄습니다.\n화면을 확인한 뒤 출고일을 다시 고르세요(이 화면의 선택은 저장하지 않았습니다).');
    return false;
}
// 기존 계산기 출고일을 따른다 — 팝업 안 #btn-date-legacy · 날짜 바 #btn-date-legacy-out 둘 다 이것을 부른다
async function followLegacyDates() {
    if (LIVE) return;   // 단독 운영 — 기존 계산기 출고일을 따르지 않는다(버튼도 숨김)
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
        if (!isAccessOk) throw new Error('권한 확인 전');
        await setDoc(doc(db, SETTINGS_PATH), { useOwnDates: false, updatedAt: serverTimestamp() }, { merge: true });
        showToast('✅ 기존 계산기 출고일을 따릅니다');
    } catch (e) { showToast('⚠️ 설정 저장 실패 — ' + errText(e)); }
}
function setupDatePopup() {
    const popup = $('date-dropdown-popup');
    $('btn-date-dropdown').addEventListener('click', (e) => {
        e.stopPropagation();
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
        recomputeAndRender();
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
    if (pending || !isAccessOk || busyRefreshing()) return;
    const block = refreshBlockReason();
    if (block) {
        if (!isAuto) { $('refresh-msg').textContent = block; showToast('ℹ️ ' + block); }
        return;
    }
    const baseRun = latest ? tsMs(latest.lastRunAt) : 0;
    const baseNoteAt = latest ? tsMs(latest.noteAt) : 0;
    const baseOk = latest ? tsMs(latest.lastOkAt) : 0;   // 자동 반영 판정 — 이 요청 뒤 성공(lastOkAt 이 이보다 새것)일 때만
    try {
        // 사용자 정보(이메일 등)는 넣지 않는다 — 요청 시각만(서버 시각).
        await setDoc(doc(db, REQUEST_PATH), { requestedAt: serverTimestamp() });
    } catch (e) {
        showToast('⚠️ 갱신 요청 실패 — ' + errText(e));
        return;
    }
    // manual = 직원이 이 PC 에서 [지금 갱신]을 누름(자동 요청은 아님) — 끝나면 자동 [스캐너에 반영](단독 운영만)
    //   rid = 이 요청 id(탭 복제로 대기 요청이 복사돼도 한 탭만 반영 — runAutoApply)
    pending = { atMs: Date.now(), baseRun, baseNoteAt, baseOk, manual: !isAuto, rid: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) };
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
        if (LIVE && refreshDoneAuto(pending, latest)) { autoApplyDue = true; autoApplyRid = pending.rid; }   // 서버 스냅샷에서 한 번 자동 반영(구독 처리부)
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

// ── 엑셀 받기 (지금 보이는 행 — 검색·필터·정렬 반영. 내 PC 로 다운로드만) ──────────
function downloadExcel() {
    const X = window.XLSX;
    if (!X) { showToast('⚠️ 엑셀 라이브러리를 못 불러옴'); return; }
    if (!viewRows.length) { showToast('받을 행이 없습니다'); return; }
    // 입고이력을 아직 못 받았거나 읽기 실패면 입고확인·차이에 스캔분이 빠져 있다 — 받기 전에 알린다
    if ((!inboundKnown || inboundErr) && !confirm('⚠️ 앱 스캔 입고 기록을 아직 받지 못했습니다(또는 읽기 실패).\n엑셀의 입고확인·차이 칸에 스캔분이 빠져 있습니다.\n\n그래도 받을까요?')) return;
    const id = ymd();
    const bad = writeXls(X, [{ name: '부족수량관리', aoa: excelAoaOf(viewRows) }], `부족수량관리_신규_${id}.xls`);   // .xls(biff8, 2026-11-10 — 한도 넘으면 안내만)
    if (bad) alert(bad);
}

// ── 보기 항목: [칸 설정](2026-11-10, 예전 간단히/전체 대신) — 고른 열만 보인다(js/lib/mibal2-cols.js). 이 브라우저에만 기억 ──
// 열 숨김은 #cols-style(만든 CSS). body[data-cols] 는 예전 이름 그대로(colsMode) — 요약 카드·차이 체크·색·열 너비 기억이 예전처럼 따른다
let colsOn = colsFromStorage(null, null).on;
const colSpan = () => visibleCount(colsOn);   // 펼친 상세 행 칸 수
function setCols(on, save) {
    colsOn = normalizeOn(on);
    let st = $('cols-style');
    if (!st) { st = document.createElement('style'); st.id = 'cols-style'; document.head.appendChild(st); }
    st.textContent = hiddenCss(colsOn);
    const simple = colsMode(colsOn) === 'simple';
    document.body.dataset.cols = simple ? 'simple' : 'full';
    if (simple) {
        $('chk-diff-only').checked = false;                                   // 숨긴 거르기가 남지 않게
        if (sortConfig.key === 'diffAbs' || sortConfig.key === 'diff') sortConfig = { key: 'mibal', dir: 'desc' };   // 숨긴 '차이' 열 정렬 → 미발수량 큰 순
    }
    if (allRows.length) applyFilters();                                       // 칸 수(colspan)·정렬을 새로 반영
    applyColWidths();                                                         // 보기마다 따로 기억한 열 너비
    if (save) { try { localStorage.setItem(COLS_PICK_KEY, serializeCols(colsOn)); } catch (e) { /* 기억 못 해도 보기는 바뀐다 */ } }
}
function loadCols() {
    let raw = null, legacy = null;
    try { raw = localStorage.getItem(COLS_PICK_KEY); legacy = localStorage.getItem(LEGACY_COLS_KEY); } catch (e) { /* 못 읽으면 기본값 */ }
    const r = colsFromStorage(raw, legacy);
    setCols(r.on, r.migrated);   // 예전 간단히/전체만 있으면 한 번 옮겨 저장
}
/** [칸 설정] 창 — 체크 목록(꼭 보일 열은 끌 수 없음)·[기본값으로]·[모두]. 닫으면(닫기·바깥) 바로 반영 */
function setupColsPick() {
    const modal = $('cols-modal'), list = $('cols-list');
    const labels = {};
    headCells().forEach((th, i, all) => { labels[colKey(th, i, all)] = (th.firstChild && th.firstChild.textContent ? th.firstChild.textContent : th.textContent).trim(); });
    let draft = colsOn;
    const draw = () => {
        list.innerHTML = pickableCols(LIVE).map(k => {
            const req = REQUIRED.includes(k);
            return `<label class="${req ? 'req' : ''}" title="${req ? '꼭 보여야 하는 열이라 끌 수 없습니다' : ''}"><input type="checkbox" data-col="${esc(k)}"${draft.includes(k) ? ' checked' : ''}${req ? ' disabled' : ''}> ${esc(labels[k] || k)}${req ? ' <span class="t-3" style="font-size:11px;">(필수)</span>' : ''}</label>`;
        }).join('');
    };
    const close = () => { if (modal.style.display !== 'flex') return; modal.style.display = 'none'; setCols(draft, true); };
    $('btn-cols-set').addEventListener('click', () => { draft = colsOn; draw(); modal.style.display = 'flex'; });
    list.addEventListener('change', (e) => { const c = e.target.closest('input[data-col]'); if (c) { draft = toggleCol(draft, c.dataset.col, c.checked); draw(); } });
    $('btn-cols-default').addEventListener('click', () => { draft = normalizeOn(DEFAULT_ON); draw(); });
    $('btn-cols-all').addEventListener('click', () => { draft = normalizeOn(pickableCols(LIVE)); draw(); });
    $('btn-cols-none').addEventListener('click', () => { draft = normalizeOn(REQUIRED.filter(k => pickableCols(LIVE).includes(k))); draw(); });   // 필수 열만 남김
    $('btn-cols-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
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
    loadCols();
    setupColsPick();
    setupDatePopup();
    $('search-input').addEventListener('input', applyFilters);
    $('chk-diff-only').addEventListener('change', applyFilters);
    $('chk-check-only').addEventListener('change', applyFilters);
    $('btn-excel').addEventListener('click', downloadExcel);
    $('btn-refresh').addEventListener('click', () => requestRefresh(false));
    $('btn-view-live').addEventListener('click', () => setView('live', true));
    $('btn-view-loc').addEventListener('click', () => setView('loc', true));
    document.querySelectorAll('.list-table th.sortable').forEach(th => th.addEventListener('click', () => {
        if (justResized) return;   // 열 너비를 끌다 놓은 click
        const key = th.dataset.sort;
        if (sortConfig.key === key) sortConfig.dir = sortConfig.dir === 'asc' ? 'desc' : 'asc';
        else sortConfig = { key, dir: (key === 'code' || key === 'name' || key === 'loc') ? 'asc' : 'desc' };
        applyFilters();
    }));
    $('table-body').addEventListener('click', (e) => {
        if (e.target.closest('td.conf-edit')) { e.stopPropagation(); return; }   // 입고확인 칸은 고치는 곳(펼치기 대신)
        const tr = e.target.closest('tr.data-row'); if (!tr) return;
        const code = tr.dataset.code;
        if (expanded.has(code)) expanded.delete(code); else expanded.add(code);
        renderTable();
    });
    // 입고확인 칸 — 나가면 대기에 넣기, Enter = 칸 나가기
    $('table-body').addEventListener('focusout', (e) => {
        const td = e.target.closest && e.target.closest('td.conf-edit');
        if (!td) return;
        onConfCellOut(td.dataset.code, td.textContent.trim(), td);
        flushDeferredRender();
    });
    $('table-body').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.closest && e.target.closest('td.conf-edit')) { e.preventDefault(); e.target.blur(); }
    });
    // 1분마다 상태 재판정 · 요청 시간초과 확인
    setInterval(() => { renderStatus(); checkPending(); }, 60000);
}

// ── 입장 판정 ──────────────────────────────────────────────
/**
 * 관리자이거나 'china.mibal2' 권한이 있으면 들어간다 — 표준 권한 계산(js/lib/perm.js resolve·can, page-gate.js 와 같음)을
 * js/lib/mibal2-access.js 로 부른다(2026-10-27, 전에는 관리자만). 읽기만 한다. 서버에서 읽지 못하면(오프라인) 차단한다.
 * 이메일은 판정에만 쓰고 저장·출력하지 않는다.
 */
async function checkAccess(user) {
    // 15초 안에 못 읽으면 실패로 본다(Firestore 가 내부 오류로 멈추면 영영 안 끝난다 — page-gate.js READ_TIMEOUT_MS 와 같은 값)
    let timer;
    const read = getDocFromServer(doc(db, BASE + '/config/mainConfig'));
    // 시간 초과 오류에 원래 읽기를 붙여 둔다 — 망이 느렸을 뿐이면 start 가 늦게라도 이어 간다
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout', read })), 15000); });
    const snap = await Promise.race([read, timeout]).finally(() => clearTimeout(timer));
    return accessFromSnap(snap, user);
}
function accessFromSnap(snap, user) {
    // 공통 상단바 개인 알림(P2) — 같은 문서의 memberEmails 로 이름을 찾아 넘긴다(추가 읽기 없음). 이름은 메모리에만.
    const memberName = memberNameFor(snap.exists() ? snap.data().memberEmails : null, user.email);
    if (memberName && auth.currentUser && auth.currentUser.uid === user.uid) setShellContext({ signedIn: true, uid: user.uid, memberName });
    myMemberName = memberName || '';
    const acc = mibal2Access(snap.exists() ? snap.data() : {}, user.email);
    accessIsAdmin = acc.isAdmin;
    return acc.ok;
}
function showAdminBlock(msg) {
    isAccessOk = false;
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
        if (!(await checkAccess(user))) { showAdminBlock(MIBAL2_DENIED_MSG); return; }
    } catch (e) {
        console.error('[mibal2] 권한 확인 실패:', e && e.code);
        if (e && e.code === 'timeout' && e.read) {
            showAdminBlock('권한 확인이 늦어지고 있습니다(15초 넘음). 잠시 기다리거나 새로고침해 보세요.');
            e.read.then((snap) => {
                if (!accessFromSnap(snap, user)) { showAdminBlock(MIBAL2_DENIED_MSG); return; }
                startAfterAccess();
            }, (e2) => showAdminBlock(e2 && e2.code === 'permission-denied' ? MIBAL2_DENIED_MSG : '권한을 확인하지 못해 화면을 열지 않았습니다(네트워크 오류). 새로고침해 보세요.'));
            return;
        }
        // 명단 밖·퇴사자는 규칙상 mainConfig 를 못 읽는다(permission-denied) → '권한 없음'. 그 밖(네트워크 등)은 '확인 실패'
        showAdminBlock(e && e.code === 'permission-denied' ? MIBAL2_DENIED_MSG : '권한을 확인하지 못해 화면을 열지 않았습니다(네트워크 오류). 새로고침해 보세요.');
        return;
    }
    startAfterAccess();
}
/**
 * live 의 [스캐너에 반영]·[작업 마감] 시작 때 — 다른 PC 가 바꿨을 수 있는 CONFIG·EDITED_CELLS·settings(출고일·작업 표시)를 서버에서 다시 읽어 화면·계산에 쓴다.
 * 셋 다 읽혀야 바꾼다(하나라도 실패하면 throw — 부르는 쪽이 멈춘다).
 * 출고일 창이 열려 있으면 읽지도 쓰지도 않고 popupOpen — 다시 읽기 전에 저장하면 다른 PC 의 출고일을 덮는다. 창은 그 클릭으로 닫히며 평소처럼 저장된다.
 * @returns {{datesChanged: boolean, popupOpen?: boolean, sig?: string}} datesChanged = 이 PC 의 출고일 선택이 서버와 달라 서버 값으로 맞췄는가 · sig = 세 문서 서명(확인창 뒤 비교용)
 */
async function reloadShared() {
    if ($('date-dropdown-popup').style.display === 'block') return { datesChanged: false, popupOpen: true };
    const [c, e, s] = await readSharedDocs();
    config = c.exists() ? (c.data() || {}) : {};
    graceDays = graceDaysFrom(config);
    editedCells = e.exists() ? (e.data().cells || {}) : {};
    settings = s.exists() ? (s.data() || {}) : null;
    const next = liveDatesFrom(settings).dates;
    const datesChanged = JSON.stringify([...next].sort()) !== JSON.stringify([...selectedDates].sort());
    if (datesChanged) selectedDates = next;
    renderDateList();
    recomputeAndRender();
    return { datesChanged, sig: sharedSigOf([c, e, s]) };
}
const readSharedDocs = () => Promise.all([
    getDocFromServer(doc(db, CHINA_COLLECTION, 'CONFIG')),
    getDocFromServer(doc(db, CHINA_COLLECTION, 'EDITED_CELLS')),
    getDocFromServer(doc(db, SETTINGS_PATH))
]);
const sharedSigOf = (snaps) => stableSig(snaps.map(x => (x.exists() ? x.data() : null)));
/**
 * 단독 운영(live) 도구 불러오기 — LIVE 가 아니면 아무것도 하지 않는다(동적 import 도 하지 않음).
 * 못 불러오면 읽기 전용으로 남고 안내만 한다.
 */
async function loadLiveTools() {
    if (!LIVE) return null;
    try {
        const mod = await import('./china-mibal2-live.js?v=202611130915');
        return mod.startLive({
            db, showToast, setLoading, errText,
            isAdmin: () => accessIsAdmin,
            memberName: () => myMemberName,
            getRows: () => allRows,
            getViewRows: () => viewRows,   // 화면에 보이는 행(검색·필터·정렬 반영) — 이지어드민 업로드용 받기
            // opts.allGrace — 본사도착 유예를 보지 않고 그 출고일 도착분을 모두 넣는다(작업 마감: 유예가 지나도 작업 출고일 전부)
            rowsFor: (dates, im, opts) => withScanLink(computeRows({ ...liveBundle(), selectedDates: dates, ...(opts && opts.allGrace ? { graceDays: ALL_GRACE_DAYS } : {}) }), im || inboundMap, { keepOutside: true }),
            getShipItems: () => ship.items || {},   // 출고일 불일치 확인(js/lib/ship-mismatch.js)
            computeFor: (dates, opts) => computeRows({ ...liveBundle(), selectedDates: dates, ...(opts && opts.allGrace ? { graceDays: ALL_GRACE_DAYS } : {}) }),
            getSelectedDates: () => selectedDates.slice(),
            // 작업 마감·되돌리기 뒤 — 이 PC 의 선택을 맞춘다(저장은 호출한 쪽이 settings.shipDates 로 함께 했다)
            setSelectedDates: (dates) => { selectedDates = dates.slice(); dateSource = 'own'; renderDateList(); recomputeAndRender(); },
            getShipList: () => listShipDates(ship.items, graceDays, new Date()),
            getLatest: () => latest,
            getParseError: () => parseError,   // 자동 반영 — 수집 자료 해석 실패면 멈춤
            reloadShared,
            readSharedSig: async () => sharedSigOf(await readSharedDocs()),   // 확인창 뒤 재확인 — 화면 상태는 바꾸지 않는다
            getConfig: () => config,
            patchConfig: (patch) => { config = { ...config, ...patch }; graceDays = graceDaysFrom(config); renderDateList(); recomputeAndRender(); },
            getEdited: () => editedCells,
            setEditedCap: (code, cap) => {
                const cur = { ...(editedCells[code] || {}) };
                if (cap === undefined) delete cur.capacity; else cur.capacity = cap;
                editedCells = { ...editedCells, [code]: cur };
                recomputeAndRender();
            },
            getSettings: () => settings,
            // 입고확인 저장 대기 — 작업 마감 확인창에 건수, 입고이력을 비운 뒤 버린다(지난 작업 기준이라 새 작업에 쓰면 안 됨)
            pendingFixCount: () => Object.keys(pendingFix).length,
            clearPendingFix: () => { pendingFix = {}; renderTable(); updateFixBar(); },
            patchSettings: (patch) => {
                const next = { ...(settings || {}), ...patch };
                Object.keys(patch).forEach(k => { if (patch[k] === undefined) delete next[k]; });
                settings = next;
                renderDateTags();
            },
            getLocIndex: () => locIndex,
            getClosedView: () => closedKind(),     // '' | 'closed'(보관함 기록 보는 중) | 'error'(보관함 못 읽음) — 반영·마감·입고 오차 기록을 막는다
            getClosedOverride: () => closedOverrideView,   // [지금 입고이력으로 보기] 중이면 그 보관함 판정 — 쓰기 전 한 번 더 묻는다
            closedSettled                          // 그 판정 전에 — 다시 판정하고 보관함 읽기가 끝날 때까지 기다림
        });
    } catch (e) {
        console.error('[mibal2] 운영 도구 불러오기 실패:', e);
        showToast('⚠️ 운영 도구를 불러오지 못했습니다 — 새로고침해 보세요(지금은 보기만 됩니다)');
        return null;
    }
}
// ── 마감된 작업 보기(2026-11-12 사용자 결정 (나)) — 판정 js/lib/mibal2-closed-view.js ──
// 고른 출고일이 모두 보관함(ChinaStockGoods_Archive)에 있고 진행 중인 작업과 겹치지 않으면 입고확인 = 보관함의 코드별 입고 합.
// 보관함은 출고일(+ 이 화면이 아는 마지막 마감 번호)이 바뀔 때만 한 번 읽는다(ships array-contains-any, 캐시).
// 못 읽으면 지금처럼 입고이력으로 보이고 안내 줄에 알린다([다시 읽기]).
const openBatchShips = () => (serverBatchOpen(settings) ? settings.batch.ships.map(String) : null);
function syncClosedView() {
    if (!LIVE || !isAccessOk) { closedView = null; return; }
    const batchShips = openBatchShips();
    const dates = closedQueryDates({ selected: selectedDates, batchShips });
    const key = dates.length ? closedCacheKey(dates, settings && settings.lastClosedId) : '';
    closedOverrideView = null;
    if (key && key === closedOverrideKey && closedCache.has(key)) closedOverrideView = closedViewOf({ selected: selectedDates, batchShips, archives: closedCache.get(key) });
    if (!key || key === closedOverrideKey) { closedView = null; return; }
    if (closedCache.has(key)) {
        const view = closedViewOf({ selected: selectedDates, batchShips, archives: closedCache.get(key) });
        closedView = view ? { key, view } : null;
        return;
    }
    if (closedView && closedView.key === key && (closedView.loading || closedView.error)) return;   // 읽는 중 · 실패(다시 읽기는 버튼)
    closedView = { key, loading: true };
    const req = ++closedReq;
    // 서버에서만 읽는다 — 캐시(오프라인) 결과를 캐시에 넣으면 키가 안 바뀌는 동안 다시 안 읽어 마감된 출고일에 반영할 수 있다
    const p = getDocsFromServer(query(collection(db, ARCHIVE_COLL), where('ships', 'array-contains-any', dates))).then((snap) => {
        if (snap.metadata && snap.metadata.fromCache) throw Object.assign(new Error('보관함을 서버에서 읽지 못함'), { code: 'unavailable' });
        // 쓰는 칸만(상품코드·입고 합) — 상품명 등은 메모리에도 두지 않는다
        closedCache.set(key, snap.docs.map(d => {
            const x = d.data() || {};
            return { id: d.id, ships: Array.isArray(x.ships) ? x.ships.map(String) : [], closedAtMs: Number(x.closedAtMs) || 0,
                rows: (Array.isArray(x.rows) ? x.rows : []).map(r => ({ c: r && r.c, q: r && r.q })) };
        }));
        if (req === closedReq) recomputeAndRender();
    }, (e) => {
        console.warn('[mibal2] 보관함 읽기 실패:', e && e.code);
        if (req === closedReq && closedView && closedView.key === key) { closedView = { key, error: errText(e) }; recomputeAndRender(); }
    }).finally(() => { if (closedPending === p) closedPending = null; });
    closedPending = p;
}
/** 쓰기 판단 직전(반영·마감·입고 오차) — 지금 설정·출고일로 다시 판정하고, 보관함을 읽는 중이면 끝날 때까지 기다린다 */
async function closedSettled() {
    recomputeAndRender();
    while (closedPending) await closedPending;
}
/** 표 위 안내 줄 — 보관함 기록을 보는 중 · 입고이력으로 보는 중(직접 고름) · 보관함 못 읽음 */
function renderClosedNote() {
    let el = $('closed-note');
    if (!el) {
        el = document.createElement('div');
        el.id = 'closed-note';
        el.className = 'src-note live-only';
        el.setAttribute('role', 'status');
        el.style.cssText = 'background:var(--c-track);font-weight:600;';
        const note = $('src-note');
        note.parentNode.insertBefore(el, note.nextSibling);
    }
    const btn = (id, text, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.id = id; b.className = 'd-btn d-btn-sm'; b.textContent = text; b.style.marginLeft = '6px';
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        el.appendChild(b);
    };
    const dates = LIVE && isAccessOk ? closedQueryDates({ selected: selectedDates, batchShips: openBatchShips() }) : [];
    const key = dates.length ? closedCacheKey(dates, settings && settings.lastClosedId) : '';
    el.textContent = '';
    if (viewMode !== 'live') { el.hidden = true; return; }
    if (closedView && closedView.view) {
        const lines = closedNoteLines(closedView.view);
        el.textContent = lines[0];
        btn('btn-closed-live', '지금 입고이력으로 보기', () => { closedOverrideKey = closedView.key; recomputeAndRender(); });
        lines.slice(1).forEach((t, i) => { const d = document.createElement('div'); d.className = 't-warn'; d.id = 'closed-note-misfiled-' + i; d.textContent = '⚠ ' + t; el.appendChild(d); });
    } else if (closedView && closedView.loading) {
        el.textContent = '마감된 작업인지 보관함을 확인하는 중... (그동안 입고확인을 고치거나 반영하지 않습니다)';
    } else if (closedView && closedView.error) {
        el.textContent = `⚠ 보관함을 확인하지 못해 막았습니다(연결 확인 후 출고일을 다시 고르세요) — 반영·마감·입고 오차 기록·입고확인 저장을 하지 않습니다. 입고확인은 지금 입고이력 값 · ${closedView.error}`;
        btn('btn-closed-retry', '다시 읽기', () => { closedView = null; recomputeAndRender(); });
    } else if (key && key === closedOverrideKey) {
        el.textContent = '마감된 출고일을 지금 입고이력으로 보는 중입니다(새 작업으로 다시 할 때)';
        btn('btn-closed-archive', '보관함 기록으로 보기', () => { closedOverrideKey = ''; recomputeAndRender(); });
    } else { el.hidden = true; return; }
    el.hidden = false;
}

async function startAfterAccess() {
    isAccessOk = true;
    $('admin-block').style.display = 'none';
    $('app-main').style.display = 'block';
    setLoading(true, LIVE ? '설정·로케이션 불러오는 중...' : '설정·로케이션·기존 계산기 미발수량 불러오는 중...');
    try { const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); if (p && p.atMs) pending = p; } catch (e) {}
    renderRefreshUI();
    // 단독 운영(live)에서는 기존 계산기 미발수량(비교값)을 읽지 않는다 — oldSnap 이 null 이면 '신규에만' 플래그·버전기록 경고도 나오지 않는다
    const results = await Promise.allSettled([loadConfig(), loadEditedCells(), loadLocations(), LIVE ? null : loadOldSnapshot().then(s => { oldSnap = s; }), loadSettings()]);
    const names = ['CONFIG', 'EDITED_CELLS', 'Locations', '기존 계산기 미발수량', 'settings'];
    const fails = results.map((r, i) => r.status === 'rejected' ? `${names[i]}(${(r.reason && r.reason.code) || r.reason})` : '').filter(Boolean);
    if (fails.length) { console.error('[mibal2] 읽기 실패:', fails); showToast('⚠️ 읽기 실패: ' + fails.join(', ')); }

    // 출고일은 문자열로만 다룬다(설정·CONFIG 에 이상한 값이 들어 있어도 정렬·표시가 깨지지 않게)
    const sd = LIVE ? liveDatesFrom(settings) : selectedDatesFrom(config, settings);
    selectedDates = sd.dates; dateSource = sd.source;
    if (LIVE) live = await loadLiveTools();   // 단독 운영 도구 — 위치지정 보기(옵션추가항목1 원천)보다 먼저

    // includeMetadataChanges: 캐시 → 서버 확인으로 넘어가는 순간도 이벤트로 받아, 서버 자료로만 자동 요청을 판단한다
    onSnapshot(doc(db, LATEST_PATH), { includeMetadataChanges: true }, (snap) => {
        applyLatest(snap.exists() ? snap.data() : null);
        renderStatus();
        checkPending();
        renderDateList();
        recomputeAndRender();
        setLoading(false);
        if (busyBannerStop) busyBannerStop.refresh();   // 요청 대기·'방금 갱신됨'은 latest 로 판정한다
        if (!firstServerSeen && !snap.metadata.fromCache) { firstServerSeen = true; maybeAutoRequest(); }
        if (live && !snap.metadata.fromCache) live.onLatest();   // 단독 운영 — 업무예상용 미발 기록(그날 1회)
        // 이 PC 에서 누른 [지금 갱신]이 끝남 → 자동 [스캐너에 반영](한 번). 캐시 스냅샷이면 서버 확인 때까지 미룬다
        if (autoApplyDue && live && live.autoApply && !snap.metadata.fromCache) { autoApplyDue = false; runAutoApply(autoApplyRid); }
    }, (err) => {
        setLoading(false);
        console.error('[mibal2] mibal2Latest 구독 실패:', err);
        $('status-chip').className = 'status-chip red';
        $('status-chip').textContent = '● 수집 자료 읽기 실패';
        $('status-err').textContent = errText(err);
    });
    // 스캐너 연동(시험 — 읽기 전용): 입고이력 구독(부족수량 보기일 때 한 번) + 켜진 버튼 3개(입고 오차 통계·비축창고 보기·스캐너 값 미리보기 엑셀)
    ensureInbound();
    setupScanTools({
        db, showToast, setLoading,
        getLiveRows: () => allRows,
        getInboundMap: () => (inboundKnown ? inboundMap : null),   // 아직 못 받았으면(또는 실패) 미리보기가 한 번 읽는다
        live: LIVE
    });
    // 위치지정(시험 — 보기·엑셀 받기만). 기억한 보기가 위치지정이면 여기서 들어간다(그때 처음 구독)
    locTools = setupLocMode({
        db, showToast,
        isActive: () => viewMode === 'loc',
        getConfig: () => config,
        getNewRows: () => allRows,
        getShipItems: () => ship.items || {},
        getLocations: () => { const m = {}; Object.keys(locIndex).forEach(c => { const v = locIndex[c]; if (v && v.id) m[c] = v.id; }); return m; },
        live: live ? live.locOptions : null
    });
    if (live) live.attachLoc(locTools);
    if (viewMode === 'loc') locTools.enter();
    // '갱신 중' 띠 — 이지어드민 잠금 + 갱신 요청 문서. '방금 갱신됨'은 이미 구독 중인 mibal2Latest 로(추가 구독 없음)
    busyBannerStop = mountBusyBanner({ db, el: $('busy-banner'), sources: [
        { path: LEASE_PATH, kind: 'lease' },
        { path: REQUEST_PATH, kind: 'mibalRequest', latest: () => latest }
    ], extra: (now) => [latestDoneView(latest, now)], onState: (v) => { busyViews = v || {}; renderRefreshUI(); } });
}

// ── 스캐너 연결(2026-11-10 — 기존 화면 js/china-stock-goods.js setupMobileGate·openInScannerApp 과 같다) ──
// 휴대폰으로 열면 '입고앱(스캐너)을 실행하시겠습니까?' 안내 — 로그인·권한 판정과 상관없이 바로. [입고앱 실행] = 같은 창으로 scan.html
function setupMobileGate() {
    const isMobile = /Android|iPhone|iPod|Mobile|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const gate = $('mobile-gate');
    if (!isMobile || !gate) return;
    gate.style.display = 'flex';
    $('mg-open-scan')?.addEventListener('click', () => { location.href = new URL('scan.html', location.href).href; });
    $('mg-open-web')?.addEventListener('click', () => { gate.style.display = 'none'; });
}
// PC 머리줄 [스캐너 열기] — 입고 스캐너를 새 창으로
function openInScannerApp() {
    window.open(new URL('scan.html', location.href).href, '_blank');
}
setupMobileGate();
$('btn-open-scanner')?.addEventListener('click', () => openInScannerApp());

setupEvents();
{
    let savedView = null;
    try { savedView = localStorage.getItem(VIEW_KEY); } catch (e) { /* 무시 */ }
    if (LIVE) {   // 빠른 이동(Ctrl+K) — #tab=mibal|location 이 기억한 보기보다 먼저
        const viewOfHash = (h) => (h.tab === 'location' ? 'loc' : h.tab === 'mibal' ? 'live' : null);
        savedView = viewOfHash(readHash()) || savedView;
        onHashNav((h) => { const v = viewOfHash(h); if (v && v !== viewMode) setView(v, false); });
    }
    setView(savedView, false);
}
if (auth) onAuthStateChanged(auth, (user) => { if (user) start(user); });
else { setLoading(false); $('status-err').textContent = 'Firebase 초기화 실패 — 새로고침해 보세요'; }
