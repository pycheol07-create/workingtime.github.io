// === js/ui-history.js ===
// 설명: 이력 보기와 관련된 모든 UI 렌더링 함수를 모아서 내보내는 인덱스 파일입니다.

// 1. 리포트 관련 함수 (일별/주별/월별/연간 리포트)
import {
    renderReportDaily,
    renderReportWeekly,
    renderReportMonthly,
    renderReportYearly
} from './ui-history-reports.js?v=b5dcda446066-9b003c86';

// 2. 근태 이력 관련 함수 (일별/주별/월별 근태)
import {
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory,
    renderAttendanceYearlyHistory
} from './ui-history-attendance.js?v=a96a8c12ae76-d18bba49';

// 3. 트렌드 분석 관련 함수 (차트)
import {
    renderTrendAnalysisCharts
} from './ui-history-trends.js?v=efc58ac0a17b-aa026d69';

// 4. 업무 이력 요약 관련 함수 (주별/월별 요약)
import {
    renderWeeklyHistory,
    renderMonthlyHistory,
    renderYearlyHistory
} from './ui-history-summary.js?v=6050322e9007-bc6a36d0';

// 5. 개인 리포트 관련 함수
import {
    renderPersonalReport
} from './ui-history-personal.js?v=131abc3bfe71-12ff2951';

// 6. 경영 지표 관련 함수
import {
    renderManagementDaily,
    renderManagementSummary
} from './ui-history-management.js?v=b170c269edf1-688719b9';

// 7. 검수 이력 관련 함수
import {
    renderInspectionHistoryTable,
    renderInspectionLogTable,
    renderInspectionLayout,
    renderInspectionListMode
} from './ui-history-inspection.js?v=b3e080de6922-92ecfe05';

// ✅ [신규] 8. 실적 예측 관련 함수
import {
    renderPredictionTab
} from './ui-history-prediction.js?v=e8f50ae37140-8e6157b0';


// --- 모든 함수를 ui.js 및 리스너가 사용할 수 있도록 다시 내보내기 ---

export {
    // 리포트
    renderReportDaily,
    renderReportWeekly,
    renderReportMonthly,
    renderReportYearly,
    
    // 근태 이력
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory,
    renderAttendanceYearlyHistory,

    // 트렌드 분석
    renderTrendAnalysisCharts,

    // 업무 이력 요약
    renderWeeklyHistory,
    renderMonthlyHistory,
    renderYearlyHistory,

    // 개인 리포트
    renderPersonalReport,

    // 경영 지표
    renderManagementDaily,
    renderManagementSummary,

    // 검수 이력
    renderInspectionHistoryTable,
    renderInspectionLogTable,
    renderInspectionLayout,
    renderInspectionListMode,
    
    // ✅ [신규] 실적 예측
    renderPredictionTab
};