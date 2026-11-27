// === js/lib/insp-day.js ===
// 하루치 검수 항목 = 매니저 리스트(inspectionList) + 매니저에서 비운 완료 항목(inspectionDone). 2026-10-29
//   검수 매니저를 열 때 오늘 리스트가 전부 '완료'면 매니저 리스트는 비우고, 완료 항목은 inspectionDone 으로 옮긴다
//   (js/inspection-logic.js). 일자별 보기·엑셀·참조표처럼 '그날 검수한 것'을 보는 곳은 이 함수로 둘을 합쳐 읽는다.
//   항목 객체는 복사하지 않는다 — 부르는 쪽의 제자리 수정이 원래 배열에 남게.
// 순수 모듈(import 없음, node --test 대상).

const s = (v) => (v == null ? '' : String(v));
/** 같은 검수 항목인가 — 이름·옵션·출고일·코드 */
const itemKey = (it) => [s(it && it.name), s(it && it.option), s(it && it.packingDate), s(it && it.code)].join('|');

/**
 * 매니저 리스트를 비울 때 서버 문서 값 → { list: [], done, moved } 또는 null(옮길 것 없음·조건 안 맞음).
 *   완료 항목만 inspectionDone 끝에 붙인다(이미 같은 항목이 있으면 붙이지 않는다 — 옛 탭이 되살린 리스트를 다시 옮겨도 두 번 쌓이지 않게).
 *   requireAllDone: 리스트가 전부 '완료'일 때만(매니저를 열 때). false 면 대기는 버리고 완료만 옮긴다([대기 리스트 삭제]).
 */
export function moveDoneItems(day, { requireAllDone = false } = {}) {
    const d = day || {};
    const list = Array.isArray(d.inspectionList) ? d.inspectionList : [];
    if (list.length === 0) return null;
    if (requireAllDone && !list.every(it => it && it.status === '완료')) return null;
    const done = (Array.isArray(d.inspectionDone) ? d.inspectionDone : []).slice();
    const at = new Map(done.map((it, i) => [itemKey(it), i]));
    let moved = 0;
    list.forEach(it => {
        if (!it || it.status !== '완료') return;
        const k = itemKey(it);
        // 같은 항목이 이미 있으면 새 것으로 바꿔 끼운다 — 같은 날 재검수 결과가 남고, 옛 탭이 되살린 같은 값이면 해가 없다
        if (at.has(k)) { done[at.get(k)] = it; return; }
        at.set(k, done.length);
        done.push(it);
        moved++;
    });
    return { list: [], done, moved };
}

/** 검수 항목들의 패킹일(packingDate) → '10/24' · '10/24, 10/26' · 4개 넘으면 '10/20, 10/22, 10/24 외 2'. 없으면 '' (일자별 보기 표시용) */
export function packDatesLabel(items, max = 3) {
    const days = [...new Set((Array.isArray(items) ? items : [])
        .map(it => s(it && it.packingDate).slice(0, 10))
        .filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v)))].sort();
    if (!days.length) return '';
    const md = (v) => `${v.slice(5, 7)}/${v.slice(8, 10)}`;
    const head = days.slice(0, max).map(md).join(', ');
    return days.length > max ? `${head} 외 ${days.length - max}` : head;
}

/** 업무 예상 샘플검수 — 오늘 검수 매니저 리스트 장수(대기 + 완료). 리스트는 오늘 것만 있으므로 다른 날은 0.
 *  live = 실시간 상태(State.appState), day = 이력의 오늘 항목, subscribed = 오늘 문서를 구독 중인가.
 *  구독 중이면 실시간 값만 본다(리스트를 비웠는데 이력의 옛 장수가 남지 않게). 구독 전에만 이력 쪽 */
export function inspListCountFor(dateStr, today, live, day, subscribed = false) {
    if (!dateStr || dateStr !== today) return 0;
    return subscribed ? dayInspItems(live).length : (dayInspItems(live).length || dayInspItems(day).length);
}

/** 하루 행(daily_data 또는 history) → 그날 검수 항목 전부(대기 + 완료 + 비운 완료).
 *  옛 탭이 리스트를 되살려 두 칸에 같은 항목이 있으면 리스트 쪽만 남긴다(일자별 보기·엑셀에 두 번 나오지 않게). */
export function dayInspItems(day) {
    const d = day || {};
    const list = Array.isArray(d.inspectionList) ? d.inspectionList : [];
    const done = Array.isArray(d.inspectionDone) ? d.inspectionDone : [];
    if (!done.length) return list;
    const inList = new Set(list.map(itemKey));
    return list.concat(done.filter(it => !inList.has(itemKey(it))));
}

/** 같은 검수 항목 열쇠(이름·옵션·출고일·코드) — 이어서 검수·패킹일자별이 같이 쓴다 */
export const inspItemKey = itemKey;

/**
 * [이어서 검수](2026-11-27 사용자 요청) — 원래 날짜의 대기 항목을 오늘 리스트에 붙이고, 새로 붙인 것만 원래 날짜 리스트에서 뺀다.
 *   srcList  = 원래 날짜 서버 문서의 inspectionList(history — 마감 안 한 날은 daily_data 쪽도 같은 함수로 뺀다)
 *   todayDoc = 오늘 daily_data 문서 값({inspectionList, inspectionDone}) — 둘 다 보고 이미 있는 항목은 다시 안 붙인다
 * → { add: 붙일 항목(상태 '대기'), nextToday: 오늘 inspectionList, nextSrc: 원래 날짜 inspectionList, removed: 뺀 수 }
 */
export function resumePlan(srcList, todayDoc, otherList) {
    const src = Array.isArray(srcList) ? srcList : [];
    const cur = Array.isArray(todayDoc && todayDoc.inspectionList) ? todayDoc.inspectionList : [];
    const seen = new Set(dayInspItems(todayDoc).map(itemKey));
    // 같은 날의 다른 쪽 리스트(이력 ↔ 마감 안 한 daily_data)에서 이미 완료면 옮기지 않는다(한쪽 저장이 늦은 경우 — 2026-11-27 리뷰)
    const doneElsewhere = new Set((Array.isArray(otherList) ? otherList : []).filter(it => it && it.status === '완료').map(itemKey));
    const addKeys = new Set();
    const dropKeys = new Set();   // 원래 날짜에서 뺄 열쇠 = 새로 붙인 것 + 이미 오늘 리스트(대기·완료)에 있는 것(두 날짜에 같은 대기가 남지 않게, 리뷰)
    const add = [];
    src.forEach(it => {
        if (!it || it.status === '완료') return;
        const k = itemKey(it);
        if (doneElsewhere.has(k)) return;
        if (seen.has(k)) { dropKeys.add(k); return; }
        if (addKeys.has(k)) return;
        addKeys.add(k);
        dropKeys.add(k);
        add.push({ ...it, status: '대기' });
    });
    const { list: nextSrc, removed } = removeMoved(src, dropKeys);
    return { add, nextToday: cur.concat(add), nextSrc, removed, addKeys, dropKeys };
}

/** 리스트에서 옮긴(addKeys) 대기 줄만 뺀다 — 완료 줄은 그대로 */
export function removeMoved(list, addKeys) {
    const src = Array.isArray(list) ? list : [];
    const next = src.filter(it => !(it && it.status !== '완료' && addKeys.has(itemKey(it))));
    return { list: next, removed: src.length - next.length };
}

const packKeyOf = (it) => {
    const v = s(it && it.packingDate).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
};

/**
 * 일자별 보기 '패킹일자별'(2026-11-27 사용자 요청) — 검수일별 목록 [{date, data:[항목]}] → 패킹일별 [{date: 패킹일|'', count, data}].
 *   data 의 항목은 사본에 _inspDate(그 항목의 검수일)·_otherDates(같은 항목이 있던 다른 검수일 수)를 붙인다(원본은 안 바꿈).
 *   같은 항목(이름·옵션·출고일·코드)이 여러 검수일에 있으면(옛 이어서 검수) 하나만 — 완료 우선, 같으면 검수일이 늦은 것.
 *   순서: 패킹일 최근 순, 패킹일 없음('')은 맨 뒤. 각 묶음 안은 검수일 최근 순.
 */
export function packDateGroups(dateList) {
    const best = new Map();
    (Array.isArray(dateList) ? dateList : []).forEach(d => {
        const date = s(d && d.date);
        (Array.isArray(d && d.data) ? d.data : []).forEach(it => {
            if (!it) return;
            const k = itemKey(it);
            const prev = best.get(k);
            if (!prev) { best.set(k, { it, date, n: 1 }); return; }
            prev.n++;
            const better = (it.status === '완료') !== (prev.it.status === '완료')
                ? it.status === '완료'
                : date > prev.date;
            if (better) { prev.it = it; prev.date = date; }
        });
    });
    const groups = new Map();
    best.forEach(({ it, date, n }) => {
        const pk = packKeyOf(it);
        if (!groups.has(pk)) groups.set(pk, []);
        groups.get(pk).push({ ...it, _inspDate: date, _otherDates: n - 1 });
    });
    return [...groups.entries()]
        .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : b[0].localeCompare(a[0])))
        .map(([date, data]) => ({ date, count: data.length, data: data.sort((a, b) => b._inspDate.localeCompare(a._inspDate)) }));
}
