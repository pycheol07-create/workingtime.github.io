// === js/lib/scan-link.js ===
// 신규 미발계산기(china-mibal2) '스캐너 연동(시험 — 읽기 전용)' — 순수 함수(DOM/Firebase 없음). 2026-10-27.
// tests/scan-link.test.js 가 본다.
//
// 기존 미발계산기(js/china-stock-goods.js)의 스캐너 쪽 규칙을 같게 옮겼다 — 그 파일은 import 하지 않는다
// (로드만 해도 ScanDB 를 지우고 다시 쓴다). 기존 쪽을 바꾸면 여기도 바꿀 것.
//   · inboundMapOf      ← china-stock-goods.js loadInboundHistory (barcode 별 qty 합)
//   · confirmedOf       ← applyDates 의 confirmed = inboundMap[code] || ed.confirmed || '' + confSrcOf
//   · scanDbPreviewOf   ← syncScanDBCore (arrivalQty·mibalQty 에서 입고분을 빼고 0 아래는 0)
//   · outsideInboundOf  ← appendUnregisteredInbound (표 밖 스캔 입고분)
//   · floor2MapOf       ← loadFloor2 (floor2 > 0 만)
//   · byShipOf          ← applyDates match() 의 perShip (출고일별 수량)
// 여기서 만든 값은 화면·엑셀(내 PC 다운로드)에만 쓴다. 운영 스캐너 자료(ScanDB 등)에는 쓰지 않는다.
// 표의 입고확인·차이 열·'선택 출고일 밖 입고' 행은 2026-10-27 에 뺐다가 2026-10-28 다시 넣었다(사용자 결정 — 기능은 다 넣고 쓰기는 꺼 둠).

const int0 = (v) => parseInt(v) || 0;

/** InboundHistory 문서 데이터 배열 → { barcode: qty 합 }. barcode 가 비면 건너뛴다(기존과 같이 trim 하지 않음) */
export function inboundMapOf(docs) {
    const m = {};
    (docs || []).forEach(d => {
        const data = d || {};
        const code = data.barcode;
        const qty = int0(data.qty);
        if (code) m[code] = (m[code] || 0) + qty;
    });
    return m;
}

/**
 * 입고확인 값과 출처. edited = EDITED_CELLS.cells 모양 {code:{confirmed}}.
 *   confirmed = inboundMap[code] || edited[code].confirmed || ''   (스캔 합이 0 이면 수동값으로 넘어간다 — 기존과 같다)
 *   confSrc   = 빈칸 'none' · 스캔 합이 있으면 'scan' · 아니면 'manual'
 */
export function confirmedOf(code, inboundMap, edited) {
    const im = inboundMap || {};
    const ed = (edited && edited[code]) || {};
    const confirmed = im[code] || ed.confirmed || '';
    const confSrc = String(confirmed == null ? '' : confirmed).trim() === '' ? 'none' : (im[code] ? 'scan' : 'manual');
    return { confirmed, confSrc };
}

/**
 * 신규 계산 행 → 스캐너DB 에 넣는다면 들어갈 값(미리보기 — 쓰지 않는다).
 *   arrivalQty = max(도착 − 입고, 0) · mibalQty = max(피킹 배정수량 − 입고, 0)(피킹 배정수량을 모르면 null)
 *   제외: '선택 출고일 밖' 행(outside), 도착 0 행(기존 표의 .filter(d => d.arrivalQty > 0) 와 같다)
 *   location = 신규의 대표 피킹자리(Locations). 로케이션이 없으면 ''.
 * @returns {Object<string,{arrivalQty,mibalQty,location,capacity,name,option,totalStock}>}
 */
export function scanDbPreviewOf(rows, inboundMap) {
    const im = inboundMap || {};
    const out = {};
    (rows || []).forEach(r => {
        if (!r || r.outside || !(int0(r.arr) > 0)) return;
        const inQ = im[r.code] || 0;
        const third = (r.third === null || r.third === undefined) ? null : int0(r.third);
        out[r.code] = {
            arrivalQty: Math.max(int0(r.arr) - inQ, 0),
            mibalQty: third === null ? null : Math.max(third - inQ, 0),
            location: r.locInfo ? String(r.loc || '') : '',
            capacity: r.cap === null || r.cap === undefined ? null : r.cap,
            name: r.name || '', option: r.option || '',
            totalStock: r.stock === null || r.stock === undefined ? null : r.stock
        };
    });
    return out;
}

/**
 * 표에 없는데 앱 스캔 입고가 있는 코드 → [{ code, qty }] (코드 오름차순).
 * 신규 수집 자료에는 최근 출고 코드만 있어 '미등록'(오더리스트에 없음)인지는 가릴 수 없다 — '선택 출고일 밖 입고' 로만 본다.
 */
export function outsideInboundOf(inboundMap, rowCodes) {
    const inTable = new Set(rowCodes || []);
    return Object.keys(inboundMap || {})
        .filter(code => inboundMap[code] && !inTable.has(code))
        .sort()
        .map(code => ({ code, qty: inboundMap[code] }));
}

/** FLOOR2_STOCK 문서 데이터 → { map: {code: 작업수량(>0)}, names: {code: 상품명} } */
export function floor2MapOf(docData) {
    const src = (docData && docData.map) ? docData.map : {};
    const map = {}, names = {};
    for (const code in src) {
        const q = int0(src[code] && src[code].floor2);
        if (q > 0) { map[code] = q; names[code] = (src[code] && src[code].name) || ''; }
    }
    return { map, names };
}

/** 도착에 쓰인 출고 기록 [출고일, 본사도착일, 수량][] → { 출고일: 수량 합 } (수량 0 인 날은 뺀다) */
export function byShipOf(arrUsed) {
    const m = {};
    (arrUsed || []).forEach(e => {
        const s = String((e && e[0]) || ''); if (!s) return;
        const q = int0(e[2]);
        if (q) m[s] = (m[s] || 0) + q;
    });
    return m;
}

/**
 * LOC_SHARD_i.map 들 → { code: { location, sub } } (앱 지정 위치 — 작업자 이름은 꺼내지 않는다).
 * 같은 코드가 여러 샤드에 있으면 뒤 샤드가 이긴다(기존 rebuildLocationAssignMap 과 같은 순서).
 */
export function locAssignOf(shardMaps) {
    const out = {};
    (shardMaps || []).forEach(map => {
        for (const code in (map || {})) {
            const v = map[code] || {};
            out[code] = { location: v.location || '', sub: v.sub || '' };
        }
    });
    return out;
}

/**
 * 스캐너 값 미리보기 엑셀(2차원 배열). 신규 미리보기와 지금 ScanDB 값을 코드별로 나란히 둔다.
 *   scanDb = { code: { arrivalQty, mibalQty, location, name } }
 *   다름 = 어느 칸이 다른지('도착'·'미발'·'위치') 또는 '신규에만'·'ScanDB에만'. 같으면 빈칸.
 *   이지어드민 업로드 형식이 아니다(머리글이 다름) — 시험 비교용.
 */
export const PREVIEW_HEAD = Object.freeze([
    '코드', '상품명',
    '신규 arrivalQty', '신규 mibalQty', '신규 location(Locations 대표 피킹자리)',
    'ScanDB arrivalQty', 'ScanDB mibalQty', 'ScanDB location(미발재고로그)',
    '다름'
]);
export function previewCompareAoa(preview, scanDb) {
    const p = preview || {}, s = scanDb || {};
    const codes = [...new Set([...Object.keys(p), ...Object.keys(s)])].sort();
    const numOrBlank = (v) => { if (v === null || v === undefined || v === '') return ''; const n = Number(v); return Number.isFinite(n) ? n : ''; };
    const aoa = [[...PREVIEW_HEAD]];
    codes.forEach(code => {
        const a = p[code], b = s[code];
        let diff = '';
        if (a && !b) diff = '신규에만';
        else if (!a && b) diff = 'ScanDB에만';
        else {
            const d = [];
            if (int0(a.arrivalQty) !== int0(b.arrivalQty)) d.push('도착');
            if (a.mibalQty === null || a.mibalQty === undefined) d.push('미발(신규 모름)');
            else if (int0(a.mibalQty) !== int0(b.mibalQty)) d.push('미발');
            if (String(a.location || '').trim() !== String(b.location || '').trim()) d.push('위치');
            diff = d.join('·');
        }
        aoa.push([
            code, (a && a.name) || (b && b.name) || '',
            a ? numOrBlank(a.arrivalQty) : '', a ? numOrBlank(a.mibalQty) : '', a ? String(a.location || '') : '',
            b ? numOrBlank(b.arrivalQty) : '', b ? numOrBlank(b.mibalQty) : '', b ? String(b.location || '') : '',
            diff
        ]);
    });
    return aoa;
}
