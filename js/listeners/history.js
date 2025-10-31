// === js/listeners/history.js ===

import { appState, appConfig, setAppState } from '../store.js';
import { fetchAllHistoryData, deleteHistoryDoc, updateHistoryDoc } from '../api.js';
import { showToast, getTodayDateString, getWeekOfYear } from '../utils.js';
// ✅ [수정] ui/index.js에서 필요한 모든 ui 함수를 가져옵니다.
import * as ui from '../ui/index.js'; 

// --- 1. 컨텍스트 변수 ---
let allHistoryData = []; // 이력 데이터 캐시
let historyKeyToDelete = null;
let activeMainHistoryTab = 'work';
// ✅ [수정] window. 전역 대신 이 파일의 로컬 변수 사용
let quantityModalContext = { mode: 'today', dateKey: null, onConfirm: null, onCancel: null };
let attendanceRecordToDelete = null;

// (엑셀 함수들은 excel.js에서 window 전역으로 등록됨)

/**
 * '이력 보기' 모달 관련 리스너를 부착합니다.
 */
export function attachHistoryListeners() {

    // --- 1. 이력 모달 열기 ---
    const openHistoryBtn = document.getElementById('open-history-btn');
    if (openHistoryBtn) {
      openHistoryBtn.addEventListener('click', async () => {
        // (인증/역할 확인은 init.js에서 버튼을 숨김/표시)
        
        const historyModal = document.getElementById('history-modal');
        if (historyModal) {
          historyModal.classList.remove('hidden');
          
          // 팝업 위치 초기화
          const contentBox = document.getElementById('history-modal-content-box');
          const overlay = document.getElementById('history-modal');
          if (contentBox && overlay && contentBox.dataset.hasBeenUncentered === 'true') {
              overlay.classList.add('flex', 'items-center', 'justify-center');
              contentBox.style.position = '';
              contentBox.style.top = '';
              contentBox.style.left = '';
              contentBox.dataset.hasBeenUncentered = 'false';
          }
          
          // 데이터 로드 및 렌더링
          try {
              await loadAndRenderHistoryList(); 
          } catch (loadError) {
              console.error("이력 데이터 로딩 중 오류:", loadError);
              showToast("이력 데이터를 불러오는 중 오류가 발생했습니다.", true);
          }
        }
      });
    }

    // --- 2. 이력 모달 닫기 ---
    const closeHistoryBtn = document.getElementById('close-history-btn');
    if (closeHistoryBtn) {
      closeHistoryBtn.addEventListener('click', () => {
        document.getElementById('history-modal')?.classList.add('hidden');
      });
    }

    // --- 3. 이력 모달 내부 리스너 (메인 탭) ---
    const historyMainTabs = document.getElementById('history-main-tabs');
    if (historyMainTabs) {
      historyMainTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-main-tab]');
        if (btn) {
          const tabName = btn.dataset.mainTab;
          activeMainHistoryTab = tabName;

          document.querySelectorAll('.history-main-tab-btn').forEach(b => {
              b.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
              b.classList.add('font-medium', 'text-gray-500');
          });
          btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
          btn.classList.remove('font-medium', 'text-gray-500');

          const dateListContainer = document.getElementById('history-date-list-container');
          const workHistoryPanel = document.getElementById('work-history-panel');
          const attendanceHistoryPanel = document.getElementById('attendance-history-panel');
          const trendAnalysisPanel = document.getElementById('trend-analysis-panel');

          if (tabName === 'work') {
            if (workHistoryPanel) workHistoryPanel.classList.remove('hidden');
            if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
            if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden');
            if (dateListContainer) dateListContainer.style.display = 'block';

            const activeSubTabBtn = document.getElementById('history-tabs')?.querySelector('button.font-semibold');
            const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
            switchHistoryView(view);
          
          } else if (tabName === 'attendance') {
            if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
            if (attendanceHistoryPanel) attendanceHistoryPanel.classList.remove('hidden');
            if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden');
            if (dateListContainer) dateListContainer.style.display = 'block';

            const activeSubTabBtn = document.getElementById('attendance-history-tabs')?.querySelector('button.font-semibold');
            const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';
            switchHistoryView(view);
          
          } else if (tabName === 'trends') {
            if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
            if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
            if (trendAnalysisPanel) trendAnalysisPanel.classList.remove('hidden');
            if (dateListContainer) dateListContainer.style.display = 'none';
            
            // ui/analysis.js의 함수 호출
            ui.renderTrendAnalysisCharts(allHistoryData, appConfig);
          }
        }
      });
    }

    // --- 4. 이력 모달 (업무 서브 탭) ---
    const historyTabs = document.getElementById('history-tabs');
    if (historyTabs) {
      historyTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-view]');
        if (btn) {
          switchHistoryView(btn.dataset.view);
        }
      });
    }

    // --- 5. 이력 모달 (근태 서브 탭) ---
    const attendanceHistoryTabs = document.getElementById('attendance-history-tabs');
    if (attendanceHistoryTabs) {
      attendanceHistoryTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-view]');
        if (btn) {
          switchHistoryView(btn.dataset.view);
        }
      });
    }

    // --- 6. 이력 모달 (날짜 리스트 클릭) ---
    const historyDateList = document.getElementById('history-date-list');
    if (historyDateList) {
      historyDateList.addEventListener('click', (e) => {
        const btn = e.target.closest('.history-date-btn');
        if (btn) {
          historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
          btn.classList.add('bg-blue-100', 'font-bold');
          const dateKey = btn.dataset.key;
          
          const activeSubTabBtn = (activeMainHistoryTab === 'work')
            ? historyTabs?.querySelector('button.font-semibold')
            : attendanceHistoryTabs?.querySelector('button.font-semibold');
          const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');
          
          if (activeView === 'daily') {
              const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
              const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) 
                                    ? allHistoryData[currentIndex + 1] 
                                    : null;
              // ui/history.js의 함수 호출
              ui.renderHistoryDetail(dateKey, previousDayData, allHistoryData, appConfig);

          } else if (activeView === 'attendance-daily') {
              ui.renderAttendanceDailyHistory(dateKey, allHistoryData);
          
          } else if (activeView === 'weekly' || activeView === 'monthly' || activeView === 'attendance-weekly' || activeView === 'attendance-monthly') {
              const targetKey = dateKey; 
              if (activeView === 'weekly' || activeView === 'monthly') {
                  const summaryCard = document.getElementById(`summary-card-${targetKey}`);
                  if (summaryCard) {
                      summaryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      summaryCard.classList.add('ring-2', 'ring-blue-400', 'transition-all', 'duration-300');
                      setTimeout(() => {
                          summaryCard.classList.remove('ring-2', 'ring-blue-400');
                      }, 2000); 
                  }
              }
          }
        }
      });
    }

    // --- 7. 이력 모달 (근태 탭 내부의 수정/삭제/추가) ---
    const attendanceHistoryViewContainer = document.getElementById('attendance-history-view-container');
    if (attendanceHistoryViewContainer) {
        attendanceHistoryViewContainer.addEventListener('click', (e) => {
            
            // 7a. '수정' 버튼
            const editBtn = e.target.closest('button[data-action="edit-attendance"]');
            if (editBtn) {
                const dateKey = editBtn.dataset.dateKey;
                const index = parseInt(editBtn.dataset.index, 10);
                if (!dateKey || isNaN(index)) return showToast('수정할 기록 정보를 찾는 데 실패했습니다.', true);
                
                const dayData = allHistoryData.find(d => d.id === dateKey);
                if (!dayData || !dayData.onLeaveMembers || !dayData.onLeaveMembers[index]) return showToast('원본 근태 기록을 찾을 수 없습니다.', true);

                const record = dayData.onLeaveMembers[index];
                const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장']; // (임시)

                document.getElementById('edit-attendance-member-name').value = record.member;
                const typeSelect = document.getElementById('edit-attendance-type');
                typeSelect.innerHTML = '';
                LEAVE_TYPES.forEach(type => {
                    const option = document.createElement('option');
                    option.value = type;
                    option.textContent = type;
                    if (type === record.type) option.selected = true;
                    typeSelect.appendChild(option);
                });
                
                const isTimeBased = (record.type === '외출' || record.type === '조퇴');
                const isDateBased = !isTimeBased;
                
                document.getElementById('edit-attendance-time-fields').classList.toggle('hidden', !isTimeBased);
                document.getElementById('edit-attendance-start-time').value = record.startTime || '';
                document.getElementById('edit-attendance-end-time').value = record.endTime || '';
                
                document.getElementById('edit-attendance-date-fields').classList.toggle('hidden', isDateBased);
                document.getElementById('edit-attendance-start-date').value = record.startDate || '';
                document.getElementById('edit-attendance-end-date').value = record.endDate || '';

                document.getElementById('edit-attendance-date-key').value = dateKey;
                document.getElementById('edit-attendance-record-index').value = index;
                document.getElementById('edit-attendance-record-modal').classList.remove('hidden');
                return;
            }
            
            // 7b. '삭제' 버튼
            const deleteBtn = e.target.closest('button[data-action="delete-attendance"]');
            if (deleteBtn) {
                const dateKey = deleteBtn.dataset.dateKey;
                const index = parseInt(deleteBtn.dataset.index, 10);
                if (!dateKey || isNaN(index)) return showToast('삭제할 기록 정보를 찾는 데 실패했습니다.', true);

                const dayData = allHistoryData.find(d => d.id === dateKey);
                const record = dayData?.onLeaveMembers?.[index];
                if (!record) return showToast('삭제할 근태 기록을 찾을 수 없습니다.', true);

                // ✅ [수정] window 전역 대신 이 파일의 로컬 변수 사용
                window.deleteMode = 'attendance-history'; // (modals.js에서 참조할 임시 전역 변수)
                window.attendanceRecordToDelete = { dateKey, index }; // (modals.js에서 참조)
                
                document.getElementById('delete-confirm-message').textContent = `${record.member}님의 '${record.type}' 기록을 삭제하시겠습니까?`;
                document.getElementById('delete-confirm-modal').classList.remove('hidden');
                return;
            }

            // 7c. '수동 추가' 버튼
            const addBtn = e.target.closest('button[data-action="open-add-attendance-modal"]');
            if (addBtn) {
                const dateKey = addBtn.dataset.dateKey;
                if (!dateKey) return showToast('날짜 정보를 찾을 수 없습니다.', true);

                document.getElementById('add-attendance-form')?.reset();
                document.getElementById('add-attendance-date-key').value = dateKey;
                document.getElementById('add-attendance-start-date').value = dateKey;
                document.getElementById('add-attendance-end-date').value = '';

                // uiModals.renderManualAddModalDatalists(appState, appConfig);
                // -> [수정] 근태 모달용 datalist 렌더링 함수 필요
                //    (일단 modals.js에 있는 renderManualAddModalDatalists 호출)
                ui.renderManualAddModalDatalists(appState, appConfig); 

                const LEAVE_TYPES = ['연차', '외출', '조퇴', '결근', '출장']; // (임시)
                const typeSelect = document.getElementById('add-attendance-type');
                typeSelect.innerHTML = '';
                LEAVE_TYPES.forEach((type, index) => {
                    const option = document.createElement('option');
                    option.value = type;
                    option.textContent = type;
                    if (index === 0) option.selected = true;
                    typeSelect.appendChild(option);
                });

                const firstType = LEAVE_TYPES[0] || '';
                const isTimeBased = (firstType === '외출' || firstType === '조퇴');
                const isDateBased = !isTimeBased;
                document.getElementById('add-attendance-time-fields').classList.toggle('hidden', !isTimeBased);
                document.getElementById('add-attendance-date-fields').classList.toggle('hidden', !isDateBased);

                document.getElementById('add-attendance-record-modal').classList.remove('hidden');
                return;
            }
        });
    }

    // --- 8. 엑셀 다운로드 (전역 함수 호출) ---
    // (HTML onclick에서 직접 호출하므로 여기서는 window 전역에 할당)
    
    // 이력 모달의 '처리량 수정'
    window.openHistoryQuantityModal = (dateKey) => {
        const todayDateString = getTodayDateString();
        let quantitiesToShow = {};

        if (dateKey === todayDateString) {
            quantitiesToShow = appState.taskQuantities || {};
        } else {
            const data = allHistoryData.find(d => d.id === dateKey);
            if (!data) return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
            quantitiesToShow = data.taskQuantities || {};
        }

        ui.renderQuantityModalInputs(quantitiesToShow, appConfig.quantityTaskTypes);
        document.getElementById('quantity-modal-title').textContent = `${dateKey} 처리량 수정`;

        // ✅ [수정] window 전역 대신 이 파일의 로컬 변수 사용
        quantityModalContext = {
            mode: 'history',
            dateKey,
            onConfirm: async (newQuantities) => {
                const idx = allHistoryData.findIndex(d => d.id === dateKey);
                if (idx === -1 && dateKey !== todayDateString) {
                     showToast('이력 데이터를 찾을 수 없어 수정할 수 없습니다.', true);
                     return;
                }
                
                let dataToSave;
                if (idx > -1) {
                    allHistoryData[idx] = { ...allHistoryData[idx], taskQuantities: newQuantities };
                    dataToSave = allHistoryData[idx];
                } else {
                    dataToSave = { id: dateKey, taskQuantities: newQuantities, workRecords: [], onLeaveMembers: [], partTimers: [] };
                    allHistoryData.unshift(dataToSave); // 캐시에도 추가
                }
                
                await updateHistoryDoc(dateKey, dataToSave); // api.js 호출
                
                if (dateKey === getTodayDateString()) {
                    setAppState({ taskQuantities: newQuantities });
                    ui.render(); // 메인 화면 UI 즉시 갱신
                }
                
                const activeSubTabBtn = document.getElementById('history-tabs')?.querySelector('button.font-semibold');
                const currentView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
                switchHistoryView(currentView);
            },
            onCancel: () => {}
        };
        // ✅ [수정] window.quantityModalContext 대신 로컬 변수 사용
        window.quantityModalContext = quantityModalContext; // (임시로 window에 유지)

        document.getElementById('confirm-quantity-btn').textContent = '수정 저장';
        document.getElementById('cancel-quantity-btn').textContent = '취소';
        document.getElementById('quantity-modal').classList.remove('hidden');
    };

    // 이력 모달의 '삭제'
    window.requestHistoryDeletion = (dateKey) => {
      historyKeyToDelete = dateKey;
      document.getElementById('delete-history-modal').classList.remove('hidden');
    };
    
    // 이력 모달의 '엑셀 (전체)'
    window.downloadHistoryAsExcel = (dateKey) => {
        // excel.js를 동적으로 import하여 사용
        import('../excel.js').then(excelModule => {
            excelModule.downloadHistoryAsExcel(dateKey, allHistoryData, appConfig);
        }).catch(err => console.error("excel.js 로드 실패:", err));
    };
    
    // 이력 모달의 '근태 엑셀 (전체)'
    window.downloadAttendanceHistoryAsExcel = (dateKey) => {
        import('../excel.js').then(excelModule => {
            excelModule.downloadAttendanceHistoryAsExcel(dateKey, allHistoryData);
        }).catch(err => console.error("excel.js 로드 실패:", err));
    };

} // attachHistoryListeners 끝

// --- 9. 이력 모달 (내부 헬퍼 함수) ---

async function loadAndRenderHistoryList() {
    const historyDateList = document.getElementById('history-date-list');
    if (!historyDateList) return;
    historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">이력 로딩 중...</div></li>';
    
    allHistoryData = await fetchAllHistoryData(); // api.js 호출

    if (allHistoryData.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">저장된 이력이 없습니다.</div></li>';
        const viewsToClear = ['history-daily-view', 'history-weekly-view', 'history-monthly-view', 'history-attendance-daily-view', 'history-attendance-weekly-view', 'history-attendance-monthly-view'];
        viewsToClear.forEach(viewId => {
            const viewEl = document.getElementById(viewId);
            if (viewEl) viewEl.innerHTML = '';
        });
        return;
    }

    const activeSubTabBtn = (activeMainHistoryTab === 'work')
        ? document.getElementById('history-tabs')?.querySelector('button.font-semibold')
        : document.getElementById('attendance-history-tabs')?.querySelector('button.font-semibold');
    const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');
    
    switchHistoryView(activeView); 
}

function renderHistoryDateListByMode(mode = 'day') {
    const historyDateList = document.getElementById('history-date-list');
    if (!historyDateList) return;
    historyDateList.innerHTML = '';

    let keys = [];
    
    if (mode === 'day') {
        keys = allHistoryData.map(d => d.id);
    } else if (mode === 'week') {
        const weekSet = new Set(allHistoryData.map(d => getWeekOfYear(new Date(d.id + "T00:00:00"))));
        keys = Array.from(weekSet).sort((a, b) => b.localeCompare(a));
    } else if (mode === 'month') {
        const monthSet = new Set(allHistoryData.map(d => d.id.substring(0, 7)));
        keys = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
    }

    if (keys.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">데이터 없음</div></li>';
        return;
    }

    keys.forEach(key => {
        const li = document.createElement('li');
        li.innerHTML = `<button data-key="${key}" class="history-date-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:outline-none focus:ring-2 focus:ring-blue-300">${key}</button>`;
        historyDateList.appendChild(li);
    });

    const firstButton = historyDateList.firstChild?.querySelector('button');
    if (firstButton) {
        firstButton.classList.add('bg-blue-100', 'font-bold');
        if (mode === 'day') {
             const previousDayData = (allHistoryData.length > 1) ? allHistoryData[1] : null;
             if (activeMainHistoryTab === 'work') {
                // ✅ [수정] ui.renderHistoryDetail 호출
                ui.renderHistoryDetail(firstButton.dataset.key, previousDayData, allHistoryData, appConfig);
             } else {
                ui.renderAttendanceDailyHistory(firstButton.dataset.key, allHistoryData);
             }
        }
    }
}

function switchHistoryView(view) {
  const allViews = [
      document.getElementById('history-daily-view'),
      document.getElementById('history-weekly-view'),
      document.getElementById('history-monthly-view'),
      document.getElementById('history-attendance-daily-view'),
      document.getElementById('history-attendance-weekly-view'),
      document.getElementById('history-attendance-monthly-view')
  ];
  allViews.forEach(v => v && v.classList.add('hidden'));

  const historyTabs = document.getElementById('history-tabs');
  const attendanceHistoryTabs = document.getElementById('attendance-history-tabs');

  if (historyTabs) {
      historyTabs.querySelectorAll('button').forEach(btn => {
          btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
          btn.classList.add('text-gray-500');
      });
  }
  if (attendanceHistoryTabs) {
      attendanceHistoryTabs.querySelectorAll('button').forEach(btn => {
          btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
          btn.classList.add('text-gray-500');
      });
  }

  const dateListContainer = document.getElementById('history-date-list-container');
  if (dateListContainer) {
      dateListContainer.style.display = 'block'; 
  }

  let viewToShow = null;
  let tabToActivate = null;
  let listMode = 'day';

  switch(view) {
      case 'daily':
          listMode = 'day';
          viewToShow = document.getElementById('history-daily-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="daily"]');
          break;
      case 'weekly':
          listMode = 'week';
          viewToShow = document.getElementById('history-weekly-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="weekly"]');
          ui.renderWeeklyHistory(allHistoryData, appConfig);
          break;
      case 'monthly':
          listMode = 'month';
          viewToShow = document.getElementById('history-monthly-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="monthly"]');
          ui.renderMonthlyHistory(allHistoryData, appConfig);
          break;
      case 'attendance-daily':
          listMode = 'day';
          viewToShow = document.getElementById('history-attendance-daily-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-daily"]');
          break;
      case 'attendance-weekly':
          listMode = 'week';
          viewToShow = document.getElementById('history-attendance-weekly-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-weekly"]');
          ui.renderAttendanceWeeklyHistory(allHistoryData);
          break;
      case 'attendance-monthly':
          listMode = 'month';
          viewToShow = document.getElementById('history-attendance-monthly-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-monthly"]');
          ui.renderAttendanceMonthlyHistory(allHistoryData);
          break;
  }
  
  renderHistoryDateListByMode(listMode); // 컨텐츠 렌더링 후 목록 렌더링

  if (viewToShow) viewToShow.classList.remove('hidden');
  if (tabToActivate) {
      tabToActivate.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
      tabToActivate.classList.remove('text-gray-500');
  }
}