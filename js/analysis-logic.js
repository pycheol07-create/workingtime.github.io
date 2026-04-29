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
 * 🚀 고도화된 오차 보정 및 패턴 예측 알고리즘 (핵심 3전략 적용)
 */
export const predictFutureTrends = (historyData, daysToPredict = 14) => {
    const todayStr = getTodayDateString();
    const sortedData = [...historyData].sort((a, b) => a.id.localeCompare(b.id));

    const pastData = sortedData.filter(d => d.id < todayStr).slice(-90);
    const todayData = sortedData.find(d => d.id === todayStr) || { id: todayStr, management: { revenue: 0 }, taskQuantities: { '국내배송': 0 } };

    if (pastData.length < 7) return null; 

    const getAdvancedDowPrediction = (records, targetDow, type) => {
        const sameDayRecords = records.filter(r => new Date(r.id).getDay() === targetDow);
        if (sameDayRecords.length === 0) return 0;

        sameDayRecords.sort((a, b) => b.id.localeCompare(a.id));

        let validRecords = sameDayRecords;

        if (sameDayRecords.length >= 5) {
            const sortedByVal = [...sameDayRecords].sort((a, b) => {
                const valA = type === 'rev' ? (Number(a.management?.revenue) || 0) : (Number(a.taskQuantities?.['국내배송']) || 0);
                const valB = type === 'rev' ? (Number(b.management?.revenue) || 0) : (Number(b.taskQuantities?.['국내배송']) || 0);
                return valA - valB;
            });
            sortedByVal.pop();   
            sortedByVal.shift(); 
            validRecords = sortedByVal.sort((a, b) => b.id.localeCompare(a.id)); 
        }

        let totalWeight = 0;
        let weightedSum = 0;
        validRecords.slice(0, 5).forEach((record, index) => {
            const val = type === 'rev' ? (Number(record.management?.revenue) || 0) : (Number(record.taskQuantities?.['국내배송']) || 0);
            const weight = Math.max(0.2, 1.0 - (index * 0.2)); 
            
            weightedSum += val * weight;
            totalWeight += weight;
        });

        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    };

    const advDowAvgRev = {};
    const advDowAvgDel = {};
    for (let i = 0; i < 7; i++) {
        advDowAvgRev[i] = getAdvancedDowPrediction(pastData, i, 'rev');
        advDowAvgDel[i] = getAdvancedDowPrediction(pastData, i, 'del');
    }

    const recent30Rev = pastData.slice(-30).map(d => Number(d.management?.revenue) || 0).filter(v => v > 0);
    const recent7Rev = pastData.slice(-7).map(d => Number(d.management?.revenue) || 0).filter(v => v > 0);
    const recent30Del = pastData.slice(-30).map(d => Number(d.taskQuantities?.['국내배송']) || 0).filter(v => v > 0);
    const recent7Del = pastData.slice(-7).map(d => Number(d.taskQuantities?.['국내배송']) || 0).filter(v => v > 0);

    const getAvg = (arr) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
    const avg30Rev = getAvg(recent30Rev), avg7Rev = getAvg(recent7Rev);
    const avg30Del = getAvg(recent30Del), avg7Del = getAvg(recent7Del);

    let trendRev = 1, trendDel = 1;
    if (avg30Rev > 0) trendRev = Math.max(0.7, Math.min(1.3, avg7Rev / avg30Rev));
    if (avg30Del > 0) trendDel = Math.max(0.7, Math.min(1.3, avg7Del / avg30Del));

    const backtestDays = pastData.slice(-14);
    let sumActualRev = 0, sumPredRev = 0;
    let sumActualDel = 0, sumPredDel = 0;

    backtestDays.forEach(day => {
        const dow = new Date(day.id).getDay();
        const actualRev = Number(day.management?.revenue) || 0;
        const actualDel = Number(day.taskQuantities?.['국내배송']) || 0;

        let pRev = advDowAvgRev[dow];
        let pDel = advDowAvgDel[dow];

        if (actualRev > 0) { sumActualRev += actualRev; sumPredRev += pRev; }
        if (actualDel > 0) { sumActualDel += actualDel; sumPredDel += pDel; }
    });

    let errorFactorRev = 1;
    let errorFactorDel = 1;
    if (sumPredRev > 0) errorFactorRev = Math.max(0.8, Math.min(1.2, sumActualRev / sumPredRev));
    if (sumPredDel > 0) errorFactorDel = Math.max(0.8, Math.min(1.2, sumActualDel / sumPredDel));

    const todayDow = new Date(todayStr).getDay();
    let todayPredRev = advDowAvgRev[todayDow] * errorFactorRev;
    let todayPredDel = advDowAvgDel[todayDow] * errorFactorDel;

    if (todayDow > 0 && todayDow < 6) { 
        if (advDowAvgRev[todayDow] === 0 && avg30Rev > 0) todayPredRev = avg30Rev * 0.8 * errorFactorRev;
        if (advDowAvgDel[todayDow] === 0 && avg30Del > 0) todayPredDel = avg30Del * 0.8 * errorFactorDel;
    }
    todayPredRev = Math.round(Math.max(0, todayPredRev));
    todayPredDel = Math.round(Math.max(0, todayPredDel));

    const todayActualRev = Number(todayData.management?.revenue) || 0;
    const todayActualDel = Number(todayData.taskQuantities?.['국내배송']) || 0;

    const futureLabels = [];
    const predictedRevenue = [];
    const predictedDelivery = [];

    let tomorrowRev = 0, tomorrowDel = 0;
    const todayDateObj = new Date(todayStr);

    for (let i = 1; i <= daysToPredict; i++) {
        const targetDate = new Date(todayDateObj.getTime() + (i * 24 * 60 * 60 * 1000));
        const dow = targetDate.getDay();
        const dateStr = targetDate.toISOString().slice(5, 10);

        let pRev = advDowAvgRev[dow] * errorFactorRev;
        let pDel = advDowAvgDel[dow] * errorFactorDel;

        if (dow > 0 && dow < 6) {
            if (advDowAvgRev[dow] === 0 && avg30Rev > 0) pRev = avg30Rev * 0.8 * errorFactorRev;
            if (advDowAvgDel[dow] === 0 && avg30Del > 0) pDel = avg30Del * 0.8 * errorFactorDel;
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

/**
 * 🚀 [개선된 엔진] 고도화된 타임라인 기반 시뮬레이터 
 * 시간, 점심시간, 인원 배분(동시진행)을 분(minute) 단위로 정교하게 시뮬레이션 합니다.
 * mode: 'fixed-workers' (인원 고정 -> 소요 시간 산출) | 'target-time' (시간 고정 -> 필요 인원 산출)
 */
export const runAdvancedSimulation = (mode, taskList, inputValue, startTimeStr = "09:00", includeLinkedTasks = true) => {
    if (!taskList || taskList.length === 0 || !inputValue) {
        return { error: "업무 목록과 입력값을 올바르게 설정해주세요." };
    }

    const currentAppConfig = State.appConfig || {};
    const standards = calculateStandardThroughputs(State.allHistoryData);
    const avgWagePerMin = (currentAppConfig.defaultPartTimerWage || 10000) / 60;
    const linkedAvgDurations = calculateLinkedTaskAverageDuration(State.allHistoryData, currentAppConfig);

    // 1. 데이터 준비 및 무결성 확보 (Fallback Speed 부여)
    const tasks = taskList.map(t => {
        const speed = (t.manualSpeed !== null && t.manualSpeed > 0) ? t.manualSpeed : (standards[t.task] || 0.1); 
        const linkedTaskAvgDuration = includeLinkedTasks ? (linkedAvgDurations[t.task] || 0) : 0;
        
        let relatedTaskInfo = null;
        if (includeLinkedTasks && currentAppConfig.simulationTaskLinks && currentAppConfig.simulationTaskLinks[t.task]) {
            relatedTaskInfo = { name: currentAppConfig.simulationTaskLinks[t.task], time: linkedTaskAvgDuration };
        }

        return {
            ...t,
            speedPerMin: speed,
            remainingQty: t.targetQty,
            totalManMinutes: t.targetQty / speed,
            linkedTaskDuration: linkedTaskAvgDuration,
            relatedTaskInfo: relatedTaskInfo,
            startTime: null,
            endTime: null,
            isCompleted: false,
            finalDuration: 0
        };
    });

    const now = new Date();
    const safeStartTimeStr = String(startTimeStr || "09:00");
    const [startH, startM] = safeStartTimeStr.split(':').map(Number);
    
    // 타임라인 기준점 설정
    let currentTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
    const globalStart = new Date(currentTime.getTime());
    
    const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
    const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);

    // 2. 인원 결정 로직
    let totalWorkers = 0;
    if (mode === 'target-time') {
        const [endH, endM] = String(inputValue).split(':').map(Number);
        const targetEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endH, endM);
        let availMin = (targetEnd.getTime() - globalStart.getTime()) / 60000;
        
        if (globalStart < lunchEnd && targetEnd > lunchStart) {
            availMin -= 60; // 목표 시간 내에 점심시간이 끼어있으면 실제 가용 시간에서 차감
        }
        
        if (availMin <= 0) return { error: "목표 시간이 너무 짧습니다." };

        // 모든 작업을 처리하는 데 필요한 순수 총 맨아워(Man-Minutes) 계산 (사전 작업 시간 포함)
        const totalManMinutes = tasks.reduce((sum, t) => sum + t.totalManMinutes + t.linkedTaskDuration, 0);
        totalWorkers = Math.ceil(totalManMinutes / availMin);
        
        if (totalWorkers <= 0) totalWorkers = 1;
    } else {
        totalWorkers = Number(inputValue);
        if (totalWorkers <= 0) return { error: "투입 인원은 1명 이상이어야 합니다." };
    }

    // 3. 분 단위(Minute-by-minute) 타임라인 시뮬레이션
    let activeTasks = [];
    let completedCount = 0;
    let minuteCounter = 0;
    const maxMinutes = 1440 * 2; // 최대 48시간 루프 보호

    while (completedCount < tasks.length && minuteCounter < maxMinutes) {
        // [점심시간 예외 처리] 해당 분(minute)이 점심시간이면 시간만 흐르고 작업은 중단
        if (currentTime >= lunchStart && currentTime < lunchEnd) {
            currentTime.setMinutes(currentTime.getMinutes() + 1);
            minuteCounter++;
            continue;
        }

        // [작업 투입 판별]
        tasks.forEach((t, idx) => {
            if (!t.isCompleted && !activeTasks.includes(t)) {
                const prevTask = tasks[idx - 1];
                // 첫 작업이거나, 연관 선행 작업이 끝났거나, 명시적으로 동시 진행이 체크된 경우 시작
                const canStart = idx === 0 || 
                                (t.isConcurrent && prevTask && prevTask.startTime !== null) || 
                                (!t.isConcurrent && prevTask && prevTask.isCompleted);

                if (canStart) {
                    t.startTime = new Date(currentTime.getTime());
                    activeTasks.push(t);
                }
            }
        });

        // [처리량 할당 및 차감] 동시 진행 중인 작업 수에 맞춰 인원을 N분의 1로 분산 투입
        const currentActiveCount = activeTasks.length;
        if (currentActiveCount > 0) {
            const workerShare = totalWorkers / currentActiveCount;

            activeTasks.forEach(t => {
                // 사전 작업이 남아있다면 먼저 차감
                if (t.linkedTaskDuration > 0) {
                    t.linkedTaskDuration -= 1; // 1분 경과
                } else {
                    // 본 작업 차감
                    t.remainingQty -= (t.speedPerMin * workerShare);
                }

                // 완료 체크
                if (t.remainingQty <= 0 && t.linkedTaskDuration <= 0) {
                    t.endTime = new Date(currentTime.getTime());
                    t.endTime.setMinutes(t.endTime.getMinutes() + 1); // 1분을 꽉 채워 종료
                    t.isCompleted = true;
                    t.finalDuration = (t.endTime.getTime() - t.startTime.getTime()) / 60000;
                    completedCount++;
                }
            });

            activeTasks = activeTasks.filter(t => !t.isCompleted);
        }

        // 1분 경과
        currentTime.setMinutes(currentTime.getMinutes() + 1);
        minuteCounter++;
    }

    if (minuteCounter >= maxMinutes) {
        return { error: "시뮬레이션 처리 한도(48시간)를 초과했습니다. 수량이나 속도를 다시 확인해주세요." };
    }

    // 최종 종료 시간 및 총 소요 시간 집계
    let maxEndTime = globalStart;
    tasks.forEach(t => {
        if (t.endTime && t.endTime > maxEndTime) maxEndTime = t.endTime;
    });

    const totalDuration = (maxEndTime.getTime() - globalStart.getTime()) / 60000;
    const formatTimeStr = (date) => `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;

    return {
        mode,
        totalWorkers,
        totalDuration,
        finalEndTimeStr: formatTimeStr(maxEndTime),
        totalCost: (totalDuration * totalWorkers) * avgWagePerMin,
        globalStartTimeMs: globalStart.getTime(),
        globalEndTimeMs: maxEndTime.getTime(),
        startTime: startTimeStr,
        results: tasks.map(t => {
            let includesLunch = false;
            // 해당 작업 진행 시간 중 점심시간이 1분이라도 끼어있으면 표시
            if (t.startTime < lunchEnd && t.endTime > lunchStart) {
                includesLunch = true;
            }
            return {
                task: t.task,
                speed: t.speedPerMin,
                startTime: formatTimeStr(t.startTime),
                expectedEndTime: formatTimeStr(t.endTime),
                durationMinutes: t.finalDuration,
                isConcurrent: t.isConcurrent,
                requiredWorkers: totalWorkers,
                includesLunch: includesLunch,
                relatedTaskInfo: t.relatedTaskInfo
            };
        })
    };
};