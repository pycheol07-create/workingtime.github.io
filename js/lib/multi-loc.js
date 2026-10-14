// === js/lib/multi-loc.js ===
// 로케이션관리 '다중 위치 상품' 판정 + 상품의 비축 자리 찾기. 2026-10-14
//
// 비축 자리(판정은 호출하는 쪽의 isEtcLocation — 대분류 '기타'·'비축…'·'SAM…', 채우기자동화 규칙.py 와 같은 기준)
//   때문에 2곳 이상이 되는 상품은 기본으로 빼고, '비축포함보기'를 켰을 때만 비축 자리까지 센다.
// 비축 자리는 대시보드 기간별 상품 리스트와 같은 출처(reserveLocIds)로 센다 — 상품 행의 '옵션추가항목1' + 이 상품 코드가 박힌 비축 칸.
// 순수 모듈(DOM/Firebase 의존 없음).

/** 자리 id 비교용 — 공백·NBSP·대소문자 흔들림 흡수 */
export const normLocId = (v) => String(v == null ? '' : v).replace(/[\s ]+/g, '').toUpperCase();

/**
 * 한 상품의 비축 자리 id 목록(정렬).
 * ★ 비축랙 자리는 상품 행의 '옵션추가항목1'(예: '비축-002,비축-007,H-3-L')이 정확하다.
 *   비축 칸 문서에는 상품코드가 한 개만 남아(나중 행이 덮어씀) 거꾸로 찾으면 대부분 빠진다.
 * @param {object[]} rows                 이 상품코드가 들어간 자리 문서들
 * @param {Map<string, object>} locById   normLocId(id) → 자리 (전체 자리)
 * @param {(loc: object) => boolean} isReserve
 * @returns {string[]} 실제로 있는 자리 & 비축 자리 & 이 상품의 피킹 자리 아님
 */
export function reserveLocIds(rows, locById, isReserve) {
    const list = rows || [];
    const pickLocs = list.filter(l => !isReserve(l)).map(l => l.id);
    const etcSet = new Set();
    const addEtc = (raw) => {
        const hit = locById && locById.get(normLocId(raw));   // 실제로 있는 자리만 (오타·폐기·남의 피킹자리 제외)
        if (hit && isReserve(hit) && !pickLocs.includes(hit.id)) etcSet.add(hit.id);
    };
    list.forEach(l => String((l.rawData || {})['옵션추가항목1'] || '').split(',').forEach(addEtc));
    list.filter(l => isReserve(l)).forEach(l => addEtc(l.id));
    return [...etcSet].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {Map<string, object[]>} codeToLocs  상품코드 → 그 상품이 들어간 자리들
 * @param {(loc: object) => boolean} isReserve 비축(피킹용 아님) 자리인가
 * @param {boolean} includeReserve             true 면 비축 자리도 센다
 * @param {Map<string, object>} locById        normLocId(id) → 자리 (비축 자리 찾기용)
 * @returns {{code, name, locIds: string[], count: number, reserveCount: number, stock: number}[]}
 *   locIds — 표시할 자리(피킹 + 켜면 비축), count — 센 자리 수, reserveCount — 빼고 센 비축 자리 수(켜면 0),
 *   stock — 피킹 자리 정상재고 합(켜면 이 상품 코드가 박힌 모든 칸). 칸수 내림차순 → 재고 내림차순.
 */
export function multiLocGroups(codeToLocs, isReserve, includeReserve, locById) {
    const out = [];
    for (const [code, arr] of codeToLocs || []) {
        const all = arr || [];
        const pickRows = all.filter(l => !isReserve(l));
        const reserve = reserveLocIds(all, locById, isReserve);
        const locIds = pickRows.map(l => l.id).concat(includeReserve ? reserve : []);
        if (locIds.length < 2) continue;
        const stockRows = includeReserve ? all : pickRows;
        out.push({
            code, name: (all[0] && all[0].name) || '',
            locIds, count: locIds.length,
            reserveCount: includeReserve ? 0 : reserve.length,
            stock: stockRows.reduce((a, l) => a + (Number(l.stock || 0) || 0), 0),
        });
    }
    return out.sort((a, b) => b.count - a.count || b.stock - a.stock);
}
