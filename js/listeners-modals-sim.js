// === js/listeners-modals-sim.js ===
// 설명: '운영 시뮬레이션' 모달 전용 리스너입니다.

import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, formatDuration } from './utils.js';
import { analyzeBottlenecks, calculateSimulation } from './analysis-logic.js';

// 차트 인스턴스 보관용 변수
let simChartInstance = null;

// 시뮬레이션 테이블 행 추가 헬퍼 함수
const renderSimulationTaskRow = (tbody) => {
    // ... (이 함수 내용은 기존과 동일) ...
    const row = document.createElement('tr');
    row.className = 'bg-white border-b hover:bg-gray-50 transition sim-task-row';
    
    let taskOptions = '<option value="">업무 선택</option>';
    (State.appConfig.quantityTaskTypes || []).sort().forEach(task => {
        taskOptions += `<option value="${task}">${task}</option>`;
    });

    row.innerHTML = `
        <td class="px-4 py-2">
            <select class="sim-row-task w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                ${taskOptions}
            </select>
        </td>
        <td class="px-4 py-2">
            <input type="number" class="sim-row-qty w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right" placeholder="1000" min="1">
        </td>
        <td class="px-4 py-2">
            <input type="number" class="sim-row-worker-or-time w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right" placeholder="5" min="1">
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

// ✅ [수정] makeDraggable 함수 (width/height 고정 로직 *제거* - 요청 2)
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
            
            // ✅ [수정] 너비/높이 고정 로직 제거 (자동 리사이징 허용)
            // contentBox.style.width = `${rect.width}px`;
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

/**
 * ✅ [신규] 시뮬레이션 결과 렌더링 헬퍼 (요청 1, 3, 4)
 * @param {object} data - State.appState.simulationResults
 */
const renderSimulationResults = (data) => {
    if (!data) return;
    
    // ✅ [신규] 요청 2: 자동 크기 조절 (높이 제한 해제)
    const contentBox = document.getElementById('sim-modal-content-box');
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
        
        const simTotalDurationEl = document.getElementById('sim-total-duration');
        const simExpectedEndTimeEl = document.getElementById('sim-expected-end-time');
        const simTotalCostEl = document.getElementById('sim-total-cost');
        const simResultTbody = document.getElementById('sim-result-tbody');

        if (simTotalDurationEl) simTotalDurationEl.textContent = formatDuration(totalDuration);
        if (simExpectedEndTimeEl) simExpectedEndTimeEl.textContent = finalEndTimeStr;
        if (simTotalCostEl) simTotalCostEl.textContent = `${Math.round(totalCost).toLocaleString()}원`;

        if (simResultTbody) {
            simResultTbody.innerHTML = results.map(res => {
                // ✅ [신규] 요청 1: 연관 업무 시간 표시
                let relatedTaskHtml = '';
                if (res.relatedTaskInfo && res.workerCount > 0) {
                    const timePerWorker = res.relatedTaskInfo.time / res.workerCount;
                    relatedTaskHtml = `<div class="text-xs text-gray-400 font-normal">+ ${res.relatedTaskInfo.name} (${formatDuration(timePerWorker)})</div>`;
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
    }
};


export function setupSimulationModalListeners() {
    
    const simAddTaskRowBtn = document.getElementById('sim-add-task-row-btn');
    const simTaskTableBody = document.getElementById('sim-task-table-body');
    const simTableHeaderWorker = document.getElementById('sim-table-header-worker');
    const simStartTimeInput = document.getElementById('sim-start-time-input');

    // ✅ [수정] 공통 시뮬레이션 모달 열기 로직 (요청 3)
    const openSimulationModalLogic = () => {
        // 초기화
        if (DOM.simResultContainer) DOM.simResultContainer.classList.add('hidden');
        if (DOM.simBottleneckContainer) DOM.simBottleneckContainer.classList.add('hidden');
        if (DOM.simInputArea) DOM.simInputArea.classList.remove('hidden');
        if (simTaskTableBody) {
            simTaskTableBody.innerHTML = '';
            renderSimulationTaskRow(simTaskTableBody); // 기본 1줄 추가
        }
        if (simStartTimeInput) simStartTimeInput.value = "08:30"; // 기본 시작 시간

        // 모드 초기화 (기본: 소요 시간 예측)
        if (DOM.simModeRadios && DOM.simModeRadios.length > 0) {
            DOM.simModeRadios[0].checked = true;
            DOM.simModeRadios[0].dispatchEvent(new Event('change'));
        }

        // ✅ [신규] 요청 3: 저장된 결과가 있으면 로드
        if (State.appState.simulationResults) {
            renderSimulationResults(State.appState.simulationResults);
            // 저장된 모드/시작시간 복원
            const savedMode = State.appState.simulationResults.mode;
            const savedStartTime = State.appState.simulationResults.startTime;
            
            if (savedMode) {
                 const radio = document.querySelector(`input[name="sim-mode"][value="${savedMode}"]`);
                 if(radio) radio.checked = true;
            }
            if (savedStartTime && simStartTimeInput) {
                simStartTimeInput.value = savedStartTime;
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
            if (DOM.navContent) DOM.navContent.classList.add('hidden'); // 모바일 메뉴 닫기
        });
    }


    if (DOM.simModeRadios) {
        Array.from(DOM.simModeRadios).forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    const mode = e.target.value;
                    // ✅ [신규] 요청 3: 모드 변경 시 저장된 결과 초기화
                    State.appState.simulationResults = null; 
                    
                    if (mode === 'bottleneck') {
                        DOM.simInputArea.classList.add('hidden');
                        DOM.simResultContainer.classList.add('hidden');
                        DOM.simBottleneckContainer.classList.add('hidden'); // 계산 전엔 숨김
                        DOM.simCalculateBtn.textContent = '병목 구간 분석하기';
                    } else {
                        DOM.simInputArea.classList.remove('hidden');
                        DOM.simResultContainer.classList.add('hidden'); // 계산 전엔 숨김
                        DOM.simBottleneckContainer.classList.add('hidden');
                        DOM.simCalculateBtn.textContent = '시뮬레이션 실행 🚀';
                        
                        if (simTableHeaderWorker) {
                            simTableHeaderWorker.textContent = (mode === 'fixed-workers') ? '투입 인원 (명)' : '목표 시간 (분)';
                        }
                        document.querySelectorAll('.sim-row-worker-or-time').forEach(input => {
                            input.placeholder = (mode === 'fixed-workers') ? '5' : '60';
                        });
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

    // ✅ [수정] 계산 버튼 리스너 (요청 1, 2, 3, 4)
    if (DOM.simCalculateBtn) {
        DOM.simCalculateBtn.addEventListener('click', () => {
            const mode = document.querySelector('input[name="sim-mode"]:checked').value;
            const currentStartTimeStr = simStartTimeInput ? simStartTimeInput.value : "09:00";

            // --- 모드 3: 병목 분석 ---
            if (mode === 'bottleneck') {
                const bottlenecks = analyzeBottlenecks(State.allHistoryData);
                if (!bottlenecks || bottlenecks.length === 0) {
                    showToast('분석할 데이터가 충분하지 않습니다.', true);
                    return;
                }
                
                const simulationData = { mode, bottlenecks, startTime: currentStartTimeStr };
                // ✅ [신규] 요청 3: 결과 저장
                State.appState.simulationResults = simulationData;
                // ✅ [신규] 요청 2,3: 렌더링 헬퍼 호출
                renderSimulationResults(simulationData);
                return;
            }

            // --- 모드 1 & 2: 다중 업무 시뮬레이션 ---
            const rows = document.querySelectorAll('.sim-task-row');
            const results = [];
            let totalDuration = 0;
            let totalCost = 0;
            let finalEndTimeStr = currentStartTimeStr;
            let effectiveStartTime = currentStartTimeStr;

            rows.forEach(row => {
                const task = row.querySelector('.sim-row-task').value;
                const qty = Number(row.querySelector('.sim-row-qty').value);
                const inputVal = Number(row.querySelector('.sim-row-worker-or-time').value);

                if (task && qty > 0 && inputVal > 0) {
                    const res = calculateSimulation(mode, task, qty, inputVal, effectiveStartTime);
                    
                    if (!res.error) {
                        res.startTime = effectiveStartTime; // 결과 표시용 시작 시간 저장
                        results.push({ task, ...res });
                        
                        effectiveStartTime = res.expectedEndTime;
                        finalEndTimeStr = res.expectedEndTime;
                        totalDuration += res.durationMinutes;
                        totalCost += res.totalCost;
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
            
            // ✅ [신규] 요청 3: 결과 저장
            State.appState.simulationResults = simulationData;
            // ✅ [신규] 요청 1, 2, 4: 렌더링 헬퍼 호출
            renderSimulationResults(simulationData);
        });
    }

    // --- ✅ [신규] 드래그 기능 활성화 ---
    const modalOverlay = DOM.costSimulationModal;
    const modalHeader = document.getElementById('sim-modal-header');
    const modalContentBox = document.getElementById('sim-modal-content-box');

    if (modalOverlay && modalHeader && modalContentBox) {
        makeDraggable(modalOverlay, modalHeader, modalContentBox);
    }
}