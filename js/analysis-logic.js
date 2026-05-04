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
 * 🚀 [개선된 엔진] 고도화된 타임라인 기반 시뮬레이터 (피로도 및 정밀 역산 적용)
 * mode: 'fixed-workers' (인원 고정 -> 소요 시간 산출) | 'target-time' (시간 고정 -> 정밀 필요 인원 산출)
 */
export const runAdvancedSimulation = (mode, taskList, inputValue, startTimeStr = "09:00", includeLinkedTasks = true) => {
    if (!taskList || taskList.length === 0 || !inputValue) {
        return { error: "업무 목록과 입력값을 올바르게 설정해주세요." };
    }

    const currentAppConfig = State.appConfig || {};
    const standards = calculateStandardThroughputs(State.allHistoryData);
    const avgWagePerMin = (currentAppConfig.defaultPartTimerWage || 10000) / 60;
    const linkedAvgDurations = calculateLinkedTaskAverageDuration(State.allHistoryData, currentAppConfig);

    // ✨ 개선점 1: 현장 현실을 반영한 환경 변수 설정
    const FATIGUE_RATE = 0.95; // 장시간 근무에 따른 피로도 (기본 속도의 95% 효율로 계산)
    const PREP_TIME_MINS = 5;  // 업무 시작 전 자재 준비 등 세팅 시간 (5분)

    const now = new Date();
    const safeStartTimeStr = String(startTimeStr || "09:00");
    const [startH, startM] = safeStartTimeStr.split(':').map(Number);
    const globalStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
    const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
    const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);

    // 내부 시뮬레이션 실행기: 특정 인원(workerCount)이 투입되었을 때의 결과를 계산하는 핵심 엔진
    const executeSimulationForWorkers = (workerCount) => {
        // 매 시뮬레이션마다 작업 데이터를 초기화합니다.
        const tasks = taskList.map(t => {
            // 피로도가 반영된 실제 분당 처리 속도
            const baseSpeed = (t.manualSpeed !== null && t.manualSpeed > 0) ? t.manualSpeed : (standards[t.task] || 0.1);
            const realisticSpeed = baseSpeed * FATIGUE_RATE; 

            const linkedTaskAvgDuration = includeLinkedTasks ? (linkedAvgDurations[t.task] || 0) : 0;
            
            let relatedTaskInfo = null;
            if (includeLinkedTasks && currentAppConfig.simulationTaskLinks && currentAppConfig.simulationTaskLinks[t.task]) {
                relatedTaskInfo = { name: currentAppConfig.simulationTaskLinks[t.task], time: linkedTaskAvgDuration };
            }

            return {
                ...t,
                speedPerMin: realisticSpeed,
                remainingQty: t.targetQty,
                // 준비 시간(PREP_TIME_MINS)과 연관 작업 시간을 함께 더합니다.
                linkedTaskDuration: linkedTaskAvgDuration + PREP_TIME_MINS,
                relatedTaskInfo: relatedTaskInfo,
                startTime: null,
                endTime: null,
                isCompleted: false,
                finalDuration: 0
            };
        });

        let currentTime = new Date(globalStart.getTime());
        let activeTasks = [];
        let completedCount = 0;
        let minuteCounter = 0;
        const maxMinutes = 1440 * 2; // 최대 48시간 루프 보호

        while (completedCount < tasks.length && minuteCounter < maxMinutes) {
            // 점심시간 패스
            if (currentTime >= lunchStart && currentTime < lunchEnd) {
                currentTime.setMinutes(currentTime.getMinutes() + 1);
                minuteCounter++;
                continue;
            }

            // 작업 투입 판별
            tasks.forEach((t, idx) => {
                if (!t.isCompleted && !activeTasks.includes(t)) {
                    const prevTask = tasks[idx - 1];
                    const canStart = idx === 0 || 
                                    (t.isConcurrent && prevTask && prevTask.startTime !== null) || 
                                    (!t.isConcurrent && prevTask && prevTask.isCompleted);

                    if (canStart) {
                        t.startTime = new Date(currentTime.getTime());
                        activeTasks.push(t);
                    }
                }
            });

            // 처리량 할당 및 차감
            const currentActiveCount = activeTasks.length;
            if (currentActiveCount > 0) {
                const workerShare = workerCount / currentActiveCount;

                activeTasks.forEach(t => {
                    if (t.linkedTaskDuration > 0) {
                        t.linkedTaskDuration -= 1; // 사전 작업 및 준비 시간 1분 차감
                    } else {
                        t.remainingQty -= (t.speedPerMin * workerShare); // 수량 차감
                    }

                    // 완료 체크
                    if (t.remainingQty <= 0 && t.linkedTaskDuration <= 0) {
                        t.endTime = new Date(currentTime.getTime());
                        t.endTime.setMinutes(t.endTime.getMinutes() + 1);
                        t.isCompleted = true;
                        t.finalDuration = (t.endTime.getTime() - t.startTime.getTime()) / 60000;
                        completedCount++;
                    }
                });
                activeTasks = activeTasks.filter(t => !t.isCompleted);
            }

            currentTime.setMinutes(currentTime.getMinutes() + 1);
            minuteCounter++;
        }

        let maxEndTime = globalStart;
        tasks.forEach(t => { if (t.endTime && t.endTime > maxEndTime) maxEndTime = t.endTime; });
        return { tasks, maxEndTime, minuteCounter, maxMinutes };
    };

    let optimalWorkers = 0;
    let finalSimResult = null;

    // ✨ 개선점 2: 정밀 역산 알고리즘 (가상 시뮬레이션 반복 탐색)
    if (mode === 'target-time') {
        const [endH, endM] = String(inputValue).split(':').map(Number);
        const targetEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endH, endM);
        
        // 1명부터 순차적으로 투입하며 시뮬레이션을 돌려 목표 시간을 맞추는 최소 인원을 찾습니다.
        let testWorkers = 1;
        while (testWorkers <= 50) { // 최대 50명 한계 설정
            const simResult = executeSimulationForWorkers(testWorkers);
            
            // 시뮬레이션 완료 시간이 목표 시간보다 같거나 빠르면 탐색 성공!
            if (simResult.maxEndTime <= targetEnd || simResult.minuteCounter >= simResult.maxMinutes) {
                optimalWorkers = testWorkers;
                finalSimResult = simResult;
                break;
            }
            testWorkers++;
        }
        if (optimalWorkers === 0) {
            optimalWorkers = 50; // 50명으로도 부족한 경우
            finalSimResult = executeSimulationForWorkers(50);
        }
    } else {
        // 일반 모드 (지정된 인원으로 1회 시뮬레이션)
        optimalWorkers = Number(inputValue);
        if (optimalWorkers <= 0) return { error: "투입 인원은 1명 이상이어야 합니다." };
        finalSimResult = executeSimulationForWorkers(optimalWorkers);
    }

    if (finalSimResult.minuteCounter >= finalSimResult.maxMinutes) {
        return { error: "시뮬레이션 처리 한도(48시간)를 초과했습니다. 수량이나 속도를 다시 확인해주세요." };
    }

    const totalDuration = (finalSimResult.maxEndTime.getTime() - globalStart.getTime()) / 60000;
    const formatTimeStr = (date) => `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;

    // 최종 결과 반환
    return {
        mode,
        totalWorkers: optimalWorkers,
        totalDuration,
        finalEndTimeStr: formatTimeStr(finalSimResult.maxEndTime),
        totalCost: (totalDuration * optimalWorkers) * avgWagePerMin,
        globalStartTimeMs: globalStart.getTime(),
        globalEndTimeMs: finalSimResult.maxEndTime.getTime(),
        startTime: startTimeStr,
        results: finalSimResult.tasks.map(t => {
            let includesLunch = false;
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
                requiredWorkers: optimalWorkers,
                includesLunch: includesLunch,
                relatedTaskInfo: t.relatedTaskInfo
            };
        })
    };
};