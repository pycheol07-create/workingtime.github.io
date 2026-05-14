// === js/app-sync.js ===
import * as State from './state.js';
import * as DOM from './dom-elements.js';
import { getTodayDateString, showToast } from './utils.js';
import { doc, onSnapshot, collection, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderDashboardLayout, renderTaskSelectionModal } from './ui.js';
import { renderTodoList } from './inspection-logic.js';
import { renderNotificationList } from './app-notifications.js';

// 🔥 리스너 추적을 위한 로컬 변수 선언 (유령 리스너 사살용)
let unsubLeave = null;
let unsubConfig = null;
let unsubToday = null;
let unsubWorkRecords = null;
export let unsubscribeNotifications = null;

export function setupFirebaseListeners(renderCallback, markDirtyCallback) {
    // 🚨 핵심 방어막: 기존에 살아있던 유령 리스너들을 모조리 쏴서 죽임 (중복 읽기 과금 원천 차단!)
    if (unsubLeave) { unsubLeave(); unsubLeave = null; }
    if (unsubConfig) { unsubConfig(); unsubConfig = null; }
    if (unsubToday) { unsubToday(); unsubToday = null; }
    if (unsubWorkRecords) { unsubWorkRecords(); unsubWorkRecords = null; }
    if (unsubscribeNotifications) { unsubscribeNotifications(); unsubscribeNotifications = null; }

    const leaveScheduleDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'leaveSchedule');
    unsubLeave = onSnapshot(leaveScheduleDocRef, (docSnap) => {
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
    });

    const configDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'config', 'mainConfig');
    unsubConfig = onSnapshot(configDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const loadedConfig = docSnap.data();
            const mergedConfig = { ...State.appConfig, ...loadedConfig };
            
            if (Array.isArray(loadedConfig.taskGroups)) mergedConfig.taskGroups = loadedConfig.taskGroups;
            State.setAppConfig(mergedConfig); 

            renderDashboardLayout(State.appConfig);
            renderTaskSelectionModal(State.appConfig.taskGroups);
            renderCallback();
        }
    });

    const todayDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
    unsubToday = onSnapshot(todayDocRef, (docSnap) => {
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
    });
    
    const workRecordsCollectionRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords');
    unsubWorkRecords = onSnapshot(workRecordsCollectionRef, (querySnapshot) => {
        State.appState.workRecords = [];
        querySnapshot.forEach(doc => State.appState.workRecords.push(doc.data()));
        State.appState.workRecords.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
        renderCallback();
        if (DOM.connectionStatusEl) DOM.connectionStatusEl.textContent = '동기화 (업무)';
    });

    if (State.appState.currentUser) {
        const notiColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'notifications');
        const d = new Date();
        d.setDate(d.getDate() - 15);
        const fifteenDaysAgoStr = d.toISOString();

        const notiQuery = query(
            notiColRef, 
            where("targetMember", "==", State.appState.currentUser),
            where("createdAt", ">=", fifteenDaysAgoStr) 
        );
        
        let isInitialLoad = true;

        unsubscribeNotifications = onSnapshot(notiQuery, (snapshot) => {
            const notifications = [];
            let unreadCount = 0;
            
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