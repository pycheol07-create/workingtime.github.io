// === js/analysis-logic.js ===
// 설명: app-history-logic.js에서 분리된 순수 계산 및 분석 함수 모음입니다.

import * as State from './state.js';
import { formatDuration } from './utils.js';
import { calculateStandardThroughputs } from './ui-history-reports-logic.js';

/**
 * (app-history-logic.js -> analysis-logic.js)
 * 누락된 처리량이 있는지 확인하는 함수
 */
export const checkMissingQuantities = (dayData) => {
    if (!dayData || !dayData.workRecords) return [];

    const records = dayData.workRecords;
    const quantities = dayData.taskQuantities || {};
    const confirmedZeroTasks = dayData.confirmedZeroTasks || [];

    const durationByTask = records.reduce((acc, r) => {
        if (r.task && r.duration > 0) {
            acc[r.task] = (acc[r.task] || 0) + r.duration;
        }
        return acc;
    }, {});

    const tasksWithDuration = Object.keys(durationByTask);
    if (tasksWithDuration.length === 0) return [];
    
    // ✅ [수정] State.appConfig가 로드되기 전에 호출될 수 있으므로 방어 코드 추가
    const quantityTaskTypes = (State.appConfig && State.appConfig.quantityTaskTypes) ? State.appConfig.quantityTaskTypes : [];
    const missingTasks = [];

    for (const task of tasksWithDuration) {
        if (quantityTaskTypes.includes(task)) {
            const quantity = Number(quantities[task]) || 0;
            if (quantity <= 0 && !confirmedZeroTasks.includes(task)) {
                missingTasks.push(task);
            }
        }
    }

    return missingTasks;
};

/**
 * (app-history-logic.js -> analysis-logic.js)
 * 인건비 시뮬레이션 계산 로직
 * ✅ [수정] includeLinkedTasks 인자 추가 및 계산 로직 변경
 */
export const calculateSimulation = (mode, task, targetQty, inputValue, startTimeStr = "09:00", includeLinkedTasks = true) => {
    // mode: 'fixed-workers' | 'target-time'
    if (!task || targetQty <= 0 || inputValue <= 0) {
        return { error: "모든 값을 올바르게 입력해주세요." };
    }

    // ✅ [수정] State에서 appConfig를 안전하게 가져옵니다.
    const currentAppConfig = State.appConfig || {};
    const standards = calculateStandardThroughputs(State.allHistoryData);
    const speedPerPerson = standards[task] || 0; // (개/분/인)

    // ✅ [수정] '건당 평균 시간' (분/건)을 가져오도록 헬퍼 함수 변경
    const linkedAvgDurations = calculateLinkedTaskAverageDuration(State.allHistoryData, currentAppConfig);
    // ✅ [수정] 체크박스 값에 따라 연관 업무 시간을 0으로 설정
    const linkedTaskAvgDuration = includeLinkedTasks ? (linkedAvgDurations[task] || 0) : 0; // (분/건)
    const linkedTaskName = currentAppConfig.simulationTaskLinks ? currentAppConfig.simulationTaskLinks[task] : null;


    if (speedPerPerson <= 0) {
        return { error: "해당 업무의 과거 이력 데이터가 부족하여 예측할 수 없습니다." };
    }

    // ✅ [수정] currentAppConfig에서 시급을 가져옵니다.
    const avgWagePerMinute = (currentAppConfig.defaultPartTimerWage || 10000) / 60;
    
    // ✅ [수정] '주업무'에 필요한 총 *맨-분* (Man-Minutes)
    const totalManMinutesForMainTask = targetQty / speedPerPerson;
    
    // ✅ [수정] 연관 업무 정보 (표시용)
    let relatedTaskInfo = null;
    if (linkedTaskName) {
        relatedTaskInfo = {
            name: linkedTaskName,
            time: linkedTaskAvgDuration // 인원수로 나누지 않은 고정 시간 (예: 29분)
        };
    }

    let result = {
        speed: speedPerPerson,
        relatedTaskInfo: relatedTaskInfo 
    };

    if (mode === 'fixed-workers') {
        // 입력값 = 인원 수 -> 결과값 = 소요 시간
        result.workerCount = inputValue; // 예: 5명

        // ✅ [수정] 1. 주 업무에 걸리는 시간 (인원수로 나눔)
        const durationForMainTask = totalManMinutesForMainTask / result.workerCount; // 예: 500맨분 / 5명 = 100분
        
        // ✅ [수정] 2. 최종 소요 시간 = (주 업무 시간) + (사전 작업 고정 시간)
        // (사전 작업 시간(linkedTaskAvgDuration)은 인원수로 나누지 않음)
        result.durationMinutes = durationForMainTask + linkedTaskAvgDuration; // 예: 100분 + 29분 = 129분

        // ✅ [수정] 3. 총 비용 계산
        // (팀원들은 주 업무 + 사전 작업 시간 동안 모두 급여를 받음)
        const totalManMinutesNeeded = result.durationMinutes * result.workerCount; // 예: 129분 * 5명 = 645 맨분
        result.totalCost = totalManMinutesNeeded * avgWagePerMinute;


        result.label1 = '예상 소요 시간';
        result.value1 = formatDuration(result.durationMinutes);

        // ✨ 휴게시간(12:30~13:30) 고려한 종료 시간 예측
        const now = new Date();
        const safeStartTimeStr = String(startTimeStr || "09:00");
        const [startH, startM] = safeStartTimeStr.split(':').map(Number);
        const startDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
        
        const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
        const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);
        
        // ✅ [수정] durationMinutes (129분) 기준으로 종료 시간 계산
        let endDateTime = new Date(startDateTime.getTime() + result.durationMinutes * 60000);

        // 작업 구간이 점심시간을 포함하는지 체크
        if (startDateTime < lunchEnd && endDateTime > lunchStart) {
             result.durationMinutes += 60; // 실제 소요 시간에 점심시간 포함
             result.value1 = `${formatDuration(result.durationMinutes)} (점심포함)`;
             endDateTime = new Date(endDateTime.getTime() + 60 * 60000); // 종료 시각도 1시간 뒤로 밀림
             result.includesLunch = true; // ✨ 점심 포함 플래그
        } else {
             result.includesLunch = false;
        }
        
        result.expectedEndTime = `${endDateTime.getHours().toString().padStart(2, '0')}:${endDateTime.getMinutes().toString().padStart(2, '0')}`;

    } else if (mode === 'target-time') {
        // (목표 시간 모드는 로직이 더 복잡하므로, 일단 'fixed-workers' 모드 기준으로 수정했습니다.)
        // (기존 로직 유지)
        result.durationMinutes = inputValue;
        // (기존) totalManMinutesNeeded = totalManMinutesForMainTask + linkedTaskAvgDuration
        // (수정) (필요 인원 * 목표 시간) = (주업무 맨-분) + (필요 인원 * 사전작업 시간)
        // (W * D) = M + (W * L)
        // W * D - W * L = M
        // W * (D - L) = M
        // W = M / (D - L)
        const effectiveDuration = inputValue - linkedTaskAvgDuration; // 목표시간 - 사전작업 고정시간
        if (effectiveDuration <= 0) {
            return { error: "목표 시간이 사전 작업 시간보다 짧아 계산할 수 없습니다." };
        }
        
        result.workerCount = totalManMinutesForMainTask / effectiveDuration;
        result.label1 = '필요 인원';
        result.value1 = `${Math.ceil(result.workerCount * 10) / 10} 명`;
        
        const totalManMinutesNeeded = result.durationMinutes * result.workerCount;
        result.totalCost = totalManMinutesNeeded * avgWagePerMinute;

        // ... (종료 시각 계산 로직은 동일) ...
        const safeStartTimeStr = String(startTimeStr || "09:00");
        const [startH, startM] = safeStartTimeStr.split(':').map(Number);
        const now = new Date();
        const startDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
        
        const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
        const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);
        
        let endDateTime = new Date(startDateTime.getTime() + inputValue * 60000);
        
        if (startDateTime < lunchEnd && endDateTime > lunchStart) {
             endDateTime = new Date(endDateTime.getTime() + 60 * 60000);
             result.includesLunch = true;
        } else {
             result.includesLunch = false;
        }

        result.expectedEndTime = `${endDateTime.getHours().toString().padStart(2, '0')}:${endDateTime.getMinutes().toString().padStart(2, '0')}`;
    }

    return result;
};

/**
 * (app-history-logic.js -> analysis-logic.js)
 * 효율 곡선 차트 데이터 생성
 */
export const generateEfficiencyChartData = (task, targetQty, historyData) => {
    // ... (이 함수는 변경 없음) ...
    const standards = calculateStandardThroughputs(historyData);
    const speedPerPerson = standards[task] || 0;
    if (speedPerPerson <= 0) return null;

    const totalManMinutes = targetQty / speedPerPerson;
    const labels = [];
    const data = [];

    for (let workers = 1; workers <= 15; workers++) {
        labels.push(`${workers}명`);
        data.push(Math.round(totalManMinutes / workers));
    }

    return { labels, data, taskName: task };
};

/**
 * (app-history-logic.js -> analysis-logic.js)
 * 병목 구간 분석 로직
 */
export const analyzeBottlenecks = (historyData) => {
    // ... (이 함수는 변경 없음) ...
    const standards = calculateStandardThroughputs(historyData);
    const ranked = Object.entries(standards)
        .map(([task, speed]) => ({
            task,
            speed,
            timeFor1000: (speed > 0) ? (1000 / speed) : 0 // 1000개 처리 시 필요 시간 (1인 기준)
        }))
        .filter(item => item.speed > 0)
        .sort((a, b) => b.timeFor1000 - a.timeFor1000) // 시간이 오래 걸릴수록(느릴수록) 상위
        .slice(0, 5); // 상위 5개

    return ranked;
};


/**
 * ✅ [수정] 연관 업무의 '건당 평균 시간' (분/건) 계산 헬퍼
 * (e.g. '직진배송 준비작업' 1건당 평균 몇 분이 걸리는가?)
 * [수정] 'calculateLinkedTaskMinutesPerItem' -> 'calculateLinkedTaskAverageDuration'
 */
const calculateLinkedTaskAverageDuration = (allHistoryData, appConfig) => {
    // ... (이 함수는 이전 답변과 동일, 변경 없음) ...
    const links = (appConfig && appConfig.simulationTaskLinks) ? appConfig.simulationTaskLinks : {};
    const mainTasks = Object.keys(links);
    if (mainTasks.length === 0 || !allHistoryData) return {};

    const linkedTasks = new Set(Object.values(links));
    const taskStats = {}; // { duration: 총 시간, count: 총 횟수 }

    allHistoryData.forEach(day => {
        // 1. Aggregate Durations & Counts (연관 업무의 총 시간 및 횟수 집계)
        (day.workRecords || []).forEach(r => {
            // ✅ [수정] '직진배송 사전작업' 같은 연관 업무를 찾습니다.
            if (linkedTasks.has(r.task)) {
                if (!taskStats[r.task]) {
                    taskStats[r.task] = { duration: 0, count: 0 };
                }
                // ✅ [수정] 리포트 로직과 동일하게, duration이 0이더라도 count합니다.
                taskStats[r.task].duration += (r.duration || 0);
                taskStats[r.task].count += 1;
            }
        });
        // ⛔️ [삭제] 주 업무(메인)의 처리량(quantity) 집계 로직 삭제
    });

    const avgDurations = {}; // 연관 업무의 평균 시간 (분/건)
    Object.entries(taskStats).forEach(([taskName, stats]) => {
        if (stats.count > 0) {
            avgDurations[taskName] = stats.duration / stats.count; // (평균 분/건)
        }
    });

    // 2. 주 업무(mainTask)를 기준으로 매핑하여 반환
    const mainTaskAvgDurations = {};
    for (const mainTask of mainTasks) {
        const linkedTaskName = links[mainTask];
        if (avgDurations[linkedTaskName]) {
            mainTaskAvgDurations[mainTask] = avgDurations[linkedTaskName];
        }
    }
    return mainTaskAvgDurations;
};