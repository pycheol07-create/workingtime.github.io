// === js/app-shell-noti.js ===
// 공통 상단바(js/app-shell.js)의 개인 알림 구독 (UI 1단계 P2, 2026-10-16). 셸이 로그인 확인 2~3초 뒤 import 한다.
//   - 조회 조건은 대시보드(js/app-sync.js 개인 알림 구독)와 똑같이 — 같은 색인을 쓰고, 읽기도 최대 30건.
//   - SDK 는 페이지와 같은 버전 주소(10.12.2)로 불러 같은 인스턴스를 쓴다 → 페이지가 이미 붙인 에뮬레이터 연결·캐시 설정을 그대로 따른다.
//     ⚠️ 페이지의 firebasejs 버전을 올리면 여기 주소도 같이 올릴 것(다르면 getApps() 가 비어 구독하지 않는다 — 조용히 꺼질 뿐 깨지지는 않는다).
//   - 읽음 처리·목록은 대시보드(#notification-modal)가 한다. 여기서는 안 읽은 수와 '새 알림 왔음'만 알린다.
//   - 이름·알림 내용은 로그로 남기지 않는다.
import { getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, query, where, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { emulatorEnabled } from './firebase-emulator.js?v=202610161856';

/**
 * memberName 의 최근 3일 알림(최대 30건)을 구독한다.
 * onCount(안 읽은 수) — 스냅샷마다. onNew() — 처음 스냅샷 이후 새로 들어온 안 읽은 알림이 있을 때.
 * 구독하지 못하면 null, 했으면 해제 함수를 돌려준다.
 */
export function watchNotifications(memberName, { onCount, onNew } = {}) {
    if (!memberName) return null;
    // 페이지가 Firebase 를 아직(또는 끝내) 띄우지 않았으면 손대지 않는다 — 여기서 기본 앱을 새로 만들지 않는다.
    if (!getApps().some(a => a.name === '[DEFAULT]')) return null;
    // 🧪 ?emu=1 인데 에뮬레이터 띠가 없으면 운영으로 붙었을 수 있다 — 구독하지 않는다.
    if (emulatorEnabled() && !document.getElementById('emulator-banner')) return null;

    const db = getFirestore(getApp());
    const d = new Date();
    d.setDate(d.getDate() - 3);   // js/app-sync.js 와 같은 3일
    const q = query(
        collection(db, 'artifacts', 'team-work-logger-v2', 'notifications'),
        where('targetMember', '==', memberName),
        where('createdAt', '>=', d.toISOString()),
        limit(30)
    );

    let first = true;
    return onSnapshot(q, (snap) => {
        let unread = 0;
        snap.forEach(s => { if (!s.data().isRead) unread++; });
        let fresh = false;
        if (!first) {
            snap.docChanges().forEach(ch => { if (ch.type === 'added' && !ch.doc.data().isRead) fresh = true; });
        }
        first = false;
        try { if (onCount) onCount(unread); } catch (e) { /* 화면 갱신 실패로 구독을 멈추지 않는다 */ }
        try { if (fresh && onNew) onNew(); } catch (e) { /* 무시 */ }
    }, (err) => {
        console.warn('[app-shell] 알림 구독 오류:', err && err.code);
    });
}
