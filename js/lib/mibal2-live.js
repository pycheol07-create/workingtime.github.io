// === js/lib/mibal2-live.js ===
// 신규 부족수량관리 단독 운영(live) — 순수 함수(DOM/Firebase 없음). 2026-10-28. tests/mibal2-live.test.js 가 본다.
// 쓰기는 js/china-mibal2-live*.js 가 한다(live 일 때만 동적 import). 여기는 '무엇을 쓸지' 계산만.
//
//   scanApplyPlan    [스캐너에 반영] — ScanDB 에 쓸 문서·지울 코드 (식 = js/lib/scan-link.js scanDbPreviewOf 와 같다)
//   versionDataOf    ScanDB 문서들 → ScanDB_Versions 사본 모양(기존 화면 saveScanDBVersion 과 같은 칸)
//   archiveRecordOf  [작업 마감] — ChinaStockGoods_Archive/{작업번호} 문서(코드별 도착·입고합·비축·입고오차 요약)
//   diffRowsOf       신규 표 행 → js/lib/inbound-diff.js buildDiffRecord 가 받는 행 모양
//   historyGroupsOf · historyRecordsOf   업무예상용 MIBAL_HISTORY 자동 기록(basis 'v2')
//   locSourceOf · locFreshMsOf · locStaleReason   위치값 엑셀의 옵션추가항목1 원천(로케이션관리 Locations)
//   barcodeMapOfAoa  [바코드 매핑 올리기] 엑셀 → BARCODE_MAP(바코드 → 상품코드)
// 공급처 이름·원가는 다루지 않는다. Locations rawData 는 '옵션추가항목1' 칸 하나만 꺼낸다.
import { scanDbPreviewOf, byShipOf } from './scan-link.js?v=202610301140';

export const ARCHIVE_COLL = 'ChinaStockGoods_Archive';
export const RECENT_SCAN_MIN = 10;          // 마지막 스캔 입고가 이 안이면 [스캐너에 반영] 전에 확인창
export const LOC_STALE_DAYS = 7;            // 로케이션관리 업로드가 이 일수보다 오래되면 위치값 엑셀 받기를 막는다
export const HISTORY_BASIS = 'v2';          // MIBAL_HISTORY basis — 신규 화면 자동 기록(js/lib/mibal-forecast.js)
export const ARCHIVE_ID_RE = /^[0-9]{8}-[0-9]{6}$/;   // firestore.rules ChinaStockGoods_Archive 와 같다
export const ARCHIVE_BYTE_LIMIT = 900000;

const int0 = (v) => parseInt(v) || 0;
const pad2 = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD' (로컬 날짜) */
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** Date → 작업번호·보관 ID 'YYYYMMDD-HHMMSS' (로컬 시각) */
export const batchIdOf = (d = new Date()) =>
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

/**
 * [스캐너에 반영] 계획.
 *   rows = 신규 표 행(선택 출고일), inboundMap = 앱 스캔 입고 합(미발 초기화·작업 마감 이후), currentCodes = 지금 ScanDB 문서 id.
 *   쓸 값: arrivalQty = max(도착 − 입고합, 0) · mibalQty = max(피킹 배정수량 − 입고합, 0) · location = Locations 대표 피킹자리 · name.
 *   피킹 배정수량을 모르는 상품(비축 모름)은 mibalQty = 남은 도착 전부(피킹으로 보냄) — unknownMibal 에 모아 확인창에 보인다.
 *   문서 칸은 기존 화면 syncScanDBCore 와 같다(code·name·option·arrivalQty·mibalQty·totalStock·location·capacity) — updatedAt 은 쓰는 쪽이 붙인다.
 *   deletes = 지금 ScanDB 에 있는데 새 목록에 없는 코드(정렬).
 */
export function scanApplyPlan(rows, inboundMap, currentCodes) {
    const preview = scanDbPreviewOf(rows, inboundMap);
    const sets = {};
    const unknownMibal = [];
    let arr = 0, mibal = 0;
    Object.keys(preview).sort().forEach(code => {
        const p = preview[code];
        let m = p.mibalQty;
        if (m === null || m === undefined) { m = p.arrivalQty; unknownMibal.push(code); }
        sets[code] = {
            code, name: p.name || '', option: p.option || '',
            arrivalQty: p.arrivalQty, mibalQty: m,
            totalStock: p.totalStock === null || p.totalStock === undefined ? 0 : int0(p.totalStock),
            location: p.location || '', capacity: p.capacity === null || p.capacity === undefined ? 0 : int0(p.capacity)
        };
        arr += p.arrivalQty; mibal += m;
    });
    const deletes = [...new Set(currentCodes || [])].filter(c => !(c in sets)).sort();
    return { sets, deletes, unknownMibal, totals: { codes: Object.keys(sets).length, arr, mibal, del: deletes.length } };
}

/** ScanDB 문서들 [{id, data}] → { data, count, totalMibal } — 기존 화면 saveScanDBVersion 과 같은 칸 */
export function versionDataOf(docs) {
    const data = {};
    let totalMibal = 0;
    (docs || []).forEach(d => {
        const v = d.data || {};
        data[d.id] = { name: v.name || '', option: v.option || '', arrivalQty: v.arrivalQty || 0, mibalQty: v.mibalQty || 0,
            location: v.location || '', totalStock: v.totalStock || 0, capacity: v.capacity || 0 };
        totalMibal += int0(v.mibalQty);
    });
    return { data, count: Object.keys(data).length, totalMibal };
}

/**
 * [작업 마감] 보관 문서. 행 = 선택 출고일 도착 상품(+ 표 밖 앱 스캔 입고).
 *   rows: 신규 표 행(outside 행 포함 가능) · inboundMap · floor2Map {code: 비축 수량}
 *   한 줄 = { c, nm, a(도착), q(앱 스캔 입고합), f2(비축), d(도착−입고), u?:1(선택 출고일 밖 입고) }
 *   totals = { codes, arr, conf, floor2, short, over, noScan(도착 있는데 입고 0), outside }
 */
export function archiveRecordOf({ id, ships, startedAtMs, closedAt, by, rows, inboundMap, floor2Map } = {}) {
    const im = inboundMap || {}, f2 = floor2Map || {};
    const out = [];
    const seen = new Set();
    (rows || []).forEach(r => {
        if (!r || !r.code || seen.has(r.code)) return;
        const a = r.outside ? 0 : int0(r.arr);
        const q = int0(im[r.code]);
        if (a <= 0 && q <= 0) return;
        seen.add(r.code);
        const row = { c: String(r.code), nm: String(r.name || ''), a, q, f2: int0(f2[r.code]), d: a - q };
        if (r.outside) row.u = 1;
        out.push(row);
    });
    Object.keys(im).forEach(code => {
        if (seen.has(code) || !(int0(im[code]) > 0)) return;
        seen.add(code);
        out.push({ c: code, nm: '', a: 0, q: int0(im[code]), f2: int0(f2[code]), d: -int0(im[code]), u: 1 });
    });
    out.sort((x, y) => x.c.localeCompare(y.c));
    const t = { codes: out.length, arr: 0, conf: 0, floor2: 0, short: 0, over: 0, noScan: 0, outside: 0 };
    out.forEach(r => {
        t.arr += r.a; t.conf += r.q; t.floor2 += r.f2;
        if (r.u) t.outside++;
        if (r.a > 0 && r.q === 0) t.noScan++;
        else if (r.d > 0) t.short += r.d;
        else if (r.d < 0) t.over += -r.d;
    });
    const cAt = closedAt instanceof Date ? closedAt : new Date(closedAt || Date.now());
    return {
        id: String(id || batchIdOf(cAt)),
        ships: [...new Set((ships || []).map(String))].sort(),
        startedAtMs: Number(startedAtMs) || 0,
        closedAt: cAt, closedAtMs: cAt.getTime(),
        by: String(by || '').slice(0, 40),
        totals: t, rows: out
    };
}

/**
 * 부분 마감 뒤 추가분 보관 — 같은 작업의 지난 마감(partialOf)이 비축 비우기 직전에 멈춘 뒤 다시 마감할 때.
 *   도착·입고 오차는 지난 보관에 이미 있으므로 넣지 않는다(a = 0, d = 0). 남기는 것은 그 뒤 앱 스캔(q — 지난번 입고이력은 이미 지움)과
 *   비축 늘어난 몫(f2 = 지금 비축 − 지난번 보관 때 비축 baseF2, 0 아래는 0). 둘 다 없는 줄은 뺀다.
 * @returns 새 문서(rows·totals 다시 계산, partialOf 칸 추가)
 */
export function partialRecordOf(rec, partialOf, baseF2) {
    const base = baseF2 || {};
    const rows = [];
    (rec.rows || []).forEach(r => {
        const f2 = Math.max(int0(r.f2) - int0(base[r.c]), 0);
        const q = int0(r.q);
        if (q <= 0 && f2 <= 0) return;
        const x = { c: r.c, nm: r.nm || '', a: 0, q, f2, d: 0 };
        if (r.u) x.u = 1;
        rows.push(x);
    });
    const t = { codes: rows.length, arr: 0, conf: 0, floor2: 0, short: 0, over: 0, noScan: 0, outside: 0 };
    rows.forEach(r => { t.conf += r.q; t.floor2 += r.f2; if (r.u) t.outside++; });
    return { ...rec, partialOf: String(partialOf), totals: t, rows };
}

/** 보관 문서가 너무 크면 상품명을 뺀 사본 → { rec, shrunk, ok } */
export function shrinkArchive(rec, limit = ARCHIVE_BYTE_LIMIT) {
    const size = (o) => {
        const s = JSON.stringify(o);
        return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length * 3;
    };
    if (size(rec) <= limit) return { rec, shrunk: false, ok: true };
    const small = { ...rec, rows: (rec.rows || []).map(r => { const x = { ...r }; delete x.nm; return x; }) };
    return { rec: small, shrunk: true, ok: size(small) <= limit };
}

/** 보관 문서 → 엑셀(2차원 배열) */
export function archiveAoa(rec) {
    const aoa = [['상품코드', '상품명', '도착', '앱 스캔 입고', '비축', '차이(도착−입고)', '비고']];
    ((rec && rec.rows) || []).forEach(r => aoa.push([r.c, r.nm || '', int0(r.a), int0(r.q), int0(r.f2), int0(r.d), r.u ? '선택 출고일 밖 입고' : '']));
    return aoa;
}

/**
 * 신규 표 행 → buildDiffRecord(rows) 모양 { code, name, option, arrivalQty, confirmed, confSrc, byShip, unregistered }.
 * '선택 출고일 밖 입고' 행은 unregistered(미등록 입고분)로 넘긴다 — 도착 0, 입고확인 = 스캔 합.
 */
export function diffRowsOf(rows) {
    return (rows || []).filter(r => r && r.code).map(r => ({
        code: r.code, name: r.name || '', option: r.option || '',
        arrivalQty: r.outside ? 0 : int0(r.arr),
        confirmed: r.conf === undefined ? '' : r.conf,
        confSrc: r.confSrc,
        byShip: r.outside ? {} : byShipOf(r.arrUsed),
        unregistered: !!r.outside
    }));
}

/**
 * 업무예상용 자동 기록 묶음 — 아직 입고 안 된 패킹(출고일)별.
 *   shipList = listShipDates 결과 [{date, arrivals:[...]}]. 가장 이른 본사도착일이 today 보다 앞이면(이미 입고) 뺀다.
 *   같은 날 도착하는 출고일은 한 묶음(함께 계산해 같은 값을 출고일마다 기록 — mibal-forecast 가 한 번만 더한다).
 *   도착일을 모르는 출고일은 따로 한 묶음씩.
 * @returns {Array<{ships:string[], 입고일:string}>}
 */
export function historyGroupsOf(shipList, today) {
    const groups = new Map();
    (shipList || []).forEach(x => {
        if (!x || !x.date) return;
        const arrs = (x.arrivals || []).map(String).filter(s => s.length >= 10).sort();
        const first = arrs[0] || '';
        if (first && today && first < today) return;
        const key = first ? 'a:' + first : 's:' + x.date;
        if (!groups.has(key)) groups.set(key, { ships: [], 입고일: first });
        groups.get(key).ships.push(String(x.date));
    });
    return [...groups.values()].map(g => ({ ships: g.ships.sort(), 입고일: g.입고일 }));
}

/**
 * 묶음별 합계 → MIBAL_HISTORY map 패치 { '출고일|전송날짜': {출고일, 입고일, 미발수량, 전송날짜, basis, 부족합} }.
 *   totalsOf(ships) → { mibal: Σ미발수량(min(부족,도착)), short: Σ부족수량 }
 */
export function historyRecordsOf(groups, totalsOf, today) {
    const out = {};
    (groups || []).forEach(g => {
        const t = totalsOf(g.ships) || {};
        const grp = [...g.ships].map(String).sort().join('+');   // 묶음 키 — mibal-forecast 가 v2 는 이것으로만 묶는다
        g.ships.forEach(ship => {
            out[`${ship}|${today}`] = { 출고일: ship, 입고일: g.입고일 || '', 미발수량: int0(t.mibal), 전송날짜: today, basis: HISTORY_BASIS, 부족합: int0(t.short), grp };
        });
    });
    return out;
}

/** 오늘 이미 신규 화면(v2) 기록이 있는가 */
export const hasHistoryToday = (map, today) => Object.values(map || {}).some(r => r && r.전송날짜 === today && r.basis === HISTORY_BASIS);

/** 행들 → { mibal: Σmin(부족,도착), short: Σ부족 } (모름은 0) */
export const mibalTotalsOf = (rows) => (rows || []).reduce((s, r) => ({ mibal: s.mibal + int0(r && r.mibal), short: s.short + int0(r && r.short) }), { mibal: 0, short: 0 });

/** 자리 칸 → '옵션추가항목1'(location.js 와 같은 순서: rawDataStr 이 있으면 그것만, 없으면 rawData 맵). 다른 칸은 보지 않는다 */
export function opt1Of(slot) {
    if (!slot || typeof slot !== 'object') return '';
    if (slot.rawDataStr) {
        try { const d = JSON.parse(slot.rawDataStr); const v = d && typeof d === 'object' ? d['옵션추가항목1'] : ''; return v == null ? '' : String(v); }
        catch (e) { return ''; }
    }
    const rd = slot.rawData;
    if (rd && typeof rd === 'object') { const v = rd['옵션추가항목1']; return v == null ? '' : String(v); }
    return '';
}

/**
 * Locations ZONE_* 문서들 [{id, data}] + 대표 자리(buildLocIndex 결과 {code:{id}}) → { code: { name, option, loc, opt1 } }.
 *   china-mibal2-loc.js 의 미발재고로그 자리(stockLogPick 모양)를 대신한다. 순서는 buildLocIndex 와 같다(문서 id·자리 id 오름차순),
 *   이름·옵션·옵션추가항목1 은 처음 나온 빈칸 아닌 값. 공급처 등 rawData 의 다른 칸은 꺼내지 않는다.
 */
export function locSourceOf(zoneDocs, locIndex) {
    const out = {};
    [...(zoneDocs || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).forEach(zd => {
        const z = zd.data || {};
        Object.keys(z).sort().forEach(locId => {
            const o = z[locId];
            if (!o || typeof o !== 'object') return;
            const code = String(o.code == null ? '' : o.code).trim();
            if (!code || code === locId) return;
            const e = out[code] || (out[code] = { name: '', option: '', loc: '', opt1: '' });
            if (!e.name && o.name) e.name = String(o.name);
            if (!e.option && o.option) e.option = String(o.option);
            if (!e.opt1) e.opt1 = opt1Of(o);
        });
    });
    Object.keys(out).forEach(code => { const li = (locIndex || {})[code]; out[code].loc = li && li.id ? String(li.id) : ''; });
    return out;
}

const msOf = (v) => {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    const t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
};

/** 로케이션관리 자료가 언제 마지막으로 올라왔나(ms, 모르면 0) — 업로드 상태 문서(locationStock/uploadStatus)의 끝난 업로드 시각(endAt)만.
 *  자리마다 찍힌 updatedAt 은 보지 않는다(값이 그대로인 자리는 다시 찍지 않아 '마지막 업로드'를 뜻하지 않음). 끝나지 않았으면(state≠done) 0. */
export function locFreshMsOf(uploadStatus) {
    const u = uploadStatus || {};
    return u.state === 'done' ? msOf(u.endAt) : 0;
}

/** 위치값 엑셀 받기를 막을 이유('' = 받아도 됨) */
export function locStaleReason(freshMs, nowMs, days = LOC_STALE_DAYS) {
    if (!freshMs) return '로케이션관리 업로드 날짜를 모릅니다';
    const age = Math.floor((nowMs - freshMs) / 86400000);
    if (age > days) return `로케이션관리 자료가 ${age}일 전 것입니다(${days}일 넘음) — 로케이션관리에 오늘 재고를 먼저 올리세요`;
    return '';
}

const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');

/**
 * 엑셀 행(2차원 배열) → { map: {바코드: 상품코드}, rows, headerRow } — 머리글(상품코드·바코드)을 위 20줄에서 찾는다.
 * 기존 화면 미발재고로그 업로드(handleStockLogUpload)와 같은 규칙: 대문자·trim, 바코드가 상품코드와 같으면 넣지 않는다. 다른 열은 보지 않는다.
 * 머리글을 못 찾으면 map = null.
 */
export function barcodeMapOfAoa(aoa) {
    const rows = aoa || [];
    let hi = -1, ci = -1, bi = -1;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
        const cl = (rows[i] || []).map(cleanKey);
        if (cl.includes('상품코드') && cl.includes('바코드')) { hi = i; ci = cl.indexOf('상품코드'); bi = cl.indexOf('바코드'); break; }
    }
    if (hi < 0) return { map: null, rows: 0, headerRow: -1 };
    const map = {};
    let n = 0;
    for (let i = hi + 1; i < rows.length; i++) {
        const c = String((rows[i] || [])[ci] == null ? '' : rows[i][ci]).trim().toUpperCase();
        const b = String((rows[i] || [])[bi] == null ? '' : rows[i][bi]).trim().toUpperCase();
        if (!c) continue;
        n++;
        if (b && b !== c) map[b] = c;
    }
    return { map, rows: n, headerRow: hi };
}
