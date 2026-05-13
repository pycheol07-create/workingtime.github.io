// === js/app-sync.js ===
import * as State from './state.js';
import * as DOM from './dom-elements.js';
import { getTodayDateString, showToast } from './utils.js';
// 🚨 deleteDoc 추가 임포트
import { doc, onSnapshot, collection, query, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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
        
        let isInitialLoad = true;

        if (unsubscribeNotifications) unsubscribeNotifications();
        unsubscribeNotifications = onSnapshot(notiQuery, (snapshot) => {
            const notifications = [];
            let unreadCount = 0;
            
            // ✨ 알림 15일 경과 기준 (15일 * 24시간 * 60분 * 60초 * 1000밀리초)
            const now = Date.now();
            const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
            
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' && !isInitialLoad) {
                    const data = change.doc.data();
                    if (!data.isRead) {
                        showToast(`🔔 새 알림이 도착했습니다.`);
                        
                        const modal = document.getElementById('notification-modal');
                        if (modal && modal.classList.contains('hidden')) {
                            modal.classList.remove('hidden'); 
                        }
                    }
                }
            });

            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                data.id = docSnap.id;
                
                // ✨ 15일이 경과한 알림은 파이어베이스 DB에서 완전히 자동 삭제
                const createdAtTime = new Date(data.createdAt).getTime();
                if (now - createdAtTime > FIFTEEN_DAYS_MS) {
                    deleteDoc(doc(State.db, 'artifacts', 'team-work-logger-v2', 'notifications', data.id))
                        .catch(e => console.error("알림 자동 삭제 실패:", e));
                    return; // 로컬 배열(화면)에는 담지 않음
                }

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

            isInitialLoad = false;
        });
    }
}