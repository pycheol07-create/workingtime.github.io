// === js/listeners-modals-sim.js ===
// 설명: '운영 시뮬레이션' 모달 전용 리스너입니다.

import * as DOM from './dom-elements.js';
import { appState, appConfig, allHistoryData } from './state.js';
import { showToast, formatDuration, calcElapsedMinutes } from './utils.js';
import { analyzeBottlenecks, calculateSimulation } from './analysis-logic.js';
import { calculateAverageStaffing } from './ui-history-reports-logic.js';

// 차트 인스턴스 보관용 변수
let simChartInstance = null;

// ✅ [신규] 사용자 지정 업무 정렬 순서 정의
const CUSTOM_TASK_ORDER = ['채우기', '국내배송', '해외배송', '상.하차', '중국제작', '직진배송', '티니'];

// ✅ [신규] 정렬 헬퍼 함수
const sortTasksCustom = (a, b) => {
    const idxA = CUSTOM_TASK_ORDER.indexOf(a);
    const idxB = CUSTOM_TASK_ORDER.indexOf(b);

    // 둘 다 커스텀 목록에 있으면 지정된 순서대로
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    // A만 있으면 A가 먼저
    if (idxA !== -1) return -1;
    // B만 있으면 B가 먼저
    if (idxB !== -1) return 1;
    // 둘 다 없으면 가나다순
    return a.localeCompare(b);
};

const renderSimulationTaskRow = (tbody, task = '', qty = '', workers = 0) => {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b hover:bg-gray-50 transition sim-task-row';
    
    let taskOptions = '<option value="">업무 선택</option>';
    const quantityTaskTypes = (appConfig && appConfig.quantityTaskTypes) ? appConfig.quantityTaskTypes : [];
    
    // ✅ [수정] 드롭다운 옵션도 지정된 순서대로 정렬
    quantityTaskTypes.sort(sortTasksCustom).forEach(taskName => {
        const selected = (taskName === task) ? 'selected' : '';
        taskOptions += `<option value="${taskName}" ${selected}>${taskName}</option>`;
    });

    const workerVal = workers > 0 ? Math.round(workers) : '';

    row.innerHTML = `
        <td class="px-4 py-2">
            <select class="sim-row-task w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                ${taskOptions}
            </select>
        </td>
        <td class="px-4 py-2">
            <input type="number" class="sim-row-qty w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right" placeholder="1000" min="1" value="${qty > 0 ? qty : ''}">
        </td>
        <td class="px-4 py-2 sim-row-worker-or-time-cell">
            <input type="number" class="sim-row-worker-or-time w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right" placeholder="5" min="1" value="${workerVal}">
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

    const currentMode = document.querySelector('input[name="sim-mode"]:checked')?.value || 'fixed-workers';
    if (currentMode === 'target-time') {
        row.querySelector('.sim-row-worker-or-time-cell')?.classList.add('hidden');
    }
};

function makeDraggable(modalOverlay, header, contentBox) {
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) { 
            return;
        }
        isDragging = true;

        if (contentBox.dataset.hasBeenUncentered !== 'true') {
            const rect = contentBox.getBoundingClientRect();
            modalOverlay.classList.remove('flex', 'items-center', 'justify-center');
            contentBox.style.position = 'absolute';
            contentBox.style.top = `${rect.top}px`;
            contentBox.style.left = `${rect.left}px`;
            
            contentBox.style.width = `${rect.width}px`;
            // contentBox.style.height = `${rect.height}px`; 

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
    const simSummaryLabel1 = document.getElementById('sim-summary-label-1');
    const simSummaryValue1 = document.getElementById('sim-summary-value-1');
    const simSummaryLabel2 = document.getElementById('sim-summary-label-2');
    const simSummaryValue2 = document.getElementById('sim-summary-value-2');
    const simSummaryLabel3 = document.getElementById('sim-summary-label-3');
    const simSummaryValue3 = document.getElementById('sim-summary-value-3');

    if (!data) {
        if (DOM.simResultContainer) DOM.simResultContainer.classList.add('hidden');
        if (DOM.simBottleneckContainer) DOM.simBottleneckContainer.classList.add('hidden');
        if (contentBox) contentBox.style.height = null;
        return;
    }
    
    if (contentBox) contentBox.style.height = 'auto';

    const { mode } = data;

    if (mode === 'bottleneck') {
        const { bottlenecks } = data;
        if (DOM.simBottleneckTbody) {
            DOM.simBottleneckTbody.innerHTML = bottlenecks.map((item, index) => `
                <tr class="bg-white">
                    <td class="px-4 py-3 font-medium text-gray-900">${index + 1}위</td>
                    <td class="px-4 py-3 font-bold ${index === 0 ? 'text-red-600' : 'text-gray-800'}">${item.task}</td>
                    <td class="px-4 py-3 text-right font-mono ${index === 0 ? 'text-red-600 font-bold' : ''}">${formatDuration(item.timeFor1000)}</td>
                    <td class="px-4 py-3 text-right text-gray-500">${item.speed.toFixed(2)}</td>
                </tr>
            `).join('');
        }
        if (DOM.simBottleneckContainer) DOM.simBottleneckContainer.classList.remove('hidden');
        if (DOM.simResultContainer) DOM.simResultContainer.classList.add('hidden');
        if (DOM.simInputArea) DOM.simInputArea.classList.add('hidden');

    } else if (mode === 'fixed-workers') {
        const { results, totalDuration, finalEndTimeStr, totalCost } = data;
        
        if (simSummaryLabel1) simSummaryLabel1.textContent = '총 예상 소요 시간';
        if (simSummaryValue1) simSummaryValue1.textContent = formatDuration(totalDuration);
        if (simSummaryLabel2) simSummaryLabel2.textContent = '예상 종료 시각';
        if (simSummaryValue2) simSummaryValue2.textContent = finalEndTimeStr;
        if (simSummaryLabel3) simSummaryLabel3.textContent = '예상 총 인건비';
        if (simSummaryValue3) simSummaryValue3.textContent = `${Math.round(totalCost).toLocaleString()}원`;

        if (simResultThead) {
            simResultThead.innerHTML = `
                <tr>
                    <th class="px-4 py-2">업무</th>
                    <th class="px-4 py-2 text-right">표준 속도 (개/분)</th>
                    <th class="px-4 py-2 text-right">예상 시간</th>
                    <th class="px-4 py-2 text-right">예상 비용</th>
                    <th class="px-4 py-2 text-right">종료 시각</th>
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
                return `
                <tr class="bg-white">
                    <td class="px-4 py-3 font-medium text-gray-900">
                        ${res.task}
                        <div class="text-xs text-gray-400 font-normal">${res.startTime} 시작</div>
                        ${relatedTaskHtml} 
                    </td>
                    <td class="px-4 py-3 text-right text-gray-500 font-mono">
                        ${res.speed.toFixed(2)} 
                    </td>
                    <td class="px-4 py-3 text-right">
                        ${formatDuration(res.durationMinutes)}
                        ${res.includesLunch ? '<span class="text-xs text-orange-500 block">(점심포함)</span>' : ''}
                    </td>
                    <td class="px-4 py-3 text-right">${Math.round(res.totalCost).toLocaleString()}원</td>
                    <td class="px-4 py-3 text-right font-bold text-indigo-600">${res.expectedEndTime}</td>
                </tr>
                `;
            }).join('');
        }
        if (DOM.simResultContainer) DOM.simResultContainer.classList.remove('hidden');
        if (DOM.simBottleneckContainer) DOM.simBottleneckContainer.classList.add('hidden');
        if (DOM.simInputArea) DOM.simInputArea.classList.remove('hidden');
    
    } else if (mode === 'target-time') {
        const { results, totalDuration, totalWorkers, totalCost, startTime, endTime } = data;

        if (simSummaryLabel1) simSummaryLabel1.textContent = '총 가용 시간';
        if (simSummaryValue1) simSummaryValue1.textContent = formatDuration(totalDuration);
        if (simSummaryLabel2) simSummaryLabel2.textContent = '총 필요 인원 (연인원)';
        if (simSummaryValue2) simSummaryValue2.textContent = `${totalWorkers.toFixed(1)} 명`;
        if (simSummaryLabel3) simSummaryLabel3.textContent = '예상 총 인건비';
        if (simSummaryValue3) simSummaryValue3.textContent = `${Math.round(totalCost).toLocaleString()}원`;

        if (simResultThead) {
            simResultThead.innerHTML = `
                <tr>
                    <th class="px-4 py-2">업무</th>
                    <th class="px-4 py-2 text-right">표준 속도 (개/분)</th>
                    <th class="px-4 py-2 text-right">필요 인원 (명)</th>
                    <th class="px-4 py-2 text-right">예상 비용</th>
                    <th class="px-4 py-2 text-right">업무 가용 시간</th>
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

                return `
                <tr class="bg-white">
                    <td class="px-4 py-3 font-medium text-gray-900">
                        ${res.task}
                        ${relatedTaskHtml} 
                    </td>
                    <td class="px-4 py-3 text-right text-gray-500 font-mono">
                        ${res.speed.toFixed(2)} 
                    </td>
                    <td class="px-4 py-3 text-right font-bold text-indigo-600">
                        ${res.workerCount.toFixed(1)} 명
                    </td>
                    <td class="px-4 py-3 text-right">${Math.round(res.totalCost).toLocaleString()}원</td>
                    <td class="px-4 py-3 text-right">
                        ${formatDuration(res.durationMinutes)}
                        ${res.includesLunch ? '<span class="text-xs text-orange-500 block">(점심포함)</span>' : ''}
                    </td>
                </tr>
                `;
            }).join('');
        }
        if (DOM.simResultContainer) DOM.simResultContainer.classList.remove('hidden');
        if (DOM.simBottleneckContainer) DOM.simBottleneckContainer.classList.add('hidden');
        if (DOM.simInputArea) DOM.simInputArea.classList.remove('hidden');
    }
};


export function setupSimulationModalListeners() {
    
    const simAddTaskRowBtn = document.getElementById('sim-add-task-row-btn');
    const simTaskTableBody = document.getElementById('sim-task-table-body');
    const simTableHeaderWorker = document.getElementById('sim-table-header-worker');
    const simStartTimeInput = document.getElementById('sim-start-time-input');
    const simEndTimeInput = document.getElementById('sim-end-time-input');
    const simEndTimeWrapper = document.getElementById('sim-end-time-wrapper');

    // ✅ [수정] 공통 시뮬레이션 모달 열기 로직 (정렬 기준 변경)
    const openSimulationModalLogic = () => {
        
        if (DOM.simInputArea) DOM.simInputArea.classList.remove('hidden');
        if (simTaskTableBody) {
            simTaskTableBody.innerHTML = ''; // 테이블 비우기

            // 1. 평균 인원 계산
            const avgStaffMap = calculateAverageStaffing(allHistoryData);
            
            // 2. 오늘 처리량이 입력된 업무 데이터 가져오기
            const quantityTaskSet = new Set(appConfig.quantityTaskTypes || []);
            const quantities = appState.taskQuantities || {};

            // 3. 표시할 업무 목록 구성
            const tasksToShow = new Set(appConfig.keyTasks || []); 
            Object.keys(quantities).forEach(t => {
                if (Number(quantities[t]) > 0) {
                    tasksToShow.add(t); 
                }
            });

            let tasksWereAdded = false;

            // 4. ✅ 지정된 순서대로 정렬하여 테이블 행 추가
            Array.from(tasksToShow).sort(sortTasksCustom).forEach(taskName => {
                if (quantityTaskSet.has(taskName)) {
                    const qty = Number(quantities[taskName]) || 0;
                    const avgStaff = avgStaffMap[taskName] || 0;
                    
                    renderSimulationTaskRow(simTaskTableBody, taskName, qty, avgStaff);
                    tasksWereAdded = true;
                }
            });

            if (!tasksWereAdded) {
                renderSimulationTaskRow(simTaskTableBody);
            }
        }
        
        if (appState.simulationResults) {
            renderSimulationResults(appState.simulationResults);
            
            const savedMode = appState.simulationResults.mode;
            const savedStartTime = appState.simulationResults.startTime;
            const savedEndTime = appState.simulationResults.endTime; 
            
            if (savedMode) {
                 const radio = document.querySelector(`input[name="sim-mode"][value="${savedMode}"]`);
                 if(radio) radio.checked = true;
            }
            if (savedStartTime && simStartTimeInput) {
                simStartTimeInput.value = savedStartTime;
            }
            if (savedEndTime && simEndTimeInput) {
                simEndTimeInput.value = savedEndTime;
            }
            
            const mode = savedMode || 'fixed-workers';
            if (mode === 'bottleneck') {
                DOM.simInputArea.classList.add('hidden');
                if(simEndTimeWrapper) simEndTimeWrapper.classList.add('hidden');
                DOM.simCalculateBtn.textContent = '병목 구간 분석하기';
            } else if (mode === 'target-time') {
                DOM.simInputArea.classList.remove('hidden');
                if(simEndTimeWrapper) simEndTimeWrapper.classList.remove('hidden');
                DOM.simCalculateBtn.textContent = '필요 인원 예측하기 👥';
                if (simTableHeaderWorker) simTableHeaderWorker.classList.add('hidden');
                document.querySelectorAll('.sim-row-worker-or-time-cell').forEach(cell => cell.classList.add('hidden'));
            } else { // 'fixed-workers'
                DOM.simInputArea.classList.remove('hidden');
                if(simEndTimeWrapper) simEndTimeWrapper.classList.add('hidden');
                DOM.simCalculateBtn.textContent = '시뮬레이션 실행 🚀';
                if (simTableHeaderWorker) {
                    simTableHeaderWorker.classList.remove('hidden');
                    simTableHeaderWorker.textContent = '투입 인원 (명)';
                }
                document.querySelectorAll('.sim-row-worker-or-time-cell').forEach(cell => cell.classList.remove('hidden'));
            }

        } else {
            renderSimulationResults(null); 
            if (simStartTimeInput) simStartTimeInput.value = "08:30"; 
            if (simEndTimeInput) simEndTimeInput.value = "17:00"; 

            if (DOM.simModeRadios && DOM.simModeRadios.length > 0) {
                DOM.simModeRadios[0].checked = true;
                
                DOM.simInputArea.classList.remove('hidden');
                if(simEndTimeWrapper) simEndTimeWrapper.classList.add('hidden');
                DOM.simCalculateBtn.textContent = '시뮬레이션 실행 🚀';
                if (simTableHeaderWorker) {
                    simTableHeaderWorker.classList.remove('hidden');
                    simTableHeaderWorker.textContent = '투입 인원 (명)';
                }
                document.querySelectorAll('.sim-row-worker-or-time-cell').forEach(cell => cell.classList.remove('hidden'));
            }
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

    if (DOM.simModeRadios) {
        Array.from(DOM.simModeRadios).forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    const mode = e.target.value;
                    
                    if (mode === 'bottleneck') {
                        DOM.simInputArea.classList.add('hidden');
                        if(simEndTimeWrapper) simEndTimeWrapper.classList.add('hidden');
                        DOM.simCalculateBtn.textContent = '병목 구간 분석하기';
                    
                    } else if (mode === 'target-time') {
                        DOM.simInputArea.classList.remove('hidden');
                        if(simEndTimeWrapper) simEndTimeWrapper.classList.remove('hidden');
                        DOM.simCalculateBtn.textContent = '필요 인원 예측하기 👥';

                        if (simTableHeaderWorker) simTableHeaderWorker.classList.add('hidden');
                        document.querySelectorAll('.sim-row-worker-or-time-cell').forEach(cell => cell.classList.add('hidden'));

                    } else { // 'fixed-workers'
                        DOM.simInputArea.classList.remove('hidden');
                        if(simEndTimeWrapper) simEndTimeWrapper.classList.add('hidden');
                        DOM.simCalculateBtn.textContent = '시뮬레이션 실행 🚀';
                        
                        if (simTableHeaderWorker) {
                            simTableHeaderWorker.classList.remove('hidden');
                            simTableHeaderWorker.textContent = '투입 인원 (명)';
                        }
                        document.querySelectorAll('.sim-row-worker-or-time-cell').forEach(cell => cell.classList.remove('hidden'));
                    }
                }
            });
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
    }

    if (DOM.simCalculateBtn) {
        DOM.simCalculateBtn.addEventListener('click', () => {
            const mode = document.querySelector('input[name="sim-mode"]:checked').value;
            const currentStartTimeStr = simStartTimeInput ? simStartTimeInput.value : "09:00";
            const currentEndTimeStr = simEndTimeInput ? simEndTimeInput.value : "17:00";
            const includeLinkedTasks = document.getElementById('sim-include-linked-tasks-checkbox')?.checked || false;

            if (mode === 'bottleneck') {
                const bottlenecks = analyzeBottlenecks(allHistoryData);
                if (!bottlenecks || bottlenecks.length === 0) {
                    showToast('분석할 데이터가 충분하지 않습니다.', true);
                    return;
                }
                
                const simulationData = { mode, bottlenecks, startTime: currentStartTimeStr };
                appState.simulationResults = simulationData;
                renderSimulationResults(simulationData);
                return;
            }

            const rows = document.querySelectorAll('.sim-task-row');
            const results = [];
            let totalDuration = 0;
            let totalCost = 0;

            if (mode === 'target-time') {
                if (!currentEndTimeStr) {
                    showToast('필요 인원 예측 모드는 종료 시각이 필수입니다.', true);
                    return;
                }
                if (currentStartTimeStr >= currentEndTimeStr) {
                    showToast('종료 시각은 시작 시각보다 늦어야 합니다.', true);
                    return;
                }
                
                const now = new Date();
                const [startH, startM] = currentStartTimeStr.split(':').map(Number);
                const [endH, endM] = currentEndTimeStr.split(':').map(Number);
                const startDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
                const endDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endH, endM);
                
                let durationMinutes = calcElapsedMinutes(currentStartTimeStr, currentEndTimeStr, []);

                const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
                const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);
                let includesLunch = false;
                if (startDateTime < lunchEnd && endDateTime > lunchStart) {
                     durationMinutes -= 60; 
                     includesLunch = true;
                }
                durationMinutes = Math.max(0, durationMinutes);
                totalDuration = durationMinutes; 
                
                if (durationMinutes <= 0) {
                     showToast('총 가용 시간이 0분입니다. 시간을 확인해주세요.', true);
                     return;
                }
                
                let totalWorkers = 0; 

                rows.forEach(row => {
                    const task = row.querySelector('.sim-row-task').value;
                    const qty = Number(row.querySelector('.sim-row-qty').value);
                    if (task && qty > 0) {
                        const res = calculateSimulation(mode, task, qty, durationMinutes, currentStartTimeStr, includeLinkedTasks);
                        if (!res.error) {
                            res.includesLunch = includesLunch; 
                            results.push({ task, ...res });
                            totalWorkers += res.workerCount; 
                            totalCost += res.totalCost;
                        } else {
                            showToast(`'${task}' 업무 시뮬레이션 오류: ${res.error}`, true);
                            appState.simulationResults = null;
                            renderSimulationResults(null);
                            return;
                        }
                    }
                });
                
                if (results.length === 0) {
                    showToast('최소 1개 이상의 업무 정보를 올바르게 입력해주세요.', true);
                    return;
                }
                
                const simulationData = {
                    mode,
                    results,
                    totalDuration,
                    totalWorkers,
                    totalCost,
                    startTime: currentStartTimeStr,
                    endTime: currentEndTimeStr
                };
                
                appState.simulationResults = simulationData;
                renderSimulationResults(simulationData);
                return;
            }

            let finalEndTimeStr = currentStartTimeStr;
            let effectiveStartTime = currentStartTimeStr;

            rows.forEach(row => {
                const task = row.querySelector('.sim-row-task').value;
                const qty = Number(row.querySelector('.sim-row-qty').value);
                const inputVal = Number(row.querySelector('.sim-row-worker-or-time').value);

                if (task && qty > 0 && inputVal > 0) {
                    const res = calculateSimulation(mode, task, qty, inputVal, effectiveStartTime, includeLinkedTasks);
                    
                    if (!res.error) {
                        res.startTime = effectiveStartTime; 
                        results.push({ task, ...res });
                        
                        effectiveStartTime = res.expectedEndTime;
                        finalEndTimeStr = res.expectedEndTime;
                        totalDuration += res.durationMinutes;
                        totalCost += res.totalCost;
                    } else {
                        showToast(`'${task}' 업무 시뮬레이션 오류: ${res.error}`, true);
                        appState.simulationResults = null;
                        renderSimulationResults(null);
                        return;
                    }
                }
            });

            if (results.length === 0) {
                showToast('최소 1개 이상의 업무 정보를 올바르게 입력해주세요.', true);
                return;
            }

            const simulationData = {
                mode,
                results,
                totalDuration,
                finalEndTimeStr,
                totalCost,
                startTime: currentStartTimeStr
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