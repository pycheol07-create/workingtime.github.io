// === js/listeners-history-tabs.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString, getWeekOfYear } from './utils.js';
import { renderDashboardTab } from './ui-history-dashboard.js';
import { renderProductivityTab } from './ui-history-productivity.js';
import { renderStaffingTab } from './ui-history-staffing.js';
import { renderPredictionTab } from './ui-history-prediction.js';
import { fetchAndRenderInspectionHistory } from './listeners-history-inspection.js';
import * as UILeave from './ui-history-leave.js';
import { loadAndRenderWeekendStats } from './ui-history-weekend.js';
import { renderHistoryDateListByMode } from './history-list-controller.js';

export const getFilteredHistoryData = () => {
    const activeBtn = document.querySelector('.history-date-btn.active-date-btn');
    if (!activeBtn) return State.allHistoryData; 
    
    const key = activeBtn.dataset.key;
    if (key.length === 10) return State.allHistoryData.filter(d => d.id === key); // 일간
    if (key.length === 7) return State.allHistoryData.filter(d => d.id.startsWith(key)); // 월간
    if (key.length === 4) return State.allHistoryData.filter(d => d.id.startsWith(key)); // 연간
    if (key.includes('-W')) { // 주간
        return State.allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === key);
    }
    return State.allHistoryData;
};

export function setupGlobalFilterListeners() {
    const globalExcelBtn = document.getElementById('global-download-excel-btn');
    if (globalExcelBtn) {
        globalExcelBtn.addEventListener('click', () => {
            const filteredData = getFilteredHistoryData();
            if (!filteredData || filteredData.length === 0) return showToast('다운로드할 데이터가 없습니다.', true);

            let csvContent = "\uFEFF날짜,출근 인원(명),총 업무시간(분),총 인건비(원),총 생산량(개),종합 UPH\n";
            let totalMembers = 0, totalMins = 0, totalCost = 0, totalQty = 0;
            const sortedData = [...filteredData].sort((a, b) => a.id.localeCompare(b.id));

            sortedData.forEach(day => {
                const memCount = new Set((day.workRecords || []).map(r => r.member)).size;
                let dayMin = 0, dayCost = 0, dayQty = 0;
                
                (day.workRecords || []).forEach(r => {
                    dayMin += (r.duration || 0);
                    const wage = State.appConfig?.memberWages?.[r.member] || 10000;
                    dayCost += ((r.duration || 0) / 60) * wage;
                });
                Object.values(day.taskQuantities || {}).forEach(q => { dayQty += (Number(q) || 0); });

                const dayUph = dayMin > 0 ? (dayQty / (dayMin / 60)).toFixed(1) : 0;
                totalMembers += memCount; totalMins += dayMin; totalCost += dayCost; totalQty += dayQty;
                csvContent += `${day.id},${memCount},${dayMin},${Math.round(dayCost)},${dayQty},${dayUph}\n`;
            });

            const totalUph = totalMins > 0 ? (totalQty / (totalMins / 60)).toFixed(1) : 0;
            csvContent += `\n합계,-,${totalMins},${Math.round(totalCost)},${totalQty},${totalUph}\n`;

            const activeBtn = document.querySelector('.history-date-btn.active-date-btn');
            const targetName = activeBtn ? activeBtn.dataset.key : '전체';
            const fileName = `물류팀_통합데이터_${targetName}.csv`;
            const link = document.createElement("a");
            link.setAttribute("href", URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })));
            link.setAttribute("download", fileName);
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            showToast('통합 엑셀 데이터가 성공적으로 다운로드되었습니다.');
        });
    }
}

export function setupHistoryTabsListeners() {
    const mainTabsContainer = document.getElementById('history-main-tabs');
    if (mainTabsContainer) {
        mainTabsContainer.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-main-tab]');
            if (!btn) return;
            const tabName = btn.dataset.mainTab;
            
            document.querySelectorAll('.history-main-tab-btn').forEach(b => {
                const isActive = (b === btn);
                b.className = isActive 
                    ? 'history-main-tab-btn py-3 md:py-4 font-bold text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 transition whitespace-nowrap text-sm md:text-base'
                    : 'history-main-tab-btn py-3 md:py-4 font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 border-b-2 border-transparent transition whitespace-nowrap text-sm md:text-base';
            });

            document.getElementById('dashboard-panel').classList.toggle('hidden', tabName !== 'dashboard');
            document.getElementById('productivity-panel').classList.toggle('hidden', tabName !== 'productivity');
            document.getElementById('staffing-panel').classList.toggle('hidden', tabName !== 'staffing');
            document.getElementById('prediction-panel').classList.toggle('hidden', tabName !== 'prediction');
            document.getElementById('rawdata-panel').classList.toggle('hidden', tabName !== 'rawdata');

            const filteredData = getFilteredHistoryData();
            
            if (tabName === 'dashboard') renderDashboardTab(filteredData, State.appConfig);
            else if (tabName === 'productivity') renderProductivityTab(filteredData, State.appConfig);
            else if (tabName === 'staffing') renderStaffingTab(filteredData, State.appConfig);
            else if (tabName === 'prediction') renderPredictionTab(filteredData);
            else if (tabName === 'rawdata') {
                const firstSub = document.querySelector('.rawdata-sub-tab-btn.font-bold') || document.querySelector('.rawdata-sub-tab-btn[data-sub-tab="work"]');
                if (firstSub) firstSub.click();
            }
        });
    }

    document.querySelectorAll('.rawdata-sub-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const subTabName = e.target.dataset.subTab;
            State.context.activeMainHistoryTab = subTabName;
            
            document.querySelectorAll('.rawdata-sub-tab-btn').forEach(b => {
                 const isActive = (b === e.target);
                 b.className = isActive
                    ? 'rawdata-sub-tab-btn py-3 text-sm font-bold text-gray-800 dark:text-gray-200 border-b-2 border-gray-800 dark:border-gray-200 whitespace-nowrap'
                    : 'rawdata-sub-tab-btn py-3 text-sm font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 border-b-2 border-transparent whitespace-nowrap';
            });

            const panels = {
                'work': document.getElementById('work-history-panel'), 'attendance': document.getElementById('attendance-history-panel'),
                'report': document.getElementById('report-panel'), 'personal': document.getElementById('personal-report-panel'),
                'management': document.getElementById('management-panel'), 'inspection': document.getElementById('inspection-history-panel'),
                'leave': document.getElementById('history-leave-panel'), 'weekend': document.getElementById('history-weekend-panel')
            };

            Object.keys(panels).forEach(key => { if (panels[key]) panels[key].classList.toggle('hidden', key !== subTabName); });
            
            const activeDateBtn = document.querySelector('.history-date-btn.active-date-btn');
            if (activeDateBtn) activeDateBtn.click();
            
            if (subTabName === 'personal') {
                if (DOM.personalReportMemberSelect && DOM.personalReportMemberSelect.options.length <= 1) {
                    const staff = (State.appConfig.teamGroups || []).flatMap(g => g.members);
                    const partTimers = (State.appState.partTimers || []).map(p => p.name);
                    const allMembers = [...new Set([...staff, ...partTimers])].sort();
                    
                    DOM.personalReportMemberSelect.innerHTML = '<option value="">직원 선택...</option>';
                    allMembers.forEach(m => {
                        const op = document.createElement('option'); op.value = m; op.textContent = m;
                        DOM.personalReportMemberSelect.appendChild(op);
                    });
                    if (State.appState.currentUser && allMembers.includes(State.appState.currentUser)) {
                        DOM.personalReportMemberSelect.value = State.appState.currentUser;
                        State.context.personalReportMember = State.appState.currentUser;
                    }
                }
            } else if (subTabName === 'inspection') fetchAndRenderInspectionHistory();
            else if (subTabName === 'leave') UILeave.initLeaveManagement();
            else if (subTabName === 'weekend') loadAndRenderWeekendStats();
        });
    });
}