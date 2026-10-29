// === js/app-notifications.js ===
import * as State from './state.js?v=202610291723';
import { doc, writeBatch, deleteDoc, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showToast, escapeHtml, getActiveTeamMembers } from './utils.js?v=202610291723';
import { sortUnreadFirst, addDismissed } from './lib/noti-popup.js?v=202610291723';

// 알림창에 지금 보이는 안 읽은 알림 id — 창을 닫을 때(×·배경·종·ESC) '닫은 것'으로 기억해
// 같은 알림으로 창이 다시 저절로 열리지 않게 한다(js/app-sync.js 자동 열기 · js/lib/noti-popup.js).
let shownUnreadIds = [];

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
        return true;
    } catch(e) {
        console.error("알림 발송 실패", e);
        return false;   // 부르는 쪽이 실패한 사람을 셀 수 있게
    }
}

export function renderNotificationList() {
    const list = document.getElementById('notification-list');
    if (!list) return;
    // 안 읽은 것 위로(그 안에서 최신순)
    const notis = sortUnreadFirst(State.appState.notifications || []);
    shownUnreadIds = notis.filter(n => !n.isRead).map(n => n.id);
    if (notis.length === 0) {
        list.innerHTML = '<li class="text-center text-gray-400 dark:text-gray-500 py-8 text-sm">알림이 없습니다.</li>';
        return;
    }
    
    // 안 읽은 것은 굵은 파란 테두리 + 왼쪽 띠 + NEW 표시(다크 모드 포함)
    list.innerHTML = notis.map(n => `
        <li class="p-3 rounded-lg ${n.isRead ? 'border bg-gray-50 border-gray-200 dark:bg-gray-700/50 dark:border-gray-600 text-gray-500 dark:text-gray-400 shadow-sm' : 'border-2 border-l-[6px] bg-blue-50 border-blue-500 dark:bg-blue-900/40 dark:border-blue-400 text-gray-900 dark:text-gray-100 shadow-md'} relative pr-8">
            <div class="text-[11px] font-bold mb-1 flex items-center gap-1.5">${n.isRead ? '' : '<span class="px-1.5 rounded bg-blue-600 dark:bg-blue-500 text-white text-[10px] font-extrabold tracking-wide">NEW</span>'}<span class="opacity-70">${new Date(n.createdAt).toLocaleString('ko-KR', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</span></div>
            <div class="text-sm font-medium leading-snug break-words whitespace-pre-line">${escapeHtml(n.message)}</div>
            <button class="absolute top-2 right-2 text-gray-400 hover:text-red-500 font-bold text-lg delete-single-noti-btn transition" data-id="${n.id}">&times;</button>
        </li>
    `).join('');
}

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
    // 배경(창 바깥 어두운 부분)을 누르면 닫는다 — 누르기 시작한 곳도 배경일 때만(창 안에서 끌다가 바깥에서 놓으면 닫지 않는다).
    // pointerdown 이라 마우스·터치·펜 모두 같다.
    let downOnBackdrop = false;
    notiModal?.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === notiModal; });
    notiModal?.addEventListener('click', (e) => {
        const ok = downOnBackdrop && e.target === notiModal;
        downOnBackdrop = false;
        if (ok) notiModal.classList.add('hidden');
    });
    // 어떤 길로 닫히든(×·배경·종·ESC — js/modal-esc.js) 그때 보이던 안 읽은 알림을 '닫은 것'으로 기억한다(이 탭에서만, id 만).
    if (notiModal) {
        let wasOpen = !notiModal.classList.contains('hidden');
        new MutationObserver(() => {
            const open = !notiModal.classList.contains('hidden');
            if (wasOpen && !open && shownUnreadIds.length) addDismissed(shownUnreadIds);
            wasOpen = open;
        }).observe(notiModal, { attributes: true, attributeFilter: ['class'] });
    }
    
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

    // 🔥 쪽지 보내기 관련 이벤트 리스너 수정 (다중/전체 선택 기능)
    const openSendMsgBtn = document.getElementById('open-send-msg-btn');
    const closeSendMsgBtn = document.getElementById('close-send-msg-btn');
    const sendMsgModal = document.getElementById('send-message-modal');
    const sendMsgSubmitBtn = document.getElementById('send-msg-submit-btn');
    
    openSendMsgBtn?.addEventListener('click', () => {
        const listContainer = document.getElementById('msg-target-list');
        const selectAllCb = document.getElementById('msg-target-select-all');
        
        if (listContainer) listContainer.innerHTML = '';
        if (selectAllCb) selectAllCb.checked = false;
        
        const members = new Set();
        getActiveTeamMembers(State.appConfig).forEach(m => members.add(m));   // 퇴사자(퇴사일 다음 날부터) 제외
        (State.appState?.partTimers || []).forEach(p => members.add(p.name));
        
        Array.from(members).sort().forEach(m => {
            if (m !== State.appState.currentUser) {
                const label = document.createElement('label');
                label.className = 'flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-600 p-1.5 rounded-md transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-500';
                label.innerHTML = `<input type="checkbox" value="${escapeHtml(m)}" class="msg-target-checkbox w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 bg-white dark:bg-gray-800 cursor-pointer"> <span class="truncate font-medium">${escapeHtml(m)}</span>`;
                if (listContainer) listContainer.appendChild(label);
            }
        });

        document.getElementById('msg-content-input').value = '';
        sendMsgModal?.classList.remove('hidden');
    });

    // "전체 선택" 묶음 처리 로직
    const selectAllCb = document.getElementById('msg-target-select-all');
    const listContainer = document.getElementById('msg-target-list');
    
    if (selectAllCb && listContainer) {
        selectAllCb.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            listContainer.querySelectorAll('.msg-target-checkbox').forEach(cb => cb.checked = isChecked);
        });

        listContainer.addEventListener('change', (e) => {
            if (e.target.classList.contains('msg-target-checkbox')) {
                const allCbs = listContainer.querySelectorAll('.msg-target-checkbox');
                const allChecked = Array.from(allCbs).every(cb => cb.checked);
                selectAllCb.checked = allChecked;
            }
        });
    }

    closeSendMsgBtn?.addEventListener('click', () => {
        sendMsgModal?.classList.add('hidden');
    });

    sendMsgSubmitBtn?.addEventListener('click', async () => {
        const selectedCbs = document.querySelectorAll('.msg-target-checkbox:checked');
        const targets = Array.from(selectedCbs).map(cb => cb.value);
        const text = document.getElementById('msg-content-input').value.trim();
        
        if (targets.length === 0) return showToast('받는 사람을 1명 이상 선택해주세요.', true);
        if (!text) return showToast('메시지 내용을 입력해주세요.', true);
        
        const sender = State.appState.currentUser || '관리자';
        const finalMsg = `✉️ [${sender}님의 쪽지]\n${text}`;

        const originalBtnHtml = sendMsgSubmitBtn.innerHTML;   // 아이콘까지 되돌리려고 innerHTML 로 보관
        sendMsgSubmitBtn.disabled = true;
        sendMsgSubmitBtn.textContent = '전송 중...';

        try {
            // 여러 명에게 병렬로 알림 발송 — sendNotification 은 실패해도 던지지 않고 false 를 준다
            const results = await Promise.all(targets.map(target => sendNotification(target, finalMsg, 'message')));
            const failed = targets.filter((_, i) => !results[i]);

            if (failed.length === 0) {
                showToast(`${targets.length}명에게 쪽지를 성공적으로 보냈습니다.`);
                sendMsgModal?.classList.add('hidden');
            } else {
                // 실패한 사람만 체크로 남겨 두고 창은 열어 둔다 — 그대로 다시 누르면 재발송
                showToast(`${targets.length - failed.length}명 성공, ${failed.length}명 실패 — 실패한 사람만 선택해 두었습니다.`, true);
                selectedCbs.forEach(cb => { if (!failed.includes(cb.value)) cb.checked = false; });
                if (selectAllCb) selectAllCb.checked = false;
            }
        } catch (e) {
            showToast('쪽지 발송 중 오류가 발생했습니다.', true);
            console.error(e);
        } finally {
            sendMsgSubmitBtn.disabled = false;
            sendMsgSubmitBtn.innerHTML = originalBtnHtml;
        }
    });
}