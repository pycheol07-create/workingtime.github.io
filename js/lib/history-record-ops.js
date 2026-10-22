// === js/lib/history-record-ops.js ===
// 지난 날짜 이력의 업무 기록(workRecords) 추가·수정·삭제 — 서버 문서 배열에 무엇을 할지만 정한다. (2026-10-22)
//
// 왜 따로 떼어냈나
//   예전엔 메모리(State.allHistoryData)의 배열을 고친 뒤 그 배열을 통째로 setDoc 했다.
//   merge:true 는 배열을 합치지 않고 통째로 바꾸므로, 다른 PC 가 그 사이 넣은 기록이 사라졌다.
//   지금은 runTransaction 안에서 **서버 배열**에 이 함수를 적용해 쓴다(history-data-manager.js).
//   트랜잭션은 충돌하면 콜백을 다시 부르므로, 여기 함수들은 입력을 바꾸지 않고 새 배열을 돌려준다.
// 순수 모듈(DOM/Firebase 의존 없음). 반환은 모두 { list, changed }.

const asList = (list) => (Array.isArray(list) ? list : []);
const idOf = (r) => (r && typeof r === 'object' ? r.id : undefined);

/** 완료 기록인데 시간이 0분 이하면(반올림 기준) 남기지 않는다 — 기존 updateHistoryDirectly 규칙 그대로. */
export const isEmptyCompleted = (rec) =>
    !!rec && rec.status === 'completed' && Math.round(Number(rec.duration) || 0) <= 0;

/** 기록 추가. 같은 id 가 이미 있으면 그대로 둔다(changed=false — 응답만 못 받고 다시 눌러도 두 번 안 들어간다). */
export function addRecord(list, rec) {
    const arr = [...asList(list)];
    if (rec && rec.id != null && arr.some(r => idOf(r) === rec.id)) return { list: arr, changed: false };
    arr.push(rec);
    return { list: arr, changed: true };
}

/** 기록 수정. id 가 없으면 throw('기록 없음').
 *  recompute(merged, original, patch) 가 있으면 그 반환값을 새 기록으로 쓴다(시간 재계산용).
 *  결과가 완료·0분 이하면 그 기록을 뺀다(removed=true). */
export function updateRecord(list, id, patch, recompute) {
    const arr = [...asList(list)];
    const i = arr.findIndex(r => idOf(r) === id);
    if (i === -1) throw new Error('기록 없음');
    const original = arr[i];
    const merged = { ...original, ...(patch || {}) };
    const next = typeof recompute === 'function' ? (recompute(merged, original, patch || {}) || merged) : merged;
    if (isEmptyCompleted(next)) {
        arr.splice(i, 1);
        return { list: arr, changed: true, removed: true };
    }
    arr[i] = next;
    return { list: arr, changed: true, removed: false };
}

/** 기록 삭제. 없는 id 면 changed=false(쓰지 않는다). */
export function removeRecord(list, id) {
    const src = asList(list);
    const arr = src.filter(r => idOf(r) !== id);
    return { list: arr, changed: arr.length !== src.length };
}
