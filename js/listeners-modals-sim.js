// === js/listeners-modals-sim.js ===
// 설명: 통합된 '업무 예측 시뮬레이션' 모달 전용 리스너입니다.

import * as DOM from './dom-elements.js';
import { appState, appConfig, allHistoryData } from './state.js';
import { showToast, formatDuration, calcElapsedMinutes, getCurrentTime } from './utils.js';
import { calculateSimulation } from './analysis-logic.js';
import { calculateAverageStaffing, calculateStandardThroughputs } from './ui-history-reports-logic.js';

const CUSTOM_TASK_ORDER = ['채우기', '국내배송', '해외배송', '상.하차', '중국제작', '직진배송', '티니'];
const DEFAULT_CONCURRENT_TASKS = ['해외배송', '상.하차'];

const sortTasksCustom = (a, b) => {
    const idxA = CUSTOM_TASK_ORDER.indexOf(a);
    const idxB = CUSTOM_TASK_ORDER.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
};

const renderSimulationTaskRow = (tbody, task = '', qty = '', workers = 0, isConcurrent = false, standardSpeed = 0) => {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b hover:bg-gray-50 transition sim-task-row';
    
    const isFirstRow = tbody.children.length === 0;
    const disableCheckbox = isFirstRow ? 'disabled' : '';
    const checkedAttr = (!isFirstRow && isConcurrent) ? 'checked' : '';
    const checkboxClass = isFirstRow ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer';

    let taskOptions = '<option value="">업무 선택</option>';
    const quantityTaskTypes = (appConfig && appConfig.quantityTaskTypes) ? appConfig.quantityTaskTypes : [];
    
    quantityTaskTypes.sort(sortTasksCustom).forEach(taskName => {
        const selected = (taskName === task) ? 'selected' : '';
        taskOptions += `<option value="${taskName}" ${selected}>${taskName}</option>`;
    });

    const workerVal = workers > 0 ? Math.round(workers) : '';
    const speedVal = standardSpeed > 0 ? standardSpeed.toFixed(2) : '';

    row.innerHTML = `
        <td class="px-2 py-2 text-center border-r border-gray-100">
            <div class="flex flex-col items-center justify-center">
                <input type="checkbox" class="sim-row-concurrent w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 ${checkboxClass}" ${disableCheckbox} ${checkedAttr}>
                <span class="text-[10px] text-gray-400 mt-0.5 ${isFirstRow ? 'invisible' : ''}">동시</span>
            </div>
        </td>
        <td class="px-4 py-2">
            <select class="sim-row-task w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                ${taskOptions}
            </select>
        </td>
        <td class="px-4 py-2">
            <input type="number" class="sim-row-speed w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right bg-blue-50/30" placeholder="자동" step="0.01" value="${speedVal}">
        </td>
        <td class="px-4 py-2">
            <input type="number" class="sim-row-qty w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right" placeholder="1000" min="1" value="${qty > 0 ? qty : ''}">
        </td>
        <td class="px-4 py-2 sim-row-worker-or-time-cell">
            <input type="number" class="sim-row-worker-or-time w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right" placeholder="5" min="1" step="1" value="${workerVal}">
        </td>
        <td class="px-4 py-2 text-center">
            <button class="sim-row-delete-btn text-gray-400 hover:text-red-500 transition">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
            </button>
        </td>
    `;
    tbody.appendChild(row);
};

function makeDraggable(modalOverlay, header, contentBox) {
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        if (contentBox.dataset.hasBeenUncentered !== 'true') {
            const rect = contentBox.getBoundingClientRect();
            modalOverlay.classList.remove('flex', 'items-center', 'justify-center');
            contentBox.style.position = 'absolute';
            contentBox.style.top = `${rect.top}px`;
            contentBox.style.left = `${rect.left}px`;
            contentBox.style.width = `${rect.width}px`;
            contentBox.style.transform = 'none';
            contentBox.dataset.hasBeenUncentered = 'true';
        }
        const rect = contentBox.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isDragging) return;
        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;
        contentBox.style.left = `${newLeft}px`;
        contentBox.style.top = `${newTop}px`;
    }

    function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}

const renderSimulationResults = (data) => {
    const contentBox = document.getElementById('sim-modal-content-box');
    const simResultThead = document.getElementById('sim-result-thead');
    const simResultTbody = document.getElementById('sim-result-tbody');
    
    if (!data) {
        if (DOM.simResultContainer) DOM.simResultContainer.classList.add('hidden');
        if (contentBox) contentBox.style.height = null;
        return;
    }
    
    if (contentBox) contentBox.style.height = 'auto';

    const { results, totalDuration, finalEndTimeStr, totalCost, totalWorkersForTarget } = data;
    
    const simSummaryLabel1 = document.getElementById('sim-summary-label-1');
    const simSummaryValue1 = document.getElementById('sim-summary-value-1');
    const simSummaryLabel2 = document.getElementById('sim-summary-label-2');
    const simSummaryValue2 = document.getElementById('sim-summary-value-2');
    const simSummaryLabel3 = document.getElementById('sim-summary-label-3');
    const simSummaryValue3 = document.getElementById('sim-summary-value-3');

    if (simSummaryLabel1) simSummaryLabel1.textContent = '총 예상 소요 시간';
    if (simSummaryValue1) simSummaryValue1.textContent = formatDuration(totalDuration); 
    if (simSummaryLabel2) simSummaryLabel2.textContent = '예상 종료 시각 / 목표 필요 인원';
    if (simSummaryValue2) simSummaryValue2.innerHTML = `<span class="text-indigo-600">${finalEndTimeStr}</span> <span class="text-gray-400 mx-1">|</span> <span class="text-orange-600">${Math.ceil(totalWorkersForTarget)}명</span>`;
    if (simSummaryLabel3) simSummaryLabel3.textContent = '예상 총 인건비';
    if (simSummaryValue3) simSummaryValue3.textContent = `${Math.round(totalCost).toLocaleString()}원`;

    if (simResultThead) {
        simResultThead.innerHTML = `
            <tr>
                <th class="px-4 py-2">업무</th>
                <th class="px-4 py-2 text-right">표준 속도</th>
                <th class="px-4 py-2 text-right">예상 소요 시간<br><span class="text-[10px] text-gray-400 font-normal">(입력 투입 인원 기준)</span></th>
                <th class="px-4 py-2 text-right">필요 인원<br><span class="text-[10px] text-gray-400 font-normal">(목표 시각 기준)</span></th>
                <th class="px-4 py-2 text-right">예상 종료 시각</th>
            </tr>
        `;
    }

    if (simResultTbody) {
        simResultTbody.innerHTML = results.map(res => {
            let relatedTaskHtml = '';
            if (res.relatedTaskInfo) {
                const fixedTime = res.relatedTaskInfo.time;
                const timeClass = fixedTime > 0 ? "text-gray-400" : "text-gray-300";
                relatedTaskHtml = `<div class="text-xs ${timeClass} font-normal">+ ${res.relatedTaskInfo.name} (${formatDuration(fixedTime)})</div>`;
            }
            const concurrentIcon = res.isConcurrent ? `<span class="text-indigo-500 ml-1" title="동시 진행">🔗</span>` : '';

            return `
            <tr class="bg-white hover:bg-gray-50 transition">
                <td class="px-4 py-3 font-medium text-gray-900">
                    ${res.task} ${concurrentIcon}
                    <div class="text-xs text-gray-400 font-normal">${res.startTime} 시작</div>
                    ${relatedTaskHtml} 
                </td>
                <td class="px-4 py-3 text-right text-gray-500 font-mono">
                    ${res.speed.toFixed(2)} 
                </td>
                <td class="px-4 py-3 text-right text-indigo-700 font-medium">
                    ${formatDuration(res.durationMinutes)}
                    ${res.includesLunch ? '<span class="text-xs text-orange-500 block">(점심포함)</span>' : ''}
                </td>
                <td class="px-4 py-3 text-right text-orange-600 font-bold">
                    ${res.requiredWorkers} 명
                </td>
                <td class="px-4 py-3 text-right font-bold text-gray-700">${res.expectedEndTime}</td>
            </tr>
            `;
        }).join('');
    }
    
    if (DOM.simResultContainer) DOM.simResultContainer.classList.remove('hidden');
    if (DOM.simInputArea) DOM.simInputArea.classList.remove('hidden');
};

export function setupSimulationModalListeners() {
    
    const simAddTaskRowBtn = document.getElementById('sim-add-task-row-btn');
    const simTaskTableBody = document.getElementById('sim-task-table-body');
    const simStartTimeInput = document.getElementById('sim-start-time-input');
    const simEndTimeInput = document.getElementById('sim-end-time-input');
    
    // 이전에 동적 주입되던 헤더 스크립트 삭제 (HTML에 반영됨)

    const openSimulationModalLogic = () => {
        if (DOM.simInputArea) DOM.simInputArea.classList.remove('hidden');
        
        const attendanceMap = appState.dailyAttendance || {};
        const currentActiveCount = Object.values(attendanceMap).filter(a => a.status === 'active').length;
        
        const activeDisplay = document.getElementById('sim-active-count-display');
        if (activeDisplay) activeDisplay.textContent = currentActiveCount;

        if (simTaskTableBody) {
            simTaskTableBody.innerHTML = '';

            const avgStaffMap = calculateAverageStaffing(allHistoryData);
            const standards = calculateStandardThroughputs(allHistoryData);
            
            const quantityTaskSet = new Set(appConfig.quantityTaskTypes || []);
            const quantities = appState.taskQuantities || {};
            const tasksToShow = new Set(appConfig.keyTasks || []); 
            Object.keys(quantities).forEach(t => {
                if (Number(quantities[t]) > 0) tasksToShow.add(t); 
            });

            let tasksWereAdded = false;

            Array.from(tasksToShow).sort(sortTasksCustom).forEach(taskName => {
                if (quantityTaskSet.has(taskName)) { 
                    const qty = Number(quantities[taskName]) || 0;
                    
                    let avgStaff = avgStaffMap[taskName] || 0;
                    if (currentActiveCount > 0 && avgStaff > 0) {
                        avgStaff = Math.min(avgStaff, currentActiveCount);
                    }
                    avgStaff = Math.round(avgStaff);

                    const isConcurrent = DEFAULT_CONCURRENT_TASKS.includes(taskName);
                    const speed = standards[taskName] || 0;
                    
                    renderSimulationTaskRow(simTaskTableBody, taskName, qty, avgStaff, isConcurrent, speed);
                    tasksWereAdded = true;
                }
            });

            if (!tasksWereAdded) {
                renderSimulationTaskRow(simTaskTableBody);
            }
        }
        
        if (appState.simulationResults) {
            renderSimulationResults(appState.simulationResults);
            
            const savedStartTime = appState.simulationResults.startTime;
            const savedEndTime = appState.simulationResults.endTime; 
            if (savedStartTime && simStartTimeInput) simStartTimeInput.value = savedStartTime;
            if (savedEndTime && simEndTimeInput) simEndTimeInput.value = savedEndTime;
        } else {
            renderSimulationResults(null); 
            if (simStartTimeInput) simStartTimeInput.value = "08:30"; 
            if (simEndTimeInput) simEndTimeInput.value = "17:00"; 
        }

        const contentBox = document.getElementById('sim-modal-content-box');
        if (contentBox) {
            contentBox.removeAttribute('style');
            contentBox.dataset.hasBeenUncentered = 'false';
        }
        if (DOM.costSimulationModal) {
             DOM.costSimulationModal.classList.add('flex', 'items-center', 'justify-center');
             DOM.costSimulationModal.classList.remove('hidden');
        }
    };

    if (DOM.openCostSimulationBtn) {
        DOM.openCostSimulationBtn.addEventListener('click', () => {
            openSimulationModalLogic();
            document.getElementById('menu-dropdown')?.classList.add('hidden');
        });
    }

    if (DOM.openCostSimulationBtnMobile) {
        DOM.openCostSimulationBtnMobile.addEventListener('click', () => {
            openSimulationModalLogic();
            if (DOM.navContent) DOM.navContent.classList.add('hidden'); 
        });
    }

    if (simAddTaskRowBtn && simTaskTableBody) {
        simAddTaskRowBtn.addEventListener('click', () => {
            renderSimulationTaskRow(simTaskTableBody);
        });
    }

    if (simTaskTableBody) {
        simTaskTableBody.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.sim-row-delete-btn');
            if (deleteBtn) {
                deleteBtn.closest('tr').remove();
            }
        });

        simTaskTableBody.addEventListener('change', (e) => {
            if (e.target.classList.contains('sim-row-task')) {
                const taskName = e.target.value;
                const row = e.target.closest('tr');
                const speedInput = row.querySelector('.sim-row-speed');
                if (taskName && speedInput) {
                     const standards = calculateStandardThroughputs(allHistoryData);
                     const speed = standards[taskName] || 0;
                     speedInput.value = speed > 0 ? speed.toFixed(2) : '';
                }
            }
        });
    }

    // 통합된 예측 실행 로직
    if (DOM.simCalculateBtn) {
        DOM.simCalculateBtn.addEventListener('click', () => {
            const currentStartTimeStr = simStartTimeInput ? simStartTimeInput.value : "09:00";
            const currentEndTimeStr = simEndTimeInput ? simEndTimeInput.value : "17:00";
            const includeLinkedTasks = document.getElementById('sim-include-linked-tasks-checkbox')?.checked || false;

            const rows = document.querySelectorAll('.sim-task-row');
            const results = [];
            let totalWorkersForTarget = 0;
            let totalCost = 0;

            const now = new Date();
            const [startH, startM] = currentStartTimeStr.split(':').map(Number);
            let globalStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
            
            let currentBatchStartTime = new Date(globalStart); 
            let currentBatchMaxEndTime = new Date(globalStart);

            const formatTimeStr = (date) => {
                return `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
            };

            // 목표 시간에 맞추기 위한 전체 가용 시간(분) 도출
            let durationMinutesForTarget = calcElapsedMinutes(currentStartTimeStr, currentEndTimeStr, []);
            const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
            const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);
            let checkStart = new Date(globalStart);
            let checkEnd = new Date(globalStart.getTime() + durationMinutesForTarget * 60000);
            
            if (checkStart < lunchEnd && checkEnd > lunchStart) {
                 durationMinutesForTarget = Math.max(0, durationMinutesForTarget - 60);
            }

            rows.forEach((row, index) => {
                const task = row.querySelector('.sim-row-task').value;
                const qty = Number(row.querySelector('.sim-row-qty').value);
                const workerInput = Number(row.querySelector('.sim-row-worker-or-time').value);
                const isConcurrent = row.querySelector('.sim-row-concurrent').checked;
                const manualSpeed = Number(row.querySelector('.sim-row-speed').value);

                if (task && qty > 0 && workerInput > 0) {
                    
                    let thisTaskStart;
                    if (index === 0 || !isConcurrent) {
                        thisTaskStart = new Date(currentBatchMaxEndTime);
                        currentBatchStartTime = thisTaskStart;
                    } else {
                        thisTaskStart = new Date(currentBatchStartTime);
                    }
                    
                    const startTimeStr = formatTimeStr(thisTaskStart);

                    // 1. 투입 인원 기준 소요 시간 예측
                    const timeRes = calculateSimulation('fixed-workers', task, qty, workerInput, startTimeStr, includeLinkedTasks, manualSpeed);
                    
                    // 2. 목표 시간 기준 필요 인원 예측
                    const workerRes = calculateSimulation('target-time', task, qty, durationMinutesForTarget, startTimeStr, includeLinkedTasks, manualSpeed);

                    if (!timeRes.error) {
                        timeRes.startTime = startTimeStr;
                        timeRes.isConcurrent = (index > 0 && isConcurrent);
                        
                        // 병합
                        timeRes.requiredWorkers = (!workerRes.error) ? workerRes.workerCount : '-';
                        
                        results.push({ task, ...timeRes });
                        
                        if (!workerRes.error) totalWorkersForTarget += workerRes.workerCount;
                        totalCost += timeRes.totalCost;

                        const [endH, endM] = timeRes.expectedEndTime.split(':').map(Number);
                        let thisTaskEnd = new Date(thisTaskStart);
                        thisTaskEnd.setHours(endH, endM, 0, 0);
                        
                        if (thisTaskEnd < thisTaskStart) {
                            thisTaskEnd.setDate(thisTaskEnd.getDate() + 1);
                        }

                        if (thisTaskEnd > currentBatchMaxEndTime) {
                            currentBatchMaxEndTime = thisTaskEnd;
                        }
                    } else {
                        showToast(`'${task}' 오류: ${timeRes.error}`, true);
                    }
                }
            });

            if (results.length === 0) {
                showToast('입력 정보를 확인해주세요.', true);
                return;
            }

            const finalEndTimeStr = formatTimeStr(currentBatchMaxEndTime);
            let totalDurationMs = currentBatchMaxEndTime - globalStart;
            let totalDuration = Math.floor(totalDurationMs / 60000);

            const simulationData = {
                results,
                totalDuration,
                finalEndTimeStr,
                totalCost,
                totalWorkersForTarget,
                startTime: currentStartTimeStr,
                endTime: currentEndTimeStr
            };
            
            appState.simulationResults = simulationData;
            renderSimulationResults(simulationData);
        });
    }

    const modalOverlay = DOM.costSimulationModal;
    const modalHeader = document.getElementById('sim-modal-header');
    const modalContentBox = document.getElementById('sim-modal-content-box');

    if (modalOverlay && modalHeader && modalContentBox) {
        makeDraggable(modalOverlay, modalHeader, modalContentBox);
    }
}