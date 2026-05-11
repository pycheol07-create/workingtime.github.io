// === js/app-notifications.js ===
import * as State from './state.js';
import { doc, writeBatch, deleteDoc, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showToast } from './utils.js';

// 🔥 [신규] 특정 대상에게 알림을 발송하는 핵심 공통 함수
export async function sendNotification(targetMember, message, type = 'info') {
    try {
        const notiColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications');
        await addDoc(notiColRef, {
            targetMember,
            message,
            type,
            isRead: false,
            createdAt: new Date().toISOString()
        });
    } catch(e) {
        console.error("알림 발송 실패", e);
    }
}

// 알림 리스트 렌더링 함수
export function renderNotificationList() {
    const list = document.getElementById('notification-list');
    if (!list) return;
    const notis = State.appState.notifications || [];
    if (notis.length === 0) {
        list.innerHTML = '<li class="text-center text-gray-400 dark:text-gray-500 py-8 text-sm">알림이 없습니다.</li>';
        return;
    }
    
    list.innerHTML = notis.map(n => `
        <li class="p-3 rounded-lg border ${n.isRead ? 'bg-gray-50 border-gray-200 dark:bg-gray-700/50 dark:border-gray-600 text-gray-500 dark:text-gray-400' : 'bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800 text-gray-800 dark:text-gray-200'} shadow-sm relative pr-8">
            <div class="text-[10px] font-bold mb-1 opacity-70">${new Date(n.createdAt).toLocaleString('ko-KR', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</div>
            <div class="text-sm font-medium leading-snug break-words">${n.message}</div>
            <button class="absolute top-2 right-2 text-gray-400 hover:text-red-500 font-bold text-lg delete-single-noti-btn transition" data-id="${n.id}">&times;</button>
        </li>
    `).join('');
}

// 알림 모두 읽음 처리 함수
export async function markAllNotificationsAsRead() {
    const unreadNotis = (State.appState.notifications || []).filter(n => !n.isRead);
    if(unreadNotis.length === 0) return;
    
    try {
        const batch = writeBatch(State.db);
        unreadNotis.forEach(n => {
            const ref = doc(State.db, 'artifacts', 'team-work-logger-v2', 'notifications', n.id);
            batch.update(ref, { isRead: true, readAt: new Date().toISOString() });
        });
        await batch.commit();
    } catch(e) {
        console.error("일괄 읽음 처리 실패:", e);
    }
}

// 알림 관련 모달 및 이벤트 설정
export function setupNotificationListeners() {
    const notiModal = document.getElementById('notification-modal');
    const bellPc = document.getElementById('notification-bell-btn');
    const bellMobile = document.getElementById('notification-bell-btn-mobile');
    const closeNoti = document.getElementById('close-notification-modal-btn');
    
    function toggleNotiModal() {
        if (!notiModal) return;
        notiModal.classList.toggle('hidden');
        if (!notiModal.classList.contains('hidden')) {
            renderNotificationList();
        }
    }
    
    bellPc?.addEventListener('click', toggleNotiModal);
    bellMobile?.addEventListener('click', toggleNotiModal);
    closeNoti?.addEventListener('click', () => notiModal?.classList.add('hidden'));
    
    document.getElementById('read-all-noti-btn')?.addEventListener('click', markAllNotificationsAsRead);
    
    document.getElementById('clear-all-noti-btn')?.addEventListener('click', async () => {
        if (!State.appState.notifications || State.appState.notifications.length === 0) return;
        if (!confirm('모든 알림을 삭제하시겠습니까?')) return;
        
        try {
            const batch = writeBatch(State.db);
            State.appState.notifications.forEach(n => {
                batch.delete(doc(State.db, 'artifacts', 'team-work-logger-v2', 'notifications', n.id));
            });
            await batch.commit();
        } catch(e) {
            console.error('알림 전체 삭제 실패:', e);
        }
    });

    document.getElementById('notification-list')?.addEventListener('click', async (e) => {
        if(e.target.classList.contains('delete-single-noti-btn')) {
            const id = e.target.dataset.id;
            try {
                await deleteDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'notifications', id));
            } catch(err) {
                console.error("개별 알림 삭제 실패:", err);
            }
        }
    });

    // 🔥 [신규] '쪽지 보내기' 관련 이벤트 리스너
    const openSendMsgBtn = document.getElementById('open-send-msg-btn');
    const closeSendMsgBtn = document.getElementById('close-send-msg-btn');
    const sendMsgModal = document.getElementById('send-message-modal');
    const sendMsgSubmitBtn = document.getElementById('send-msg-submit-btn');
    
    openSendMsgBtn?.addEventListener('click', () => {
        const select = document.getElementById('msg-target-select');
        select.innerHTML = '<option value="">대상을 선택하세요...</option>';
        
        const members = new Set();
        (State.appConfig?.teamGroups || []).forEach(g => g.members?.forEach(m => members.add(m)));
        (State.appState?.partTimers || []).forEach(p => members.add(p.name));
        
        Array.from(members).sort().forEach(m => {
            if (m !== State.appState.currentUser) {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                select.appendChild(opt);
            }
        });

        document.getElementById('msg-content-input').value = '';
        sendMsgModal?.classList.remove('hidden');
    });

    closeSendMsgBtn?.addEventListener('click', () => {
        sendMsgModal?.classList.add('hidden');
    });

    sendMsgSubmitBtn?.addEventListener('click', async () => {
        const target = document.getElementById('msg-target-select').value;
        const text = document.getElementById('msg-content-input').value.trim();
        
        if (!target) return showToast('받는 사람을 선택해주세요.', true);
        if (!text) return showToast('메시지 내용을 입력해주세요.', true);
        
        const sender = State.appState.currentUser || '관리자';
        const finalMsg = `✉️ [${sender}님의 쪽지]\n${text}`;

        const originalBtnText = sendMsgSubmitBtn.textContent;
        sendMsgSubmitBtn.disabled = true;
        sendMsgSubmitBtn.textContent = '전송 중...';

        await sendNotification(target, finalMsg, 'message');
        
        showToast(`${target}님에게 쪽지를 성공적으로 보냈습니다.`);
        sendMsgModal?.classList.add('hidden');
        
        sendMsgSubmitBtn.disabled = false;
        sendMsgSubmitBtn.textContent = originalBtnText;
    });
}