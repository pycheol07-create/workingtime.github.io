// js/lib/locrec-sort.js — 변경 추천 표 머리줄 정렬(2026-11-05). DOM 없음(tests/locrec-sort.test.js).
// 맞바꾸기·페어는 줄(A/B)이 둘 — 글자 칸은 첫 줄, 숫자 칸(이동수량·일출고)은 두 줄 합으로 비교한다.
// 이동수량은 '피킹만'(qty) 또는 '비축 포함'(qty + reserve) 중 고른다.

/** 머리줄 칸 — 순서는 표 칸 순서와 같아야 한다(js/locrec-table.js rowHtml). num: 처음 누르면 큰 순 */
export const SORT_COLS = [
    { key: 'rank', label: '순위', sortable: true, num: true },
    { key: 'code', label: '상품코드', sortable: true, title: '누르면 데이터 리스트에서 그 상품 보기 — 맞바꾸기·페어는 두 줄(A/B)' },
    { key: 'name', label: '상품명', sortable: true },
    { key: 'option', label: '옵션', sortable: true },
    { key: 'from', label: '현재 로케이션', sortable: true },
    { key: 'to', label: '추천 로케이션', sortable: true },
    { key: 'qty', label: '이동수량', sortable: true, num: true, title: '옮길 수량(괄호는 비축 수량)' },
    { key: 'daily', label: '일출고', sortable: true, num: true, title: '하루 평균 출고(개/일)' },
    { key: 'gain', label: '이득', sortable: true, num: true, title: '하루에 덜 걷는 양(동·개/일)' },
    { key: 'score', label: '점수', sortable: true, num: true, title: '이 줄만 처리하면 동선 점수(0~100)가 오르는 만큼' },
    { key: 'state', label: '상태', sortable: true },
    { key: 'acts', label: '표시', sortable: false },
    { key: 'sf', label: '칸수무관', sortable: false, title: '칸수 무관 허용 — 켜면 칸수가 다른 자리(4칸↔2칸)로도 추천합니다(끌 때까지 유지)' },
];
const NUM = new Set(SORT_COLS.filter(c => c.num).map(c => c.key));

const n = (v) => { const x = Number(v); return v == null || v === '' || !Number.isFinite(x) ? null : x; };

/** 다음 정렬 상태: 같은 칸을 누르면 방향을 바꾸고, 세 번째엔 해제. 숫자 칸은 큰 순부터, 글자 칸은 가나다순부터 */
export function nextSort(cur, key) {
    const first = NUM.has(key) && key !== 'rank' ? 'desc' : 'asc';
    if (!cur || cur.key !== key) return { key, dir: first };
    if (cur.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
    return null;
}

/** 한 행의 비교 값. x = { r, st, i0 } · lines(r) = 줄 목록 */
export function sortValue(x, key, { qtyWithReserve = false, lines } = {}) {
    const r = (x && x.r) || {};
    const ls = typeof lines === 'function' ? lines(r) : [];
    const first = ls[0] || {};
    const sum = (f) => { let s = null; for (const l of ls) { const v = f(l); if (v != null) s = (s || 0) + v; } return s; };
    switch (key) {
        case 'rank': return r.carried ? null : (n(r.rank) ?? (x.i0 != null ? x.i0 + 1 : null));
        case 'code': case 'name': case 'option': case 'from': case 'to': return String(first[key] ?? '').trim();
        case 'qty': return sum(l => (qtyWithReserve ? lineTotal(l) : n(l.qty)));
        case 'daily': return sum(l => n(l.daily));
        case 'gain': return n(r.gain);
        case 'score': return r.routeOut ? null : n(r.scoreGain);
        // 화면 글자와 같게 — 다른 추천으로 이미 옮긴 줄(other·표시 없음)은 '변경완료'(js/locrec-table.js rowHtml stLabel)
        case 'state': { const st = x.st || {}; return String(st.other && !st.mark ? '변경완료' : (st.label || '')); }
        default: return null;
    }
}

/** 한 줄의 비축 포함 총 수량(이동수량 + 비축). 이동수량이 없으면 null */
export function lineTotal(l) {
    const q = n(l && l.qty);
    return q == null ? null : q + (n(l && l.reserve) || 0);
}

/** 비축 포함 총 재고가 limit 개 이하인 추천인가(2026-11-05 사용자 요청 '10개 이하 제외').
 *  한 줄짜리(단독)는 그 줄로, 두 줄(맞바꾸기·페어)은 두 줄이 모두 limit 이하일 때만 — 한쪽만 빼면 맞바꾸기가 깨진다.
 *  수량을 모르는 줄은 판정하지 않는다(제외 안 함). */
export function isLowStockRow(r, limit, lines) {
    const lim = Number(limit);
    if (!Number.isFinite(lim) || lim < 0) return false;
    const ls = typeof lines === 'function' ? lines(r || {}) : [];
    if (!ls.length) return false;
    const tots = ls.map(lineTotal);
    if (tots.some(t => t == null)) return false;
    return tots.every(t => t <= lim);
}

/** 정렬된 새 배열(입력은 바꾸지 않음). 값이 없는 행은 방향과 상관없이 맨 뒤, 같으면 원래 순서 */
export function sortRows(rows, sort, opts = {}) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    if (!sort || !sort.key) return list;
    const dir = sort.dir === 'desc' ? -1 : 1;
    const isNum = NUM.has(sort.key);
    const vals = new Map(list.map(x => [x, sortValue(x, sort.key, opts)]));
    return list.map((x, idx) => ({ x, idx })).sort((a, b) => {
        const va = vals.get(a.x), vb = vals.get(b.x);
        const ea = va == null || va === '', eb = vb == null || vb === '';
        if (ea || eb) return ea === eb ? a.idx - b.idx : (ea ? 1 : -1);
        const c = isNum ? va - vb : String(va).localeCompare(String(vb), 'ko', { numeric: true });
        return c ? c * dir : a.idx - b.idx;
    }).map(o => o.x);
}
