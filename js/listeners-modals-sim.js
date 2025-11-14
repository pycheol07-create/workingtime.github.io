// === js/listeners-modals-sim.js ===
// 설명: '운영 시뮬레이션' 모달 전용 리스너입니다.

import * as DOM from './dom-elements.js';
// ✅ [수정] State import 방식을 네임스페이스가 아닌 개별 바인딩으로 변경
import { appState, appConfig, allHistoryData } from './state.js';
// ✅ [수정] calcElapsedMinutes 임포트 추가
import { showToast, formatDuration, calcElapsedMinutes } from './utils.js';
import { analyzeBottlenecks, calculateSimulation } from './analysis-logic.js';

// 차트 인스턴스 보관용 변수
let simChartInstance = null;

// ✅ [수정] 함수가 task와 qty를 인자로 받도록 변경
const renderSimulationTaskRow = (tbody, task = '', qty = '') => {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b hover:bg-gray-50 transition sim-task-row';
    
    let taskOptions = '<option value="">업무 선택</option>';
    // ✅ [수정] State.appConfig -> appConfig
    const quantityTaskTypes = (appConfig && appConfig.quantityTaskTypes) ? appConfig.quantityTaskTypes : [];
    quantityTaskTypes.sort().forEach(taskName => {
        // ✅ [수정] 인자로 받은 task가 일치하면 selected 속성 추가
        const selected = (taskName === task) ? 'selected' : '';
        taskOptions += `<option value="${taskName}" ${selected}>${taskName}</option>`;
    });

    row.innerHTML = `
        <td class="px-4 py-2">
            <select class="sim-row-task w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                ${taskOptions}
            </select>
        </td>
        <td class="px-4 py-2">
            <input type="number" class="sim-row-qty w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right" placeholder="1000" min="1" value="${qty}">
        </td>
        <td class="px-4 py-2 sim-row-worker-or-time-cell">
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

    // ✅ [신규] 현재 모드에 따라 새 행의 열 숨김/표시 처리
    const currentMode = document.querySelector('input[name="sim-mode"]:checked')?.value || 'fixed-workers';
    if (currentMode === 'target-time') {
        row.querySelector('.sim-row-worker-or-time-cell')?.classList.add('hidden');
    }
};

// ✅ [수정] makeDraggable 함수 (width/height 고정 로직 *제거* - 요청 2)
function makeDraggable(modalOverlay, header, contentBox) {
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
        // 최대화 상태가 없으므로 isHistoryMaximized 체크 제거
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
            contentBox.style.width = `${rect.width}px`; // 너비는 유지
            // contentBox.style.height = `${rect.height}px`; // ✅ 높이 고정 제거

            contentBox.style.transform = 'none';
            contentBox.dataset.hasBeenUncentered = 'true';
        }

        // mousedown 시점의 좌표를 다시 계산
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
 * ✅ [대폭 수정] 시뮬레이션 결과 렌더링 헬퍼 (요청 1, 2, 4 + 신규 모드)
 * @param {object} data - appState.simulationResults
 */
const renderSimulationResults = (data) => {
    const contentBox = document.getElementById('sim-modal-content-box');
    
    // ✅ [신규] 결과 표시 DOM (HTML에서 ID 변경됨)
    const simResultThead = document.getElementById('sim-result-thead');
    const simResultTbody = document.getElementById('sim-result-tbody');
    const simSummaryLabel1 = document.getElementById('sim-summary-label-1');
    const simSummaryValue1 = document.getElementById('sim-summary-value-1');
    const simSummaryLabel2 = document.getElementById('sim-summary-label-2');
    const simSummaryValue2 = document.getElementById('sim-summary-value-2');
    const simSummaryLabel3 = document.getElementById('sim-summary-label-3');
    const simSummaryValue3 = document.getElementById('sim-summary-value-3');


    if (!data) {
        // 결과가 없으면(null) 결과창 숨기기
        if (DOM.simResultContainer) DOM.simResultContainer.classList.add('hidden');
        if (DOM.simBottleneckContainer) DOM.simBottleneckContainer.classList.add('hidden');
        // ✅ [신규] 요청 2: 자동 크기 조절 (높이 복원)
        if (contentBox) contentBox.style.height = null; // 인라인 스타일 제거
        return;
    }
    
    // ✅ [신규] 요청 2: 자동 크기 조절 (높이 제한 해제)
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
        
        // --- 요약 카드 ---
        if (simSummaryLabel1) simSummaryLabel1.textContent = '총 예상 소요 시간';
        if (simSummaryValue1) simSummaryValue1.textContent = formatDuration(totalDuration);
        if (simSummaryLabel2) simSummaryLabel2.textContent = '예상 종료 시각';
        if (simSummaryValue2) simSummaryValue2.textContent = finalEndTimeStr;
        if (simSummaryLabel3) simSummaryLabel3.textContent = '예상 총 인건비';
        if (simSummaryValue3) simSummaryValue3.textContent = `${Math.round(totalCost).toLocaleString()}원`;

        // --- 결과 테이블 헤더 ---
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

        // --- 결과 테이블 바디 ---
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
    
    // ✅ [신규] '필요 인원 예측' (target-time) 모드 결과 렌더링
    } else if (mode === 'target-time') {
        const { results, totalDuration, totalWorkers, totalCost, startTime, endTime } = data;

        // --- 요약 카드 ---
        if (simSummaryLabel1) simSummaryLabel1.textContent = '총 가용 시간';
        if (simSummaryValue1) simSummaryValue1.textContent = formatDuration(totalDuration);
        if (simSummaryLabel2) simSummaryLabel2.textContent = '총 필요 인원 (연인원)';
        if (simSummaryValue2) simSummaryValue2.textContent = `${totalWorkers.toFixed(1)} 명`;
        if (simSummaryLabel3) simSummaryLabel3.textContent = '예상 총 인건비';
        if (simSummaryValue3) simSummaryValue3.textContent = `${Math.round(totalCost).toLocaleString()}원`;

        // --- 결과 테이블 헤더 ---
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

        // --- 결과 테이블 바디 ---
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
    
    // ... (simAddTaskRowBtn, simTaskTableBody 등 변수 선언은 동일) ...
    const simAddTaskRowBtn = document.getElementById('sim-add-task-row-btn');
    const simTaskTableBody = document.getElementById('sim-task-table-body');
    const simTableHeaderWorker = document.getElementById('sim-table-header-worker');
    const simStartTimeInput = document.getElementById('sim-start-time-input');
    // ✅ [신규] 종료 시각 DOM
    const simEndTimeInput = document.getElementById('sim-end-time-input');
    const simEndTimeWrapper = document.getElementById('sim-end-time-wrapper');

    // ✅ [수정] 공통 시뮬레이션 모달 열기 로직 (오늘의 주요 업무 자동 추가)
    const openSimulationModalLogic = () => {
        
        // ✅ [수정] '주요 업무' 중 '오늘 처리량'이 있는 항목을 찾아 자동 추가
        if (DOM.simInputArea) DOM.simInputArea.classList.remove('hidden');
        if (simTaskTableBody) {
            simTaskTableBody.innerHTML = ''; // 테이블 비우기

            // ✅ [수정] 3가지 목록을 모두 가져옴
            const keyTaskSet = new Set(appConfig.keyTasks || []);
            const quantityTaskSet = new Set(appConfig.quantityTaskTypes || []);
            const quantities = appState.taskQuantities || {};
            const tasksToPrepopulate = [];

            // ✅ [수정] 오늘의 처리량(quantities)을 기준으로 순회
            for (const taskName in quantities) {
                const qty = Number(quantities[taskName]) || 0;
                
                // ✅ [수정] 3가지 조건 모두 만족하는지 확인
                // 1. 처리량이 0보다 크고
                // 2. '주요 업무' 목록(keyTaskSet)에 포함되어 있고
                // 3. '처리량 집계 업무' 목록(quantityTaskSet)에 포함 (이래야 드롭다운에 항목이 있음)
                if (qty > 0 && keyTaskSet.has(taskName) && quantityTaskSet.has(taskName)) {
                    tasksToPrepopulate.push({ task: taskName, qty: qty });
                }
            }

            if (tasksToPrepopulate.length > 0) {
                // 처리량이 있는 주요 업무가 하나 이상 있으면, 그것들을 채워넣음
                tasksToPrepopulate.forEach(item => {
                    renderSimulationTaskRow(simTaskTableBody, item.task, item.qty);
                });
            } else {
                // 없으면, 예전처럼 빈 행 1개 추가
                renderSimulationTaskRow(simTaskTableBody);
            }
        }
        
        // 1. 저장된 결과가 있는지 먼저 확인
        // ✅ [수정] State.appState -> appState
        if (appState.simulationResults) {
            // 결과가 있으면: 결과 렌더링
            renderSimulationResults(appState.simulationResults);
            
            // 저장된 모드/시작시간/종료시간 복원
            const savedMode = appState.simulationResults.mode;
            const savedStartTime = appState.simulationResults.startTime;
            const savedEndTime = appState.simulationResults.endTime; // ✅ 신규
            
            if (savedMode) {
                 const radio = document.querySelector(`input[name="sim-mode"][value="${savedMode}"]`);
                 if(radio) radio.checked = true;
            }
            if (savedStartTime && simStartTimeInput) {
                simStartTimeInput.value = savedStartTime;
            }
            // ✅ [신규] 종료 시간 복원
            if (savedEndTime && simEndTimeInput) {
                simEndTimeInput.value = savedEndTime;
            }
            
            // 모드에 따라 입력창 UI 업데이트
            const mode = savedMode || 'fixed-workers';
            if (mode === 'bottleneck') {
                DOM.simInputArea.classList.add('hidden');
                if(simEndTimeWrapper) simEndTimeWrapper.classList.add('hidden');
                DOM.simCalculateBtn.textContent = '병목 구간 분석하기';
            } else if (mode === 'target-time') { // ✅ [신규]
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
            // 결과가 없으면: 입력창 초기화 (자동 채우기 로직은 이미 위에서 실행됨)
            renderSimulationResults(null); // 결과창 숨기기
            if (simStartTimeInput) simStartTimeInput.value = "08:30"; // 기본 시작 시간
            if (simEndTimeInput) simEndTimeInput.value = "17:00"; // ✅ 기본 종료 시간

            // 모드 초기화 (기본: 소요 시간 예측)
            if (DOM.simModeRadios && DOM.simModeRadios.length > 0) {
                DOM.simModeRadios[0].checked = true;
                
                // 수동으로 UI 초기화
                DOM.simInputArea.classList.remove('hidden');
                if(simEndTimeWrapper) simEndTimeWrapper.classList.add('hidden'); // ✅ 종료 시간 숨김
                DOM.simCalculateBtn.textContent = '시뮬레이션 실행 🚀';
                if (simTableHeaderWorker) {
                    simTableHeaderWorker.classList.remove('hidden'); // ✅ 인원 열 표시
                    simTableHeaderWorker.textContent = '투입 인원 (명)';
                }
                document.querySelectorAll('.sim-row-worker-or-time-cell').forEach(cell => cell.classList.remove('hidden')); // ✅ 인원 열 표시
                document.querySelectorAll('.sim-row-worker-or-time').forEach(input => {
                    input.placeholder = '5';
                });
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

    // ✅ [신규] 모바일 시뮬레이션 버튼 리스너
    if (DOM.openCostSimulationBtnMobile) {
        DOM.openCostSimulationBtnMobile.addEventListener('click', () => {
            openSimulationModalLogic();
            if (DOM.navContent) DOM.navContent.classList.add('hidden'); // 모바일 메뉴 닫기
        });
    }

    // ✅ [수정] 모드 변경 리스너 (결과값 초기화 제거)
    if (DOM.simModeRadios) {
        Array.from(DOM.simModeRadios).forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    const mode = e.target.value;
                    
                    // ✅ [수정] 이 두 줄을 제거하여 결과값이 유지되도록 함
                    // appState.simulationResults = null; 
                    // renderSimulationResults(null);
                    
                    if (mode === 'bottleneck') {
                        DOM.simInputArea.classList.add('hidden');
                        if(simEndTimeWrapper) simEndTimeWrapper.classList.add('hidden');
                        DOM.simCalculateBtn.textContent = '병목 구간 분석하기';
                    
                    } else if (mode === 'target-time') { // ✅ [신규]
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
                        document.querySelectorAll('.sim-row-worker-or-time').forEach(input => {
                            input.placeholder = '5';
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

    // ✅ [수정] 계산 버튼 리스너 (신규 모드 로직 추가 + State. -> appState)
    if (DOM.simCalculateBtn) {
        DOM.simCalculateBtn.addEventListener('click', () => {
            const mode = document.querySelector('input[name="sim-mode"]:checked').value;
            const currentStartTimeStr = simStartTimeInput ? simStartTimeInput.value : "09:00";
            // ✅ [신규] 종료 시각 읽기
            const currentEndTimeStr = simEndTimeInput ? simEndTimeInput.value : "17:00";
            const includeLinkedTasks = document.getElementById('sim-include-linked-tasks-checkbox')?.checked || false;

            // --- 모드 3: 병목 분석 ---
            if (mode === 'bottleneck') {
                // ✅ [수정] State.allHistoryData -> allHistoryData
                const bottlenecks = analyzeBottlenecks(allHistoryData);
                if (!bottlenecks || bottlenecks.length === 0) {
                    showToast('분석할 데이터가 충분하지 않습니다.', true);
                    return;
                }
                
                const simulationData = { mode, bottlenecks, startTime: currentStartTimeStr };
                // ✅ [수정] State.appState -> appState
                appState.simulationResults = simulationData;
                renderSimulationResults(simulationData);
                return;
            }

            const rows = document.querySelectorAll('.sim-task-row');
            const results = [];
            let totalDuration = 0;
            let totalCost = 0;

            // --- ✅ [신규] 모드 2: 필요 인원 예측 (target-time) ---
            if (mode === 'target-time') {
                if (!currentEndTimeStr) {
                    showToast('필요 인원 예측 모드는 종료 시각이 필수입니다.', true);
                    return;
                }
                if (currentStartTimeStr >= currentEndTimeStr) {
                    showToast('종료 시각은 시작 시각보다 늦어야 합니다.', true);
                    return;
                }
                
                // 1. 총 가용 시간 계산 (점심시간 제외)
                const now = new Date();
                const [startH, startM] = currentStartTimeStr.split(':').map(Number);
                const [endH, endM] = currentEndTimeStr.split(':').map(Number);
                const startDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM);
                const endDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endH, endM);
                
                let durationMinutes = calcElapsedMinutes(currentStartTimeStr, currentEndTimeStr, []);

                // 점심시간 체크
                const lunchStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
                const lunchEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30);
                let includesLunch = false;
                if (startDateTime < lunchEnd && endDateTime > lunchStart) {
                     durationMinutes -= 60; // 점심시간 60분 제외
                     includesLunch = true;
                }
                durationMinutes = Math.max(0, durationMinutes);
                totalDuration = durationMinutes; // 요약 카드 표시용
                
                if (durationMinutes <= 0) {
                     showToast('총 가용 시간이 0분입니다. 시간을 확인해주세요.', true);
                     return;
                }
                
                let totalWorkers = 0; // 연인원 합계

                // 2. 각 업무별로 필요 인원 계산
                rows.forEach(row => {
                    const task = row.querySelector('.sim-row-task').value;
                    const qty = Number(row.querySelector('.sim-row-qty').value);
                    // 'inputValue'로 '총 가용 시간'을 전달
                    if (task && qty > 0) {
                        const res = calculateSimulation(mode, task, qty, durationMinutes, currentStartTimeStr, includeLinkedTasks);
                        if (!res.error) {
                            res.includesLunch = includesLunch; // 점심시간 포함 여부 추가
                            results.push({ task, ...res });
                            totalWorkers += res.workerCount; // 필요 인원 누적 (연인원)
                            totalCost += res.totalCost;
                        } else {
                            showToast(`'${task}' 업무 시뮬레이션 오류: ${res.error}`, true);
                            // ✅ [수정] State.appState -> appState
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
                
                // ✅ [수정] State.appState -> appState
                appState.simulationResults = simulationData;
                renderSimulationResults(simulationData);
                return; // 'fixed-workers' 로직을 실행하지 않고 종료
            }

            // --- 모드 1: 소요 시간 예측 (fixed-workers) ---
            let finalEndTimeStr = currentStartTimeStr;
            let effectiveStartTime = currentStartTimeStr;

            rows.forEach(row => {
                const task = row.querySelector('.sim-row-task').value;
                const qty = Number(row.querySelector('.sim-row-qty').value);
                const inputVal = Number(row.querySelector('.sim-row-worker-or-time').value);

                if (task && qty > 0 && inputVal > 0) {
                    // ✅ [수정] includeLinkedTasks 값을 계산 함수로 전달
                    const res = calculateSimulation(mode, task, qty, inputVal, effectiveStartTime, includeLinkedTasks);
                    
                    if (!res.error) {
                        res.startTime = effectiveStartTime; // 결과 표시용 시작 시간 저장
                        results.push({ task, ...res });
                        
                        effectiveStartTime = res.expectedEndTime;
                        finalEndTimeStr = res.expectedEndTime;
                        totalDuration += res.durationMinutes;
                        totalCost += res.totalCost;
                    } else {
                        showToast(`'${task}' 업무 시뮬레이션 오류: ${res.error}`, true);
                        // ✅ [수정] State.appState -> appState
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
            
            // ✅ [수정] State.appState -> appState
            appState.simulationResults = simulationData;
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