// === js/listeners-history-download.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';

import {
    downloadHistoryAsExcel,
    downloadPeriodHistoryAsExcel,
    downloadWeeklyHistoryAsExcel, 
    downloadMonthlyHistoryAsExcel, 
    downloadAttendanceExcel,
    downloadReportExcel,
    downloadPersonalReportExcel,
    downloadInspectionHistory
} from './history-excel.js';

const getSelectedDateKey = () => {
    const btn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
    return btn ? btn.dataset.key : null;
};

// 💡 UX 개선: 여러 형식을 선택할 필요 없이, 엑셀 형식('xlsx')으로 즉시 다운로드를 실행합니다.
export const openDownloadFormatModal = (targetType, contextData = {}) => {
    State.context.downloadContext = { targetType, ...contextData };
    showToast('엑셀 파일 변환 및 다운로드를 준비 중입니다...', false);
    
    // 약간의 딜레이를 주어 토스트 메시지가 렌더링될 시간을 확보
    setTimeout(() => {
        executeDownload('xlsx');
    }, 100);
};

const executeDownload = async (format) => {
    const ctx = State.context.downloadContext;
    if (!ctx) return;
    
    const { targetType } = ctx;

    if (targetType === 'work') {
        const activeTabBtn = DOM.historyTabs.querySelector('button.font-semibold');
        const view = activeTabBtn ? activeTabBtn.dataset.view : 'daily';
        const key = getSelectedDateKey();

        if (!key) return showToast('날짜를 선택해주세요.', true);

        if (view === 'daily') await downloadHistoryAsExcel(key, format);
        else if (view === 'weekly') await downloadWeeklyHistoryAsExcel(key, format);
        else if (view === 'monthly') await downloadMonthlyHistoryAsExcel(key, format);
    }
    else if (targetType === 'attendance') {
        const activeTabBtn = DOM.attendanceHistoryTabs.querySelector('button.font-semibold');
        const viewFull = activeTabBtn ? activeTabBtn.dataset.view : 'attendance-daily';
        const viewMode = viewFull.replace('attendance-', ''); 
        const key = getSelectedDateKey();

        if (!key) return showToast('날짜를 선택해주세요.', true);
        downloadAttendanceExcel(viewMode, key, format);
    }
    else if (targetType === 'report') {
        const reportData = State.context.lastReportData;
        if (!reportData) return showToast('리포트 데이터가 없습니다.', true);
        downloadReportExcel(reportData, format);
    }
    else if (targetType === 'personal') {
        const reportData = State.context.lastReportData;
        if (!reportData || reportData.type !== 'personal') return showToast('개인 리포트 데이터가 없습니다.', true);
        downloadPersonalReportExcel(reportData, format);
    }
    else if (targetType === 'inspection') {
         const viewMode = State.context.inspectionViewMode || 'product';
         await downloadInspectionHistory(format, viewMode);
    }

    // 모달이 열려있다면 닫기 (HTML 상에는 유지되지만 사용되지 않음)
    const modal = document.getElementById('download-format-modal');
    if (modal) modal.classList.add('hidden');
};

export function setupHistoryDownloadListeners() {
    // 1. 업무 이력 탭 다운로드
    const historyDownloadBtn = document.getElementById('history-download-btn');
    if (historyDownloadBtn) {
        historyDownloadBtn.addEventListener('click', () => {
             const selectedListBtn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
             if (!selectedListBtn) return showToast('목록에서 날짜를 선택해주세요.', true);
             openDownloadFormatModal('work');
        });
    }

    // 2. 기간 엑셀 다운로드 (상단)
    if (DOM.historyDownloadPeriodExcelBtn) {
        DOM.historyDownloadPeriodExcelBtn.addEventListener('click', () => {
            const startDate = State.context.historyStartDate;
            const endDate = State.context.historyEndDate;

            if (!startDate || !endDate) {
                showToast('엑셀 다운로드를 위해 시작일과 종료일을 모두 설정(조회)해주세요.', true);
                return;
            }
            downloadPeriodHistoryAsExcel(startDate, endDate);
        });
    }

    // 3. 근태 이력 탭 다운로드
    const attendanceDownloadBtn = document.getElementById('attendance-download-btn');
    if (attendanceDownloadBtn) {
        attendanceDownloadBtn.addEventListener('click', () => {
             const selectedListBtn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
             if (!selectedListBtn) return showToast('목록에서 날짜를 선택해주세요.', true);
             openDownloadFormatModal('attendance');
        });
    }

    // 4. 업무 리포트 탭 다운로드
    if (DOM.reportViewContainer) {
        DOM.reportViewContainer.addEventListener('click', (e) => {
            if (e.target.closest('#report-download-btn')) {
                if (State.context.lastReportData && State.context.lastReportData.type !== 'personal') {
                    openDownloadFormatModal('report');
                } else {
                    showToast('다운로드할 리포트 데이터가 없습니다.', true);
                }
            }
        });
    }

    // 5. 개인 리포트 탭 다운로드
    if (DOM.personalReportViewContainer) {
        DOM.personalReportViewContainer.addEventListener('click', (e) => {
             if (e.target.closest('#personal-download-btn')) {
                if (State.context.lastReportData && State.context.lastReportData.type === 'personal') {
                    openDownloadFormatModal('personal');
                } else {
                    showToast('다운로드할 개인 리포트 데이터가 없습니다.', true);
                }
            }
        });
    }
    
    // 6. 검수 이력 탭 다운로드
    const historyModalContentBox = document.getElementById('history-modal-content-box');
    if (historyModalContentBox) {
        historyModalContentBox.addEventListener('click', (e) => {
            const downloadBtn = e.target.closest('#inspection-tab-download-btn');
            if (downloadBtn) {
                e.stopPropagation();
                openDownloadFormatModal('inspection');
            }
        });
    }
}