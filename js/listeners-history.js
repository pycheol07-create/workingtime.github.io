// === js/listeners-history.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

import { setupHistoryDownloadListeners, openDownloadFormatModal } from './listeners-history-download.js';
import { setupHistoryRecordListeners } from './listeners-history-records.js';
import { setupHistoryAttendanceListeners } from './listeners-history-attendance.js';
import { setupHistoryInspectionListeners, fetchAndRenderInspectionHistory } from './listeners-history-inspection.js';

import { renderTrendAnalysisCharts, trendCharts } from './ui.js';
import { loadAndRenderHistoryList, renderHistoryDetail, switchHistoryView, renderHistoryDateListByMode, openHistoryQuantityModal, augmentHistoryWithPersistentLeave } from './app-history-logic.js';
import { renderAttendanceDailyHistory, renderAttendanceWeeklyHistory, renderAttendanceMonthlyHistory, renderReportDaily, renderReportWeekly, renderReportMonthly, renderReportYearly, renderPersonalReport, renderManagementDaily, renderManagementSummary, renderWeeklyHistory, renderMonthlyHistory, renderPredictionTab } from './ui-history.js';
import * as UILeave from './ui-history-leave.js';
import { syncTodayToHistory, saveManagementData } from './history-data-manager.js';
import { doc, updateDoc, deleteField, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let isHistoryMaximized = false;

let currentWeekendStatsData = [];
let currentWeekendTotalCost = 0;
let currentWeekendTotalCount = 0;
let currentWeekendMonthStr = "";

// 💡 주말 통계 전용 정렬 및 필터 상태 관리
let weekendSortState = { key: 'count', dir: 'desc' };
let weekendFilterState = { name: '' };

const getSortIcon = (currentKey, currentDir, targetKey) => {
    if (currentKey !== targetKey) return '<span class="text-gray-300 text-[10px] ml-1 opacity-0 group-hover:opacity-50">↕</span>';
    return currentDir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

const getFilterDropdown = (key, currentFilterValue) => {
    if (!State.context) State.context = {};
    const dropdownId = `weekend-filter-${key}`; 
    const isActive = State.context.activeFilterDropdown === dropdownId;
    const hasValue = currentFilterValue && currentFilterValue !== '';
    const iconColorClass = hasValue ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-200';

    return `
        <div class="relative inline-block ml-1 filter-container">
            <button type="button" class="filter-icon-btn p-1 rounded transition ${iconColorClass}" data-dropdown-id="${dropdownId}" title="필터">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clip-rule="evenodd" />
                </svg>
            </button>
            <div class="filter-dropdown absolute top-full right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-[60] p-3 ${isActive ? 'block' : 'hidden'} text-left cursor-default font-normal text-gray-800">
                <div class="text-xs font-bold text-gray-500 mb-2 flex justify-between items-center">
                    <span>이름 검색</span>
                    ${hasValue ? `<button type="button" class="text-[10px] text-red-500 hover:underline" onclick="const i=this.closest('.filter-dropdown').querySelector('input'); i.value=''; i.dispatchEvent(new Event('input', {bubbles:true}));">지우기</button>` : ''}
                </div>
                <input type="text" class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                       placeholder="이름 입력..." value="${currentFilterValue || ''}" data-filter-key="${key}" autocomplete="off">
            </div>
        </div>
    `;
};

async function loadAndRenderWeekendStats() {
    const tbody = document.getElementById('weekend-history-table-body');
    const monthPicker = document.getElementById('weekend-stats-month-picker');
    if (!tbody || !monthPicker) return;

    const table = tbody.closest('table');
    let thead = table.querySelector('thead');
    if (!thead) {
        thead = document.createElement('thead');
        table.insertBefore(thead, tbody);
    }

    if (!currentWeekendStatsData.length || currentWeekendMonthStr !== monthPicker.value) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-blue-500 font-bold">데이터를 불러오는 중입니다...</td></tr>`;

        if (!monthPicker.value) {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            monthPicker.value = `${y}-${m}`;
        }

        currentWeekendMonthStr = monthPicker.value;
        const [year, month] = currentWeekendMonthStr.split('-');
        const startDate = `${currentWeekendMonthStr}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${currentWeekendMonthStr}-${lastDay}`;

        try {
            const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'weekend_requests');
            const q = query(colRef, where("date", ">=", startDate), where("date", "<=", endDate));
            const snap = await getDocs(q);

            const stats = new Map(); 
            let totalCount = 0;

            snap.forEach(doc => {
                const data = doc.data();
                if (data.status === 'confirmed') {
                    if (!stats.has(data.member)) stats.set(data.member, { count: 0, dates: [] });
                    const st = stats.get(data.member);
                    st.count++;
                    st.dates.push(data.date);
                    totalCount++;
                }
            });

            currentWeekendStatsData = [...stats.entries()];
            currentWeekendTotalCount = totalCount;

        } catch (e) {
            console.error("주말 통계 불러오기 오류:", e);
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-red-500 font-bold">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>`;
            return;
        }
    }

    // 💡 엑셀 스타일의 정렬/필터 헤더 렌더링
    thead.innerHTML = `
        <tr class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
            <th class="px-6 py-4 w-20 text-center font-bold text-gray-500 border-r border-gray-100 select-none">순위</th>
            <th class="px-6 py-4 w-40 cursor-pointer hover:bg-gray-200 transition select-none group relative" data-sort-key="name">
                <div class="flex items-center justify-between font-bold">
                    <span class="flex items-center">이름 ${getSortIcon(weekendSortState.key, weekendSortState.dir, 'name')}</span>
                    ${getFilterDropdown('name', weekendFilterState.name)}
                </div>
            </th>
            <th class="px-6 py-4 w-32 cursor-pointer hover:bg-gray-200 transition select-none group relative" data-sort-key="count">
                <div class="flex items-center justify-center font-bold">
                    확정 횟수 ${getSortIcon(weekendSortState.key, weekendSortState.dir, 'count')}
                </div>
            </th>
            <th class="px-6 py-4 w-40 cursor-pointer hover:bg-gray-200 transition select-none group relative" data-sort-key="cost">
                <div class="flex items-center justify-end font-bold">
                    정산 비용 ${getSortIcon(weekendSortState.key, weekendSortState.dir, 'cost')}
                </div>
            </th>
            <th class="px-6 py-4 font-bold text-gray-500 text-center select-none">근무 일자</th>
        </tr>
    `;

    let filteredData = [...currentWeekendStatsData];
    
    if (weekendFilterState.name) {
        filteredData = filteredData.filter(([name]) => name.includes(weekendFilterState.name));
    }

    filteredData.sort((a, b) => {
        let valA, valB;
        if (weekendSortState.key === 'name') {
            valA = a[0]; valB = b[0];
        } else { // count, cost
            valA = a[1].count; valB = b[1].count; 
        }

        if (valA < valB) return weekendSortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return weekendSortState.dir === 'asc' ? 1 : -1;
        
        return a[0].localeCompare(b[0]);
    });

    tbody.innerHTML = '';
    let totalCost = 0;
    const COST_PER_TIME = 110000;

    if (filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-gray-400 font-medium">검색 결과가 없습니다.</td></tr>`;
    } else {
        filteredData.forEach(([name, data], idx) => {
            data.dates.sort();
            const cost = data.count * COST_PER_TIME;
            totalCost += cost;
            
            const tr = document.createElement('tr');
            tr.className = "hover:bg-blue-50/50 transition-colors bg-white";
            tr.innerHTML = `
                <td class="px-6 py-4 text-center font-bold text-gray-400 border-r border-gray-50">${idx + 1}</td>
                <td class="px-6 py-4 font-extrabold text-gray-800">${name}</td>
                <td class="px-6 py-4 text-center font-bold text-blue-600 bg-blue-50/30">${data.count}회</td>
                <td class="px-6 py-4 text-right font-black text-gray-800">${cost.toLocaleString()} 원</td>
                <td class="px-6 py-4 text-xs font-medium text-gray-500 leading-relaxed">${data.dates.join(', ')}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    currentWeekendTotalCost = totalCost;
    const countEl = document.getElementById('weekend-total-count');
    const costEl = document.getElementById('weekend-total-cost');
    if (countEl) countEl.textContent = currentWeekendTotalCount;
    if (costEl) costEl.textContent = currentWeekendTotalCost.toLocaleString();
}

export function setupHistoryModalListeners() {
    
    setupHistoryDownloadListeners();
    setupHistoryRecordListeners();
    setupHistoryAttendanceListeners();
    setupHistoryInspectionListeners();

    const managementPanel = document.getElementById('management-panel');
    const managementTabs = document.getElementById('management-tabs');
    const managementSaveBtn = document.getElementById('management-save-btn');
    const inspectionPanel = document.getElementById('inspection-history-panel');
    const predictionPanel = document.getElementById('prediction-panel');
    const predictionDaysSelect = document.getElementById('prediction-days-select');
    const leavePanel = document.getElementById('history-leave-panel');
    const weekendPanel = document.getElementById('history-weekend-panel');

    const iconMaximize = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m0 0V4m0 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m0 0v-4m0 0l-5-5" />`;
    const iconMinimize = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />`;

    const setHistoryMaximized = (maximized) => {
        isHistoryMaximized = maximized;
        const toggleBtn = document.getElementById('toggle-history-fullscreen-btn');
        const icon = toggleBtn?.querySelector('svg');

        DOM.historyModalContentBox.removeAttribute('style');
        DOM.historyModalContentBox.dataset.hasBeenUncentered = 'false';
        
        if (maximized) {
            DOM.historyModal.classList.remove('flex', 'items-center', 'justify-center', 'p-4');
            DOM.historyModalContentBox.classList.add('fixed', 'inset-0', 'w-full', 'h-full', 'z-[150]', 'rounded-none');
            DOM.historyModalContentBox.classList.remove('relative', 'w-[1400px]', 'h-[880px]', 'rounded-2xl', 'shadow-2xl');
            if (toggleBtn) toggleBtn.title = "기본 크기로";
            if (icon) icon.innerHTML = iconMinimize;
        } else {
            DOM.historyModal.classList.add('flex', 'items-center', 'justify-center', 'p-4');
            DOM.historyModalContentBox.classList.remove('fixed', 'inset-0', 'h-full', 'z-[150]', 'rounded-none');
            DOM.historyModalContentBox.classList.add('relative', 'w-[1400px]', 'h-[880px]', 'rounded-2xl', 'shadow-2xl');
            if (toggleBtn) toggleBtn.title = "전체화면";
            if (icon) icon.innerHTML = iconMaximize;
        }
    };
    
    const styleHistoryTabs = (activeTabName) => {
        const tabsContainer = document.getElementById('history-main-tabs');
        if (!tabsContainer) return;
        
        tabsContainer.classList.remove('-mb-px');
        tabsContainer.classList.add('p-1.5', 'bg-gray-200/70', 'rounded-xl', 'inline-flex', 'items-center', 'shadow-inner');
        tabsContainer.style.gap = '0.35rem';
        
        if (tabsContainer.parentElement) {
            tabsContainer.parentElement.classList.remove('border-b', 'border-gray-200');
            tabsContainer.parentElement.classList.add('pb-4', 'pt-1');
        }

        const tabIcons = {
            'work': '📋',
            'attendance': '⏰',
            'trends': '📈',
            'prediction': '🔮',
            'report': '📊',
            'personal': '👤',
            'management': '💼',
            'inspection': '📦',
            'leave': '🏖️',
            'weekend': '📅'
        };

        document.querySelectorAll('.history-main-tab-btn').forEach(btn => {
            const tabKey = btn.dataset.mainTab;
            const pureText = btn.textContent.replace(/[^\w\s가-힣]/gi, '').trim();
            btn.innerHTML = `<span class="text-[15px] mr-1.5 opacity-90 drop-shadow-sm">${tabIcons[tabKey] || '📄'}</span><span>${pureText}</span>`;
            btn.className = 'history-main-tab-btn px-4 py-2.5 rounded-lg transition-all duration-200 whitespace-nowrap text-sm flex items-center justify-center';
            
            if (tabKey === activeTabName) {
                btn.classList.add('bg-white', 'text-blue-700', 'font-extrabold', 'shadow-md', 'border', 'border-gray-200/80', 'scale-[1.02]');
            } else {
                btn.classList.add('bg-transparent', 'text-gray-500', 'font-medium', 'border', 'border-transparent', 'hover:bg-gray-300/50', 'hover:text-gray-800');
            }
        });
    };

    const getCurrentHistoryListMode = () => {
        let activeSubTabBtn;
        if (State.context.activeMainHistoryTab === 'work') {
            activeSubTabBtn = DOM.historyTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'attendance') {
            activeSubTabBtn = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'report') {
            activeSubTabBtn = DOM.reportTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'personal') {
            activeSubTabBtn = DOM.personalReportTabs?.querySelector('button.font-semibold');
        } else if (State.context.activeMainHistoryTab === 'management') {
            activeSubTabBtn = managementTabs?.querySelector('button.font-semibold');
        }

        const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (State.context.activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');

        if (activeView.includes('yearly')) return 'year';
        if (activeView.includes('weekly')) return 'week';
        if (activeView.includes('monthly')) return 'month';
        return 'day';
    };

    const getFilteredHistoryData = () => {
        return (State.context.historyStartDate || State.context.historyEndDate)
            ? State.allHistoryData.filter(d => {
                const date = d.id;
                const start = State.context.historyStartDate;
                const end = State.context.historyEndDate;
                if (start && end) return date >= start && date <= end;
                if (start) return date >= start;
                if (end) return date <= end;
                return true;
            })
            : State.allHistoryData;
    };

    const getSelectedDateKey = () => {
        const btn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
        return btn ? btn.dataset.key : null;
    };

    const refreshAttendanceView = async () => {
        const dateKey = getSelectedDateKey();
        if (dateKey === getTodayDateString()) {
            await syncTodayToHistory();
            augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);
        }
        const filteredData = getFilteredHistoryData();
        const activeSubTabBtn = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';

        if (view === 'attendance-daily') {
            if (dateKey) renderAttendanceDailyHistory(dateKey, filteredData);
        } else if (view === 'attendance-weekly') {
             if (dateKey) renderAttendanceWeeklyHistory(dateKey, filteredData);
        } else if (view === 'attendance-monthly') {
             if (dateKey) renderAttendanceMonthlyHistory(dateKey, filteredData);
        }
    };

    const refreshReportView = () => {
        const dateKey = getSelectedDateKey();
        const filteredData = getFilteredHistoryData();
        const activeSubTabBtn = DOM.reportTabs?.querySelector('button.font-semibold');
        const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'report-daily';

        if (view === 'report-daily') renderReportDaily(dateKey, filteredData, State.appConfig, State.context);
        else if (view === 'report-weekly') renderReportWeekly(dateKey, filteredData, State.appConfig, State.context);
        else if (view === 'report-monthly') renderReportMonthly(dateKey, filteredData, State.appConfig, State.context);
        else if (view === 'report-yearly') renderReportYearly(dateKey, filteredData, State.appConfig, State.context);
    };
    
    const refreshPersonalView = () => {
        const dateKey = getSelectedDateKey();
        const activeSubTabBtn = DOM.personalReportTabs?.querySelector('button.font-semibold');
        const viewMode = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'personal-daily';
        const memberName = DOM.personalReportMemberSelect?.value;
        
        if (dateKey && memberName) {
            renderPersonalReport('personal-report-content', viewMode, dateKey, memberName, State.allHistoryData);
        }
    };

    const refreshManagementView = () => {
        const dateKey = getSelectedDateKey();
        const activeSubTabBtn = managementTabs?.querySelector('button.font-semibold');
        const viewMode = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'management-daily';
        if (!dateKey) return;

        if (viewMode === 'management-daily') {
            renderManagementDaily(dateKey, State.allHistoryData);
        } else {
            renderManagementSummary(viewMode, dateKey, State.allHistoryData);
        }
    };

    if (DOM.historyFilterBtn) {
        DOM.historyFilterBtn.addEventListener('click', () => {
            const startDate = DOM.historyStartDateInput.value;
            const endDate = DOM.historyEndDateInput.value;
            if (startDate && endDate && endDate < startDate) {
                showToast('종료일은 시작일보다 이후여야 합니다.', true); return;
            }
            State.context.historyStartDate = startDate || null;
            State.context.historyEndDate = endDate || null;
            State.context.reportSortState = {};
            renderHistoryDateListByMode(getCurrentHistoryListMode());
            showToast('이력 목록을 필터링했습니다.');
        });
    }

    if (DOM.historyClearFilterBtn) {
        DOM.historyClearFilterBtn.addEventListener('click', () => {
            DOM.historyStartDateInput.value = '';
            DOM.historyEndDateInput.value = '';
            State.context.historyStartDate = null;
            State.context.historyEndDate = null;
            State.context.reportSortState = {};
            renderHistoryDateListByMode(getCurrentHistoryListMode());
            showToast('필터를 초기화했습니다.');
        });
    }

    const monthPicker = document.getElementById('weekend-stats-month-picker');
    if (monthPicker) {
        monthPicker.addEventListener('change', () => {
            currentWeekendStatsData = []; 
            loadAndRenderWeekendStats();
        });
    }

    const downloadWeekendBtn = document.getElementById('weekend-stats-download-btn');
    if (downloadWeekendBtn) {
        downloadWeekendBtn.addEventListener('click', () => {
            if (currentWeekendStatsData.length === 0) {
                showToast('다운로드할 데이터가 없습니다.', true);
                return;
            }
            
            let csvContent = "\uFEFF"; 
            csvContent += "순위,이름,확정 횟수,정산 비용(원),근무 일자\n";
            
            const COST_PER_TIME = 110000;
            currentWeekendStatsData.forEach(([name, data], idx) => {
                const cost = data.count * COST_PER_TIME;
                const datesStr = `"${data.dates.join(', ')}"`;
                csvContent += `${idx + 1},${name},${data.count},${cost},${datesStr}\n`;
            });
            
            csvContent += `총계,-,${currentWeekendTotalCount},${currentWeekendTotalCost},-\n`;

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `주말근무_정산통계_${currentWeekendMonthStr}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showToast('엑셀(CSV) 파일이 다운로드되었습니다.');
        });
    }

    const openHistoryModalLogic = async (e) => {
        if (!State.auth || !State.auth.currentUser) {
            showToast('이력을 보려면 로그인이 필요합니다.', true);
            if (DOM.historyModal) DOM.historyModal.classList.add('hidden');
            if (DOM.loginModal) DOM.loginModal.classList.remove('hidden');
            return;
        }

        if (window.innerWidth >= 768) {
            if (e) e.preventDefault();
            window.open('history.html', '_blank');
            return;
        }

        if (DOM.historyModal) {
            DOM.historyModal.classList.remove('hidden');
            setHistoryMaximized(true); 
            if (DOM.historyStartDateInput) DOM.historyStartDateInput.value = '';
            if (DOM.historyEndDateInput) DOM.historyEndDateInput.value = '';
            State.context.historyStartDate = null;
            State.context.historyEndDate = null;
            
            styleHistoryTabs(State.context.activeMainHistoryTab || 'work');
            
            const periodExcelBtn = document.getElementById('history-download-period-excel-btn');
            if (periodExcelBtn) {
                periodExcelBtn.classList.remove('hidden');
                periodExcelBtn.classList.add('flex');
            }

            try {
                await loadAndRenderHistoryList();
            } catch (loadError) {
                console.error("이력 데이터 로딩 중 오류:", loadError);
                showToast("이력 데이터를 불러오는 중 오류가 발생했습니다.", true);
            }
        }
    };

    if (DOM.openHistoryBtn) DOM.openHistoryBtn.addEventListener('click', openHistoryModalLogic);
    if (DOM.openHistoryBtnMobile) DOM.openHistoryBtnMobile.addEventListener('click', (e) => {
        openHistoryModalLogic(e);
        if (DOM.navContent) DOM.navContent.classList.add('hidden');
    });
    if (DOM.closeHistoryBtn) DOM.closeHistoryBtn.addEventListener('click', () => {
        if (DOM.historyModal) {
            DOM.historyModal.classList.add('hidden');
            setHistoryMaximized(false);
        }
    });

    if (DOM.historyDateList) {
        DOM.historyDateList.addEventListener('click', (e) => {
            const btn = e.target.closest('.history-date-btn');
            if (btn) {
                DOM.historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
                btn.classList.add('bg-blue-100', 'font-bold');
                const dateKey = btn.dataset.key;

                let activeMainTab = State.context.activeMainHistoryTab || 'work';
                State.context.activeFilterDropdown = null; 

                if (activeMainTab === 'attendance') { refreshAttendanceView(); return; }
                else if (activeMainTab === 'management') { refreshManagementView(); return; }

                const filteredData = getFilteredHistoryData();
                State.context.reportSortState = {};

                if (activeMainTab === 'work') {
                    const activeSubTabBtn = DOM.historyTabs?.querySelector('button.font-semibold');
                    const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
                    if (activeView === 'daily') {
                        const currentIndex = filteredData.findIndex(d => d.id === dateKey);
                        const previousDayData = (currentIndex > -1 && currentIndex + 1 < filteredData.length) ? filteredData[currentIndex + 1] : null;
                        renderHistoryDetail(dateKey, previousDayData);
                    } else if (activeView === 'weekly') {
                        renderWeeklyHistory(dateKey, filteredData, State.appConfig);
                    } else if (activeView === 'monthly') {
                        renderMonthlyHistory(dateKey, filteredData, State.appConfig);
                    }
                } else if (activeMainTab === 'report') {
                    refreshReportView();
                } else if (activeMainTab === 'personal') {
                    refreshPersonalView();
                }
            }
        });
    }

    const handleTabSwitch = (e, tabsContainer) => {
        const btn = e.target.closest('button[data-view]');
        if (btn) {
            State.context.activeFilterDropdown = null;
            if (tabsContainer) {
                tabsContainer.querySelectorAll('button').forEach(b => {
                    b.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
                    b.classList.add('text-gray-500', 'hover:text-gray-700');
                });
                btn.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
                btn.classList.remove('text-gray-500', 'hover:text-gray-700');
            }
            if (tabsContainer === DOM.personalReportTabs || tabsContainer === managementTabs) {
                const viewMode = btn.dataset.view;
                let listMode = 'day';
                if(viewMode.includes('weekly')) listMode = 'week';
                if(viewMode.includes('monthly')) listMode = 'month';
                if(viewMode.includes('yearly')) listMode = 'year';
                renderHistoryDateListByMode(listMode);
            } else {
                switchHistoryView(btn.dataset.view);
            }
        }
    };

    if (DOM.historyTabs) DOM.historyTabs.addEventListener('click', (e) => switchHistoryView(e.target.closest('button[data-view]')?.dataset.view));
    if (DOM.attendanceHistoryTabs) DOM.attendanceHistoryTabs.addEventListener('click', (e) => { State.context.activeFilterDropdown = null; switchHistoryView(e.target.closest('button[data-view]')?.dataset.view); });
    if (DOM.reportTabs) DOM.reportTabs.addEventListener('click', (e) => { State.context.reportSortState = {}; State.context.activeFilterDropdown = null; switchHistoryView(e.target.closest('button[data-view]')?.dataset.view); });
    if (DOM.personalReportTabs) DOM.personalReportTabs.addEventListener('click', (e) => handleTabSwitch(e, DOM.personalReportTabs));
    if (managementTabs) managementTabs.addEventListener('click', (e) => handleTabSwitch(e, managementTabs));

    if (DOM.personalReportMemberSelect) {
        DOM.personalReportMemberSelect.addEventListener('change', (e) => {
            State.context.personalReportMember = e.target.value;
            refreshPersonalView();
        });
    }

    if (managementSaveBtn) {
        managementSaveBtn.addEventListener('click', async () => {
            const dateKey = managementSaveBtn.dataset.dateKey;
            if (!dateKey) return;
            const revenue = document.getElementById('mgmt-input-revenue')?.value.replace(/,/g, '') || 0;
            const orderCount = document.getElementById('mgmt-input-orderCount')?.value.replace(/,/g, '') || 0;
            const inventoryQty = document.getElementById('mgmt-input-inventoryQty')?.value.replace(/,/g, '') || 0;
            const inventoryAmt = document.getElementById('mgmt-input-inventoryAmt')?.value.replace(/,/g, '') || 0;

            try {
                managementSaveBtn.disabled = true;
                managementSaveBtn.textContent = '저장 중...';
                await saveManagementData(dateKey, {
                    revenue: Number(revenue), orderCount: Number(orderCount),
                    inventoryQty: Number(inventoryQty), inventoryAmt: Number(inventoryAmt)
                });
                showToast('경영 지표가 저장되었습니다.');
                refreshManagementView();
            } catch (e) {
                showToast('저장 중 오류가 발생했습니다.', true);
            } finally {
                managementSaveBtn.disabled = false;
                managementSaveBtn.textContent = '저장';
            }
        });
    }

    if (DOM.historyMainTabs) {
        DOM.historyMainTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-main-tab]');
            if (btn) {
                const tabName = btn.dataset.mainTab;
                State.context.activeMainHistoryTab = tabName;
                State.context.activeFilterDropdown = null; 
                
                styleHistoryTabs(tabName);
                
                const periodExcelBtn = document.getElementById('history-download-period-excel-btn');
                if (periodExcelBtn) {
                    if (tabName === 'work' || tabName === 'report') {
                        periodExcelBtn.classList.remove('hidden');
                        periodExcelBtn.classList.add('flex');
                    } else {
                        periodExcelBtn.classList.add('hidden');
                        periodExcelBtn.classList.remove('flex');
                    }
                }

                const dateListContainer = document.getElementById('history-date-list-container');
                
                DOM.workHistoryPanel.classList.toggle('hidden', tabName !== 'work');
                DOM.attendanceHistoryPanel.classList.toggle('hidden', tabName !== 'attendance');
                DOM.trendAnalysisPanel.classList.toggle('hidden', tabName !== 'trends');
                DOM.reportPanel.classList.toggle('hidden', tabName !== 'report');
                if (DOM.personalReportPanel) DOM.personalReportPanel.classList.toggle('hidden', tabName !== 'personal');
                if (managementPanel) managementPanel.classList.toggle('hidden', tabName !== 'management');
                if (inspectionPanel) inspectionPanel.classList.toggle('hidden', tabName !== 'inspection');
                if (predictionPanel) predictionPanel.classList.toggle('hidden', tabName !== 'prediction');
                if (leavePanel) leavePanel.classList.toggle('hidden', tabName !== 'leave');
                if (weekendPanel) weekendPanel.classList.toggle('hidden', tabName !== 'weekend');
                
                if (dateListContainer) {
                    const hideListTabs = ['trends', 'inspection', 'prediction', 'leave', 'weekend'];
                    dateListContainer.style.display = hideListTabs.includes(tabName) ? 'none' : 'block';
                }

                if (tabName === 'work') {
                     const view = DOM.historyTabs?.querySelector('button.font-semibold')?.dataset.view || 'daily';
                     switchHistoryView(view);
                } else if (tabName === 'attendance') {
                     const view = DOM.attendanceHistoryTabs?.querySelector('button.font-semibold')?.dataset.view || 'attendance-daily';
                     switchHistoryView(view);
                } else if (tabName === 'report') {
                     const view = DOM.reportTabs?.querySelector('button.font-semibold')?.dataset.view || 'report-daily';
                     switchHistoryView(view);
                } else if (tabName === 'trends') {
                     renderTrendAnalysisCharts(State.allHistoryData, State.appConfig, trendCharts);
                } else if (tabName === 'prediction') { 
                     const days = predictionDaysSelect ? Number(predictionDaysSelect.value) : 14;
                     renderPredictionTab(State.allHistoryData, days);
                } else if (tabName === 'personal') {
                     if (DOM.personalReportMemberSelect && DOM.personalReportMemberSelect.options.length <= 1) {
                         const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                         const partTimers = (State.appState.partTimers || []).map(p => p.name);
                         const allMembers = [...new Set([...staff, ...partTimers])].sort();
                         DOM.personalReportMemberSelect.innerHTML = '<option value="">직원 선택...</option>';
                         allMembers.forEach(m => {
                             const op = document.createElement('option');
                             op.value = m; op.textContent = m;
                             DOM.personalReportMemberSelect.appendChild(op);
                         });
                         if (State.appState.currentUser && allMembers.includes(State.appState.currentUser)) {
                             DOM.personalReportMemberSelect.value = State.appState.currentUser;
                             State.context.personalReportMember = State.appState.currentUser;
                         }
                     }
                     const viewMode = DOM.personalReportTabs?.querySelector('button.font-semibold')?.dataset.view || 'personal-daily';
                     let listMode = 'day';
                     if(viewMode.includes('weekly')) listMode = 'week';
                     if(viewMode.includes('monthly')) listMode = 'month';
                     if(viewMode.includes('yearly')) listMode = 'year';
                     renderHistoryDateListByMode(listMode);
                } else if (tabName === 'management') {
                     const viewMode = managementTabs?.querySelector('button.font-semibold')?.dataset.view || 'management-daily';
                     let listMode = 'day';
                     if(viewMode.includes('weekly')) listMode = 'week';
                     if(viewMode.includes('monthly')) listMode = 'month';
                     if(viewMode.includes('yearly')) listMode = 'year';
                     renderHistoryDateListByMode(listMode);
                } else if (tabName === 'inspection') {
                    fetchAndRenderInspectionHistory();
                } else if (tabName === 'leave') {
                    UILeave.initLeaveManagement();
                } else if (tabName === 'weekend') {
                    loadAndRenderWeekendStats();
                }
            }
        });
    }

    if (predictionDaysSelect) {
        predictionDaysSelect.addEventListener('change', () => {
            if (State.context.activeMainHistoryTab === 'prediction') {
                const days = Number(predictionDaysSelect.value);
                renderPredictionTab(State.allHistoryData, days);
            }
        });
    }

    if (DOM.historyViewContainer) {
        DOM.historyViewContainer.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;
            const action = button.dataset.action;
            const dateKey = button.dataset.dateKey;
            if (!dateKey) return;

            if (action === 'open-history-quantity-modal') {
                setHistoryMaximized(false); 
                openHistoryQuantityModal(dateKey);
            } else if (action === 'request-history-deletion') {
                setHistoryMaximized(false); 
                requestHistoryDeletion(dateKey);
            }
        });
    }

    if (DOM.historyModalContentBox) {
        DOM.historyModalContentBox.addEventListener('click', (e) => {
            const downloadBtn = e.target.closest('#inspection-download-btn');
            if (downloadBtn) {
                e.stopPropagation();
                openDownloadFormatModal('inspection');
                return;
            }

            const deleteBtn = e.target.closest('button[data-action="request-history-deletion"]');
            if (deleteBtn) {
                e.stopPropagation();
                const dateKey = deleteBtn.dataset.dateKey;
                if(dateKey) {
                    setHistoryMaximized(false); 
                    requestHistoryDeletion(dateKey);
                }
                return;
            }
        });
    }

    if (DOM.confirmHistoryDeleteBtn) {
        DOM.confirmHistoryDeleteBtn.addEventListener('click', async () => {
            const dateKey = State.context.historyKeyToDelete;
            if (dateKey) {
                const activeTab = State.context.activeMainHistoryTab || 'work';
                const updates = {};
                
                if (activeTab === 'work' || activeTab === 'report') {
                    updates.workRecords = deleteField();
                    updates.taskQuantities = deleteField();
                    updates.partTimers = deleteField();
                    updates.confirmedZeroTasks = deleteField();
                } else if (activeTab === 'attendance') {
                    updates.onLeaveMembers = deleteField();
                } else if (activeTab === 'management') {
                    updates.management = deleteField();
                } else if (activeTab === 'inspection') {
                    updates.inspectionList = deleteField();
                } else {
                    showToast('삭제할 대상 탭이 명확하지 않습니다.', true);
                    return;
                }

                try {
                    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
                    await updateDoc(historyDocRef, updates);

                    if (dateKey === getTodayDateString()) {
                        const dailyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', dateKey);
                        await updateDoc(dailyDocRef, updates);
                        
                        if (activeTab === 'work' || activeTab === 'report') {
                            State.appState.workRecords = [];
                            State.appState.taskQuantities = {};
                            State.appState.partTimers = [];
                            State.appState.confirmedZeroTasks = [];
                        } else if (activeTab === 'attendance') {
                            State.appState.dailyOnLeaveMembers = [];
                        } else if (activeTab === 'inspection') {
                            State.appState.inspectionList = [];
                        }
                    }

                    showToast(`${dateKey}의 데이터가 삭제되었습니다.`);
                    await loadAndRenderHistoryList();

                } catch (e) {
                    console.error("Partial deletion error:", e);
                    showToast('삭제 중 오류가 발생했습니다.', true);
                }
            }
            if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.add('hidden');
            State.context.historyKeyToDelete = null;
        });
    }

    const setupFilterListeners = (container, stateKeySort, stateKeyFilter, refreshFunc) => {
        if (!container) return;
        container.addEventListener('click', (e) => {
            if (e.target.closest('.filter-dropdown')) { e.stopPropagation(); return; }
            const filterIconBtn = e.target.closest('.filter-icon-btn');
            if (filterIconBtn) {
                e.stopPropagation();
                const dropdownId = filterIconBtn.dataset.dropdownId;
                State.context.activeFilterDropdown = (State.context.activeFilterDropdown === dropdownId) ? null : dropdownId;
                refreshFunc();
                return;
            }
            const sortTh = e.target.closest('th[data-sort-key]');
            if (sortTh) {
                const mode = sortTh.dataset.sortTarget;
                const key = sortTh.dataset.sortKey;
                if (!mode || !key) return;
                const sortStateObj = State.context[stateKeySort]; 
                if (!sortStateObj[mode]) sortStateObj[mode] = { key: '', dir: 'asc' };
                const currentSort = sortStateObj[mode];
                if (currentSort.key === key) currentSort.dir = (currentSort.dir === 'asc' ? 'desc' : 'asc');
                else { currentSort.key = key; currentSort.dir = 'asc'; }
                refreshFunc();
                return;
            }
        });
        container.addEventListener('input', (e) => {
            const filterInput = e.target.closest('[data-filter-key]');
            if (filterInput) {
                const mode = filterInput.dataset.filterTarget;
                const key = filterInput.dataset.filterKey;
                const filterStateObj = State.context[stateKeyFilter];
                if (!filterStateObj[mode]) filterStateObj[mode] = {};
                filterStateObj[mode][key] = filterInput.value;
                refreshFunc();
                setTimeout(() => {
                    const newInput = container.querySelector(`[data-filter-target="${mode}"][data-filter-key="${key}"]`);
                    if (newInput) {
                        newInput.focus();
                        if (newInput.tagName === 'INPUT') { const val = newInput.value; newInput.value = ''; newInput.value = val; }
                    }
                }, 0);
            }
        });
    };

    setupFilterListeners(DOM.attendanceHistoryViewContainer, 'attendanceSortState', 'attendanceFilterState', refreshAttendanceView);
    setupFilterListeners(DOM.reportViewContainer, 'reportSortState', 'reportFilterState', refreshReportView);
    setupFilterListeners(DOM.personalReportViewContainer, 'personalReportSortState', 'personalReportFilterState', refreshPersonalView);

    document.addEventListener('click', (e) => {
        if (State.context && State.context.activeFilterDropdown) {
            if (!e.target.closest('.filter-dropdown') && !e.target.closest('.filter-icon-btn')) {
                State.context.activeFilterDropdown = null;
                if (State.context.activeMainHistoryTab === 'attendance') refreshAttendanceView();
                else if (State.context.activeMainHistoryTab === 'report') refreshReportView();
                else if (State.context.activeMainHistoryTab === 'personal') refreshPersonalView();
                else if (State.context.activeMainHistoryTab === 'weekend') loadAndRenderWeekendStats();
            }
        }
    });

    const historyHeader = document.getElementById('history-modal-header');
    if (DOM.historyModal && historyHeader && DOM.historyModalContentBox) {
        let isDragging = false; let offsetX, offsetY;
        historyHeader.addEventListener('mousedown', e => {
            if(isHistoryMaximized || e.target.closest('button')) return;
            isDragging=true; 
            if(DOM.historyModalContentBox.dataset.hasBeenUncentered!=='true') {
                const r=DOM.historyModalContentBox.getBoundingClientRect();
                DOM.historyModal.classList.remove('flex','items-center','justify-center');
                DOM.historyModalContentBox.style.position='absolute'; 
                DOM.historyModalContentBox.style.top=`${r.top}px`; DOM.historyModalContentBox.style.left=`${r.left}px`;
                DOM.historyModalContentBox.style.width=`${r.width}px`; DOM.historyModalContentBox.style.height=`${r.height}px`;
                DOM.historyModalContentBox.style.transform='none'; DOM.historyModalContentBox.dataset.hasBeenUncentered='true';
            }
            const r=DOM.historyModalContentBox.getBoundingClientRect(); offsetX=e.clientX-r.left; offsetY=e.clientY-r.top;
            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
        function onMove(e) { if(!isDragging)return; DOM.historyModalContentBox.style.left=`${e.clientX-offsetX}px`; DOM.historyModalContentBox.style.top=`${e.clientY-offsetY}px`; }
        function onUp() { isDragging=false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    }

    const toggleFullscreenBtn = document.getElementById('toggle-history-fullscreen-btn');
    if (toggleFullscreenBtn) {
        toggleFullscreenBtn.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            setHistoryMaximized(!isHistoryMaximized);
        });
    }
}

// 💡 엑셀 스타일 이벤트 위임 (전역 위임으로 이벤트 누락 방지)
document.addEventListener('click', (e) => {
    const isWeekendPanel = e.target.closest('#history-weekend-panel') || e.target.closest('table:has(#weekend-history-table-body)');
    if (!isWeekendPanel) return;

    if (e.target.closest('.filter-dropdown')) return;
    
    const filterIconBtn = e.target.closest('.filter-icon-btn');
    if (filterIconBtn) {
        e.stopPropagation();
        if (!State.context) State.context = {};
        const dropdownId = filterIconBtn.dataset.dropdownId;
        State.context.activeFilterDropdown = (State.context.activeFilterDropdown === dropdownId) ? null : dropdownId;
        loadAndRenderWeekendStats();
        return;
    }

    const sortTh = e.target.closest('th[data-sort-key]');
    if (sortTh) {
        const key = sortTh.dataset.sortKey;
        if (!key) return;
        
        if (weekendSortState.key === key) {
            weekendSortState.dir = weekendSortState.dir === 'asc' ? 'desc' : 'asc';
        } else {
            weekendSortState.key = key;
            weekendSortState.dir = 'asc';
        }
        loadAndRenderWeekendStats();
    }
});

document.addEventListener('input', (e) => {
    const isWeekendPanel = e.target.closest('#history-weekend-panel') || e.target.closest('table:has(#weekend-history-table-body)');
    if (!isWeekendPanel) return;

    const filterInput = e.target.closest('input[data-filter-key]');
    if (filterInput) {
        const key = filterInput.dataset.filterKey;
        if (key === 'name') {
            weekendFilterState.name = filterInput.value;
            loadAndRenderWeekendStats();
            
            setTimeout(() => {
                const newInputs = document.querySelectorAll(`input[data-filter-key="name"]`);
                newInputs.forEach(newInput => {
                    if (newInput.closest('#history-weekend-panel') || newInput.closest('table:has(#weekend-history-table-body)')) {
                        newInput.focus();
                        const val = newInput.value;
                        newInput.value = '';
                        newInput.value = val;
                    }
                });
            }, 0);
        }
    }
});

export const requestHistoryDeletion = (dateKey) => {
    State.context.historyKeyToDelete = dateKey;
    const activeTab = State.context.activeMainHistoryTab || 'work';
    let targetName = '모든';
    
    if (activeTab === 'work' || activeTab === 'report') targetName = '업무 이력(처리량 포함)';
    else if (activeTab === 'attendance') targetName = '근태 이력';
    else if (activeTab === 'management') targetName = '경영 지표';
    else if (activeTab === 'inspection') targetName = '검수 이력';

    const msgEl = document.querySelector('#delete-history-modal h3');
    if (msgEl) {
        msgEl.innerHTML = `정말로 이 날짜의 <span class="text-red-600 font-bold">${targetName}</span> 데이터를 삭제하시겠습니까?`;
    }

    if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.remove('hidden');
};