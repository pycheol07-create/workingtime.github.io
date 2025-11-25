// === js/ui-history.js ===
// 설명: 이력 보기와 관련된 모든 UI 렌더링 함수를 모아서 내보내는 인덱스 파일입니다.

// 1. 리포트 관련 함수 (일별/주별/월별/연간 리포트)
import {
    renderReportDaily,
    renderReportWeekly,
    renderReportMonthly,
    renderReportYearly
} from './ui-history-reports.js';

// 2. 근태 이력 관련 함수 (일별/주별/월별 근태)
import {
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory
} from './ui-history-attendance.js';

// 3. 트렌드 분석 관련 함수 (차트)
import {
    renderTrendAnalysisCharts
} from './ui-history-trends.js';

// 4. 업무 이력 요약 관련 함수 (주별/월별 요약)
import {
    renderWeeklyHistory,
    renderMonthlyHistory
} from './ui-history-summary.js';

// 5. 개인 리포트 관련 함수
import {
    renderPersonalReport
} from './ui-history-personal.js';

// 6. 경영 지표 관련 함수
import {
    renderManagementDaily,
    renderManagementSummary
} from './ui-history-management.js';

// ✅ [수정] 7. 검수 이력 관련 함수 (새로 추가된 함수들도 포함)
import {
    renderInspectionHistoryTable,
    renderInspectionLogTable,   // [New] 상세 로그 테이블
    renderInspectionLayout,     // [New] 레이아웃(탭)
    renderInspectionListMode    // [New] 리스트별 보기
} from './ui-history-inspection.js';


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
    
    // 트렌드 분석
    renderTrendAnalysisCharts,
    
    // 업무 이력 요약
    renderWeeklyHistory,
    renderMonthlyHistory,

    // 개인 리포트
    renderPersonalReport,

    // 경영 지표
    renderManagementDaily,
    renderManagementSummary,

    // ✅ [수정] 검수 이력 (내보내기 목록 업데이트)
    renderInspectionHistoryTable,
    renderInspectionLogTable,   // [New]
    renderInspectionLayout,     // [New]
    renderInspectionListMode    // [New]
};