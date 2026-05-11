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
        
        // 이전에 수정한 검수 리스트 불러오기 로직
        State.appState.inspectionList = data.inspectionList || []; 

        // 🔥 [해결 완료] 누락되었던 당일 근태(지각, 외출, 조퇴) 불러오기 로직 추가!
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
        
        if (unsubscribeNotifications) unsubscribeNotifications();
        unsubscribeNotifications = onSnapshot(notiQuery, (snapshot) => {
            const notifications = [];
            let unreadCount = 0;
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
            
            const modal = document.getElementById('notification-modal');
            if (modal && !modal.classList.contains('hidden')) renderNotificationList();
        });
    }
}