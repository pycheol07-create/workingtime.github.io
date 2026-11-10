// === js/ops-plan-items-store.js ===
// ✅ 운영 계획 실행 관리 저장소(v2 D4) — 최상위 OpsPlanItems/{itemId} + /log/{auto}. 규칙: firestore.rules 'OpsPlanItems' 블록
//   읽기 = 분석 권한. 만들기·지우기 = 관리자. 상태·진행·체크 = 분석 권한(관리자는 모든 칸) — 트랜잭션으로 version + 1, 바뀐 칸마다 이력 한 줄.
//   ⚠️ 이름·금액 없음 — 본문은 plan-items itemFromDraft / applyChange 가 고른 칸만, 사람은 역할로만. 콘솔에 본문을 찍지 않는다.

import { doc, collection, getDocs, query, where, runTransaction, serverTimestamp, deleteDoc }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as State from './state.js?v=202611102106';
import { itemFromDraft, applyChange, logEntriesOf } from './lib/plan-items.js?v=202611102106';

export const ITEMS_COL = 'OpsPlanItems';
const myEmail = () => String((State.auth && State.auth.currentUser && State.auth.currentUser.email) || '').toLowerCase();
const col = () => collection(State.db, ITEMS_COL);

let cache = null;   // { key, at, items }
const FRESH_MS = 60 * 1000;
export const clearItemsCache = () => { cache = null; };

/** 해(들)의 과제 목록(1분 캐시) — years = [2026, 2027] 처럼. openYears = 끝·그만 아닌 것만 더 읽을 해(지난해 남은 과제). 실패하면 throw(권한·연결). */
export async function listItems(years, { force = false, openYears = [] } = {}) {
    const ys = [...new Set((Array.isArray(years) ? years : [years]).map(Number).filter(Boolean))].sort();
    const os = [...new Set((openYears || []).map(Number).filter(y => y && !ys.includes(y)))].sort();
    const key = `${ys.join(',')}|${os.join(',')}`;
    if (!force && cache && cache.key === key && Date.now() - cache.at < FRESH_MS) return cache.items;
    // 지난해 남은 과제 조회는 실패해도(색인·권한) 올해 목록은 그대로 보인다
    const snaps = await Promise.all([getDocs(query(col(), where('year', 'in', ys))),
        ...os.map(y => getDocs(query(col(), where('year', '==', y), where('status', 'in', ['todo', 'doing', 'hold'])))
            .catch(e => { console.warn('[운영 계획] 지난해 남은 과제 조회 실패 — 건너뜀', e && e.code); return null; }))]).then(a => a.filter(Boolean));
    if (snaps.some(s => s.metadata && s.metadata.fromCache)) throw Object.assign(new Error('과제 조회가 서버에 닿지 못함'), { code: 'offline' });
    const items = [];
    snaps.forEach(snap => snap.forEach(d => items.push({ id: d.id, ...d.data() })));
    cache = { key, at: Date.now(), items };
    return items;
}
export const peekItems = () => (cache ? cache.items : null);

/** [과제로 만들기](관리자) — 이름 없는 초안 → 새 과제 + 이력 '만듦' */
export async function createItem(draft, { today, parent = null } = {}) {
    const body = itemFromDraft(draft, { today, parent });
    const ref = doc(col());
    await runTransaction(State.db, async (tx) => {
        tx.set(ref, { ...body, createdAt: serverTimestamp(), createdBy: myEmail(), updatedAt: serverTimestamp(), updatedBy: myEmail() });
        tx.set(doc(collection(ref, 'log')), { at: serverTimestamp(), by: myEmail(), field: 'create', from: '', to: '' });
    });
    cache = null;
    return ref.id;
}

/** 상태·진행·체크 바꾸기 — 트랜잭션 안에서 서버 값에 적용(체크는 change.check = {idx, ok} 한 칸만), version + 1 · updatedAt(규칙: 이력은 같은 쓰기에서 과제 updatedAt 이 지금일 때만), 바뀐 칸마다 이력. 바뀐 게 없으면 false */
export async function updateItem(id, change) {
    const ref = doc(col(), id);
    const changed = await runTransaction(State.db, async (tx) => {
        const cur = await tx.get(ref);
        if (!cur.exists()) throw Object.assign(new Error('과제가 없습니다'), { code: 'not-found' });
        const item = cur.data();
        const patch = applyChange(item, change);
        if (!patch) return false;
        tx.update(ref, { ...patch, version: (Number(item.version) || 0) + 1, updatedAt: serverTimestamp(), updatedBy: myEmail() });
        logEntriesOf(item, patch, change).forEach(e => {
            tx.set(doc(collection(ref, 'log')), { at: serverTimestamp(), by: myEmail(), field: e.field, from: e.from, to: e.to });
        });
        return true;
    });
    cache = null;
    return changed;
}

/** 변경 이력(최근 30줄) — by 는 이메일이라 화면에 그리지 않는다(언제·무엇만) */
export async function itemLog(id) {
    const snap = await getDocs(collection(doc(col(), id), 'log'));
    const out = [];
    snap.forEach(d => { const x = d.data(); out.push({ at: x.at && x.at.toMillis ? x.at.toMillis() : 0, field: x.field, from: x.from, to: x.to, note: x.note || '' }); });
    return out.sort((a, b) => b.at - a.at).slice(0, 30);
}

/**
 * 기한 초과 알림 '그날 보냄' 표시(관리자) — OpsPlan/notify { day, ids } 를 트랜잭션으로 읽고, pick(sent) 가 보낼 사람을 고르면 그날로 고쳐 쓴다.
 * 규칙이 day 를 앞으로만 허용하므로 관리자 여럿 중 먼저 쓴 쪽만 보낸다. 보낼 것이 없거나 이미 그날 보냈으면 null. 이름은 메모리에만(문서에는 과제 id 만).
 */
export async function claimOverdueNotice(today, pick) {
    const ref = doc(State.db, 'OpsPlan', 'notify');
    return runTransaction(State.db, async (tx) => {
        const cur = await tx.get(ref);
        const sent = cur.exists() ? cur.data() : null;
        if (sent && sent.day >= today) return null;
        const r = pick(sent);
        if (!r || !r.targets.length) return null;
        tx.set(ref, { v: 1, day: today, ids: [...new Set([...((sent && sent.ids) || []), ...r.itemIds])].slice(-200), sentAt: serverTimestamp(), sentBy: myEmail() });
        return r;
    });
}

/** 지우기(관리자) — 보통은 상태 '그만'(drop)을 쓴다 */
export async function removeItem(id) {
    await deleteDoc(doc(col(), id));
    cache = null;
}
