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

    const quantityTaskTypes = State.appConfig.quantityTaskTypes || [];
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
 */
export const calculateSimulation = (mode, task, targetQty, inputValue, startTimeStr = "09:00") => {
    // mode: 'fixed-workers' | 'target-time'
    if (!task || targetQty <= 0 || inputValue <= 0) {
        return { error: "모든 값을 올바르게 입력해주세요." };
    }

    const standards = calculateStandardThroughputs(State.allHistoryData); // ✅ State에서 직접 참조
    const speedPerPerson = standards[task] || 0; // (개/분/인)

    if (speedPerPerson <= 0) {
        return { error: "해당 업무의 과거 이력 데이터가 부족하여 예측할 수 없습니다." };
    }

    const avgWagePerMinute = (State.appConfig.defaultPartTimerWage || 10000) / 60; // ✅ State에서 직접 참조
    const totalManMinutesNeeded = targetQty / speedPerPerson; // 총 필요 인력분

    let result = {
        speed: speedPerPerson,
        totalCost: totalManMinutesNeeded * avgWagePerMinute
    };

    if (mode === 'fixed-workers') {
        // 입력값 = 인원 수 -> 결과값 = 소요 시간
        result.workerCount = inputValue;
        result.durationMinutes = totalManMinutesNeeded / inputValue;
        result.label1 = '예상 소요 시간';
        result.value1 = formatDuration(result.durationMinutes);

        // ✨ 휴게시간(12:30~13:30) 고려한 종료 시간 예측
        const now = new Date();
        const safeStartTimeStr = String(startTimeStr || "09:00");
        const [startH, startM] = safeStartTimeStr.split(':').map(Number);
        const startDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
        
        const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
        const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);
        
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
        // 입력값 = 목표 시간 -> 결과값 = 필요 인원
        result.durationMinutes = inputValue;
        result.workerCount = totalManMinutesNeeded / inputValue;
        result.label1 = '필요 인원';
        result.value1 = `${Math.ceil(result.workerCount * 10) / 10} 명`;
        
        // 역산 모드에서도 종료 시각은 단순 계산 (목표 시간만큼 더함)
        const safeStartTimeStr = String(startTimeStr || "09:00");
        const [startH, startM] = safeStartTimeStr.split(':').map(Number);
        const now = new Date();
        const startDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
        
        const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
        const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);
        
        let endDateTime = new Date(startDateTime.getTime() + inputValue * 60000);
        
        // 목표 시간이 점심시간을 포함하는지 체크
        if (startDateTime < lunchEnd && endDateTime > lunchStart) {
             endDateTime = new Date(endDateTime.getTime() + 60 * 60000); // 종료 시각도 1시간 뒤로 밀림
             result.includesLunch = true; // ✨ 점심 포함 플래그
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