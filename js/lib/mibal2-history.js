// === js/lib/mibal2-history.js ===
// 업무예상용 미발 기록(ChinaStockGoods/MIBAL_HISTORY.map, basis 'v2') — '그날 무엇을 쓸지' 계산만. 순수 모듈(DOM/Firebase 없음). 2026-11-10.
//
// 화면(js/china-mibal2-live.js onLatest)과 PC 예약작업(앱\미발기록\기록실행.mjs → node)이 같은 식을 쓰게 여기 모았다.
//   1단계(지금): 서버(미발기록)만 이 파일을 쓴다. 화면은 아직 자기 코드(liveBundle·getShipList·onLatest) — 식은 같다(tests/mibal2-history.test.js).
//   2단계: 화면 3곳을 이 파일로 바꾼다.
// ⚠️ 이 파일을 고치면 서버 기록도 바로 바뀐다(배포 전이라도). 입출력 모양은 미발기록\tests\test_JS러너.py 가 본다.
//
//   parseLatest      mibal2Latest 문서 → { stockRows, shipItems, okMs, parseError } (화면 applyLatest 와 같은 해석)
//   liveBundleOf     computeRows 입력 묶음(화면 liveBundle 과 같은 모양, live 는 oldMap null)
//   shipListOf       출고일 목록(화면 getShipList 와 같다)
//   historyPatchFrom 출고일 목록 + 계산 함수 → MIBAL_HISTORY map 패치
//   autoHistoryPlan  서버 한 회차 판정 → { action:'write'|'skip', reason, recs, patch, stats }
//   reviveTs         서버가 보낸 시각 표시 {$ts: ms} → toMillis 를 가진 값
// 상품명·공급처·원가는 결과(recs·stats)에 넣지 않는다 — 출고일·입고일·숫자만.
import { computeRows, buildLocIndex, listShipDates, graceDaysFrom } from './mibal2-rows.js?v=202611130915';
import { historyGroupsOf, historyRecordsOf, hasHistoryToday, mibalTotalsOf, isoDay } from './mibal2-live.js?v=202611130915';
import { MIBAL2_LIVE } from './mibal2-mode.js?v=202611130915';

/** Firestore Timestamp / Date / 숫자(ms) / 날짜 글자 → ms (없으면 0) — 화면 tsMs 와 같다 */
export function tsMs(v) {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    const t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
}

const parseJsonSafe = (s, fallback) => { try { const v = JSON.parse(s); return v == null ? fallback : v; } catch (e) { return undefined; } };

/**
 * mibal2Latest 문서 → { stockRows, shipItems, okMs, parseError } — 화면 applyLatest 와 같다(문서 없음 = 빈 자료, parseError '').
 *   parseError 가 있으면 그쪽 자료는 빈 값(화면도 빈 표). 서버는 parseError 면 기록하지 않는다.
 */
export function parseLatest(data) {
    let parseError = '';
    let stockRows = {}, shipItems = {};
    if (!data) return { stockRows, shipItems, okMs: 0, parseError };
    const r = parseJsonSafe(data.rowsJson || '{}', {});
    if (r === undefined) parseError = '수집 자료(재고) 해석 실패'; else stockRows = r;
    const s = parseJsonSafe(data.shipJson || '{}', {});
    if (s === undefined) parseError = (parseError ? parseError + ' · ' : '') + '수집 자료(출고) 해석 실패';
    else shipItems = (s && s.items) || {};
    return { stockRows, shipItems, okMs: tsMs(data.lastOkAt), parseError };
}

/** computeRows 입력 묶음 — 화면 china-mibal2.js liveBundle() 과 같은 칸. graceDays = graceDaysFrom(config) */
export function liveBundleOf({ stockRows, shipItems, config, edited, locIndex, oldMap = null, selectedDates, now } = {}) {
    return {
        stockRows: stockRows || {}, shipItems: shipItems || {},
        oldMap: oldMap || null,
        zoneConfig: config || {}, edited: edited || {}, loc: locIndex || {},
        selectedDates: (selectedDates || []).map(String), graceDays: graceDaysFrom(config), now: now || new Date()
    };
}

/** 출고일 목록 — 화면 getShipList(listShipDates(ship.items, graceDays, now)) 와 같다 */
export const shipListOf = (shipItems, config, now) => listShipDates(shipItems || {}, graceDaysFrom(config), now || new Date());

/** 출고일 목록 + computeFor(출고일들) → 행 → MIBAL_HISTORY map 패치 — 화면 onLatest 와 같은 식 */
export const historyPatchFrom = (shipList, computeFor, today) =>
    historyRecordsOf(historyGroupsOf(shipList, today), (ships) => mibalTotalsOf(computeFor(ships)), today);

/** 서버가 보낸 시각 표시 {$ts: ms} 를 toMillis 를 가진 값으로(안쪽까지). 다른 값은 그대로 */
export function reviveTs(v) {
    if (Array.isArray(v)) return v.map(reviveTs);
    if (!v || typeof v !== 'object') return v;
    const ks = Object.keys(v);
    if (ks.length === 1 && ks[0] === '$ts' && typeof v.$ts === 'number') { const ms = v.$ts; return { toMillis: () => ms }; }
    const out = {};
    ks.forEach(k => { out[k] = reviveTs(v[k]); });
    return out;
}

const REC_KEYS = ['출고일', '입고일', '미발수량', '전송날짜', 'basis', '부족합', 'grp'];
const sameRec = (a, b) => !!a && !!b && REC_KEYS.every(k => String(a[k] == null ? '' : a[k]) === String(b[k] == null ? '' : b[k]));

/**
 * 서버(미발기록) 한 회차 판정. 순서:
 *   ① 단독 운영 상수 꺼짐(시험 운영 — 기존 화면이 씀) → skip 'not-live'   (비상 전환 기능은 2026-11-12 없앰)
 *   ② 수집 성공(lastOkAt) 날짜 ≠ today → skip 'not-today'
 *   ③ 오늘 v2 기록이 이미 있음 → skip 'exists' (미리보기용으로 자료가 해석되면 계산은 해서 stats 에 같음/다름 건수)
 *   ④ 수집 자료 해석 실패 → skip 'parse-error'
 *   ⑤ 기록할 묶음 0 → skip 'no-groups'
 *   ⑥ 기록 — map 에 이미 있는 키는 뺀다(다 있으면 skip 'keys-exist')
 * @param {object} p
 * @param {object} p.historyMap   MIBAL_HISTORY.map (없으면 {})
 * @param {object|null} p.latestData  mibal2Latest {rowsJson, shipJson, lastOkAt}
 * @param {object} p.config  ChinaStockGoods/CONFIG (zoneCapacity·emptyFill·graceDays)
 * @param {object} p.edited  EDITED_CELLS.cells
 * @param {Array<{id, data}>} p.zoneDocs  Locations ZONE_* (자리마다 code·category 만 있어도 된다)
 * @param {string} p.today  'YYYY-MM-DD'
 * @param {number} p.nowMs  유예 판정 기준 시각
 * @returns {{action:'write'|'skip', reason:string, recs:object, patch:object, stats:object}}
 *   recs = 쓸 것(write 일 때만 차 있음), patch = 계산한 그날 기록 전부(미리보기용)
 */
export function autoHistoryPlan({ historyMap, latestData, config, edited, zoneDocs, today, nowMs } = {}) {
    const map = historyMap || {};
    const stats = { shipDates: 0, groups: 0, keys: 0, write: 0, sameAsExisting: 0, diff: 0, mibal: 0, short: 0, locCodes: 0, parseError: '' };
    const done = (action, reason, recs = {}, patch = {}) => ({ action, reason, recs, patch, stats });

    if (!MIBAL2_LIVE) return done('skip', 'not-live');

    const L = parseLatest(latestData);
    if (!L.okMs || isoDay(new Date(L.okMs)) !== today) return done('skip', 'not-today');

    const exists = hasHistoryToday(map, today);
    stats.parseError = L.parseError;
    if (L.parseError) return done('skip', exists ? 'exists' : 'parse-error');

    const now = new Date(Number(nowMs) || Date.now());
    const locIndex = buildLocIndex(zoneDocs || []);
    stats.locCodes = Object.keys(locIndex).length;
    const base = { stockRows: L.stockRows, shipItems: L.shipItems, config, edited, locIndex, oldMap: null, now };
    const computeFor = (ships) => computeRows(liveBundleOf({ ...base, selectedDates: ships }));
    const shipList = shipListOf(L.shipItems, config, now);
    const groups = historyGroupsOf(shipList, today);
    const patch = historyRecordsOf(groups, (ships) => mibalTotalsOf(computeFor(ships)), today);
    stats.shipDates = shipList.length;
    stats.groups = groups.length;
    stats.keys = Object.keys(patch).length;
    const seenGrp = new Set();
    Object.keys(patch).forEach(k => {
        const r = patch[k];
        if (!seenGrp.has(r.grp)) { seenGrp.add(r.grp); stats.mibal += r.미발수량; stats.short += r.부족합; }   // 묶음마다 한 번
        if (k in map) { if (sameRec(map[k], r)) stats.sameAsExisting++; else stats.diff++; }
    });

    if (exists) return done('skip', 'exists', {}, patch);
    if (!groups.length) return done('skip', 'no-groups', {}, patch);
    const recs = {};
    Object.keys(patch).forEach(k => { if (!(k in map)) recs[k] = patch[k]; });
    stats.write = Object.keys(recs).length;
    if (!stats.write) return done('skip', 'keys-exist', {}, patch);
    return done('write', 'write', recs, patch);
}
