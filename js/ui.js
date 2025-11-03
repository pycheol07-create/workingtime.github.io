// === ui.js (파일 분리 수정 버전, 인덱스 역할) ===

// 1. 차트 인스턴스 (app.js에서 사용)
let trendCharts = {};
export { trendCharts };

// 2. Main UI 함수들 가져오기 및 내보내기
import {
    renderTaskAnalysis,
    renderPersonalAnalysis,
    renderRealtimeStatus,
    renderCompletedWorkLog,
    renderDashboardLayout,
    updateSummary
} from './ui-main.js';

export {
    renderTaskAnalysis,
    renderPersonalAnalysis,
    renderRealtimeStatus,
    renderCompletedWorkLog,
    renderDashboardLayout,
    updateSummary
};

// 3. History UI 함수들 가져오기 및 내보내기
import {
    renderWeeklyHistory,
    renderMonthlyHistory,
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory,
    renderTrendAnalysisCharts
} from './ui-history.js';

export {
    renderWeeklyHistory,
    renderMonthlyHistory,
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory,
    renderTrendAnalysisCharts
};

// 4. Modal UI 함수들 가져오기 및 내보내기
import {
    renderQuantityModalInputs,
    renderTaskSelectionModal,
    renderTeamSelectionModalContent,
    renderLeaveTypeModalOptions,
    renderManualAddModalDatalists
} from './ui-modals.js';

export {
    renderQuantityModalInputs,
    renderTaskSelectionModal,
    renderTeamSelectionModalContent,
    renderLeaveTypeModalOptions,
    renderManualAddModalDatalists
};

// 5. ❗️ [수정] app.js가 요청하는 공유 함수(getAllDashboardDefinitions) 내보내기
import {
    getAllDashboardDefinitions
} from './ui-shared.js';

export {
    getAllDashboardDefinitions
};