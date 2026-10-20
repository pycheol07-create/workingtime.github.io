// === js/lib/mibal2-calc.js ===
// 신규 미발계산기(미발계산기2) 계산 모듈 — 2026-10-07, 공식 v2 2026-10-20. 설계: 업무자동화\앱\미발계산기2\설계.md
//
// 업무 의미(2026-10-20 사용자 확정):
//   총재고(T) = 이지어드민 정상재고(bad=0) — 비축을 포함한 총재고. 비축(B) = 불량창고(bad=1) = 이 회사의 비축창고.
//   출고 순서 = 피킹 → 비축 → 그날 입고분.
//   미발 = 그날 입고분 중 지금 재고로 못 내보내 추가로 출고해야 하는 양(= 업무 예상 국내배송 가산값).
//   3층으로 보낼 양 = 미발 + 피킹 적재 (스캐너 mibalQty 와 같은 뜻 — 비교 기준).
//
//   출고예정 D = 접수 + 송장            부족 S = max(D − T, 0)
//   미발 M = min(S, 도착)               미해결부족 U = S − M (입고분으로도 못 냄)
//   남은 도착 R = 도착 − M              피킹재고 P = T − B (음수 가능 — 피킹에서 빚진 상태)
//   출고 후 피킹 P1 = max(P − D, 0)     출고 후 비축 B1 = max(B − max(D − P, 0), 0)  ← P<0 의 빚도 비축이 메운다
//   피킹 여유 F = max(적재량 − P1, 0)   피킹 적재 = min(R, F) · 비축 적재 = R − 피킹 적재
//   보충(비축→피킹) = min(F − 피킹 적재, B1)     3층 = M + 피킹 적재
// 직진·에이블리 재고출고는 전날 이지어드민에 올라가 총재고에서 이미 빠져 있으므로 더하지 않는다.
// 공식 v1(2026-10-07~10-20, 「필요 = 적재량 − 남는양」)은 FORMULA_VER 1 — 그때 저장한 비교 문서와 숫자 뜻이 다르다.
//
// 기존 미발계산기(js/china-stock-goods.js)의 적재량 규칙·기본 공식을 비교용으로 **같게** 옮겨 둔다.
// 저쪽(getCapacityByLocation·DEFAULT_MIBAL_FORMULA)을 바꾸면 여기도 바꿀 것.
// china-stock-goods.js 는 import 하지 않는다 — 로드만 해도 ScanDB 를 지우고 다시 쓴다.
//
// 순수 모듈(import 0, DOM/Firebase 의존 없음). 브라우저와 node --test 가 함께 쓴다.

/** 계산 공식 버전 — 1 = 2026-10-07~20 「필요 = 적재량 − 남는양」, 2 = 2026-10-20~ 피킹 → 비축 → 입고분 순서 */
export const FORMULA_VER = 2;

/** '모름'을 허용하는 수량: null/undefined/''/숫자 아님 → null, 그 외 정수로 내림 */
function intOrNull(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : null;
}
/** 모르면 0 으로 보는 수량(음수는 0) */
function intOrZero(v) {
    const n = intOrNull(v);
    return n === null || n < 0 ? 0 : n;
}
/** 기존 계산기와 같은 변환: parseInt(v) || 0 */
function legacyInt(v) { return parseInt(v) || 0; }

const PLAN_KEYS = ['출고예정', '부족', '미발', '미해결', '남은도착', '비축', '피킹재고', '출고후피킹', '출고후비축', '피킹여유', '피킹적재', '비축적재', '보충', '삼층'];

/**
 * 신규 공식 v2 (2026-10-20).
 * @param {object} p
 * @param {number|null} p.총재고  이지어드민 정상재고(bad=0, 비축 포함). null = 모름 → 계산 안 함('noStock'). 음수는 그대로 둔다.
 * @param {number|null} p.비축    이지어드민 불량창고(bad=1) 재고. null = 모름 → 부족·미발까지만 계산('noReserve'). 음수는 0('negReserve').
 * @param {number|null} p.접수    접수(status=1) qty 합. null = 모름 → 계산 안 함('noOrders'). 0 은 '주문 없음'으로 계산한다. 음수는 0.
 * @param {number|null} p.송장    송장(status=7) qty 합. null 규칙은 접수와 같다.
 * @param {number} p.적재량       capacityFor() 결과(첫 자리 하나). 모름/음수는 0.
 * @param {number} p.도착         이번 입고 도착수량. 모름/음수는 0.
 * 숫자 아닌 값(NaN·'abc')은 null 과 같이 '모름'. 소수는 내림.
 * @returns {{출고예정, 부족, 미발, 미해결, 남은도착, 비축, 피킹재고, 출고후피킹, 출고후비축, 피킹여유, 피킹적재, 비축적재, 보충, 삼층, flags:string[]}}
 *   계산을 못 하면 숫자는 null. 비축을 모르면 출고예정·부족·미발·미해결·남은도착만 숫자.
 *   flags 순서: zeroCapacity, noStock, noOrders → noReserve, negReserve, negPick, unresolved, overCap, needRefill
 */
export function calcPlan({ 총재고, 비축, 접수, 송장, 적재량, 도착 } = {}) {
    const T = intOrNull(총재고);
    const recv = intOrNull(접수);
    const inv = intOrNull(송장);
    const bRaw = intOrNull(비축);
    const C = intOrZero(적재량);
    const A = intOrZero(도착);

    const flags = [];
    if (C === 0) flags.push('zeroCapacity');
    if (T === null) flags.push('noStock');
    if (recv === null || inv === null) flags.push('noOrders');

    const out = { flags };
    PLAN_KEYS.forEach(k => { out[k] = null; });
    if (T === null || recv === null || inv === null) return out;

    // 주문 수량은 음수가 될 수 없다 — 들어오면 0 으로
    const D = Math.max(recv, 0) + Math.max(inv, 0);
    const S = Math.max(D - T, 0);
    const M = Math.min(S, A);
    const U = S - M;
    const R = A - M;
    Object.assign(out, { 출고예정: D, 부족: S, 미발: M, 미해결: U, 남은도착: R });

    if (bRaw === null) flags.push('noReserve');
    else if (bRaw < 0) flags.push('negReserve');
    if (bRaw === null) {
        if (U > 0) flags.push('unresolved');
        return out;
    }
    const B = Math.max(bRaw, 0);
    const P = T - B;
    if (P < 0) flags.push('negPick');
    if (U > 0) flags.push('unresolved');
    const P1 = Math.max(P - D, 0);
    const B1 = Math.max(B - Math.max(D - P, 0), 0);
    const F = Math.max(C - P1, 0);
    if (P1 > C) flags.push('overCap');
    const pick = Math.min(R, F);
    const resv = R - pick;
    const refill = Math.min(F - pick, B1);
    if (refill > 0) flags.push('needRefill');
    Object.assign(out, {
        비축: B, 피킹재고: P, 출고후피킹: P1, 출고후비축: B1, 피킹여유: F,
        피킹적재: pick, 비축적재: resv, 보충: refill, 삼층: M + pick
    });
    return out;
}

/**
 * 기존 미발계산기 기본 공식(비교용) — china-stock-goods.js:158 DEFAULT_MIBAL_FORMULA(오더리스트 시트 3조건)와 evalMibal(:182) 의 반올림·음수 0 처리.
 *   총재고===0 ? 적재량 : (도착+총재고<=적재량 ? 도착 : (부족수량+직진>총재고 ? 부족수량+직진−총재고 : 0))
 * 주의: 같은 파일 defaultMibal(:166) 은 '도착' 조건이 없는 2조건 옛 공식(수식 오류 시 폴백)이라 따르지 않는다.
 * 사용자가 설정에서 바꾼 공식(CONFIG.mibalFormula)은 반영하지 않는다 — 기본 공식만.
 * 입력 변환도 기존과 같다: 총재고·적재량·부족수량·직진은 parseInt||0, 도착은 숫자 변환(실패 0).
 * 부족수량은 이지어드민 현재고조회의 부족수량(=max(접수+송장−정상,0)) — 정상재고를 한 번 더 빼는 이중차감이 있다(설계.md).
 */
export function calcOld({ 총재고, 적재량, 도착, 부족수량, 직진 } = {}) {
    const s = legacyInt(총재고);
    const cap = legacyInt(적재량);
    const a = Number.isFinite(Number(도착)) ? Number(도착) : 0;
    const short = legacyInt(부족수량);
    const direct = legacyInt(직진);
    const v = s === 0 ? cap
        : (a + s <= cap ? a
            : (short + direct > s ? short + direct - s : 0));
    const r = Math.round(v);
    return r < 0 ? 0 : r;
}

/** ★ 가 들어간 로케이션(★-001, ★★-001 …)은 모두 '★' 구역, 그 외는 첫 글자(대문자) — china-stock-goods.js:138 zoneKey */
export function zoneKey(locStr) {
    const s = (locStr || '').toString().trim().toUpperCase();
    if (!s) return '';
    return s.includes('★') ? '★' : s.charAt(0);
}

/** 구역 미설정 시 기본 적재량 — china-stock-goods.js:148 */
export const DEFAULT_ZONE_CAPACITY = Object.freeze({
    'A': 20, 'B': 20, 'C': 20, 'D': 20, 'E': 40, 'F': 40, 'G': 40,
    'H': 15, 'I': 15, 'Z': 15, 'L': 15, 'O': 15, 'P': 15, 'Q': 15, 'R': 15, 'S': 15, 'T': 15,
});
export const STAR_ZONE_DEFAULT = 90; // ★ 구역 미설정 시 기본값 — china-stock-goods.js:147

/**
 * 적재량 — 기존 계산기와 같은 우선순위:
 *   1) 개별 수정값 editedCell.capacity (undefined·'' 가 아니면) → parseInt||0      (china-stock-goods.js:2254, :2323)
 *   2) 구역 설정 config.zoneCapacity[구역] (undefined·'' 가 아니면) → parseInt||0  (:146, ★ 포함)
 *   3) ★ 구역 기본 90                                                          (:147)
 *   4) 구역 기본표 DEFAULT_ZONE_CAPACITY, 없으면 0                               (:148)
 *   로케이션이 비면 0 (:144).
 *
 * @param {string} location  이지어드민 재고로그 '로케이션' 값. 기존처럼 '/' 앞 첫 칸만 쓴다(:2251 split('/')[0].trim()).
 *                           이미 잘린 값을 넣어도 결과는 같다.
 * @param {object} [config]  Firestore ChinaStockGoods/CONFIG 문서 data() 그대로. 여기서 쓰는 필드는
 *                           zoneCapacity: { [구역키: 'A'|'B'|…|'★']: number|string } 하나뿐(:1142 저장, :2825 로드).
 *                           (그 외 필드 csvUrlOrder·csvUrlBuy·savedDates*·mibalFormula·mibalVars·columnConfig·
 *                            locationColumnConfig·graceDays·newLocPosition 은 쓰지 않는다.)
 * @param {object} [editedCell] Firestore ChinaStockGoods/EDITED_CELLS 문서의 cells[상품코드] 그대로
 *                           ({ capacity, shortage, directShip, confirmed, memo … } 중 capacity 만 쓴다).
 * @returns {number}
 */
export function capacityFor(location, config, editedCell) {
    const ed = editedCell || {};
    if (ed.capacity !== undefined && ed.capacity !== '') return parseInt(ed.capacity) || 0;
    const loc = (location || '').toString().split('/')[0].trim();
    if (!loc) return 0;
    const zc = (config && config.zoneCapacity) || {};
    const ch = zoneKey(loc);
    if (zc[ch] !== undefined && zc[ch] !== '') return parseInt(zc[ch]) || 0;
    if (ch === '★') return STAR_ZONE_DEFAULT;
    return DEFAULT_ZONE_CAPACITY[ch] || 0;
}

/**
 * 이지어드민 get_order_info 응답의 주문 배열 → { 상품코드: qty 합 }.
 * 규칙(Apps Script 수집 쪽도 똑같이 쓸 것):
 *   - 주문마다 order_products[] 를 돈다. 주문 단위 cs 는 보지 않고 **상품줄의 order_cs** 로 거른다.
 *   - order_cs 를 문자열로 바꿔 앞뒤 공백을 지운 값이 okCs 에 있을 때만 더한다(기본 '0' 정상, '5').
 *     order_cs 가 없으면(null/undefined) 제외.
 *   - 상품코드 = String(product_id).trim(), 비면 제외.
 *   - qty 는 문자열이어도 parseInt(10진). 숫자가 아니거나 0 이하면 제외.
 *   - 반환에는 상품코드별 합계만 남긴다(주문 원문·고객정보는 담지 않는다).
 * @param {Array<{order_products?: Array<{product_id:string, qty:string|number, order_cs:string|number}>}>} orders
 * @param {{okCs?: string[]}} [opt]
 * @returns {Object<string, number>}
 */
export function sumOrders(orders, { okCs = ['0', '5'] } = {}) {
    const ok = new Set((okCs || []).map(c => String(c).trim()));
    const out = {};
    (Array.isArray(orders) ? orders : []).forEach(o => {
        const lines = o && Array.isArray(o.order_products) ? o.order_products : [];
        lines.forEach(p => {
            if (!p || p.order_cs === null || p.order_cs === undefined) return;
            if (!ok.has(String(p.order_cs).trim())) return;
            const code = String(p.product_id == null ? '' : p.product_id).trim();
            if (!code) return;
            const q = parseInt(p.qty, 10);
            if (!Number.isFinite(q) || q <= 0) return;
            out[code] = (out[code] || 0) + q;
        });
    });
    return out;
}

/** 음수는 괄호로 감싸 식이 읽히게 */
function fmt(n) { return n < 0 ? `(−${-n})` : String(n); }

/**
 * 근거 문자열. input 은 calcPlan 에 넣은 값, result 는 calcPlan 결과.
 * 예) 출고예정 20+5 = 25 / 부족수량 = max(25−10,0) = 15 / 미발수량 = min(15, 도착 40) = 15 / 남은 도착 25
 *     / 피킹재고 = 10−4 = 6 → 출고 후 피킹 0 · 출고 후 비축 0 / 피킹 여유 = max(20−0,0) = 20 → 피킹 적재 20 · 비축 적재 5 / 피킹 배정수량 = 15+20 = 35
 * 남는 부족수량이 있으면 미발수량 뒤에, 보충이 있으면 비축 적재 뒤에 붙인다(화면 용어 2026-10-20). 계산을 못 했으면 그 이유를 쓴다.
 */
export function explain(input, result) {
    const r = result || {};
    const flags = r.flags || [];
    if (flags.includes('noStock') || flags.includes('noOrders')) {
        const why = [];
        if (flags.includes('noStock')) why.push('총재고 모름');
        if (flags.includes('noOrders')) why.push('접수/송장 모름');
        return `${why.join(', ')} → 계산 안 함`;
    }
    const i = input || {};
    // calcPlan 과 같은 정규화로 입력을 다시 읽는다(내림·음수 0)
    const recv = Math.max(intOrNull(i.접수), 0);
    const inv = Math.max(intOrNull(i.송장), 0);
    const T = intOrNull(i.총재고);
    const C = intOrZero(i.적재량);
    const A = intOrZero(i.도착);
    let s = `출고예정 ${recv}+${inv} = ${r.출고예정}`
        + ` / 부족수량 = max(${r.출고예정}−${fmt(T)},0) = ${r.부족}`
        + ` / 미발수량 = min(${r.부족}, 도착 ${A}) = ${r.미발}`;
    if (r.미해결 > 0) s += ` / 남는 부족수량 ${r.미해결}(입고분으로도 못 냄)`;
    s += ` / 남은 도착 ${r.남은도착}`;
    if (r.삼층 === null || r.삼층 === undefined) return s + ' / 비축 모름 → 피킹 적재·비축 적재·피킹 배정수량은 계산 안 함(확인 필요)';
    s += ` / 피킹재고 = ${fmt(T)}−${r.비축} = ${fmt(r.피킹재고)} → 출고 후 피킹 ${r.출고후피킹} · 출고 후 비축 ${r.출고후비축}`
        + ` / 피킹 여유 = max(${C}−${r.출고후피킹},0) = ${r.피킹여유} → 피킹 적재 ${r.피킹적재} · 비축 적재 ${r.비축적재}`;
    if (r.보충 > 0) s += ` / 비축→피킹 보충 ${r.보충}`;
    s += ` / 피킹 배정수량 = ${r.미발}+${r.피킹적재} = ${r.삼층}`;
    return s;
}
