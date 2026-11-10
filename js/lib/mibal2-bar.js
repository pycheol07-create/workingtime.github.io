// === js/lib/mibal2-bar.js ===
// 부족수량관리(신규, live) 스캐너 연동 줄 — [⚙ 설정] 메뉴(모든 버튼) + [줄 편집](각자 PC 에서 줄에 둘 버튼·순서). 2026-11-10 사용자 요청.
// 순수 함수만(시험 tests/mibal2-bar.test.js). 화면은 js/china-mibal2-bar.js.
//   · 버튼은 id 로만 다룬다. 고를 수 있는 버튼(available) = 화면이 그 줄에 만든 버튼(DOM 순서) — 여기에 id 를 박지 않는다
//   · 저장은 그 PC 브라우저(localStorage BAR_KEY) — 서버에 저장하지 않는다. 못 읽으면 기본값(= 지금 줄 그대로)
//   · 저장 뒤 새로 생긴 버튼(known 에 없던 것)은 줄 끝에 넣는다(새 기능이 숨지 않게)
//   · 관리자 전용(adminOnly)은 관리자가 아니면 줄·메뉴 어디에도 없다

export const BAR_KEY = 'mibal2.scanBar';

const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).map(String))];
/** 이 사람이 볼 수 있는 버튼(순서 그대로) */
export const visibleIds = (available, { isAdmin = false, adminOnly = [] } = {}) =>
    uniq(available).filter(id => isAdmin || !adminOnly.includes(id));

/**
 * 저장값 → 줄에 둘 버튼(순서). raw = localStorage 글자(없으면 null)
 * 저장 모양 { v: 1, row: [id], known: [id] }
 */
export function rowFromStorage(raw, available, opt) {
    const vis = visibleIds(available, opt);
    if (raw == null) return vis;
    let v = null;
    try { v = JSON.parse(raw); } catch (e) { return vis; }
    if (!v || v.v !== 1 || !Array.isArray(v.row)) return vis;
    const known = new Set(Array.isArray(v.known) ? v.known.map(String) : []);
    const row = uniq(v.row).filter(id => vis.includes(id));
    vis.forEach(id => { if (!known.has(id) && !row.includes(id)) row.push(id); });   // 저장 뒤 생긴 버튼
    return row;
}

/** 저장 글자 — known 은 지금 볼 수 있는 버튼 전부(관리자 전용은 관리자 PC 에서만 들어감) */
export const serializeRow = (row, available, opt) => {
    const vis = visibleIds(available, opt);
    return JSON.stringify({ v: 1, row: uniq(row).filter(id => vis.includes(id)), known: vis });
};

/** 줄에 넣기(끝에)·빼기 */
export function toggleRow(row, id, on, available, opt) {
    const vis = visibleIds(available, opt);
    const r = uniq(row).filter(x => vis.includes(x));
    if (!vis.includes(id)) return r;                       // 모르는·볼 수 없는 버튼은 그대로
    if (!on) return r.filter(x => x !== id);
    return r.includes(id) ? r : [...r, id];
}

/** 한 칸 앞(-1)·뒤(+1)로 — 끝이면 그대로 */
export function moveRow(row, id, dir) {
    const r = uniq(row);
    const i = r.indexOf(id), j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= r.length) return r;
    [r[i], r[j]] = [r[j], r[i]];
    return r;
}

/** 편집 창 목록 — 줄에 있는 것(줄 순서) 다음에 줄에 없는 것(원래 순서). [{ id, on }] */
export const editList = (row, available, opt) => {
    const vis = visibleIds(available, opt);
    const r = uniq(row).filter(id => vis.includes(id));
    return [...r.map(id => ({ id, on: true })), ...vis.filter(id => !r.includes(id)).map(id => ({ id, on: false }))];
};

/** 메뉴 — 볼 수 있는 버튼 전부(원래 순서, 줄 구성과 상관없이) */
export const menuIds = (available, opt) => visibleIds(available, opt);
