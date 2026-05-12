// === js/app-sync.js ===
import * as State from './state.js';
import * as DOM from './dom-elements.js';
import { getTodayDateString, showToast } from './utils.js';
import { doc, onSnapshot, collection, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderDashboardLayout, renderTaskSelectionModal } from './ui.js';
import { renderTodoList } from './inspection-logic.js';
import { renderNotificationList } from './app-notifications.js';

export let unsubscribeNotifications = null;

export function setupFirebaseListeners(renderCallback, markDirtyCallback) {
    // 1. 근태 일정 실시간 리스너
    const leaveScheduleDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
    State.setUnsubscribeLeaveSchedule(onSnapshot(leaveScheduleDocRef, (docSnap) => {
        State.setPersistentLeaveSchedule(docSnap.exists() ? docSnap.data() : { onLeaveMembers: [] });
        const today = getTodayDateString();
        const leaves = State.persistentLeaveSchedule.onLeaveMembers || [];
        
        State.appState.dateBasedOnLeaveMembers = leaves.filter(entry => {
            if (['연차', '출장', '결근', '매장근무', '재택근무', '휴직', '외근'].includes(entry.type)) {
                const endDate = entry.endDate || entry.startDate;
                return entry.startDate && typeof entry.startDate === 'string' &&
                    today >= entry.startDate && today <= (endDate || entry.startDate);
            }
            return false;
        });
        markDirtyCallback();
        renderCallback();
    }));

    // 2. 환경 설정 실시간 리스너
    const configDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
    State.setUnsubscribeConfig(onSnapshot(configDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const loadedConfig = docSnap.data();
            const mergedConfig = { ...State.appConfig, ...loadedConfig };
            
            if (Array.isArray(loadedConfig.taskGroups)) mergedConfig.taskGroups = loadedConfig.taskGroups;
            State.setAppConfig(mergedConfig); 

            renderDashboardLayout(State.appConfig);
            renderTaskSelectionModal(State.appConfig.taskGroups);
            renderCallback();
        }
    }));

    // 3. 일일 데이터(오늘) 실시간 리스너
    const todayDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
    State.setUnsubscribeToday(onSnapshot(todayDocRef, (docSnap) => {
        const data = docSnap.exists() ? docSnap.data() : {};
        State.appState.taskQuantities = { ...data.taskQuantities };
        State.appState.partTimers = data.partTimers || [];
        State.appState.hiddenGroupIds = data.hiddenGroupIds || [];
        State.appState.dailyAttendance = data.dailyAttendance || {};
        State.appState.lunchPauseExecuted = data.lunchPauseExecuted ?? false;
        State.appState.lunchResumeExecuted = data.lunchResumeExecuted ?? false;
        
        State.appState.inspectionList = data.inspectionList || []; 
        State.appState.dailyOnLeaveMembers = data.onLeaveMembers || [];

        State.setIsDataDirty(false); 
        renderCallback();
        renderTodoList();
        
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '동기화 (메타)';
        if (DOM.statusDotEl) DOM.statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
    }));
    
    // 4. 업무 기록 실시간 리스너
    const workRecordsCollectionRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords');
    State.setUnsubscribeWorkRecords(onSnapshot(workRecordsCollectionRef, (querySnapshot) => {
        State.appState.workRecords = [];
        querySnapshot.forEach(doc => State.appState.workRecords.push(doc.data()));
        State.appState.workRecords.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
        renderCallback();
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '동기화 (업무)';
    }));

    // 5. 알림 실시간 리스너
    if (State.appState.currentUser) {
        const notiColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications');
        const notiQuery = query(notiColRef, where("targetMember", "==", State.appState.currentUser));
        
        let isInitialLoad = true; // 🔥 처음 로그인 시 과거 알림들로 인해 팝업이 뜨는 것을 방지

        if (unsubscribeNotifications) unsubscribeNotifications();
        unsubscribeNotifications = onSnapshot(notiQuery, (snapshot) => {
            const notifications = [];
            let unreadCount = 0;
            
            // 🔥 [신규] 새로운 알림(added)이 수신되었을 때 화면에 팝업창을 강제로 띄움
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' && !isInitialLoad) {
                    const data = change.doc.data();
                    // 읽지 않은 새 알림일 경우에만 팝업 표시
                    if (!data.isRead) {
                        showToast(`🔔 새 알림이 도착했습니다.`);
                        
                        const modal = document.getElementById('notification-modal');
                        if (modal && modal.classList.contains('hidden')) {
                            modal.classList.remove('hidden'); // 알림 센터 팝업 열기
                        }
                    }
                }
            });

            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                data.id = docSnap.id;
                notifications.push(data);
                if (!data.isRead) unreadCount++;
            });
            
            notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            State.appState.notifications = notifications;
            
            document.querySelectorAll('.notification-badge').forEach(badge => {
                unreadCount > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
            });
            
            // 모달이 열려있는 상태라면 내부 리스트를 갱신
            const modal = document.getElementById('notification-modal');
            if (modal && !modal.classList.contains('hidden')) renderNotificationList();

            isInitialLoad = false; // 첫 동기화 완료 처리
        });
    }
}