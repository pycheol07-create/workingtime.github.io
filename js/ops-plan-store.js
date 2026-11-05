// === js/ops-plan-store.js ===
// 📋 운영 계획 저장소(MVP-2) — 최상위 컬렉션 OpsPlan 읽기·쓰기. 규칙: firestore.rules 'OpsPlan' 블록
//   읽기 = data.analysis 권한, 쓰기 = 관리자만(id 모양·version +1·크기 상한·금액/이름 칸 금지·삭제 금지).
//   OpsPlan/targets                 목표 { v, week, month, year, overrides, updatedAt(서버 시각), updatedBy(소문자 이메일) }
//   OpsPlan/{week|month}_{periodKey} 확정본(js/lib/plan-compare.js confirmDocOf 모양) + version · confirmedAt · confirmedBy · done
//   다시 확정하면 version + 1 로 덮어쓴다(이전 버전 본문은 남기지 않음) — 새 과제 key 에 있는 옛 완료 체크는 이어받는다.
//   완료 체크는 칸 하나씩(done.<key> = true / 지움) — 연속·동시 체크가 서로 덮지 않게. version 그대로(규칙이 done·doneAt·doneBy 만 허용).
// ⚠️ 금액·직원 이름을 넣지 않는다(문서 본문은 plan-compare / plan-targets 가 골라 담은 것만). 콘솔에 문서 본문을 찍지 않는다.

import { doc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp, deleteField, FieldPath }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as State from './state.js?v=202611051422';
import { targetsDocOf } from './lib/plan-targets.js?v=202611051422';
import { cleanDone } from './lib/plan-compare.js?v=202611051422';

export const OPS_PLAN_COL = 'OpsPlan';
const myEmail = () => String((State.auth && State.auth.currentUser && State.auth.currentUser.email) || '').toLowerCase();
const ref = (id) => doc(State.db, OPS_PLAN_COL, id);

const cache = new Map();   // id → { at, data|null }
const FRESH_MS = 60 * 1000;

/** 문서 읽기(1분 캐시). 없으면 null. force = 캐시 무시. 권한 없음 등 실패는 throw. */
export async function loadPlanDoc(id, { force = false } = {}) {
    const c = cache.get(id);
    if (!force && c && Date.now() - c.at < FRESH_MS) return c.data;
    const snap = await getDoc(ref(id));
    const data = snap.exists() ? snap.data() : null;
    cache.set(id, { at: Date.now(), data });
    return data;
}
/** 캐시에 있는 값만(없으면 undefined) — 화면이 다시 그릴 때 기다리지 않게 */
export const peekPlanDoc = (id) => (cache.has(id) ? cache.get(id).data : undefined);

/** 목표 저장(관리자). input = { week, month, year, overrides } */
export async function saveTargets(input) {
    const body = { ...targetsDocOf(input), updatedAt: serverTimestamp(), updatedBy: myEmail() };
    await setDoc(ref('targets'), body);
    cache.delete('targets');
}

/** 계획 확정(관리자) — 지금 버전 + 1(없으면 1)로 덮어쓴다. body = confirmDocOf(...) 결과. 돌려줌 = 새 version. */
export async function confirmPlan(id, body) {
    const r = ref(id);
    const version = await runTransaction(State.db, async (tx) => {
        const cur = await tx.get(r);
        const v = cur.exists() ? (Number(cur.data().version) || 0) + 1 : 1;
        const keep = cur.exists() ? cleanDone(cur.data().done, body.actions) : {};   // 같은 과제의 체크는 이어받기
        tx.set(r, { ...body, done: keep, version: v, confirmedAt: serverTimestamp(), confirmedBy: myEmail() });
        return v;
    });
    cache.delete(id);
    return version;
}

/** 완료 체크 한 칸 저장(관리자) — done.<key> 만 true 로 두거나 지운다(version 그대로). key 에 ':' 등이 있어 FieldPath 로. */
export async function saveDone(id, key, checked) {
    await updateDoc(ref(id), new FieldPath('done', String(key)), checked ? true : deleteField(),
        'doneAt', serverTimestamp(), 'doneBy', myEmail());
    cache.delete(id);
}
