// === js/weekend-calendar.js ===
import * as State from './state.js';
import { store, currentManageDateStr } from './weekend-store.js';
import { showToast } from './utils.js';
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderWeekendStats, renderWeekendList } from './weekend-ui.js';
import { processSelectedDatesBulkAction, populatePastDateAddSelect, renderPastDateMembers } from './weekend-admin.js';

export async function initWeekendCalendar() {
    await loadWeekendRequests(store.currentYear, store.currentMonth);

    const selectAllCb = document.getElementById('select-all-dates-checkbox');
    if (selectAllCb) {
        selectAllCb.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.date-select-checkbox').forEach(cb => cb.checked = isChecked);
        });
    }

    const bulkConfirmBtn = document.getElementById('bulk-confirm-btn');
    if (bulkConfirmBtn) bulkConfirmBtn.onclick = () => processSelectedDatesBulkAction('confirmed');
    
    const bulkCancelBtn = document.getElementById('bulk-cancel-btn');
    if (bulkCancelBtn) bulkCancelBtn.onclick = () => processSelectedDatesBulkAction('canceled');
    
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    if (bulkDeleteBtn) bulkDeleteBtn.onclick = () => processSelectedDatesBulkAction('delete');
}

export function changeMonth(offset) {
    store.currentMonth += offset;
    if (store.currentMonth > 11) {
        store.currentMonth = 0;
        store.currentYear++;
    } else if (store.currentMonth < 0) {
        store.currentMonth = 11;
        store.currentYear--;
    }
    loadWeekendRequests(store.currentYear, store.currentMonth);
}

async function loadWeekendRequests(year, month) {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    if (store.unsubscribe) {
        store.unsubscribe();
        store.unsubscribe = null;
    }

    try {
        const startOfYear = `${year}-01-01`;
        const endOfYear = `${year}-12-31`;
        
        const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests');
        const q = query(colRef, where("date", ">=", startOfYear), where("date", "<=", endOfYear));

        store.unsubscribe = onSnapshot(q, (snapshot) => {
            store.myRequestsMap.clear();
            store.blockedDatesSet.clear();
            store.capacityMap.clear(); 
            store.requestsByDate = {};
            
            const memberStats = new Map(); 
            const yearlyStatsMap = new Map(); 
            const excludedMembers = ['박영철', '박호진', '유아라', '이승운'];

            if (State.appConfig && State.appConfig.teamGroups) {
                State.appConfig.teamGroups.forEach(group => {
                    if (group.members && Array.isArray(group.members)) {
                        group.members.forEach(member => {
                            if (!excludedMembers.includes(member)) {
                                memberStats.set(member, { confirmed: 0, requested: 0 });
                                yearlyStatsMap.set(member, 0); 
                            }
                        });
                    }
                });
            }

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                
                if (data.type === 'blocked') {
                    if (data.month === monthStr) store.blockedDatesSet.add(data.date);
                } else if (data.type === 'capacity') {
                    if (data.month === monthStr) store.capacityMap.set(data.date, data.capacity);
                } else {
                    if (data.status === 'confirmed' && !excludedMembers.includes(data.member)) {
                        yearlyStatsMap.set(data.member, (yearlyStatsMap.get(data.member) || 0) + 1);
                    }

                    if (data.month === monthStr) {
                        if (!store.requestsByDate[data.date]) store.requestsByDate[data.date] = [];
                        store.requestsByDate[data.date].push({ id: docSnap.id, ...data });

                        if (data.member === State.appState.currentUser) {
                            store.myRequestsMap.set(data.date, docSnap.id);
                        }

                        if (!excludedMembers.includes(data.member)) {
                            const stat = memberStats.get(data.member) || { confirmed: 0, requested: 0 };
                            if (data.status === 'confirmed') stat.confirmed++;
                            else if (data.status === 'requested') stat.requested++;
                            memberStats.set(data.member, stat);
                        }
                    }
                }
            });

            store.currentYearlyStats = new Map(yearlyStatsMap);
            store.currentMonthStats = new Map(memberStats);

            renderWeekendStats(memberStats, yearlyStatsMap);
            renderWeekendList(year, month);
            
            const pastPopup = document.getElementById('past-date-edit-popup');
            if (pastPopup && !pastPopup.classList.contains('hidden') && currentManageDateStr) {
                populatePastDateAddSelect(currentManageDateStr);
                renderPastDateMembers(currentManageDateStr);
            }

        }, (error) => {
            console.error("Error in weekend listener:", error);
            showToast("실시간 데이터를 불러오지 못했습니다.", true);
        });

    } catch (e) {
        console.error("Error setting up listener:", e);
    }
}

// 🚀 [중요] 기존 파일들(listeners-weekend.js 등)이 깨지지 않도록 모든 함수를 재수출합니다.
export { currentManageDateStr } from './weekend-store.js';
export * from './weekend-core.js';
export * from './weekend-admin.js';
export * from './weekend-ui.js';