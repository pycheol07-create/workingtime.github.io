// === js/listeners-history-download.js ===
// 설명: 이력 보기 내의 엑셀/PDF 다운로드 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast } from './utils.js';

import {
    downloadHistoryAsExcel,
    downloadPeriodHistoryAsExcel,
    downloadWeeklyHistoryAsExcel, 
    downloadMonthlyHistoryAsExcel, 
    downloadAttendanceExcel,
    downloadReportExcel,
    downloadPersonalReportExcel,
    downloadContentAsPdf
} from './history-excel.js';

// 날짜 선택 헬퍼 (listeners-history.js의 getSelectedDateKey와 동일 로직이 필요하므로 DOM에서 직접 조회)
const getSelectedDateKey = () => {
    const btn = DOM.historyDateList.querySelector('.history-date-btn.bg-blue-100');
    return btn ? btn.dataset.key : null;
};

export function setupHistoryDownloadListeners() {

    // --- 다운로드 모달 및 실행 로직 ---

    const openDownloadFormatModal = (targetType, contextData = {}) => {
        State.context.downloadContext = { targetType, ...contextData };
        const modal = document.getElementById('download-format-modal');
        if (modal) modal.classList.remove('hidden');
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

            if (format === 'pdf') {
                let targetId = 'history-daily-view';
                let title = `업무이력_일별_${key}`;
                if (view === 'weekly') { targetId = 'history-weekly-view'; title = `업무이력_주별_${key}`; }
                else if (view === 'monthly') { targetId = 'history-monthly-view'; title = `업무이력_월별_${key}`; }
                downloadContentAsPdf(targetId, title);
            } else {
                if (view === 'daily') await downloadHistoryAsExcel(key, format);
                else if (view === 'weekly') await downloadWeeklyHistoryAsExcel(key, format);
                else if (view === 'monthly') await downloadMonthlyHistoryAsExcel(key, format);
            }
        }
        else if (targetType === 'attendance') {
            const activeTabBtn = DOM.attendanceHistoryTabs.querySelector('button.font-semibold');
            const viewFull = activeTabBtn ? activeTabBtn.dataset.view : 'attendance-daily';
            const viewMode = viewFull.replace('attendance-', ''); 
            const key = getSelectedDateKey();

            if (!key) return showToast('날짜를 선택해주세요.', true);

            if (format === 'pdf') {
                let targetId = 'history-attendance-daily-view';
                let title = `근태이력_일별_${key}`;
                if (viewMode === 'weekly') { targetId = 'history-attendance-weekly-view'; title = `근태이력_주별_${key}`; }
                else if (viewMode === 'monthly') { targetId = 'history-attendance-monthly-view'; title = `근태이력_월별_${key}`; }
                downloadContentAsPdf(targetId, title);
            } else {
                downloadAttendanceExcel(viewMode, key, format);
            }
        }
        else if (targetType === 'report') {
            const reportData = State.context.lastReportData;
            if (!reportData) return showToast('리포트 데이터가 없습니다.', true);

            if (format === 'pdf') {
                let targetId = '';
                const tabs = document.querySelectorAll('#report-view-container > div');
                tabs.forEach(div => { if (!div.classList.contains('hidden')) targetId = div.id; });
                if (targetId) downloadContentAsPdf(targetId, reportData.title || '업무_리포트');
                else showToast('출력할 리포트 화면을 찾을 수 없습니다.', true);
            } else {
                downloadReportExcel(reportData, format);
            }
        }
        else if (targetType === 'personal') {
            const reportData = State.context.lastReportData;
            if (!reportData || reportData.type !== 'personal') return showToast('개인 리포트 데이터가 없습니다.', true);

            if (format === 'pdf') {
                downloadContentAsPdf('personal-report-content', reportData.title || '개인_리포트');
            } else {
                downloadPersonalReportExcel(reportData, format);
            }
        }

        const modal = document.getElementById('download-format-modal');
        if (modal) modal.classList.add('hidden');
    };

    // 다운로드 모달 내 버튼 (Excel/PDF/CSV 선택)
    const formatModal = document.getElementById('download-format-modal');
    if (formatModal) {
        formatModal.addEventListener('click', (e) => {
            const btn = e.target.closest('.download-option-btn');
            if (btn) {
                const format = btn.dataset.format; 
                const fileFormat = format === 'excel' ? 'xlsx' : format;
                executeDownload(fileFormat);
            }
        });
    }

    // --- 각 탭별 다운로드 버튼 연결 ---

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

    // 4. 업무 리포트 탭 다운로드 (이벤트 위임 사용)
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

    // 5. 개인 리포트 탭 다운로드 (이벤트 위임 사용)
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
}