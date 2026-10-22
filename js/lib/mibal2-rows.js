// === js/lib/mibal2-rows.js ===
// 신규 미발계산기(미발계산기2) — '입력 묶음 → 행 결과' 순수 함수. 2026-10-07. 설계: 업무자동화\앱\미발계산기2\설계.md
//
// 실시간 화면(오늘)과 날짜별 비교(integrations/mibal2Daily_*)가 **같은 함수**로 계산하도록 여기 모았다.
// 수집기(미발수집_apps_script.gs)가 Daily 문서에 넣는 locJson 도 이 파일의 buildLocIndex 규칙을 그대로 옮겼다.
// 이쪽을 바꾸면 gs 의 buildLocIndex_ 도 바꿀 것.
// 채우기자동화\규칙.py 도 isEtcLocObj·pickLocation·buildLocIndex 를 같은 규칙으로 옮겼다 — 바꾸면 그쪽도 바꿀 것(tests\test_JS일치.py 가 비교).
//
// 순수 모듈(DOM/Firebase 의존 없음). 브라우저와 node --test 가 함께 쓴다.
// 계산은 mibal2-calc.js calcPlan(공식 버전 FORMULA_VER — 2026-10-20 v2: 피킹 → 비축 → 입고분, 3층 = 미발 + 피킹 적재).
// ⚠️ js/china-stock-goods.js 는 import 하지 않는다 — 로드만 해도 ScanDB 를 지우고 다시 쓴다. 규칙만 같게 옮긴다.
import { calcPlan, calcOld, capacityFor, zoneKey, DEFAULT_ZONE_CAPACITY, STAR_ZONE_DEFAULT, FORMULA_VER } from './mibal2-calc.js?v=202610221732';

// ─────────────────────────────────────────────────────────────
// 도착수량 · 출고일 목록
// ─────────────────────────────────────────────────────────────

/**
 * 본사도착 유예 — china-stock-goods.js:94 withinGrace 와 같다.
 * (본사도착일 + graceDays) 가 now 의 0시 이후(포함)면 아직 유예 안 지남 → 유지. 날짜가 깨졌으면 false(=제외).
 */
export function withinGrace(arrivalDateStr, graceDays, now = new Date()) {
    if (!arrivalDateStr || arrivalDateStr.length < 10) return false;
    const d = new Date(arrivalDateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    d.setDate(d.getDate() + (parseInt(graceDays) || 0));
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    return d.getTime() >= today.getTime();
}

/** 한 출고 기록 [출고일, 본사도착일, 수량] 이 빠지는지 — china-stock-goods.js:2236~2238 */
export function entryExpired(entry, graceDays, now) {
    const ship = String(entry[0] || '');
    if (ship.length < 10) return true;                                   // :2236 출고일 없음 → 제외
    const arr = String(entry[1] || '');
    return !!(arr && arr.length >= 10 && !withinGrace(arr, graceDays, now)); // :2238 도착일+유예 지남 → 제외
}

/**
 * 상품 하나의 도착수량 — china-stock-goods.js:2222 applyDates 의 match() 와 같은 규칙:
 *   1~6차 중 선택한 출고일과 같은 차수의 출고수량을 모두 더한다(유예 지난 차수는 뺀다).
 *   같은 코드가 여러 행(오더·사입)이면 합친다 — shipJson 은 이미 코드별로 모아 둔 목록이다.
 * @returns {{qty:number, used:Array, skipped:Array}}  used/skipped 는 근거 표시용
 */
export function arrivalFor(item, selectedSet, graceDays, now) {
    let qty = 0; const used = [], skipped = [];
    ((item && item.s) || []).forEach(e => {
        if (!selectedSet.has(e[0])) return;
        if (entryExpired(e, graceDays, now)) { skipped.push(e); return; }
        qty += (parseInt(e[2]) || 0);
        used.push(e);
    });
    return { qty, used, skipped };
}

/** 출고일 선택 목록 — china-stock-goods.js:2112 extractShipDates 와 같은 거르기(유예 지난 차수 제외), 최신순 */
export function listShipDates(items, graceDays, now) {
    const map = {};
    Object.entries(items || {}).forEach(([code, it]) => {
        ((it && it.s) || []).forEach(e => {
            if (entryExpired(e, graceDays, now)) return;
            const m = map[e[0]] || (map[e[0]] = { qty: 0, skus: new Set(), arrivals: new Set() });
            m.qty += (parseInt(e[2]) || 0);
            m.skus.add(code);
            if (e[1] && String(e[1]).length >= 10) m.arrivals.add(e[1]);
        });
    });
    return Object.entries(map)
        .map(([date, m]) => ({ date, qty: m.qty, skus: m.skus.size, arrivals: [...m.arrivals].sort() }))
        .sort((a, b) => b.date.localeCompare(a.date));
}

// ─────────────────────────────────────────────────────────────
// 로케이션 (Locations ZONE_* 문서 → 상품코드별 대표 자리)
// ─────────────────────────────────────────────────────────────

/** 기타 자리 판정 — location.js:985 isEtcLocObj (대분류 '기타' 또는 id 가 SAM 으로 시작) */
export const isEtcLocObj = (d) => String(d.category || '피킹용').trim() === '기타' || /^SAM/i.test(String(d.id || '').trim());

/**
 * 한 상품코드의 자리 목록 → 대표 자리.
 * location.js:986~990 getBaseLocsForCode: 피킹용 자리가 있으면 피킹용만, 없으면 전체(기타·SAM) 중에서 → 그중 첫 자리
 * (location.js:4366 matches[0]).
 */
export function pickLocation(list) {
    if (!list || !list.length) return null;
    const picking = list.filter(d => !isEtcLocObj(d));
    const base = picking.length > 0 ? picking : list;
    return { id: String(base[0].id), count: list.length, etcOnly: picking.length === 0 };
}

/**
 * ZONE_ 문서들 → { 상품코드: {id, count, etcOnly} }.
 * @param {Array<{id:string, data:object}>} zoneDocs  Locations 의 ZONE_* 문서(id·필드 그대로)
 * 규칙:
 *   · 문서는 id 오름차순, 문서 안 자리(키)도 오름차순(JS 기본 정렬 = UTF-16 코드 단위)으로 돈다.
 *     location.js 는 '읽은 순서' 를 쓰는데, 브라우저 SDK 와 수집기(REST) 가 같은 순서를 보장받으려고 정렬을 명시했다.
 *   · 값이 객체가 아니면 건너뛴다(location.js:533).
 *   · code = String(code).trim(), 비었거나 자리 id 와 같으면 빈칸(location.js:898).
 */
export function buildLocIndex(zoneDocs) {
    const lists = {};
    [...(zoneDocs || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).forEach(zd => {
        const z = zd.data || {};
        Object.keys(z).sort().forEach(locId => {
            const o = z[locId];
            if (!o || typeof o !== 'object') return;
            const code = String(o.code == null ? '' : o.code).trim();
            if (!code || code === locId) return;
            (lists[code] || (lists[code] = [])).push({ id: locId, category: o.category });
        });
    });
    const out = {};
    Object.keys(lists).forEach(code => { out[code] = pickLocation(lists[code]); });
    return out;
}

/** 적재량이 어디서 왔는지(근거 표시용) — capacityFor 와 같은 우선순위 */
export function capacitySource(locId, config, ed) {
    if (ed && ed.capacity !== undefined && ed.capacity !== '') return '개별 수정값(EDITED_CELLS)';
    if (!locId) return '로케이션 없음 → 0';
    const zc = (config && config.zoneCapacity) || {};
    const ch = zoneKey(locId);
    if (zc[ch] !== undefined && zc[ch] !== '') return `구역 설정 '${ch}'(CONFIG.zoneCapacity)`;
    if (ch === '★') return `★ 구역 기본값 ${STAR_ZONE_DEFAULT}`;
    return DEFAULT_ZONE_CAPACITY[ch] ? `구역 '${ch}' 기본값` : `구역 '${ch}' 기본값 없음 → 0`;
}

/** 적재량 출처 짧은 글자(표의 '적재량(출처)' 칸) — capacitySource 와 같은 분기: 개별 | 구역 | ★기본 | 기본 | 없음 */
export function capacitySourceKind(locId, config, ed) {
    if (ed && ed.capacity !== undefined && ed.capacity !== '') return '개별';
    if (!locId) return '없음';
    const zc = (config && config.zoneCapacity) || {};
    const ch = zoneKey(locId);
    if (zc[ch] !== undefined && zc[ch] !== '') return '구역';
    if (ch === '★') return '★기본';
    return DEFAULT_ZONE_CAPACITY[ch] ? '기본' : '없음';
}

// ─────────────────────────────────────────────────────────────
// 플래그 — 화면·엑셀이 같은 글자를 쓴다
// ─────────────────────────────────────────────────────────────

/** 플래그 키 → [화면 글자, css 클래스] */
export const FLAG_INFO = Object.freeze({
    zeroCapacity: ['적재량0', 'bad'], noStock: ['재고모름', 'bad'], noOrders: ['주문모름', 'bad'],
    noReserve: ['비축모름', 'bad'], negReserve: ['비축음수', 'bad'], negPick: ['피킹재고음수', 'bad'],
    unresolved: ['남는부족수량', 'warn'], overCap: ['피킹넘침', 'warn'], needRefill: ['보충필요', 'warn'],
    noLoc: ['로케이션없음', 'bad'], etcLoc: ['기타자리만', 'bad'], multiLoc: ['여러자리', ''],
    onlyOld: ['기존에만', 'bad'], noOld: ['신규에만', 'warn'], arrDiff: ['도착다름', 'warn']
});
/** 하나라도 붙으면 '확인 필요' 행. multiLoc 은 사용자 결정(첫 자리 하나)이라 정보만 */
export const CHECK_FLAGS = new Set(['noStock', 'noOrders', 'noReserve', 'negReserve', 'negPick', 'zeroCapacity', 'noLoc', 'etcLoc']);

// ─────────────────────────────────────────────────────────────
// 설정·저장 형식 → 입력 묶음 정규화
// ─────────────────────────────────────────────────────────────

/** graceDays — china-stock-goods.js:2825 loadConfig 와 같다(없으면 1, 있으면 parseInt||0) */
export function graceDaysFrom(cfg) {
    return (cfg && cfg.graceDays !== undefined && cfg.graceDays !== null) ? (parseInt(cfg.graceDays) || 0) : 1;
}
/** 기존 계산기 출고일 — china-stock-goods.js:2825 (savedDatesMibal → savedDates → []), 문자열로 */
export function legacyDatesFrom(cfg) {
    const c = cfg || {};
    const a = Array.isArray(c.savedDatesMibal) ? c.savedDatesMibal : (Array.isArray(c.savedDates) ? c.savedDates : []);
    return a.map(String);
}
/** 이 화면이 쓸 출고일: mibal2/settings 에서 따로 골랐으면 그것, 아니면 기존 계산기 것 */
export function selectedDatesFrom(cfg, settings) {
    if (settings && settings.useOwnDates && Array.isArray(settings.shipDates)) return { dates: settings.shipDates.map(String), source: 'own' };
    return { dates: legacyDatesFrom(cfg), source: 'legacy' };
}
/** ScanDB_Versions.data / ScanDB 문서들 {code:{mibalQty, arrivalQty}} → {code:{mibal, arr}} (parseInt||0) */
export function oldMapFromScan(map) {
    const out = {};
    Object.keys(map || {}).forEach(code => {
        const o = map[code] || {};
        out[code] = { mibal: parseInt(o.mibalQty) || 0, arr: parseInt(o.arrivalQty) || 0 };
    });
    return out;
}
/** Daily 문서 oldJson {code: mibalQty} → {code:{mibal, arr:null}} (도착은 저장하지 않으므로 모름) */
export function oldMapFromDaily(obj) {
    const out = {};
    Object.keys(obj || {}).forEach(code => { out[code] = { mibal: parseInt(obj[code]) || 0, arr: null }; });
    return out;
}
/** Daily 문서 editedJson {code: capacity} → EDITED_CELLS.cells 모양 {code:{capacity}} */
export function editedFromDaily(obj) {
    const out = {};
    Object.keys(obj || {}).forEach(code => { out[code] = { capacity: obj[code] }; });
    return out;
}
/** Daily 문서 locJson {code: 대표자리} → {code:{id, count:null, etcOnly:null}} (자리 개수·기타 여부는 저장하지 않음) */
export function locFromDaily(obj) {
    const out = {};
    Object.keys(obj || {}).forEach(code => { if (obj[code]) out[code] = { id: String(obj[code]), count: null, etcOnly: null }; });
    return out;
}

// ─────────────────────────────────────────────────────────────
// 입력 묶음 → 행 결과
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} b 입력 묶음
 * @param {Object<string,{n,r,i,b}>} b.stockRows  mibal2 rowsJson (총재고·접수·송장·비축재고). b 는 10/8 수집기부터, 모르면 키 없음 → noReserve
 * @param {Object<string,{nm,op,s}>} b.shipItems  mibal2 shipJson.items
 * @param {Object<string,{mibal:number, arr:number|null}>|null} b.oldMap  기존 미발 비교값. null = 비교 자료 없음(플래그도 안 붙임)
 * @param {object} b.zoneConfig   capacityFor 에 넘길 CONFIG({zoneCapacity})
 * @param {Object<string,{capacity}>} b.edited   EDITED_CELLS.cells 모양
 * @param {Object<string,{id, count, etcOnly}>} b.loc   buildLocIndex 결과(또는 locFromDaily)
 * @param {string[]} b.selectedDates
 * @param {number} b.graceDays
 * @param {Date} [b.now]   유예 판정 기준일(날짜별 보기는 그날 수집 시각)
 * @returns {Array<object>} 행 — 표·요약·비교 저장이 그대로 쓴다
 */
export function computeRows(b) {
    const now = b.now || new Date();
    const sel = new Set((b.selectedDates || []).map(String));
    const items = b.shipItems || {};
    const stockRows = b.stockRows || {};
    const loc = b.loc || {};
    const edited = b.edited || {};
    const oldMap = b.oldMap || null;
    const g = b.graceDays;

    const codes = new Map();   // code → arrival 결과
    Object.keys(items).forEach(code => {
        const a = arrivalFor(items[code], sel, g, now);
        if (a.qty > 0) codes.set(code, a);   // china-stock-goods.js:2270 .filter(d => d.arrivalQty > 0)
    });
    if (oldMap) Object.keys(oldMap).forEach(code => { if (!codes.has(code)) codes.set(code, arrivalFor(items[code], sel, g, now)); });

    return [...codes.entries()].map(([code, a]) => {
        const it = items[code] || {};
        const sr = stockRows[code] || null;
        const locInfo = loc[code] || null;
        const locId = locInfo ? locInfo.id : '';
        const ed = edited[code];
        const cap = capacityFor(locId, b.zoneConfig, ed);
        const input = { 총재고: sr ? sr.n : null, 비축: sr ? sr.b : null, 접수: sr ? sr.r : null, 송장: sr ? sr.i : null, 적재량: cap, 도착: a.qty };
        const res = calcPlan(input);
        // 기존공식 × 신규입력: 부족수량 = max(접수+송장−정상, 0), 직진 = 0
        let oldNew = null, shortage = null;
        if (sr && sr.n !== null && sr.n !== undefined && sr.r !== null && sr.r !== undefined && sr.i !== null && sr.i !== undefined) {
            shortage = Math.max((parseInt(sr.r) || 0) + (parseInt(sr.i) || 0) - (parseInt(sr.n) || 0), 0);
            oldNew = calcOld({ 총재고: sr.n, 적재량: cap, 도착: a.qty, 부족수량: shortage, 직진: 0 });
        }
        const o = oldMap ? oldMap[code] : undefined;
        const old = o ? o.mibal : null;
        const oldArr = o && o.arr !== null && o.arr !== undefined ? o.arr : null;
        // 비교 기준 = 3층으로 보낼 양(스캐너 mibalQty 와 같은 뜻)
        const diff = (old !== null && res.삼층 !== null) ? res.삼층 - old : null;
        const flags = [...res.flags];
        if (!locInfo) flags.push('noLoc');
        else { if (locInfo.etcOnly) flags.push('etcLoc'); if (locInfo.count > 1) flags.push('multiLoc'); }
        if (oldMap) {
            if (o && a.qty <= 0) flags.push('onlyOld');
            if (!o) flags.push('noOld');
            if (o && a.qty > 0 && oldArr !== null && oldArr !== a.qty) flags.push('arrDiff');
        }
        return {
            code, name: it.nm || '', option: it.op || '', loc: locInfo ? locInfo.id : '미지정', locInfo,
            cap, capSrc: capacitySource(locId, b.zoneConfig, ed), capKind: capacitySourceKind(locId, b.zoneConfig, ed),
            arr: a.qty, arrUsed: a.used, arrSkipped: a.skipped,
            stock: sr && sr.n !== undefined ? sr.n : null, bstock: res.비축, pstock: res.피킹재고,
            recv: sr && sr.r !== undefined ? sr.r : null, inv: sr && sr.i !== undefined ? sr.i : null,
            out: res.출고예정, short: res.부족, mibal: res.미발, unres: res.미해결, remArr: res.남은도착,
            pickAfter: res.출고후피킹, resAfter: res.출고후비축, room: res.피킹여유,
            pick: res.피킹적재, resv: res.비축적재, refill: res.보충, third: res.삼층,
            old, oldArr, oldNew, shortage, diff, diffAbs: diff === null ? -1 : Math.abs(diff),
            flags, check: flags.some(f => CHECK_FLAGS.has(f)), input, res
        };
    });
}

/**
 * 요약 카드 숫자 — 모르는 값(null)은 0 으로 더한다. SKU 는 도착>0 행, refill 은 보충>0 행 수, check 는 확인 필요 행 수.
 * bstock(비축재고 합)은 모든 행의 비축재고가 모름이면 null(옛 사본). thirdUnknown = 3층을 모르는데 도착>0 인 행 수(3층 합에서 빠짐)
 */
export function summarize(rows) {
    const rs = rows || [];
    const sum = (k) => rs.reduce((s, r) => s + (r[k] || 0), 0);
    const hasB = rs.some(r => r.bstock !== null && r.bstock !== undefined);
    return {
        sku: rs.filter(r => r.arr > 0).length,
        arr: sum('arr'), mibal: sum('mibal'), unres: sum('unres'), third: sum('third'),
        pick: sum('pick'), resv: sum('resv'),
        refill: rs.filter(r => (r.refill || 0) > 0).length,
        check: rs.filter(r => r.check).length,
        old: sum('old'), diff: sum('diff'),
        bstock: hasB ? sum('bstock') : null,
        thirdUnknown: rs.filter(r => (r.third === null || r.third === undefined) && r.arr > 0).length
    };
}

/** 비교 저장 형식의 칸 이름 — 저장 문서에 formulaVer·cols 와 함께 남긴다(공식 v1 의 7칸 배열과 뜻이 다르다) */
export const COMPARE_COLS = Object.freeze(['기존', '3층', '미발', '도착', '피킹적재', '비축적재', '비축', '미해결', '보충', '기존공식x신규입력']);

/** 비교 저장 형식 {code:[COMPARE_COLS 순서]} — 상품명·금액은 넣지 않는다 */
export function compareRowsOf(rows) {
    const out = {};
    (rows || []).forEach(r => { out[r.code] = [r.old, r.third, r.mibal, r.arr, r.pick, r.resv, r.bstock, r.unres, r.refill, r.oldNew]; });
    return out;
}

/** 엑셀 열 — 화면 표 순서(상품명/옵션·적재량(출처)는 두 칸으로 나눔) + 확인필요 + 플래그 */
const EXCEL_COLS = [
    ['No', (r, i) => i + 1], ['코드', r => r.code], ['상품명', r => r.name], ['옵션', r => r.option],
    ['피킹로케이션', r => (r.locInfo ? r.loc : '미지정')], ['적재량', r => r.cap], ['적재량출처', r => r.capKind],
    ['도착', r => r.arr], ['총재고', r => r.stock], ['비축', r => r.bstock], ['피킹재고', r => r.pstock],
    ['접수', r => r.recv], ['송장', r => r.inv], ['출고예정', r => r.out], ['부족수량', r => r.short],
    ['미발수량(추가 출고)', r => r.mibal], ['남는 부족수량', r => r.unres], ['피킹 여유', r => r.room],
    ['피킹 배정수량', r => r.third], ['피킹 적재', r => r.pick], ['비축 적재', r => r.resv], ['비축→피킹 보충', r => r.refill],
    ['기존 계산기 미발수량', r => r.old], ['차이(피킹 배정−기존)', r => r.diff],
    ['확인필요', r => (r.check ? 'Y' : '')],
    ['플래그', r => (r.flags || []).map(f => (FLAG_INFO[f] ? FLAG_INFO[f][0] : f)).join('·')]
];
const NUM_KEYS = new Set(['No', '적재량', '도착', '총재고', '비축', '피킹재고', '접수', '송장', '출고예정', '부족수량', '미발수량(추가 출고)', '남는 부족수량',
    '피킹 여유', '피킹 배정수량', '피킹 적재', '비축 적재', '비축→피킹 보충', '기존 계산기 미발수량', '차이(피킹 배정−기존)']);

/** 행 → 엑셀용 2차원 배열(첫 줄 머리글). 숫자 칸의 null·숫자 아님은 빈칸. 상품코드·상품명·옵션·숫자만(공급처·원가·고객정보 없음) */
export function excelAoaOf(rows) {
    const aoa = [EXCEL_COLS.map(c => c[0])];
    (rows || []).forEach((r, i) => {
        aoa.push(EXCEL_COLS.map(([h, f]) => {
            const v = f(r, i);
            if (NUM_KEYS.has(h)) { const n = (v === null || v === undefined || v === '') ? NaN : Number(v); return Number.isFinite(n) ? n : ''; }
            return v === null || v === undefined ? '' : String(v);
        }));
    });
    return aoa;
}
