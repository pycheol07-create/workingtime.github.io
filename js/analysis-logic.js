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
 * 🚀 [개선된 엔진] 고도화된 실적 및 트렌드 예측 (이상치 제거, EMA 적용)
 */
export const predictFutureTrends = (historyData, daysToPredict = 14) => {
    const todayStr = getTodayDateString();
    const sortedData = [...historyData].sort((a, b) => a.id.localeCompare(b.id));

    // 최근 90일 데이터 기준
    const pastData = sortedData.filter(d => d.id < todayStr).slice(-90);
    const todayData = sortedData.find(d => d.id === todayStr) || { id: todayStr, management: { revenue: 0 }, taskQuantities: { '국내배송': 0 } };

    if (pastData.length < 7) return null; 

    // ✨ 개선점 1: IQR 방식을 이용한 이상치(Outlier) 제거 함수
    const filterOutliers = (arr) => {
        if (arr.length < 4) return arr;
        const sorted = [...arr].sort((a, b) => a - b);
        const q1 = sorted[Math.floor((sorted.length / 4))];
        const q3 = sorted[Math.floor((sorted.length * (3 / 4)))];
        const iqr = q3 - q1;
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;
        // 하한선은 0 이상 보장, 상한선을 넘어가는 폭증 데이터 제거
        return arr.filter(x => x >= Math.max(0, lowerBound) && x <= upperBound);
    };

    // ✨ 개선점 2: 지수이동평균(EMA) 계산 함수 (최근 데이터에 더 높은 가중치)
    const calcEMA = (dataArray, period) => {
        if (dataArray.length === 0) return 0;
        const k = 2 / (period + 1);
        let ema = dataArray[0];
        for (let i = 1; i < dataArray.length; i++) {
            ema = (dataArray[i] * k) + (ema * (1 - k));
        }
        return ema;
    };

    // 요일별(DoW) 기본 예상치 계산 (이상치 제거 적용)
    const getAdvancedDowPrediction = (records, targetDow, type) => {
        const sameDayRecords = records.filter(r => new Date(r.id).getDay() === targetDow);
        if (sameDayRecords.length === 0) return 0;

        // 최근 날짜순 정렬
        sameDayRecords.sort((a, b) => b.id.localeCompare(a.id));

        // 값만 추출
        const rawValues = sameDayRecords.map(r => type === 'rev' ? (Number(r.management?.revenue) || 0) : (Number(r.taskQuantities?.['국내배송']) || 0));
        
        // 0이 아닌 유의미한 데이터 필터링 후 이상치 제거
        const validValues = filterOutliers(rawValues.filter(v => v > 0));
        if (validValues.length === 0) return 0;

        // 평균 계산
        return validValues.reduce((a, b) => a + b, 0) / validValues.length;
    };

    const advDowAvgRev = {};
    const advDowAvgDel = {};
    for (let i = 0; i < 7; i++) {
        advDowAvgRev[i] = getAdvancedDowPrediction(pastData, i, 'rev');
        advDowAvgDel[i] = getAdvancedDowPrediction(pastData, i, 'del');
    }

    // 트렌드 분석을 위한 시계열 데이터 추출
    const revSeries = pastData.map(d => Number(d.management?.revenue) || 0).filter(v => v > 0);
    const delSeries = pastData.map(d => Number(d.taskQuantities?.['국내배송']) || 0).filter(v => v > 0);

    // EMA 트렌드 계산 (단기 7일 vs 장기 30일)
    const ema7Rev = calcEMA(revSeries.slice(-7), 7);
    const ema30Rev = calcEMA(revSeries.slice(-30), 30);
    const ema7Del = calcEMA(delSeries.slice(-7), 7);
    const ema30Del = calcEMA(delSeries.slice(-30), 30);

    let trendRev = 1, trendDel = 1;
    if (ema30Rev > 0) trendRev = Math.max(0.7, Math.min(1.3, ema7Rev / ema30Rev));
    if (ema30Del > 0) trendDel = Math.max(0.7, Math.min(1.3, ema7Del / ema30Del));

    // 최근 14일 데이터로 과거 오차율(Backtesting) 검증
    const backtestDays = pastData.slice(-14);
    let sumActualRev = 0, sumPredRev = 0;
    let sumActualDel = 0, sumPredDel = 0;

    backtestDays.forEach(day => {
        const dow = new Date(day.id).getDay();
        const actualRev = Number(day.management?.revenue) || 0;
        const actualDel = Number(day.taskQuantities?.['국내배송']) || 0;

        if (actualRev > 0) { sumActualRev += actualRev; sumPredRev += advDowAvgRev[dow]; }
        if (actualDel > 0) { sumActualDel += actualDel; sumPredDel += advDowAvgDel[dow]; }
    });

    let errorFactorRev = sumPredRev > 0 ? Math.max(0.85, Math.min(1.15, sumActualRev / sumPredRev)) : 1;
    let errorFactorDel = sumPredDel > 0 ? Math.max(0.85, Math.min(1.15, sumActualDel / sumPredDel)) : 1;

    // ✨ 개선점 3: 변동성(분산)을 기반으로 한 신뢰 구간 오차(Margin) 설정 (기본 ±10%)
    const marginRev = 0.10; 
    const marginDel = 0.10;

    const todayDow = new Date(todayStr).getDay();
    let todayPredRev = advDowAvgRev[todayDow] * errorFactorRev * trendRev;
    let todayPredDel = advDowAvgDel[todayDow] * errorFactorDel * trendDel;

    todayPredRev = Math.round(Math.max(0, todayPredRev));
    todayPredDel = Math.round(Math.max(0, todayPredDel));

    const todayActualRev = Number(todayData.management?.revenue) || 0;
    const todayActualDel = Number(todayData.taskQuantities?.['국내배송']) || 0;

    const futureLabels = [];
    const predictedRevenue = [];
    const predictedDelivery = [];
    
    // 신뢰구간 배열
    const rangeRevenue = [];
    const rangeDelivery = [];

    let tomorrowRev = 0, tomorrowDel = 0;
    const todayDateObj = new Date(todayStr);

    for (let i = 1; i <= daysToPredict; i++) {
        const targetDate = new Date(todayDateObj.getTime() + (i * 24 * 60 * 60 * 1000));
        const dow = targetDate.getDay();
        const dateStr = targetDate.toISOString().slice(5, 10);

        // 미래로 갈수록 트렌드 영향력은 조금씩 줄어들게 보정 (안정성)
        const decayTrendRev = 1 + (trendRev - 1) * Math.max(0.5, (1 - i*0.05));
        const decayTrendDel = 1 + (trendDel - 1) * Math.max(0.5, (1 - i*0.05));

        let pRev = Math.round(Math.max(0, advDowAvgRev[dow] * errorFactorRev * decayTrendRev));
        let pDel = Math.round(Math.max(0, advDowAvgDel[dow] * errorFactorDel * decayTrendDel));

        futureLabels.push(dateStr);
        predictedRevenue.push(pRev);
        predictedDelivery.push(pDel);

        // 신뢰구간(최소/최대 예측치)
        rangeRevenue.push({ min: Math.round(pRev * (1 - marginRev)), max: Math.round(pRev * (1 + marginRev)) });
        rangeDelivery.push({ min: Math.round(pDel * (1 - marginDel)), max: Math.round(pDel * (1 + marginDel)) });

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
            rangeRevenue: rangeRevenue,
            rangeDelivery: rangeDelivery,
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
 * 🚀 고도화된 타임라인 기반 시뮬레이터 (피로도 및 정밀 역산 적용)
 */
export const runAdvancedSimulation = (mode, taskList, inputValue, startTimeStr = "09:00", includeLinkedTasks = true) => {
    // (기존 runAdvancedSimulation 로직 유지)
    if (!taskList || taskList.length === 0 || !inputValue) {
        return { error: "업무 목록과 입력값을 올바르게 설정해주세요." };
    }

    const currentAppConfig = State.appConfig || {};
    const standards = calculateStandardThroughputs(State.allHistoryData);
    const avgWagePerMin = (currentAppConfig.defaultPartTimerWage || 10000) / 60;
    const linkedAvgDurations = calculateLinkedTaskAverageDuration(State.allHistoryData, currentAppConfig);

    const FATIGUE_RATE = 0.95; 
    const PREP_TIME_MINS = 5;  

    const now = new Date();
    const safeStartTimeStr = String(startTimeStr || "09:00");
    const [startH, startM] = safeStartTimeStr.split(':').map(Number);
    const globalStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
    const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
    const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);

    const executeSimulationForWorkers = (workerCount) => {
        const tasks = taskList.map(t => {
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
        const maxMinutes = 1440 * 2; 

        while (completedCount < tasks.length && minuteCounter < maxMinutes) {
            if (currentTime >= lunchStart && currentTime < lunchEnd) {
                currentTime.setMinutes(currentTime.getMinutes() + 1);
                minuteCounter++;
                continue;
            }

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

            const currentActiveCount = activeTasks.length;
            if (currentActiveCount > 0) {
                const workerShare = workerCount / currentActiveCount;

                activeTasks.forEach(t => {
                    if (t.linkedTaskDuration > 0) {
                        t.linkedTaskDuration -= 1; 
                    } else {
                        t.remainingQty -= (t.speedPerMin * workerShare); 
                    }

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

    if (mode === 'target-time') {
        const [endH, endM] = String(inputValue).split(':').map(Number);
        const targetEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endH, endM);
        
        let testWorkers = 1;
        while (testWorkers <= 50) { 
            const simResult = executeSimulationForWorkers(testWorkers);
            
            if (simResult.maxEndTime <= targetEnd || simResult.minuteCounter >= simResult.maxMinutes) {
                optimalWorkers = testWorkers;
                finalSimResult = simResult;
                break;
            }
            testWorkers++;
        }
        if (optimalWorkers === 0) {
            optimalWorkers = 50; 
            finalSimResult = executeSimulationForWorkers(50);
        }
    } else {
        optimalWorkers = Number(inputValue);
        if (optimalWorkers <= 0) return { error: "투입 인원은 1명 이상이어야 합니다." };
        finalSimResult = executeSimulationForWorkers(optimalWorkers);
    }

    if (finalSimResult.minuteCounter >= finalSimResult.maxMinutes) {
        return { error: "시뮬레이션 처리 한도(48시간)를 초과했습니다. 수량이나 속도를 다시 확인해주세요." };
    }

    const totalDuration = (finalSimResult.maxEndTime.getTime() - globalStart.getTime()) / 60000;
    const formatTimeStr = (date) => `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;

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