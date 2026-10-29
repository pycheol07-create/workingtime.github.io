// === js/app-shell-noti.js ===
// 공통 상단바(js/app-shell.js)의 개인 알림 구독 (UI 1단계 P2, 2026-10-16). 셸이 로그인 확인 2~3초 뒤 import 한다.
//   - 조회 조건은 대시보드(js/app-sync.js 개인 알림 구독)와 똑같이 — 같은 색인을 쓰고, 읽기도 최대 NOTI_LIMIT(200)건(3일 창이라 상한이 있다).
//   - SDK 는 페이지와 같은 버전 주소(10.12.2)로 불러 같은 인스턴스를 쓴다 → 페이지가 이미 붙인 에뮬레이터 연결·캐시 설정을 그대로 따른다.
//     ⚠️ 페이지의 firebasejs 버전을 올리면 여기 주소도 같이 올릴 것(다르면 getApps() 가 비어 구독하지 않는다 — 조용히 꺼질 뿐 깨지지는 않는다).
//   - 목록·삭제·쪽지는 대시보드(#notification-modal)가 한다. 여기서는 안 읽은 수·안 읽은 목록(팝업용)·'새 알림 왔음'을 알리고,
//     팝업의 [확인]으로 읽음 표시(markRead)만 쓴다(2026-10-22 — 그 전에는 읽기만 했다). 쓰는 모양은 대시보드 '모두 읽음 처리'와 같다.
//   - 이름·알림 내용은 로그로 남기지 않는다(목록은 메모리로만 넘긴다).
import { getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, query, where, limit, onSnapshot, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { emulatorEnabled } from './firebase-emulator.js?v=202610291646';

const NOTI_PATH = ['artifacts', 'team-work-logger-v2', 'notifications'];
// 최근 3일 알림 상한 — js/app-sync.js 와 같은 값. 예전 30건은 정렬 없이 잘려 최신 알림이 빠질 수 있었다(정렬은 클라이언트).
const NOTI_LIMIT = 200;

// 페이지가 띄운 Firebase 를 쓸 수 있으면 그 db, 아니면 null.
//   - 페이지가 Firebase 를 아직(또는 끝내) 띄우지 않았으면 손대지 않는다 — 여기서 기본 앱을 새로 만들지 않는다.
//   - 🧪 ?emu=1 인데 에뮬레이터 띠가 없으면 운영으로 붙었을 수 있다 — 쓰지도 읽지도 않는다.
function pageDb() {
    if (!getApps().some(a => a.name === '[DEFAULT]')) return null;
    if (emulatorEnabled() && !document.getElementById('emulator-banner')) return null;
    return getFirestore(getApp());
}

/**
 * memberName 의 최근 3일 알림(최대 NOTI_LIMIT 건)을 구독한다.
 * onCount(안 읽은 수, 안 읽은 목록 [{id, message, createdAt}] 최신순, { first }) — 스냅샷마다. first = 처음 스냅샷.
 * onNew() — 처음 스냅샷 이후 새로 들어온 안 읽은 알림이 있을 때.
 * 구독하지 못하면 null, 했으면 해제 함수를 돌려준다.
 */
export function watchNotifications(memberName, { onCount, onNew } = {}) {
    if (!memberName) return null;
    const db = pageDb();
    if (!db) return null;
    const d = new Date();
    d.setDate(d.getDate() - 3);   // js/app-sync.js 와 같은 3일
    const q = query(
        collection(db, ...NOTI_PATH),
        where('targetMember', '==', memberName),
        where('createdAt', '>=', d.toISOString()),
        limit(NOTI_LIMIT)
    );

    let first = true;
    return onSnapshot(q, (snap) => {
        if (snap.size >= NOTI_LIMIT) console.warn(`[app-shell] 최근 3일 알림이 상한(${NOTI_LIMIT}건)에 닿았습니다 — 일부가 빠졌을 수 있습니다.`);
        const items = [];
        snap.forEach(s => {
            const d = s.data();
            if (!d.isRead) items.push({ id: s.id, message: d.message, createdAt: d.createdAt });
        });
        items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
        let fresh = false;
        const wasFirst = first;
        if (!first) {
            snap.docChanges().forEach(ch => { if (ch.type === 'added' && !ch.doc.data().isRead) fresh = true; });
        }
        first = false;
        try { if (onCount) onCount(items.length, items, { first: wasFirst }); } catch (e) { /* 화면 갱신 실패로 구독을 멈추지 않는다 */ }
        try { if (fresh && onNew) onNew(); } catch (e) { /* 무시 */ }
    }, (err) => {
        console.warn('[app-shell] 알림 구독 오류:', err && err.code);
    });
}

/** 알림 ids 를 읽음으로 표시한다 — 대시보드 markAllNotificationsAsRead 와 같은 모양({ isRead: true, readAt: ISO }). 성공하면 true. */
export async function markRead(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter(x => typeof x === 'string' && x);
    if (!list.length) return true;
    const db = pageDb();
    if (!db) return false;
    try {
        const batch = writeBatch(db);
        const at = new Date().toISOString();
        list.forEach(id => batch.update(doc(db, ...NOTI_PATH, id), { isRead: true, readAt: at }));
        await batch.commit();
        return true;
    } catch (e) {
        console.warn('[app-shell] 알림 읽음 처리 실패:', e && e.code);
        return false;
    }
}
