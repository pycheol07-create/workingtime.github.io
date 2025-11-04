// === ui.js (파일 분리 후 인덱스 역할) ===

// ⛔️ [삭제] 기존 함수들 (모두 ui-main.js, ui-history.js, ui-modals.js로 이동)

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
export function getAllDashboardDefinitions(config) {
    const customDefinitions = {};
    if (config.dashboardCustomItems) {
        for (const id in config.dashboardCustomItems) {
            const item = config.dashboardCustomItems[id];
            customDefinitions[id] = {
                title: item.title,
                valueId: `summary-${id}`, // valueId 자동 생성
                isQuantity: item.isQuantity
            };
        }
    }
    return {
        ...DASHBOARD_ITEM_DEFINITIONS,
        ...customDefinitions
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
export const taskTitleColors = {
    '국내배송': 'text-green-700',
    '중국제작': 'text-purple-700',
    '직진배송': 'text-emerald-700',
    '채우기': 'text-sky-700',
    '개인담당업무': 'text-indigo-700',
    '티니': 'text-red-700',
    '택배포장': 'text-orange-700',
    '해외배송': 'text-cyan-700',
    '재고조사': 'text-fuchsia-700',
    '앵글정리': 'text-amber-700',
    '상품재작업': 'text-yellow-800',
    '상.하차': 'text-stone-700',
    '검수': 'text-teal-700',
    '아이롱': 'text-violet-700',
    '오류': 'text-rose-700',
    '강성': 'text-pink-700',
    '2층업무': 'text-neutral-700',
    '재고찾는시간': 'text-lime-700',
    '매장근무': 'text-blue-700',
    '출장': 'text-gray-700',
    'default': 'text-blue-700'
};

// ================== [ ✨ 추가된 부분 ✨ ] ==================
// (업무 '그룹'별 제목 색상 정의)
export const TASK_GROUP_COLORS = {
    '공통': 'text-green-700',
    '담당': 'text-indigo-700',
    '기타': 'text-sky-700',
    'default': 'text-gray-700' // 👈 혹시 그룹이 없는 경우 회색
};
// =========================================================


// ✅ [유지] 공유 헬퍼 (getDiffHtmlForMetric) (ui-history.js에서 사용)
import { formatDuration } from './utils.js'; // 이 함수는 formatDuration이 필요
export const getDiffHtmlForMetric = (metric, current, previous) => {
    const currValue = current || 0;
    const prevValue = previous || 0;

    if (prevValue === 0) {
        if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
        return ''; // 둘 다 0
    }
    
    const diff = currValue - prevValue;
    if (Math.abs(diff) < 0.001) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;
    
    const percent = (diff / prevValue) * 100;
    const sign = diff > 0 ? '↑' : '↓';
    
    let colorClass = 'text-gray-500';
    if (diff > 0) {
        colorClass = 'text-green-600'; // 플러스(+)는 초록색
    } else {
        colorClass = 'text-red-600'; // 마이너스(-)는 빨간색
    }
    
    let diffStr = '';
    let prevStr = '';
    if (metric === 'avgTime') {
        diffStr = formatDuration(Math.abs(diff));
        prevStr = formatDuration(prevValue);
    } else if (metric === 'avgStaff' || metric === 'avgCostPerItem') {
        diffStr = Math.abs(diff).toFixed(0);
        prevStr = prevValue.toFixed(0);
    } else { // avgThroughput
        diffStr = Math.abs(diff).toFixed(2);
        prevStr = prevValue.toFixed(2);
    }

    return `<span class="text-xs ${colorClass} ml-1 font-mono" title="이전: ${prevStr}">
                ${sign} ${diffStr} (${percent.toFixed(0)}%)
            </span>`;
};


// --- 1. Main UI 함수들 가져오기 및 내보내기 ---
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

// --- 2. History UI 함수들 가져오기 및 내보내기 ---
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
    // ❗참고: renderSummaryView, renderAggregatedAttendanceSummary 등은
    // ui-history.js 내부에서만 쓰이므로 여기서 내보낼 필요가 없습니다.
};


// --- 3. Modal UI 함수들 가져오기 및 내보내기 ---
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