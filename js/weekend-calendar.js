// === js/weekend-calendar.js ===
import * as State from './state.js';
import { store, currentManageDateStr } from './weekend-store.js';
import { showToast } from './utils.js';
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderWeekendStats, renderWeekendList, renderWeekendGrid } from './weekend-ui.js';
import { processSelectedDatesBulkAction, populatePastDateAddSelect, renderPastDateMembers } from './weekend-admin.js';

// 현재 뷰 상태 저장용 변수
let currentViewMode = 'list'; // 'list' or 'calendar'

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

    // 🔥 [추가] 뷰 전환 버튼 이벤트 리스너 설정
    const btnList = document.getElementById('view-toggle-list');
    const btnCalendar = document.getElementById('view-toggle-calendar');

    if (btnList && btnCalendar) {
        btnList.addEventListener('click', () => setViewMode('list'));
        btnCalendar.addEventListener('click', () => setViewMode('calendar'));
    }
}

// 🔥 [추가] 뷰 전환 및 UI 업데이트 함수
function setViewMode(mode) {
    currentViewMode = mode;
    const btnList = document.getElementById('view-toggle-list');
    const btnCalendar = document.getElementById('view-toggle-calendar');
    const viewList = document.getElementById('weekend-list-view');
    const viewCalendar = document.getElementById('weekend-calendar-view');
    const bulkBar = document.getElementById('admin-bulk-action-bar');

    if (mode === 'list') {
        btnList.className = 'px-2 py-1 text-xs font-bold bg-blue-50 text-blue-600';
        btnCalendar.className = 'px-2 py-1 text-xs font-bold bg-white text-gray-500 hover:bg-gray-50';
        viewList.classList.remove('hidden');
        viewCalendar.classList.add('hidden');
        
        // 리스트 뷰에서만 일괄 선택 메뉴 표시 (관리자인 경우 renderWeekendList에서 처리됨)
        renderWeekendList(store.currentYear, store.currentMonth);
    } else {
        btnList.className = 'px-2 py-1 text-xs font-bold bg-white text-gray-500 hover:bg-gray-50';
        btnCalendar.className = 'px-2 py-1 text-xs font-bold bg-blue-50 text-blue-600';
        viewList.classList.add('hidden');
        viewCalendar.classList.remove('hidden');
        viewCalendar.classList.add('flex');
        
        // 캘린더 뷰에서는 일괄 처리 바를 숨김
        if (bulkBar) {
            bulkBar.classList.add('hidden');
            bulkBar.classList.remove('flex');
        }

        renderWeekendGrid(store.currentYear, store.currentMonth);
    }
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
            
            // 🔥 [추가] 현재 활성화된 뷰에 따라 다르게 렌더링 호출
            if (currentViewMode === 'list') {
                renderWeekendList(year, month);
            } else {
                renderWeekendGrid(year, month);
            }
            
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

export { currentManageDateStr } from './weekend-store.js';
export * from './weekend-core.js';
export * from './weekend-admin.js';
export * from './weekend-ui.js';