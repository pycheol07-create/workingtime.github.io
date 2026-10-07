// === js/lib/mibal2-calc.js ===
// 신규 미발계산기(미발계산기2) 계산 모듈 — 2026-10-07. 설계: 업무자동화\앱\미발계산기2\설계.md
//
// 업무 의미: 정상재고 = 피킹 로케이션. 미발 = 피킹 칸에 채워 둘 양(적재량까지).
//   출고예정 = 접수 + 송장
//   남는양   = 정상 − 출고예정
//   미발     = max(적재량 − max(남는양,0), 0)   ← 피킹칸에 실제로 넣을 양. 적재량을 넘지 않는다
//   밀린주문 = max(−남는양, 0)                  ← 미발에 넣지 않고 따로 보여 준다(피킹칸에 다 안 들어감 — 2026-10-07 사용자 결정)
//   피킹행   = min(도착, 미발) · 비축행 = 도착 − 피킹행 · 보충필요 = max(미발 − 도착, 0)
// 직진·에이블리 재고출고는 전날 이지어드민에 올라가 정상재고에 이미 빠져 있으므로 더하지 않는다.
//
// 기존 미발계산기(js/china-stock-goods.js)의 적재량 규칙·기본 공식을 비교용으로 **같게** 옮겨 둔다.
// 저쪽(getCapacityByLocation·DEFAULT_MIBAL_FORMULA)을 바꾸면 여기도 바꿀 것.
// china-stock-goods.js 는 import 하지 않는다 — 로드만 해도 ScanDB 를 지우고 다시 쓴다.
//
// 순수 모듈(import 0, DOM/Firebase 의존 없음). 브라우저와 node --test 가 함께 쓴다.

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

/**
 * 신규 공식.
 * @param {object} p
 * @param {number|null} p.정상  이지어드민 정상재고(stock). null = 모름 → 계산 안 함('noStock'). 음수는 그대로 둔다(이지어드민 재고가 음수일 수 있음).
 * @param {number|null} p.접수  접수(status=1) qty 합. null = 모름 → 계산 안 함('noOrders'). 0 은 '주문 없음'으로 계산한다.
 * @param {number|null} p.송장  송장(status=7) qty 합. null 규칙은 접수와 같다.
 * @param {number} p.적재량     capacityFor() 결과. 모름/음수는 0.
 * @param {number} p.도착       이번 입고 도착수량. 모름/음수는 0.
 * 숫자 아닌 값(NaN·'abc')은 null 과 같이 '모름'. 소수는 내림.
 * @returns {{출고예정:number|null, 남는양:number|null, 미발:number|null, 피킹행:number|null,
 *            비축행:number|null, 보충필요:number|null, flags:string[]}}
 *   계산을 못 하면 결과 숫자는 모두 null.
 *   flags: 'zeroCapacity'(적재량 0) · 'backlog'(남는양<0, 밀린 주문) · 'noStock' · 'noOrders' · 'needRefill'(보충필요>0)
 */
export function calcNew({ 정상, 접수, 송장, 적재량, 도착 } = {}) {
    const stock = intOrNull(정상);
    const recv = intOrNull(접수);
    const inv = intOrNull(송장);
    const cap = intOrZero(적재량);
    const arr = intOrZero(도착);

    const flags = [];
    if (cap === 0) flags.push('zeroCapacity');
    if (stock === null) flags.push('noStock');
    if (recv === null || inv === null) flags.push('noOrders');

    const empty = { 출고예정: null, 남는양: null, 미발: null, 밀린주문: null, 피킹행: null, 비축행: null, 보충필요: null, flags };
    if (stock === null || recv === null || inv === null) return empty;

    // 주문 수량은 음수가 될 수 없다 — 들어오면 0 으로
    const 출고예정 = Math.max(recv, 0) + Math.max(inv, 0);
    const 남는양 = stock - 출고예정;
    const 미발 = Math.max(cap - Math.max(남는양, 0), 0);   // 피킹칸 적재량을 넘지 않는다
    const 밀린주문 = Math.max(-남는양, 0);                  // 미발에 넣지 않음 — 따로 표시
    const 피킹행 = Math.min(arr, 미발);
    const 비축행 = arr - 피킹행;
    const 보충필요 = Math.max(미발 - arr, 0);

    if (남는양 < 0) flags.push('backlog');
    if (보충필요 > 0) flags.push('needRefill');
    return { 출고예정, 남는양, 미발, 밀린주문, 피킹행, 비축행, 보충필요, flags };
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
 * 근거 문자열. input 은 calcNew 에 넣은 값, result 는 calcNew 결과.
 * 예) 출고예정 = 12+3 = 15 / 남는양 = 18−15 = 3 / 미발 = max(30−3,0) = 27 / 도착 40 → 피킹 27, 비축 13
 * 보충필요가 있으면 끝에 ' / 보충필요 N' 을 붙인다. 계산을 못 했으면 그 이유를 쓴다.
 */
export function explain(input, result) {
    const r = result || {};
    const flags = r.flags || [];
    if (flags.includes('noStock') || flags.includes('noOrders')) {
        const why = [];
        if (flags.includes('noStock')) why.push('정상재고 모름');
        if (flags.includes('noOrders')) why.push('접수/송장 모름');
        return `${why.join(', ')} → 계산 안 함`;
    }
    const i = input || {};
    // calcNew 와 같은 정규화로 입력을 다시 읽는다(내림·음수 0)
    const recv = Math.max(intOrNull(i.접수), 0);
    const inv = Math.max(intOrNull(i.송장), 0);
    const stock = intOrNull(i.정상);
    const cap = intOrZero(i.적재량);
    const arr = intOrZero(i.도착);
    let s = `출고예정 = ${recv}+${inv} = ${r.출고예정}`
        + ` / 남는양 = ${fmt(stock)}−${r.출고예정} = ${fmt(r.남는양)}`
        + ` / 미발 = ${cap}−max(${fmt(r.남는양)},0) = ${r.미발}`
        + ` / 도착 ${arr} → 피킹 ${r.피킹행}, 비축 ${r.비축행}`;
    if (r.보충필요 > 0) s += ` / 보충필요 ${r.보충필요}`;
    if (r.밀린주문 > 0) s += ` / 밀린주문 ${r.밀린주문}(미발에 안 넣음 — 비축에서 꺼내 출고)`;
    return s;
}
