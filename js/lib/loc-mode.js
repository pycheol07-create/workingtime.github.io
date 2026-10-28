// === js/lib/loc-mode.js ===
// 신규 부족수량관리(china-mibal2) '위치지정(시험)' 보기의 순수 함수 — DOM/Firebase 없음. 2026-10-28.
// tests/loc-mode.test.js 가 본다(기존 화면 원문이 바뀌면 실패하는 변경 감시 포함).
//
// 기존 부족수량관리(js/china-stock-goods.js)의 위치지정모드 규칙을 같게 옮겼다 — 그 파일은 import 하지 않는다
// (로드만 해도 ScanDB 를 지우고 다시 쓴다). 기존 쪽을 바꾸면 여기도 바꿀 것.
//   · locPartsArr·orderLocForDownload·mergeCsvLocs ← 같은 이름 함수(원문 그대로)
//   · newLocParts       ← renderNewLocOnly 의 '기준값에 없던 새 자리' 고르기(HTML 대신 배열)
//   · locAssignFullOf   ← rebuildLocationAssignMap (base 가 없으면 location. 작업자 이름 대신 scanned = 'Scanner_Web' 여부만)
//   · stockLogPick      ← loadStockLogFromFirebase (상품코드 trim, 뒤 행이 이김) — 쓰는 4칸만 남긴다(공급처 등은 버림)
//   · todayLocRows      ← 당일입고지정 목록: appendUnregisteredLocation + applyFilters 당일 블록
//                          (비축 입고분 ∪ 오늘 지정. 출고일과 무관. 비축됐는데 자리 미지정 줄이 맨 위)
//   · existingLocRows   ← lmExistingRows (sub 'existing' && 스캐너 전송분, 코드·위치 검색, 최신순)
//   · dayLocAoa         ← downloadDayLoc 의 표·확인 건수(숨은 지정분 / 비축에 없던 상품 → '비고' / 미발재고로그에 없는 상품)
//   · locMoveAoa        ← downloadLocMove. 단 '파일에 없던 상품' 은 기준값(base) 없음만으로 본다 —
//                          신규 화면은 오더리스트 CSV 를 읽지 않는다(사용자 결정 2026-10-28)
// 여기서 만든 값은 화면·내 PC 엑셀에만 쓴다. 운영 스캐너 자료(LOC_SHARD 등)에는 쓰지 않는다.

const SCANNER_WORKER = 'Scanner_Web';   // 스캐너 앱이 위치를 보낼 때 worker 칸 값(기존 lmExistingRows 와 같다)

/** 콤마 다중 위치 → 배열(공백 제거·빈칸 제외) */
export function locPartsArr(s) { return (s || '').toString().split(',').map(x => x.trim()).filter(Boolean); }

/** 받기 때 새 자리(base 에 없던)를 맨앞(front)/맨뒤(back)로 — 기존 자리 순서는 유지 */
export function orderLocForDownload(location, base, pos) {
    const b = new Set(locPartsArr(base));
    const parts = locPartsArr(location);
    const baseParts = parts.filter(p => b.has(p));
    const newParts = parts.filter(p => !b.has(p));
    const ordered = (pos === 'front') ? [...newParts, ...baseParts] : [...baseParts, ...newParts];
    return ordered.join(',');
}

/** 콤마 다중 위치 병합(중복 제거, 순서 유지) — 기존 옵션추가항목1 + 새 위치 */
export function mergeCsvLocs(a, b) {
    const seen = new Set(); const out = [];
    [...locPartsArr(a), ...locPartsArr(b)].forEach(p => { if (!seen.has(p)) { seen.add(p); out.push(p); } });
    return out.join(',');
}

/** 기준값(base)에 없던 새 자리만(추가위치 칸) */
export function newLocParts(location, base) {
    const b = new Set(locPartsArr(base));
    return locPartsArr(location).filter(p => !b.has(p));
}

/** 지정 시각(at: 숫자 ms 또는 Firestore Timestamp) → ms, 모르면 0 (기존 lmAtMs 와 같다) */
export function locAtMs(at) {
    try { if (at == null) return 0; if (typeof at === 'number') return at; return at.toDate ? at.toDate().getTime() : 0; } catch (e) { return 0; }
}

/**
 * LOC_SHARD_i.map 들 → { code: { location, base, sub, at, scanned } }.
 * 같은 코드가 여러 샤드에 있으면 뒤 샤드가 이긴다. base 칸이 없으면 location(기존과 같음).
 * 작업자 이름(worker)은 남기지 않는다 — 스캐너 전송분인지(scanned)만.
 */
export function locAssignFullOf(shardMaps) {
    const out = {};
    (shardMaps || []).forEach(map => {
        for (const code in (map || {})) {
            const v = map[code] || {};
            out[code] = {
                location: v.location || '', at: v.at, sub: v.sub || '',
                base: (v.base !== undefined ? v.base : (v.location || '')),
                scanned: (v.worker || '') === SCANNER_WORKER
            };
        }
    });
    return out;
}

/** 오늘(당일입고분) 자리가 지정됐나 — 기존 isAssignedToday 와 같은 기준(sub 'today' && location) */
export function isAssignedToday(a) { return !!(a && (a.sub || '') === 'today' && a.location); }

/**
 * 미발재고로그(StockLog) 행 배열 → { code: { name, option, loc, opt1 } }. 다른 칸(공급처 등)은 버린다.
 * 상품코드는 trim, 같은 코드는 뒤 행이 이긴다(기존 loadStockLogFromFirebase 와 같다).
 */
export function stockLogPick(rows) {
    const out = {};
    (rows || []).forEach(r => {
        if (!r || typeof r !== 'object') return;
        const c = String(r['상품코드'] || '').trim();
        if (!c) return;
        const s = (v) => (v === undefined || v === null) ? '' : String(v);
        out[c] = { name: s(r['상품명']), option: s(r['옵션']), loc: s(r['로케이션']), opt1: s(r['옵션추가항목1']) };
    });
    return out;
}

/**
 * 당일입고지정 목록.
 *   목록 = 비축 입고분(floor2 > 0) ∪ 오늘 지정(isAssignedToday). 출고일과 무관.
 *   상품명 = names(신규 표) → 비축 이름 → 미발재고로그 → shipItems(수집기 출고 기록 nm) · 옵션 = options(신규 표) → 미발재고로그 → shipItems op
 *   로케이션 = 미발재고로그 '로케이션' 의 '/' 앞 → 없으면 locations(앱 로케이션관리 대표 자리)
 *   옵션추가항목1 = 미발재고로그 값 · 추가위치 = 오늘 지정 중 새 자리
 *   (미발재고로그는 그날 업로드분 — 부족 상품만 들어 있어, 비축에 들어간 다른 상품은 이름·로케이션이 비었다. 2026-10-28)
 *   검색 = 코드·상품명(대문자 포함). 정렬 = 코드 순, 그다음 '비축됐는데 자리 미지정' 줄을 맨 위로(그룹 안 순서 유지).
 * @param {{assign:Object, floor2:Object<string,number>, floor2Names?:Object, names?:Object, options?:Object, stockLog?:Object, shipItems?:Object<string,{nm,op}>, locations?:Object<string,string>, search?:string}} o
 * @returns {Array<{code,name,option,location,locFromApp:boolean,opt1,newLocs:string[],assigned:boolean,floor2:number,missing:boolean}>}
 */
export function todayLocRows(o) {
    const assign = o.assign || {}, floor2 = o.floor2 || {}, f2n = o.floor2Names || {};
    const names = o.names || {}, options = o.options || {}, log = o.stockLog || {};
    const ship = o.shipItems || {}, locs = o.locations || {};
    const codes = new Set();
    Object.keys(floor2).forEach(c => { if ((floor2[c] || 0) > 0) codes.add(c); });
    Object.keys(assign).forEach(c => { if (isAssignedToday(assign[c])) codes.add(c); });
    const kw = String(o.search || '').trim().toUpperCase();
    let rows = [...codes].map(code => {
        const a = assign[code];
        const l = log[code] || {};
        const s = ship[code] || {};
        const logLoc = String(l.loc || '').split('/')[0].trim();
        const assigned = isAssignedToday(a);
        const q = floor2[code] || 0;
        return {
            code,
            name: names[code] || f2n[code] || l.name || s.nm || '',
            option: options[code] || l.option || s.op || '',
            location: logLoc || locs[code] || '',
            locFromApp: !logLoc && !!locs[code],   // 이지어드민 값이 아니라 앱 로케이션관리 대표 자리 — 화면에 '(앱)' 표시
            opt1: l.opt1 || '',
            newLocs: assigned ? newLocParts(a.location, a.base) : [],
            assigned, floor2: q, missing: q > 0 && !assigned
        };
    });
    if (kw) rows = rows.filter(r => r.code.toUpperCase().includes(kw) || String(r.name).toUpperCase().includes(kw));
    rows.sort((a, b) => a.code.localeCompare(b.code));
    const miss = [], rest = [];
    rows.forEach(r => (r.missing ? miss : rest).push(r));
    return miss.concat(rest);
}

/**
 * 기존재고지정 목록 — sub 'existing' && 스캐너 전송분. 검색 = 코드·위치(대문자 포함). 최신순.
 * @returns {Array<{code,location,base,at,atMs,noBase:boolean}>}
 */
export function existingLocRows(o) {
    const assign = o.assign || {};
    const kw = String(o.search || '').trim().toUpperCase();
    let rows = Object.entries(assign)
        .map(([code, v]) => ({ code, location: v.location || '', base: v.base || '', sub: v.sub || '', at: v.at, scanned: !!v.scanned }))
        .filter(r => r.sub === 'existing' && r.scanned);
    if (kw) rows = rows.filter(r => r.code.toUpperCase().includes(kw) || r.location.toUpperCase().includes(kw));
    rows.sort((a, b) => locAtMs(b.at) - locAtMs(a.at));
    return rows.map(r => ({ code: r.code, location: r.location, base: r.base, at: r.at, atMs: locAtMs(r.at), noBase: !r.base }));
}

export const FLAG_NOTE = '파일에 없던 상품';

/**
 * 당일입고 위치값 엑셀(2차원 배열)과 확인 건수.
 *   대상 = 지금 보이는 목록(shown) 중 오늘 지정된 상품. hidden = 검색으로 숨어 빠지는 지정 상품 수(allRows 기준).
 *   값 = 기존 옵션추가항목1(미발재고로그) + 지정 위치 병합 → 새 자리를 pos(front|back)로.
 *   flagged = 비축 입고분에 없던 상품('비고' 열) — 비축이 통째로 비었으면(f2Known=false) 판정 안 함.
 *   risky = 미발재고로그에 상품이 없는 수(기존 자리값을 덮어쓸 수 있음).
 * @returns {{aoa:Array<Array>, count:number, flagged:number, risky:number, hidden:number, f2Known:boolean}}
 */
export function dayLocAoa(o) {
    const assign = o.assign || {}, f2 = o.floor2 || {}, log = o.stockLog || {};
    const shown = o.shownRows || [], all = o.allRows || shown;
    const visible = new Set(shown.map(r => r.code));
    const hidden = new Set(all.filter(r => isAssignedToday(assign[r.code]) && !visible.has(r.code)).map(r => r.code)).size;
    const todayRows = shown.filter(r => isAssignedToday(assign[r.code]));
    const f2Known = Object.keys(f2).length > 0;
    const notInFloor2 = r => f2Known && !((f2[r.code] || 0) > 0);
    const flagged = todayRows.filter(notInFloor2).length;
    const risky = todayRows.filter(r => !log[r.code]).length;
    const hasFlag = flagged > 0;
    const aoa = [hasFlag ? ['상품코드', '옵션추가항목1', '비고'] : ['상품코드', '옵션추가항목1']];
    todayRows.forEach(r => {
        const a = assign[r.code];
        const existing = (log[r.code] && log[r.code].opt1) || '';
        const full = mergeCsvLocs(existing, a.location);
        const row = [r.code, orderLocForDownload(full, existing, o.pos)];
        if (hasFlag) row.push(notInFloor2(r) ? FLAG_NOTE : '');
        aoa.push(row);
    });
    return { aoa, count: todayRows.length, flagged, risky, hidden, f2Known };
}

/**
 * 기존재고 위치값 엑셀 — existingLocRows 결과 중 위치가 있는 것. 값 = 지정 위치를 기준값 대비 새 자리 pos 로 재배치.
 * flagged = 기준값(base) 없음('비고' 열).
 * @returns {{aoa:Array<Array>, count:number, flagged:number}}
 */
export function locMoveAoa(o) {
    const rows = (o.rows || []).filter(r => r.location);
    const isMissing = r => !r.base;
    const flagged = rows.filter(isMissing).length;
    const hasFlag = flagged > 0;
    const aoa = [hasFlag ? ['상품코드', '옵션추가항목1', '비고'] : ['상품코드', '옵션추가항목1']];
    rows.forEach(r => {
        const row = [r.code, orderLocForDownload(r.location, r.base, o.pos)];
        if (hasFlag) row.push(isMissing(r) ? FLAG_NOTE : '');
        aoa.push(row);
    });
    return { aoa, count: rows.length, flagged };
}

/** CONFIG.newLocPosition → 'front' | 'back' (기존 loadConfig 와 같다) */
export const newLocPositionOf = (config) => ((config && config.newLocPosition) === 'front' ? 'front' : 'back');
