// === js/lib/leave-ops.js ===
// persistent_data/leaveSchedule.onLeaveMembers 를 고치는 순수 함수 모음.
//   config.js updateLeaveSchedule(db, mutate) 의 mutate 안에서 서버 목록에 적용한다.
//   트랜잭션은 충돌 시 mutate 를 여러 번 부르므로 여기 함수는 입력을 바꾸지 않고 새 배열을 돌려준다.
//   행 번호가 아니라 식별자로 찾는다(attendance-check 4번).

/** 기록 식별자 — id 가 있으면 id, 없으면 member|type|startDate|endDate (endDate 없으면 startDate). */
export function leaveKey(l) {
    if (!l) return '';
    if (l.id) return String(l.id);
    return [l.member || '', l.type || '', l.startDate || '', l.endDate || l.startDate || ''].join('|');
}

/** entry.id 와 같은 기록이 있으면 덮어 합치고({...기존, ...entry}), 없으면 끝에 붙인다. */
export function upsertById(list, entry) {
    const src = Array.isArray(list) ? list : [];
    const idx = entry && entry.id ? src.findIndex(l => l && l.id === entry.id) : -1;
    if (idx < 0) return [...src, { ...entry }];
    return src.map((l, i) => (i === idx ? { ...l, ...entry } : l));
}

/** id 가 ids 에 든 기록을 뺀다. */
export function removeByIds(list, ids) {
    const set = new Set((ids || []).filter(Boolean).map(String));
    return (Array.isArray(list) ? list : []).filter(l => !(l && l.id && set.has(String(l.id))));
}

/** pred(l) 가 참인 첫 기록 한 건만 뺀다(id 없는 옛 기록을 내용으로 지울 때 — 같은 내용 여러 건을 한꺼번에 지우지 않게). */
export function removeFirst(list, pred) {
    const src = Array.isArray(list) ? list : [];
    const idx = src.findIndex(l => pred(l));
    return idx < 0 ? src.slice() : src.filter((_, i) => i !== idx);
}

/** 화면에서 찾은 기록 한 건을 지운다 — id 가 있으면 id 로, 없으면 member+startDate+type 첫 일치 1건. */
export function removeRecord(list, rec) {
    if (!rec) return Array.isArray(list) ? list.slice() : [];
    if (rec.id) return removeByIds(list, [rec.id]);
    return removeFirst(list, l => !!l && l.member === rec.member
        && (l.startDate || '') === (rec.startDate || '') && l.type === rec.type);
}

/** pred(l) 가 참인 기록을 뺀다. */
export function removeWhere(list, pred) {
    return (Array.isArray(list) ? list : []).filter(l => !pred(l));
}
