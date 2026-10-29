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
