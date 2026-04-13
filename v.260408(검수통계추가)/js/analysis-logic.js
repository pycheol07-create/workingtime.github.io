// === js/analysis-logic.js ===
// 설명: 순수 계산 및 분석 함수 모음입니다. (시뮬레이션, 병목 분석, 예측 등)

import * as State from './state.js';
import { formatDuration, getTodayDateString } from './utils.js';
import { calculateStandardThroughputs } from './ui-history-reports-logic.js';

/**
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
 * 인건비 시뮬레이션 계산 로직
 */
export const calculateSimulation = (mode, task, targetQty, inputValue, startTimeStr = "09:00", includeLinkedTasks = true, manualSpeed = null) => {
    // mode: 'fixed-workers' | 'target-time'
    if (!task || targetQty <= 0 || inputValue <= 0) {
        return { error: "모든 값을 올바르게 입력해주세요." };
    }

    const currentAppConfig = State.appConfig || {};
    const standards = calculateStandardThroughputs(State.allHistoryData);
    
    const speedPerPerson = (manualSpeed !== null && manualSpeed > 0) 
        ? Number(manualSpeed) 
        : (standards[task] || 0); 

    const linkedAvgDurations = calculateLinkedTaskAverageDuration(State.allHistoryData, currentAppConfig);
    const linkedTaskAvgDuration = includeLinkedTasks ? (linkedAvgDurations[task] || 0) : 0; 
    const linkedTaskName = currentAppConfig.simulationTaskLinks ? currentAppConfig.simulationTaskLinks[task] : null;

    if (speedPerPerson <= 0) {
        return { error: "해당 업무의 과거 이력 데이터가 부족하여 예측할 수 없습니다. (속도를 직접 입력해보세요)" };
    }

    const avgWagePerMinute = (currentAppConfig.defaultPartTimerWage || 10000) / 60;
    const totalManMinutesForMainTask = targetQty / speedPerPerson;
    
    let relatedTaskInfo = null;
    if (linkedTaskName) {
        relatedTaskInfo = {
            name: linkedTaskName,
            time: linkedTaskAvgDuration 
        };
    }

    let result = {
        speed: speedPerPerson,
        relatedTaskInfo: relatedTaskInfo 
    };

    if (mode === 'fixed-workers') {
        result.workerCount = inputValue; 
        const durationForMainTask = totalManMinutesForMainTask / result.workerCount; 
        result.durationMinutes = durationForMainTask + linkedTaskAvgDuration; 

        const totalManMinutesNeeded = result.durationMinutes * result.workerCount; 
        result.totalCost = totalManMinutesNeeded * avgWagePerMinute;

        result.label1 = '예상 소요 시간';
        result.value1 = formatDuration(result.durationMinutes);

        const now = new Date();
        const safeStartTimeStr = String(startTimeStr || "09:00");
        const [startH, startM] = safeStartTimeStr.split(':').map(Number);
        const startDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
        
        const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
        const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);
        
        let endDateTime = new Date(startDateTime.getTime() + result.durationMinutes * 60000);

        if (startDateTime < lunchEnd && endDateTime > lunchStart) {
             result.durationMinutes += 60; 
             result.value1 = `${formatDuration(result.durationMinutes)} (점심포함)`;
             endDateTime = new Date(endDateTime.getTime() + 60 * 60000); 
             result.includesLunch = true; 
        } else {
             result.includesLunch = false;
        }
        
        result.expectedEndTime = `${endDateTime.getHours().toString().padStart(2, '0')}:${endDateTime.getMinutes().toString().padStart(2, '0')}`;

    } else if (mode === 'target-time') {
        result.durationMinutes = inputValue;
        
        const effectiveDuration = inputValue - linkedTaskAvgDuration; 
        if (effectiveDuration <= 0) {
            return { error: "목표 시간이 사전 작업 시간보다 짧아 계산할 수 없습니다." };
        }
        
        result.workerCount = Math.ceil(totalManMinutesForMainTask / effectiveDuration);
        
        result.label1 = '필요 인원';
        result.value1 = `${result.workerCount} 명`;
        
        const totalManMinutesNeeded = result.durationMinutes * result.workerCount;
        result.totalCost = totalManMinutesNeeded * avgWagePerMinute;

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
 * 병목 구간 분석 로직
 */
export const analyzeBottlenecks = (historyData) => {
    const standards = calculateStandardThroughputs(historyData);
    const ranked = Object.entries(standards)
        .map(([task, speed]) => ({
            task,
            speed,
            timeFor1000: (speed > 0) ? (1000 / speed) : 0 
        }))
        .filter(item => item.speed > 0)
        .sort((a, b) => b.timeFor1000 - a.timeFor1000) 
        .slice(0, 5); 

    return ranked;
};

const calculateLinkedTaskAverageDuration = (allHistoryData, appConfig) => {
    const links = (appConfig && appConfig.simulationTaskLinks) ? appConfig.simulationTaskLinks : {};
    const mainTasks = Object.keys(links);
    if (mainTasks.length === 0 || !allHistoryData) return {};

    const linkedTasks = new Set(Object.values(links));
    const taskStats = {}; 

    allHistoryData.forEach(day => {
        (day.workRecords || []).forEach(r => {
            if (linkedTasks.has(r.task)) {
                if (!taskStats[r.task]) {
                    taskStats[r.task] = { duration: 0, count: 0 };
                }
                taskStats[r.task].duration += (r.duration || 0);
                taskStats[r.task].count += 1;
            }
        });
    });

    const avgDurations = {}; 
    Object.entries(taskStats).forEach(([taskName, stats]) => {
        if (stats.count > 0) {
            avgDurations[taskName] = stats.duration / stats.count; 
        }
    });

    const mainTaskAvgDurations = {};
    for (const mainTask of mainTasks) {
        const linkedTaskName = links[mainTask];
        if (avgDurations[linkedTaskName]) {
            mainTaskAvgDurations[mainTask] = avgDurations[linkedTaskName];
        }
    }
    return mainTaskAvgDurations;
};

/**
 * ✅ [완전 개편] 오차 누적 기반 보정 알고리즘
 * "어제의 시점"에서 데이터를 분석해 오늘의 예측값을 산출하고, 과거 14일 오차율을 스스로 학습하여 보정합니다.
 */
export const predictFutureTrends = (historyData, daysToPredict = 14) => {
    const todayStr = getTodayDateString();
    const sortedData = [...historyData].sort((a, b) => a.id.localeCompare(b.id));

    // 1. 학습에 사용할 '과거 데이터 (어제까지)' 분리 (오늘 데이터에 오염되지 않기 위해)
    const pastData = sortedData.filter(d => d.id < todayStr).slice(-90);
    // 오늘의 실제 데이터 추출
    const todayData = sortedData.find(d => d.id === todayStr) || { id: todayStr, management: { revenue: 0 }, taskQuantities: { '국내배송': 0 } };

    if (pastData.length < 7) return null; // 예측을 위한 최소 일수

    // 2. 요일별(Day of Week) 평균 및 최근 추세 계산
    const dowStats = { rev: {0:[],1:[],2:[],3:[],4:[],5:[],6:[]}, del: {0:[],1:[],2:[],3:[],4:[],5:[],6:[]} };
    let recent7Rev = [], recent30Rev = [], recent7Del = [], recent30Del = [];

    pastData.forEach((day, index) => {
        const dow = new Date(day.id).getDay();
        const rev = Number(day.management?.revenue) || 0;
        const del = Number(day.taskQuantities?.['국내배송']) || 0;

        dowStats.rev[dow].push(rev);
        dowStats.del[dow].push(del);

        const daysFromEnd = pastData.length - 1 - index;
        if (daysFromEnd < 7) {
            if (rev > 0) recent7Rev.push(rev);
            if (del > 0) recent7Del.push(del);
        }
        if (daysFromEnd < 30) {
            if (rev > 0) recent30Rev.push(rev);
            if (del > 0) recent30Del.push(del);
        }
    });

    const getAvg = (arr) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
    const dowAvgRev = {}, dowAvgDel = {};
    for (let i = 0; i < 7; i++) {
        dowAvgRev[i] = getAvg(dowStats.rev[i]);
        dowAvgDel[i] = getAvg(dowStats.del[i]);
    }

    const avg30Rev = getAvg(recent30Rev), avg7Rev = getAvg(recent7Rev);
    const avg30Del = getAvg(recent30Del), avg7Del = getAvg(recent7Del);

    let trendRev = 1, trendDel = 1;
    if (avg30Rev > 0) trendRev = Math.max(0.7, Math.min(1.3, avg7Rev / avg30Rev));
    if (avg30Del > 0) trendDel = Math.max(0.7, Math.min(1.3, avg7Del / avg30Del));

    // 3. 🎯 핵심: 최근 14일 백테스팅을 통한 AI 오차 보정치 산출
    const backtestDays = pastData.slice(-14);
    let sumActualRev = 0, sumPredRev = 0;
    let sumActualDel = 0, sumPredDel = 0;

    backtestDays.forEach(day => {
        const dow = new Date(day.id).getDay();
        const actualRev = Number(day.management?.revenue) || 0;
        const actualDel = Number(day.taskQuantities?.['국내배송']) || 0;

        let pRev = dowAvgRev[dow] * trendRev;
        let pDel = dowAvgDel[dow] * trendDel;

        if (actualRev > 0) { sumActualRev += actualRev; sumPredRev += pRev; }
        if (actualDel > 0) { sumActualDel += actualDel; sumPredDel += pDel; }
    });

    // 오차율 가중치 (±20% 리미트)
    let errorFactorRev = 1;
    let errorFactorDel = 1;
    if (sumPredRev > 0) errorFactorRev = Math.max(0.8, Math.min(1.2, sumActualRev / sumPredRev));
    if (sumPredDel > 0) errorFactorDel = Math.max(0.8, Math.min(1.2, sumActualDel / sumPredDel));

    // 4. "오늘"의 예측값 (어제 기준 모델을 활용하여 산출) 및 실제값 매핑
    const todayDow = new Date(todayStr).getDay();
    let todayPredRev = dowAvgRev[todayDow] * trendRev * errorFactorRev;
    let todayPredDel = dowAvgDel[todayDow] * trendDel * errorFactorDel;

    // 평일인데 요일 평균이 0인 예외 상황 보정
    if (todayDow > 0 && todayDow < 6) {
        if (dowAvgRev[todayDow] === 0 && avg30Rev > 0) todayPredRev = avg30Rev * 0.8 * errorFactorRev;
        if (dowAvgDel[todayDow] === 0 && avg30Del > 0) todayPredDel = avg30Del * 0.8 * errorFactorDel;
    }
    todayPredRev = Math.round(Math.max(0, todayPredRev));
    todayPredDel = Math.round(Math.max(0, todayPredDel));

    const todayActualRev = Number(todayData.management?.revenue) || 0;
    const todayActualDel = Number(todayData.taskQuantities?.['국내배송']) || 0;

    // 5. "내일"부터 미래 기간 예측
    const futureLabels = [];
    const predictedRevenue = [];
    const predictedDelivery = [];

    let tomorrowRev = 0, tomorrowDel = 0;
    const todayDateObj = new Date(todayStr);

    for (let i = 1; i <= daysToPredict; i++) {
        const targetDate = new Date(todayDateObj.getTime() + (i * 24 * 60 * 60 * 1000));
        const dow = targetDate.getDay();
        const dateStr = targetDate.toISOString().slice(5, 10);

        let pRev = dowAvgRev[dow] * trendRev * errorFactorRev;
        let pDel = dowAvgDel[dow] * trendDel * errorFactorDel;

        if (dow > 0 && dow < 6) {
            if (dowAvgRev[dow] === 0 && avg30Rev > 0) pRev = avg30Rev * 0.8 * errorFactorRev;
            if (dowAvgDel[dow] === 0 && avg30Del > 0) pDel = avg30Del * 0.8 * errorFactorDel;
        }

        pRev = Math.round(Math.max(0, pRev));
        pDel = Math.round(Math.max(0, pDel));

        futureLabels.push(dateStr);
        predictedRevenue.push(pRev);
        predictedDelivery.push(pDel);

        if (i === 1) {
            tomorrowRev = pRev;
            tomorrowDel = pDel;
        }
    }

    const displayHist = sortedData.slice(-30);

    return {
        historical: {
            labels: displayHist.map(d => d.id.substring(5)),
            revenue: displayHist.map(d => Number(d.management?.revenue) || 0),
            delivery: displayHist.map(d => Number(d.taskQuantities?.['국내배송']) || 0)
        },
        prediction: {
            labels: futureLabels,
            revenue: predictedRevenue,
            delivery: predictedDelivery,
            today: {
                predictedRev: todayPredRev,
                predictedDel: todayPredDel,
                actualRev: todayActualRev,
                actualDel: todayActualDel,
                errorFactorRev: errorFactorRev,
                errorFactorDel: errorFactorDel
            },
            tomorrow: {
                revenue: tomorrowRev,
                delivery: tomorrowDel
            }
        },
        trend: {
            revenueFactor: trendRev,
            deliveryFactor: trendDel
        }
    };
};