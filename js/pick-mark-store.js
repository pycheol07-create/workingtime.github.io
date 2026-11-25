// === js/pick-mark-store.js ===
// '전날 피킹까지 함' 표시 쓰기(2026-11-25) — 업무 예상 계획 화면의 직진배송·에이블리배송 줄 버튼(js/ui-history-prediction.js)이 부른다.
// 문서 모양·판정은 js/lib/ship-transmit.js('전날 피킹까지 함' 절) — 여기는 쓰기만.
//   artifacts/team-work-logger-v2/persistent_data/shipPickMarks  { marks: { D: { 업무id: { at, by } } }, updatedAt }
//   쓰기 권한: firestore.rules — data.forecast 또는 ship.platform. 지우기(문서 통째)는 막혀 있다.
//   켜기는 오늘(D === 오늘)만 — 규칙도 오늘(KST) 날짜 칸만 새로 쓰게 하고 at == 서버 시각·by == 로그인 이메일을 본다.
//   되돌리기(끄기)는 날짜와 상관없이 되고, 표시한 사람·관리자로 막는 것은 화면에서만(사용자 결정 — 규칙은 보지 않는다).
// ⚠️ by 에는 로그인 이메일을 쓴다. 로그·토스트에 내지 않는다(로그에는 날짜·업무 id·e.code 만).
// ⚠️ Firebase 를 여기서 초기화하지 않는다 — 페이지가 만든 db 를 받아 쓴다.
import { doc, updateDoc, setDoc, serverTimestamp, deleteField, FieldPath } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { buildPickMarkPatch } from './lib/ship-transmit.js?v=202611251333';

export const PICK_MARKS_PATH = ['artifacts', 'team-work-logger-v2', 'persistent_data', 'shipPickMarks'];

/** 표시 하나를 켜거나 끈다.
 *  @param {object} db        Firestore
 *  @param {string} day       D 'YYYY-MM-DD'
 *  @param {string} taskId    'k_direct' | 'k_ably'
 *  @param {boolean} on       true = 표시, false = 되돌리기
 *  @param {object} opts
 *  @param {string} opts.by           로그인 이메일(on 일 때 필요)
 *  @param {string} opts.today        'YYYY-MM-DD'
 *  @param {Array<string>} [opts.existingDays]  지금 문서의 marks 날짜 키(옛 날짜 정리용)
 *  @returns {Promise<{set, del, prune}>}  쓴 계획(buildPickMarkPatch 결과 — 화면이 로컬 값을 맞춘다).
 *           실패하면 throw(Error.message = 사유 문구, 또는 Firestore 오류 그대로) */
export async function setPickMark(db, day, taskId, on, { by, today, existingDays } = {}) {
    if (!db) throw new Error('데이터베이스 연결 없음');
    const p = buildPickMarkPatch({ day, taskId, on, by, today, existingDays });
    if (p.error) throw new Error(p.error);
    const ref = doc(db, ...PICK_MARKS_PATH);
    const args = [];
    if (p.set) args.push(new FieldPath('marks', p.set.day, p.set.taskId), { at: serverTimestamp(), by: p.set.by });
    if (p.del) args.push(p.del.taskId ? new FieldPath('marks', p.del.day, p.del.taskId) : new FieldPath('marks', p.del.day), deleteField());
    p.prune.forEach(d => args.push(new FieldPath('marks', d), deleteField()));
    args.push('updatedAt', serverTimestamp());
    try {
        await updateDoc(ref, ...args);
        return p;
    } catch (e) {
        if (!e || e.code !== 'not-found') throw e;
        if (!p.set) return p;                   // 문서가 없으면 되돌릴 것도 없다
        // 처음 쓰는 표시 — 문서를 만든다(merge: 그 사이 다른 사람이 만들었어도 그 칸들을 지우지 않는다)
        await setDoc(ref, {
            marks: { [p.set.day]: { [p.set.taskId]: { at: serverTimestamp(), by: p.set.by } } },
            updatedAt: serverTimestamp()
        }, { merge: true });
        return p;
    }
}
