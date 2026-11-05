// === js/lib/approval-noti.js ===
// 기안서 알림(2026-11-05) — 앱 알림(종)과 같은 모양 { targetMember, message, type:'approval', isRead:false, createdAt }
//   을 artifacts/team-work-logger-v2/notifications 에 넣는다(js/app-notifications.js sendNotification 과 같은 칸).
// ⚠️ notifications 는 등록 직원 전원이 읽을 수 있다(firestore.rules artifacts/** 읽기) → 문구에 기안서 종류·내용·작성자를 넣지 않는다.
// Firestore 함수(collection·addDoc)는 부르는 쪽이 넘긴다 — 이 파일은 CDN 을 import 하지 않아 node 시험이 된다(tests/approval-logic.test.js).
// 알림이 실패해도 제출·결재는 그대로 둔다(부르는 쪽이 실패 건수만 안내).

export const NOTI_TYPE = 'approval';
export const MSG_TO_ADMIN = '결재할 기안서가 있습니다 — 기안서 메뉴에서 확인하세요.';
// 결재선(2026-11-05): 제출 때 1차 결재자, 단계 승인 때 다음 결재자에게 이 문구 · 최종 승인·반려 때 작성자에게 MSG_TO_AUTHOR
export const MSG_TO_APPROVER = MSG_TO_ADMIN;
// 작성자에게 — 승인·반려를 나누지 않는다(알림 목록만 봐도 누구 기안이 반려됐는지 드러나지 않게)
export const MSG_TO_AUTHOR = '기안서 메뉴에 새 소식이 있습니다 — 확인하세요.';

/** 알림 문서 하나(순수). */
export const notiDoc = (targetMember, message, now = new Date()) => ({
    targetMember, message, type: NOTI_TYPE, isRead: false, createdAt: now.toISOString()
});

/** 이름 목록에 알림을 넣는다. fs = { collection, addDoc }. → { sent, failed } (던지지 않는다). */
export async function sendApprovalNoti(db, fs, names, message) {
    const list = [...new Set((Array.isArray(names) ? names : []).filter(n => typeof n === 'string' && n))];
    let sent = 0, failed = 0;
    await Promise.all(list.map(async (name) => {
        try {
            await fs.addDoc(fs.collection(db, 'artifacts', 'team-work-logger-v2', 'notifications'), notiDoc(name, message));
            sent++;
        } catch (e) {
            failed++;
            console.error('[approval] 알림 실패:', e && e.code);
        }
    }));
    return { sent, failed };
}
