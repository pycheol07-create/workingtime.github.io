// === js/notice-logic.js ===
import * as State from './state.js?v=202610221624';
import { showToast, getActiveTeamMembers } from './utils.js?v=202610221624';
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeFirebase } from './config.js?v=202610221624';

// 🔥 [신규] 멘션 발송을 위해 알림 함수 가져오기
import { sendNotification } from './app-notifications.js?v=202610221624';

const createId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

const getNoticeDocRef = () => {
    const firebase = initializeFirebase();
    // 옛 이름(adminTodos) 그대로 — 공지가 사는 문서다. 투두 기능은 2026-10-14 삭제.
    return doc(firebase.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'adminTodos');
};

let unsub = null;

// ==========================================
// 1. 공지 구독 및 저장 (실시간 동기화)
// ==========================================
/** 로그인 후 app.js 가 부른다. 로그인 전에는 규칙상 읽을 수 없다. */
export const subscribeNotices = () => {
    if (unsub) return;   // 이미 구독 중
    try {
        unsub = onSnapshot(getNoticeDocRef(), (docSnap) => {
            State.appState.importantNotices = docSnap.exists() ? (docSnap.data().notices || []) : [];

            document.dispatchEvent(new CustomEvent('renderNotices'));
            // 일정이 지난 공지 정리. 지우면 스냅샷이 다시 돌아 화면도 갱신된다.
            purgeExpiredNotices().catch(e => console.warn('지난 공지 정리 실패:', e));
        }, (error) => {
            console.error("공지 실시간 동기화 오류:", error);
            // onSnapshot 은 오류가 나면 리스너를 끝낸다. 비워 둬야 다음 로그인 때 다시 구독한다.
            unsub = null;
        });
    } catch (e) {
        console.error("공지 구독 시작 오류:", e);
        unsub = null;
    }
};

export const unsubscribeNotices = () => {
    if (unsub) { try { unsub(); } catch (e) {} }
    unsub = null;
};

export const saveNotices = async ({ quiet = false } = {}) => {
    try {
        // merge — 문서의 다른 필드(옛 투두 tasks 등)는 건드리지 않는다
        await setDoc(getNoticeDocRef(), {
            notices: State.appState.importantNotices || []
        }, { merge: true });
        return true;
    } catch (e) {
        console.error("데이터 저장 오류:", e);
        if (!quiet) showToast('공지 저장에 실패했습니다.', true);
        return false;
    }
};

// ==========================================
// 2. 중요 알림(Notice) 전용 로직
// ==========================================

// 🔥 [신규] 텍스트 내에서 '@이름' 멘션을 찾아 알림을 발송하는 헬퍼 함수
const processMentions = async (text) => {
    const sender = State.appState.currentUser || '관리자';
    const mentionRegex = /@([가-힣a-zA-Z0-9]+)/g;
    const matches = [...text.matchAll(mentionRegex)];
    
    if (matches.length > 0) {
        const uniqueMentions = [...new Set(matches.map(m => m[1]))];
        
        // 유효한 대상자인지 확인하기 위해 전체 멤버 세트 구성
        const allMembers = new Set();
        getActiveTeamMembers(State.appConfig).forEach(m => allMembers.add(m));   // 퇴사자 제외
        (State.appState?.partTimers || []).forEach(p => allMembers.add(p.name));

        const shortText = text.length > 20 ? text.substring(0, 20) + '...' : text;

        let failed = 0;
        for (const name of uniqueMentions) {
            if (allMembers.has(name) && name !== sender) {
                // 발송 — 실패해도 던지지 않고 false 를 준다
                const ok = await sendNotification(name, `🔔 중요 알림에서 ${sender}님이 회원님을 멘션했습니다:\n"${shortText}"`, 'mention');
                if (!ok) failed++;
            }
        }
        if (failed > 0) showToast(`멘션 알림 ${failed}명 발송 실패`, true);
    }
};

/**
 * @param {string} text  공지 내용
 * @param {string} [scheduleAt]  'YYYY-MM-DDTHH:MM' 형태의 일정. 비우면 일정 없는 공지.
 */
/** 일정이 지난 공지를 걷어낸다.
 *
 *  '지났다'의 기준은 **그 날짜가 끝난 뒤**다(다음 날 00:00 이후).
 *  시간을 14:00 으로 넣었다고 14:01 에 사라지면, 정작 그날 확인해야 할
 *  공지가 눈앞에서 없어진다. 하루는 온전히 남겨 둔다.
 *
 *  일정이 없는 공지는 건드리지 않는다.
 *  지우는 것이므로 되돌릴 수 없다 — 조건을 좁게 잡은 이유다.
 */
export const purgeExpiredNotices = async () => {
    const list = State.appState.importantNotices || [];
    if (list.length === 0) return 0;

    const today = new Date(); today.setHours(0, 0, 0, 0);

    const kept = list.filter(n => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(n && n.scheduleAt || ''));
        if (!m) return true;                       // 일정 없는 공지는 그대로
        const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return day >= today;                       // 오늘 것까지는 남긴다
    });

    const removed = list.length - kept.length;
    if (removed === 0) return 0;

    State.appState.importantNotices = kept;
    // 스냅샷마다 도는 자동 정리라 실패해도 토스트는 띄우지 않는다(콘솔만)
    await saveNotices({ quiet: true });
    return removed;
};

export const addNotice = async (text, scheduleAt = '') => {
    if (!text.trim()) { showToast("알림 내용을 입력해주세요.", true); return false; }
    const newNotice = {
        id: createId(), text: text.trim(), completed: false, createdAt: Date.now()
    };
    // 일정은 넣었을 때만 담는다. 빈 값을 넣어 두면 '일정 없음'과 구분이 흐려진다.
    if (String(scheduleAt || '').trim()) newNotice.scheduleAt = String(scheduleAt).trim();
    if(!State.appState.importantNotices) State.appState.importantNotices = [];
    State.appState.importantNotices.push(newNotice);

    if (!(await saveNotices())) {
        // 저장 실패 — 화면에만 남은 공지를 빼고, 입력칸은 부르는 쪽이 그대로 둔다
        State.appState.importantNotices = (State.appState.importantNotices || []).filter(n => n.id !== newNotice.id);
        document.dispatchEvent(new CustomEvent('renderNotices'));
        return false;
    }

    // 멘션 감지 및 푸시
    await processMentions(text.trim());
    return true;
};

export const toggleNotice = async (id) => {
    const notice = State.appState.importantNotices.find(n => n.id === id);
    if (notice) {
        notice.completed = !notice.completed;
        await saveNotices();
    }
};

export const deleteNotice = async (id) => {
    if (!confirm("이 중요 알림을 삭제하시겠습니까?")) return;
    State.appState.importantNotices = State.appState.importantNotices.filter(n => n.id !== id);
    await saveNotices();
};

export const editNotice = async (id, newText, scheduleAt) => {
    const notice = State.appState.importantNotices.find(n => n.id === id);
    if (notice && newText.trim()) {
        notice.text = newText.trim();
        // undefined 면 손대지 않고, 빈 문자열이면 일정을 없앤다
        if (scheduleAt !== undefined) {
            if (String(scheduleAt).trim()) notice.scheduleAt = String(scheduleAt).trim();
            else delete notice.scheduleAt;
        }
        if (!(await saveNotices())) return false;

        // 수정 시에도 새롭게 멘션된 사람이 있다면 푸시
        await processMentions(newText.trim());
    }
};