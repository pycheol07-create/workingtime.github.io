// === js/ui/dashboard.js ===

import { getAllDashboardDefinitions as adminGetAllDefinitions } from '../admin.js'; // ✅ [수정] admin.js에서 가져오도록 변경

// ✅ [수정] 현황판 아이템 정의 (isQuantity 플래그 추가)
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

// ✅ [수정] admin.js의 함수를 사용하도록 변경
export function getAllDashboardDefinitions(config) {
    // admin.js에 있는 함수를 그대로 사용합니다.
    // 이 함수는 admin.js에서 이미 export 하고 있으므로,
    // 여기서는 admin.js의 함수를 app.js에서 직접 사용할 수 있도록
    // ui/index.js에서 adminGetAllDefinitions를 export 해주는 것이 좋습니다.
    // 하지만 일단은 admin.js의 함수를 호출하는 방식으로 유지합니다.
    
    // [수정] admin.js에서 import한 함수를 사용합니다.
    // (admin.js가 ui.js보다 먼저 로드되어야 함을 의미 - HTML <script> 순서 주의)
    // -> [재수정] admin.js는 모듈이므로 HTML 로드 순서와 무관합니다.
    //    다만, app.js가 admin.js의 함수를 직접 참조하는 것이 더 깔끔합니다.
    //    여기서는 app.js가 이 함수를 호출한다고 가정하고 admin.js의 함수를 사용합니다.
    
    // [최종 수정] app.js가 ui.js(지금 이 파일)를 import 하므로,
    // 이 파일이 admin.js를 import 하는 것은 문제가 없습니다.
    // 하지만 admin.js의 getAllDashboardDefinitions 함수는 admin.js 내에서만 사용됩니다.
    // app.js와 ui.js는 *DASHBOARD_ITEM_DEFINITIONS* 정의만 공유하고,
    // *getAllDashboardDefinitions* 로직은 각자(admin.js, ui.js) 가지고 있어야 합니다.
    // 따라서 기존 ui.js의 로직을 복원합니다.
    
    // 커스텀 항목 정의를 기본 정의 형식에 맞게 변환
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


// ✅ [수정] 현황판 레이아웃 렌더링 함수 (초기 수량 로드 및 클릭 div 제거)
export const renderDashboardLayout = (appConfig) => {
    const container = document.getElementById('summary-content');
    if (!container) return;

    const itemIds = appConfig.dashboardItems || [];
    // ⛔️ [삭제] quantities 변수 (appConfig.dashboardQuantities는 admin.js에서 삭제됨)
    // const quantities = appConfig.dashboardQuantities || {}; 
    const allDefinitions = getAllDashboardDefinitions(appConfig);

    container.innerHTML = '';
    let html = '';

    itemIds.forEach(id => {
        const def = allDefinitions[id];
        if (!def) {
            console.warn(`Main App: Dashboard definition not found for ID: ${id}. Skipping render.`);
            return;
        }

        let valueContent;
        const isQuantity = def.isQuantity === true; // isQuantity 확인

        if (isQuantity) {
             // ✅ [수정] 초기값은 항상 0으로 설정
             valueContent = `<p id="${def.valueId}">0</p>`;
        } else {
             valueContent = `<p id="${def.valueId}">0</p>`; // 비수량 항목도 초기값 0
        }

        // isQuantity일 경우 dashboard-card-quantity 클래스 추가 (유지)
        html += `
            <div class="dashboard-card p-4 rounded-lg ${isQuantity ? 'dashboard-card-quantity' : ''}">
                <h4 class="text-sm font-bold uppercase tracking-wider">${def.title}</h4>
                ${valueContent}
            </div>
        `;
    });

    container.innerHTML = html;
};

// ✅ [수정] updateSummary 함수 (커스텀 항목 ID 처리, 수량 업데이트 제외 유지)
export const updateSummary = (appState, appConfig) => {
    // ✅ [수정] 모든 정의 가져오기
    const allDefinitions = getAllDashboardDefinitions(appConfig);

    // ✅ [수정] 정의된 모든 ID에 대해 요소 가져오기 시도 (수량 항목 포함)
    const elements = {};
    Object.keys(allDefinitions).forEach(id => {
        const def = allDefinitions[id];
        if (def && def.valueId) {
            elements[id] = document.getElementById(def.valueId);
        }
    });

    // --- (기존 계산 로직: totalStaffCount, onLeaveTotalCount 등...은 모두 동일) ---
    const teamGroups = appConfig.teamGroups || [];
    const allStaffMembers = new Set(teamGroups.flatMap(g => g.members));
    const allPartTimers = new Set((appState.partTimers || []).map(p => p.name));
    const totalStaffCount = allStaffMembers.size;
    const totalPartTimerCount = allPartTimers.size;

    const combinedOnLeaveMembers = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];

    const onLeaveMemberNames = new Set(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime))
            .map(item => item.member)
    );
    const onLeaveTotalCount = onLeaveMemberNames.size;


    // ✅ [수정] 업무중/휴식중/대기 인원 계산 로직 변경
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const pausedRecords = (appState.workRecords || []).filter(r => r.status === 'paused');
    
    const ongoingMembers = new Set(ongoingRecords.map(r => r.member));
    const pausedMembers = new Set(pausedRecords.map(r => r.member));

    // '업무중'은 'ongoing' 상태인 사람만 카운트
    const workingStaffCount = [...ongoingMembers].filter(member => allStaffMembers.has(member)).length;
    const workingPartTimerCount = [...ongoingMembers].filter(member => allPartTimers.has(member)).length;
    const totalWorkingCount = ongoingMembers.size; // '업무중' 총원

    // 근무 가능 인원 (기존과 동일)
    const availableStaffCount = totalStaffCount - [...onLeaveMemberNames].filter(member => allStaffMembers.has(member)).length;
    const availablePartTimerCount = totalPartTimerCount - [...onLeaveMemberNames].filter(member => allPartTimers.has(member)).length;
    
    // '휴식중' 인원
    const pausedStaffCount = [...pausedMembers].filter(member => allStaffMembers.has(member)).length;
    const pausedPartTimerCount = [...pausedMembers].filter(member => allPartTimers.has(member)).length;
    
    // '대기'는 (근무 가능) - (업무중) - (휴식중)
    const idleStaffCount = Math.max(0, availableStaffCount - workingStaffCount - pausedStaffCount);
    const idlePartTimerCount = Math.max(0, availablePartTimerCount - workingPartTimerCount - pausedPartTimerCount);
    
    const totalIdleCount = idleStaffCount + idlePartTimerCount; // '대기' 총원

    // 진행 업무(Task) 카운트는 'ongoing' + 'paused' 모두 포함 (기존 로직 유지)
    const ongoingOrPausedRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const ongoingTaskCount = new Set(ongoingOrPausedRecords.map(r => r.task)).size;
    // --- (계산 로직 끝) ---


    // ✅ [수정] 동적으로 요소 업데이트 (수량 항목 제외)
    if (elements['total-staff']) elements['total-staff'].textContent = `${totalStaffCount}/${totalPartTimerCount}`;
    if (elements['leave-staff']) elements['leave-staff'].textContent = `${onLeaveTotalCount}`;
    if (elements['active-staff']) elements['active-staff'].textContent = `${availableStaffCount}/${availablePartTimerCount}`;
    if (elements['working-staff']) elements['working-staff'].textContent = `${totalWorkingCount}`;
    if (elements['idle-staff']) elements['idle-staff'].textContent = `${totalIdleCount}`;
    if (elements['ongoing-tasks']) elements['ongoing-tasks'].textContent = `${ongoingTaskCount}`;

    // total-work-time은 타이머(updateElapsedTimes)가 관리

    // --- 👇 [수정] 수량 항목 업데이트 로직 (appConfig.quantityToDashboardMap 사용) ---
    const quantitiesFromState = appState.taskQuantities || {}; // Firestore에서 로드된 최신 수량
    
    // ✅ [수정] 관리자 페이지에서 설정한 맵을 직접 사용
    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};
    
    // 4. appState의 수량을 현황판 요소에 반영
    for (const task in quantitiesFromState) {
        const quantity = quantitiesFromState[task] || 0;
        const targetDashboardId = taskNameToDashboardIdMap[task]; // 매핑된 현황판 ID 찾기

        if (targetDashboardId && elements[targetDashboardId]) { // 해당 현황판 요소가 존재하는지 확인
            elements[targetDashboardId].textContent = quantity; // 요소의 텍스트 업데이트
        }
    }
    // --- 👆 [수정 끝] ---
};