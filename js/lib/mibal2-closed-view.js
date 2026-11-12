// === js/lib/mibal2-closed-view.js ===
// 신규 부족수량관리(live) — 마감한 작업의 출고일을 다시 고르면 입고확인을 보관함(ChinaStockGoods_Archive) 값으로 (2026-11-12 사용자 결정 (나)).
// 순수 모듈(DOM/Firebase 없음). 화면 쪽은 js/china-mibal2.js(보관함 읽기·캐시·표시), 쓰기 막기는 js/china-mibal2-live.js(CLOSED_BTN_IDS).
//
// [작업 마감]은 입고이력(InboundHistory)을 지우고 보관함에 코드별 입고 합(rows[].q)을 남긴다. 표 입고확인은 입고이력만 읽어서
//   마감한 출고일을 다시 고르면 빈칸이 되거나, 마감 뒤 새 작업의 스캔이 옛 출고일 표에 섞여 보였다.
// 판정:
//   · 고른 출고일이 없거나, 진행 중인 작업(batch.ships)과 하나라도 겹치면 → 지금처럼 입고이력(null)
//   · 고른 출고일이 모두 보관함 어딘가에 있으면 → 보관함 보기. 그 출고일이 들어 있는 보관을 **모두 더한다**
//     (마감 때마다 입고이력을 지우므로 정상 경로에서는 보관끼리 스캔이 겹치지 않는다 — 부분 마감 뒤 추가분(partialOf)·같은 출고일 다시 작업도 합이 맞다.
//      단 마감 중 입고이력 삭제가 중간에 끊긴 뒤 다시 마감하면 같은 스캔이 두 보관에 들어가 합이 커질 수 있다 — 마감 쪽 문제, 여기서는 고치지 않음)
//   · 하나라도 보관함에 없으면 → 입고이력(null) — 아직 마감 안 한 출고일이 섞였다
// 보관 행 rows[] = { c(상품코드), q(앱 스캔 입고 합), … } — js/lib/mibal2-live.js archiveRecordOf. 상품명·공급처는 여기서 쓰지 않는다.

/** 출고일이 잘못 저장된 보관 — 보관 id → 안내 한 줄(사용자가 고치지 않기로 함). 늘어나면 여기에만 더한다 */
export const MISFILED_ARCHIVES = Object.freeze({
    '20261110-091315': '이 기록은 11/01 출고분 스캔이 11/06 으로 저장된 것입니다'
});

const ARRAY_ANY_MAX = 30;   // Firestore array-contains-any 값 한도
const int0 = (v) => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : 0; };
const uniq = (a) => [...new Set((a || []).map(String))].sort();
const pad2 = (n) => String(n).padStart(2, '0');
const mdOf = (d) => { const p = String(d || '').split('-'); return p.length === 3 ? `${p[1]}/${p[2]}` : String(d || ''); };

/**
 * 보관함을 읽어 볼 출고일 — 보관함 보기가 될 수 없으면 [](읽지 않음).
 * @param {{selected: string[], batchShips: string[]|null}} p  batchShips = 진행 중인 작업의 출고일(없거나 마감된 표시면 null)
 */
export function closedQueryDates({ selected, batchShips } = {}) {
    const sel = uniq(selected);
    if (!sel.length || sel.length > ARRAY_ANY_MAX) return [];
    const open = new Set(uniq(batchShips));
    if (sel.some(d => open.has(d))) return [];
    return sel;
}

/** 캐시 키 — 고른 출고일 + 마지막 마감 번호(이 PC 가 마감하면 바뀐다) */
export const closedCacheKey = (dates, lastClosedId) => uniq(dates).join(',') + '|' + String(lastClosedId || '');

/**
 * 보관함 보기 판정.
 * @param {object} p
 * @param {string[]} p.selected     고른 출고일
 * @param {string[]|null} p.batchShips  진행 중인 작업 출고일
 * @param {Array<{id, ships, closedAtMs, rows}>} p.archives  그 출고일이 들어 있는 보관(array-contains-any 결과 — 더 넓어도 된다)
 * @returns {null | { ids, ships, others, map, closedAtMs, codes, total, notes }}  others = 고르지 않았지만 함께 마감한 출고일
 *   map = { 상품코드: 입고 합 } (0 은 뺀다) · closedAtMs = 가장 늦은 마감 · ids = 더한 보관(마감 순) · notes = 잘못 저장된 보관 안내
 */
export function closedViewOf({ selected, batchShips, archives } = {}) {
    const sel = closedQueryDates({ selected, batchShips });
    if (!sel.length) return null;
    const use = (archives || []).filter(a => a && a.id && Array.isArray(a.ships) && a.ships.some(s => sel.includes(String(s))));
    const covered = new Set(use.flatMap(a => a.ships.map(String)));
    if (!sel.every(d => covered.has(d))) return null;
    const seen = new Set();
    const list = use.filter(a => (seen.has(String(a.id)) ? false : (seen.add(String(a.id)), true)))
        .sort((x, y) => (int0(x.closedAtMs) - int0(y.closedAtMs)) || String(x.id).localeCompare(String(y.id)));
    const map = {};
    list.forEach(a => (Array.isArray(a.rows) ? a.rows : []).forEach(r => {
        if (!r || !r.c) return;
        const q = int0(r.q);
        if (q) map[String(r.c)] = (map[String(r.c)] || 0) + q;
    }));
    Object.keys(map).forEach(k => { if (!map[k]) delete map[k]; });
    const notes = list.map(a => MISFILED_ARCHIVES[String(a.id)]).filter(Boolean);
    return {
        ids: list.map(a => String(a.id)),
        ships: [...covered].sort(),
        others: [...covered].filter(d => !sel.includes(d)).sort(),
        map,
        closedAtMs: Math.max(0, ...list.map(a => int0(a.closedAtMs))),
        codes: Object.keys(map).length,
        total: Object.values(map).reduce((s, v) => s + v, 0),
        notes
    };
}

/** ms → 'MM/DD HH:MM'(이 PC 시각) */
export function mdhmPad(ms) {
    const d = new Date(Number(ms) || 0);
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 표 위 안내 줄들 — [본문, …잘못 저장된 보관 안내] */
export function closedNoteLines(view) {
    if (!view) return [];
    const head = `마감된 작업 — 입고확인은 ${view.closedAtMs ? mdhmPad(view.closedAtMs) : '시각 모름'} 마감 기록`
        + (view.ids.length > 1 ? ` (보관 ${view.ids.length}건 합)` : '')
        + ((view.others || []).length ? ` · 함께 마감한 출고일 ${view.others.map(mdOf).join(', ')} 포함` : '')
        + ' · 이 출고일은 반영·마감·입고 오차 기록을 하지 않습니다';
    return [head, ...view.notes];
}
