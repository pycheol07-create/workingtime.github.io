// === ui.js (파일 분리 후 인덱스 역할) ===
import { taskWidgetDefs, taskIdOfWidget } from './lib/task-config-sync.js?v=202610301845';

// ✅ [유지] 앱 전역에서 사용하는 차트 인스턴스 (app.js에서 사용)
let trendCharts = {};
export { trendCharts }; // ❗ app.js에서 trendCharts를 직접 수정하므로 export 필요

// ✅ [유지] 공유 상수 (DASHBOARD_ITEM_DEFINITIONS)
export const DASHBOARD_ITEM_DEFINITIONS = {
    'total-staff': { title: '총원<br>(직원/알바)', valueId: 'summary-total-staff' },
    'leave-staff': { title: '휴무', valueId: 'summary-leave-staff' },
    'active-staff': { title: '근무<br>(직원/알바)', valueId: 'summary-active-staff' },
    'working-staff': { title: '업무중', valueId: 'summary-working-staff' },
    'idle-staff': { title: '대기', valueId: 'summary-idle-staff' },
    'ongoing-tasks': { title: '진행업무', valueId: 'summary-ongoing-tasks' },
    'total-work-time': { title: '업무진행시간', valueId: 'summary-total-work-time' },
    'domestic-invoice': { title: '국내송장<br>(예상)', valueId: 'summary-domestic-invoice', isQuantity: true },
    'china-production': { title: '중국제작', valueId: 'summary-china-production', isQuantity: true },
    'direct-delivery': { title: '직진배송', valueId: 'summary-direct-delivery', isQuantity: true }
};

// ✅ [유지] 공유 헬퍼 (getAllDashboardDefinitions)
// 업무 수량 위젯(task-<업무id>)은 저장된 정의 없이 taskIdNames 로 만든다 — 제목 = 지금 업무 이름(이름을 바꾸면 따라감).
// dashboardCustomItems 의 task- 항목은 옛 버전 탭용 사본이라 여기서는 쓰지 않는다(js/lib/task-config-sync.js).
export function getAllDashboardDefinitions(config) {
    const customDefinitions = {};
    if (config.dashboardCustomItems) {
        for (const id in config.dashboardCustomItems) {
            if (taskIdOfWidget(id)) continue;
            const item = config.dashboardCustomItems[id];
            customDefinitions[id] = {
                title: item.title,
                valueId: `summary-${id}`, // valueId 자동 생성
                isQuantity: item.isQuantity
            };
        }
    }
    const taskDefinitions = {};
    const taskDefs = taskWidgetDefs(config);
    for (const id in taskDefs) taskDefinitions[id] = { ...taskDefs[id], valueId: `summary-${id}` };
    return {
        ...DASHBOARD_ITEM_DEFINITIONS,
        ...customDefinitions,
        ...taskDefinitions
    };
}

// ✅ [유지] 공유 상수 (taskCardStyles, taskTitleColors) (ui-main.js에서 사용)
export const taskCardStyles = {
    'default': {
        card: ['bg-blue-50', 'border-gray-300', 'text-gray-700', 'shadow-sm'],
        hover: 'hover:border-blue-500 hover:shadow-md',
        subtitle: 'text-gray-500',
        buttonBgOff: 'bg-gray-200',
        buttonTextOff: 'text-gray-500'
    },
    'ongoing': {
        card: ['bg-blue-100', 'border-blue-500', 'text-gray-900', 'shadow-xl', 'shadow-blue-200/50'], // 진행 중 강조
        hover: 'hover:border-blue-600',
        subtitle: 'text-gray-600',
        buttonBgOn: 'bg-blue-600',
        buttonTextOn: 'text-white',
        buttonHoverOn: 'hover:bg-blue-700'
    },
    'paused': {
        card: ['bg-yellow-50', 'border-yellow-300', 'text-yellow-800', 'shadow-md', 'shadow-yellow-100/50'],
        hover: 'hover:border-yellow-400 hover:shadow-lg',
        title: 'text-yellow-800',
        subtitle: 'text-yellow-700',
        buttonBgOn: 'bg-yellow-600',
        buttonTextOn: 'text-white',
        buttonHoverOn: 'hover:bg-yellow-700'
    }
};
// 시스템 업무는 고정 id 키(업무 id 2단계) — 찾을 때 systemIdOfName(이름, 설정) || 이름. 지금 이 표를 읽는 곳은 없다.
export const taskTitleColors = {
    'k_domestic': 'text-green-700',
    'k_china': 'text-purple-700',
    'k_direct': 'text-emerald-700',
    'k_fill': 'text-sky-700',
    '개인담당업무': 'text-indigo-700',
    '티니': 'text-red-700',
    '택배포장': 'text-orange-700',
    '해외배송': 'text-cyan-700',
    '재고조사': 'text-fuchsia-700',
    'k_angle': 'text-amber-700',
    '상품재작업': 'text-yellow-800',
    'k_loadunload': 'text-stone-700',
    '검수': 'text-teal-700',
    '아이롱': 'text-violet-700',
    'k_error': 'text-rose-700',
    '강성': 'text-pink-700',
    '2층업무': 'text-neutral-700',
    '재고찾는시간': 'text-lime-700',
    'k_store': 'text-blue-700',
    '출장': 'text-gray-700',
    'default': 'text-blue-700'
};


// --- 1. Main UI 함수들 가져오기 및 내보내기 ---
import {
    renderTaskAnalysis,
    renderPersonalAnalysis,
    renderRealtimeStatus,
    renderCompletedWorkLog,
    renderDashboardLayout,
    updateSummary,
    applyDynamicSidebar // ✨ 신규 임포트
} from './ui-main.js?v=202610301845';

export {
    renderTaskAnalysis,
    renderPersonalAnalysis,
    renderRealtimeStatus,
    renderCompletedWorkLog,
    renderDashboardLayout,
    updateSummary,
    applyDynamicSidebar // ✨ 신규 익스포트
};

// --- 2. History UI 함수들 가져오기 및 내보내기 ---
import {
    renderWeeklyHistory,
    renderMonthlyHistory,
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory,
    renderTrendAnalysisCharts,
    renderReportDaily,
    renderReportWeekly,
    renderReportMonthly,
    renderReportYearly
} from './ui-history.js?v=202610301845';

export {
    renderWeeklyHistory,
    renderMonthlyHistory,
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory,
    renderTrendAnalysisCharts,
    renderReportDaily,
    renderReportWeekly,
    renderReportMonthly,
    renderReportYearly
};

// --- 3. Modal UI 함수들 가져오기 및 내보내기 ---
import {
    renderQuantityModalInputs,
    applyPlannedPrefill,
    renderTaskSelectionModal,
    renderTeamSelectionModalContent,
    renderLeaveTypeModalOptions,
    renderManualAddModalDatalists
} from './ui-modals.js?v=202610301845';

export {
    renderQuantityModalInputs,
    applyPlannedPrefill,
    renderTaskSelectionModal,
    renderTeamSelectionModalContent,
    renderLeaveTypeModalOptions,
    renderManualAddModalDatalists
};