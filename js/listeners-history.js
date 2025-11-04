// === listeners-history.js (이력 모달 리스너) ===

// app.js (메인)에서 가져올 핵심 상태 및 DOM 요소들
import {
    appState, appConfig, db, auth, 
    allHistoryData,
    context, 
    LEAVE_TYPES,

    // DOM 요소 (이 파일에서 필요한 것들)
    addAttendanceRecordModal, addAttendanceForm, confirmAddAttendanceBtn,
    addAttendanceMemberNameInput, addAttendanceMemberDatalist, addAttendanceTypeSelect,
    addAttendanceStartTimeInput, addAttendanceEndTimeInput, addAttendanceStartDateInput,
    addAttendanceEndDateInput, addAttendanceDateKeyInput, addAttendanceTimeFields,
    addAttendanceDateFields, editAttendanceRecordModal, confirmEditAttendanceBtn,
    editAttendanceMemberName, editAttendanceTypeSelect,
    editAttendanceStartTimeInput, editAttendanceEndTimeInput, editAttendanceStartDateInput,
    editAttendanceEndDateInput, editAttendanceDateKeyInput, editAttendanceRecordIndexInput,
    editAttendanceTimeFields, editAttendanceDateFields,
    deleteConfirmModal, historyModal,
    historyModalContentBox,
    openHistoryBtn, closeHistoryBtn, historyDateList, historyViewContainer, historyTabs,
    historyMainTabs, workHistoryPanel, attendanceHistoryPanel, attendanceHistoryTabs,
    attendanceHistoryViewContainer, trendAnalysisPanel,
    deleteHistoryModal, confirmHistoryDeleteBtn, 

    // 👈 [추가] 기간 조회 DOM 요소들
    historyStartDateInput, historyEndDateInput, historyFilterBtn, 
    historyClearFilterBtn, historyDownloadPeriodExcelBtn,
    
    // (로그인/로그아웃 DOM 요소)
    loginModal, 
    
} from './app.js';

// utils.js에서 필요한 모든 헬퍼 함수 가져오기
import { showToast } from './utils.js';

// ui.js (통합)에서 가져올 렌더링 함수
import {
    renderTrendAnalysisCharts,
    trendCharts // ✅ [수정] trendCharts는 ui.js에서 가져옴
} from './ui.js';

// app-history-logic.js (이력 로직)
import {
    loadAndRenderHistoryList,
    renderHistoryDetail,
    switchHistoryView,
    renderHistoryDateListByMode,
    openHistoryQuantityModal,     // 👈 [추가]
    requestHistoryDeletion      // 👈 [추가]
} from './app-history-logic.js';

// history-excel.js (엑셀 로직)
import {
    downloadPeriodHistoryAsExcel,
    downloadHistoryAsExcel      // 👈 [추가]
} from './history-excel.js';

// (ui-history에서 직접 가져와야 함 - app-history-logic가 ui를 import하므로 순환참조 방지)
import {
  renderAttendanceDailyHistory,
  renderAttendanceWeeklyHistory,
  renderAttendanceMonthlyHistory,
  renderWeeklyHistory,
  renderMonthlyHistory
} from './ui-history.js';


// Firebase (Firestore)
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


/**
 * 2. 이력(History) 모달 관련 리스너 설정
 */
export function setupHistoryModalListeners() {
    
    // --- 4. 👈 [수정] 이력(History) 모달 리스너 (기간 조회 버튼 추가) ---
    
    // 👈 [추가] 현재 활성화된 탭 모드(day, week, month)를 반환하는 헬퍼 함수
    const getCurrentHistoryListMode = () => {
        const activeSubTabBtn = (context.activeMainHistoryTab === 'work')
            ? historyTabs?.querySelector('button.font-semibold')
            : attendanceHistoryTabs?.querySelector('button.font-semibold');
        
        const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (context.activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily');

        if (activeView.includes('weekly')) return 'week';
        if (activeView.includes('monthly')) return 'month';
        return 'day';
    };

    // 👈 [추가] '조회' 버튼 리스너
    if (historyFilterBtn) {
        historyFilterBtn.addEventListener('click', () => {
            const startDate = historyStartDateInput.value;
            const endDate = historyEndDateInput.value;

            if (startDate && endDate && endDate < startDate) {
                showToast('종료일은 시작일보다 이후여야 합니다.', true);
                return;
            }
            
            context.historyStartDate = startDate || null;
            context.historyEndDate = endDate || null;
            
            renderHistoryDateListByMode(getCurrentHistoryListMode());
            showToast('이력 목록을 필터링했습니다.');
        });
    }

    // 👈 [추가] '초기화' 버튼 리스너
    if (historyClearFilterBtn) {
        historyClearFilterBtn.addEventListener('click', () => {
            historyStartDateInput.value = '';
            historyEndDateInput.value = '';
            context.historyStartDate = null;
            context.historyEndDate = null;
            
            renderHistoryDateListByMode(getCurrentHistoryListMode());
            showToast('필터를 초기화했습니다.');
        });
    }

    // 👈 [추가] '선택기간 엑셀다운' 버튼 리스너
    if (historyDownloadPeriodExcelBtn) {
        historyDownloadPeriodExcelBtn.addEventListener('click', () => {
            const startDate = context.historyStartDate;
            const endDate = context.historyEndDate;

            if (!startDate || !endDate) {
                showToast('엑셀 다운로드를 위해 시작일과 종료일을 모두 설정(조회)해주세요.', true);
                return;
            }
            
            // 이 함수는 history-excel.js에서 구현했습니다.
            downloadPeriodHistoryAsExcel(startDate, endDate); 
        });
    }

    if (openHistoryBtn) {
      openHistoryBtn.addEventListener('click', async () => {
        if (!auth || !auth.currentUser) {
            showToast('이력을 보려면 로그인이 필요합니다.', true);
            if (historyModal && !historyModal.classList.contains('hidden')) {
                 historyModal.classList.add('hidden'); 
            }
            if (loginModal) loginModal.classList.remove('hidden'); 
            return; 
        }
          
        if (historyModal) {
          historyModal.classList.remove('hidden'); 
          
          // 👈 [추가] 모달 열 때 필터값 초기화
          if (historyStartDateInput) historyStartDateInput.value = '';
          if (historyEndDateInput) historyEndDateInput.value = '';
          context.historyStartDate = null;
          context.historyEndDate = null;

          const contentBox = document.getElementById('history-modal-content-box');
          const overlay = document.getElementById('history-modal');
          
          if (contentBox && overlay && contentBox.dataset.hasBeenUncentered === 'true') {
              overlay.classList.add('flex', 'items-center', 'justify-center');
              contentBox.style.position = '';
              contentBox.style.top = '';
              contentBox.style.left = '';
              contentBox.dataset.hasBeenUncentered = 'false';
          }
          
          try {
              await loadAndRenderHistoryList(); 
          } catch (loadError) {
              console.error("이력 데이터 로딩 중 오류:", loadError);
              showToast("이력 데이터를 불러오는 중 오류가 발생했습니다.", true);
          }
        }
      });
    }
    
    if (closeHistoryBtn) {
      closeHistoryBtn.addEventListener('click', () => {
        if (historyModal) {
            historyModal.classList.add('hidden'); 
        }
      });
    }

    if (historyDateList) {
      historyDateList.addEventListener('click', (e) => {
        const btn = e.target.closest('.history-date-btn');
        if (btn) {
          historyDateList.querySelectorAll('button').forEach(b => b.classList.remove('bg-blue-100', 'font-bold'));
          btn.classList.add('bg-blue-100', 'font-bold');
          const dateKey = btn.dataset.key; 
          
          const activeSubTabBtn = (context.activeMainHistoryTab === 'work') // ✅ context.
            ? historyTabs?.querySelector('button.font-semibold')
            : attendanceHistoryTabs?.querySelector('button.font-semibold');
          const activeView = activeSubTabBtn ? activeSubTabBtn.dataset.view : (context.activeMainHistoryTab === 'work' ? 'daily' : 'attendance-daily'); // ✅ context.
          
          // 👈 [추가] 날짜 클릭 시 필터링된 데이터(filteredData)를 사용해야 함
          const filteredData = (context.historyStartDate || context.historyEndDate)
              ? allHistoryData.filter(d => {
                  const date = d.id;
                  const start = context.historyStartDate;
                  const end = context.historyEndDate;
                  if (start && end) return date >= start && date <= end;
                  if (start) return date >= start;
                  if (end) return date <= end;
                  return true;
                })
              : allHistoryData;

          if (context.activeMainHistoryTab === 'work') {
              if (activeView === 'daily') {
                  const currentIndex = filteredData.findIndex(d => d.id === dateKey);
                  // 👈 [수정] filteredData에서 previousDayData를 찾음
                  const previousDayData = (currentIndex > -1 && currentIndex + 1 < filteredData.length) 
                                        ? filteredData[currentIndex + 1] 
                                        : null;
                  renderHistoryDetail(dateKey, previousDayData); // 👈 dateKey로 찾지만, prev는 filteredData 기준
              } else if (activeView === 'weekly') {
                  renderWeeklyHistory(dateKey, filteredData, appConfig); // 👈 filteredData 전달
              } else if (activeView === 'monthly') {
                  renderMonthlyHistory(dateKey, filteredData, appConfig); // 👈 filteredData 전달
              }
          } else { // attendance tab
              if (activeView === 'attendance-daily') {
                  renderAttendanceDailyHistory(dateKey, filteredData); // 👈 filteredData 전달
              } else if (activeView === 'attendance-weekly') {
                  renderAttendanceWeeklyHistory(dateKey, filteredData); // 👈 filteredData 전달
              } else if (activeView === 'attendance-monthly') {
                  renderAttendanceMonthlyHistory(dateKey, filteredData); // 👈 filteredData 전달
              }
          }

        }
      });
    }

    if (historyTabs) {
      historyTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-view]');
        if (btn) {
          switchHistoryView(btn.dataset.view);
        }
      });
    }

    if (confirmHistoryDeleteBtn) {
      confirmHistoryDeleteBtn.addEventListener('click', async () => {
        if (context.historyKeyToDelete) { // ✅ context.
          const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', context.historyKeyToDelete); // ✅ context.
          try {
            await deleteDoc(historyDocRef);
            showToast(`${context.historyKeyToDelete} 이력이 삭제되었습니다.`); // ✅ context.
            await loadAndRenderHistoryList();
          } catch (e) {
            console.error('Error deleting history:', e);
            showToast('이력 삭제 중 오류 발생.', true);
          }
        }
        if (deleteHistoryModal) deleteHistoryModal.classList.add('hidden');
        context.historyKeyToDelete = null; // ✅ context.
      });
    }

    if (historyMainTabs) {
      historyMainTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-main-tab]');
        if (btn) {
          const tabName = btn.dataset.mainTab;
          context.activeMainHistoryTab = tabName; // ✅ context.

          document.querySelectorAll('.history-main-tab-btn').forEach(b => {
              b.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
              b.classList.add('font-medium', 'text-gray-500');
          });
          btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
          btn.classList.remove('font-medium', 'text-gray-500');

          const dateListContainer = document.getElementById('history-date-list-container');

          if (tabName === 'work') {
            if (workHistoryPanel) workHistoryPanel.classList.remove('hidden');
            if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
            if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden'); 
            if (dateListContainer) dateListContainer.style.display = 'block'; 

            const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
            const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
            switchHistoryView(view);
          
          } else if (tabName === 'attendance') { 
            if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
            if (attendanceHistoryPanel) attendanceHistoryPanel.classList.remove('hidden');
            if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden'); 
            if (dateListContainer) dateListContainer.style.display = 'block'; 

            const activeSubTabBtn = attendanceHistoryTabs?.querySelector('button.font-semibold');
            const view = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'attendance-daily';
            switchHistoryView(view);
          
          } else if (tabName === 'trends') { 
            if (workHistoryPanel) workHistoryPanel.classList.add('hidden');
            if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
            if (trendAnalysisPanel) trendAnalysisPanel.classList.remove('hidden');
            if (dateListContainer) dateListContainer.style.display = 'none'; 
            
            // 👈 [수정] 트렌드 분석은 필터된 데이터가 아닌 '전체' 데이터 기준
            renderTrendAnalysisCharts(allHistoryData, appConfig, trendCharts);
          }
        }
      });
    }

    if (attendanceHistoryTabs) {
      attendanceHistoryTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-view]');
        if (btn) {
          switchHistoryView(btn.dataset.view);
        }
      });
    }

    // ✅ [추가] '업무 이력' (일별 상세) 뷰의 버튼 리스너
    if (historyViewContainer) {
        historyViewContainer.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;

            const action = button.dataset.action;
            const dateKey = button.dataset.dateKey;

            if (!dateKey) {
                console.warn('Action button missing dateKey', button);
                return;
            }

            // data-action 값에 따라 적절한 함수 호출
            if (action === 'open-history-quantity-modal') {
                openHistoryQuantityModal(dateKey);
            } else if (action === 'download-history-excel') {
                downloadHistoryAsExcel(dateKey);
            } else if (action === 'request-history-deletion') {
                requestHistoryDeletion(dateKey);
            }
        });
    }
    
    // (근태 이력) '일별 상세' 보기 리스너 (수정/삭제/추가)
    if (attendanceHistoryViewContainer) {
        attendanceHistoryViewContainer.addEventListener('click', (e) => {
            
            // 1. '수정' 버튼 클릭
            const editBtn = e.target.closest('button[data-action="edit-attendance"]');
            if (editBtn) {
                const dateKey = editBtn.dataset.dateKey;
                const index = parseInt(editBtn.dataset.index, 10);
                if (!dateKey || isNaN(index)) { return; }
                
                // 👈 [수정] 필터된 데이터를 기준으로 찾지 않고, '전체' 데이터에서 찾음
                const dayData = allHistoryData.find(d => d.id === dateKey);
                
                if (!dayData || !dayData.onLeaveMembers || !dayData.onLeaveMembers[index]) {
                    showToast('원본 근태 기록을 찾을 수 없습니다.', true); return;
                }
                const record = dayData.onLeaveMembers[index];

                if (editAttendanceMemberName) editAttendanceMemberName.value = record.member;
                if (editAttendanceTypeSelect) {
                    editAttendanceTypeSelect.innerHTML = ''; 
                    LEAVE_TYPES.forEach(type => {
                        const option = document.createElement('option');
                        option.value = type;
                        option.textContent = type;
                        if (type === record.type) option.selected = true;
                        editAttendanceTypeSelect.appendChild(option);
                    });
                }
                const isTimeBased = (record.type === '외출' || record.type === '조퇴');
                const isDateBased = (record.type === '연차' || record.type === '출장' || record.type === '결근');

                if (editAttendanceTimeFields) {
                    editAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
                    if (editAttendanceStartTimeInput) editAttendanceStartTimeInput.value = record.startTime || '';
                    if (editAttendanceEndTimeInput) editAttendanceEndTimeInput.value = record.endTime || '';
                }
                if (editAttendanceDateFields) {
                    editAttendanceDateFields.classList.toggle('hidden', !isDateBased);
                    if (editAttendanceStartDateInput) editAttendanceStartDateInput.value = record.startDate || '';
                    if (editAttendanceEndDateInput) editAttendanceEndDateInput.value = record.endDate || '';
                }
                if (editAttendanceDateKeyInput) editAttendanceDateKeyInput.value = dateKey;
                if (editAttendanceRecordIndexInput) editAttendanceRecordIndexInput.value = index;
                if (editAttendanceRecordModal) editAttendanceRecordModal.classList.remove('hidden');
                return; 
            }
            
            // 2. '삭제' 버튼 클릭
            const deleteBtn = e.target.closest('button[data-action="delete-attendance"]');
            if (deleteBtn) {
                const dateKey = deleteBtn.dataset.dateKey;
                const index = parseInt(deleteBtn.dataset.index, 10);
                if (!dateKey || isNaN(index)) { return; }

                // 👈 [수정] 필터된 데이터를 기준으로 찾지 않고, '전체' 데이터에서 찾음
                const dayData = allHistoryData.find(d => d.id === dateKey);
                const record = dayData?.onLeaveMembers?.[index];
                
                if (!record) { showToast('삭제할 근태 기록을 찾을 수 없습니다.', true); return; }

                context.deleteMode = 'attendance'; // ✅ context.
                context.attendanceRecordToDelete = { dateKey, index }; // ✅ context.
                
                const msgEl = document.getElementById('delete-confirm-message');
                if (msgEl) msgEl.textContent = `${record.member}님의 '${record.type}' 기록을 삭제하시겠습니까?`;
                if (deleteConfirmModal) deleteConfirmModal.classList.remove('hidden');
                return; 
            }

            // 3. '수동 추가' 버튼 클릭
            const addBtn = e.target.closest('button[data-action="open-add-attendance-modal"]');
            if (addBtn) {
                const dateKey = addBtn.dataset.dateKey;
                if (!dateKey) { showToast('날짜 정보를 찾을 수 없습니다.', true); return; }
                if (addAttendanceForm) addAttendanceForm.reset();
                if (addAttendanceDateKeyInput) addAttendanceDateKeyInput.value = dateKey;
                if (addAttendanceStartDateInput) addAttendanceStartDateInput.value = dateKey;
                if (addAttendanceEndDateInput) addAttendanceEndDateInput.value = '';

                if (addAttendanceMemberDatalist) {
                    addAttendanceMemberDatalist.innerHTML = '';
                    const staffMembers = (appConfig.teamGroups || []).flatMap(g => g.members);
                    const partTimerMembers = (appState.partTimers || []).map(p => p.name);
                    const allMembers = [...new Set([...staffMembers, ...partTimerMembers])].sort();
                    allMembers.forEach(member => {
                        const option = document.createElement('option');
                        option.value = member;
                        addAttendanceMemberDatalist.appendChild(option);
                    });
                }

                if (addAttendanceTypeSelect) {
                    addAttendanceTypeSelect.innerHTML = ''; 
                    LEAVE_TYPES.forEach((type, index) => {
                        const option = document.createElement('option');
                        option.value = type;
                        option.textContent = type;
                        if (index === 0) option.selected = true; 
                        addAttendanceTypeSelect.appendChild(option);
                    });
                }
                const firstType = LEAVE_TYPES[0] || '';
                const isTimeBased = (firstType === '외출' || firstType === '조퇴');
                const isDateBased = (firstType === '연차' || firstType === '출장' || firstType === '결근');
                if (addAttendanceTimeFields) addAttendanceTimeFields.classList.toggle('hidden', !isTimeBased);
                if (addAttendanceDateFields) addAttendanceDateFields.classList.toggle('hidden', !isDateBased);

                if (addAttendanceRecordModal) addAttendanceRecordModal.classList.remove('hidden');
                return;
            }
        });
    }

    // --- 14. 이력 모달 드래그 기능 ---
    const historyHeader = document.getElementById('history-modal-header');
    if (historyModal && historyHeader && historyModalContentBox) {
        makeDraggable(historyModal, historyHeader, historyModalContentBox);
    }

    // ✅ [수정] --- 15. 이력 모달 전체화면 버튼 리스너 (모니터 전체화면 API 사용) ---
    const toggleFullscreenBtn = document.getElementById('toggle-history-fullscreen-btn');
    
    if (toggleFullscreenBtn && historyModal && historyModalContentBox) {
        
        // 새 아이콘 정의
        const iconMaximize = `<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9M20.25 20.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />`; // 새 확대 아이콘
        const iconMinimize = `<path stroke-linecap="round" stroke-linejoin="round" d="M9 9L3.75 3.75M9 9h4.5M9 9V4.5m9 9l5.25 5.25M15 15h-4.5m4.5 0v4.5m-9 0l-5.25 5.25M9 21v-4.5M9 21H4.5m9-9l5.25-5.25M15 9V4.5M15 9h4.5" />`; // 새 축소 아이콘

        // 1. 클릭 이벤트 리스너: Fullscreen API 호출
        toggleFullscreenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            if (!document.fullscreenElement) {
                // 모니터 전체화면 시작
                historyModalContentBox.requestFullscreen().catch(err => {
                    alert(`전체화면 모드를 시작할 수 없습니다: ${err.message} (${err.name})`);
                });
            } else {
                // 모니터 전체화면 종료
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            }
        });

        // 2. Fullscreen 상태 변경 감지 리스너 (아이콘 및 스타일 변경용)
        const handleFullscreenChange = () => {
            const icon = toggleFullscreenBtn.querySelector('svg');
            if (!icon) return;

            // 현재 전체화면 요소가 이 모달 컨텐츠 박스인지 확인
            if (document.fullscreenElement === historyModalContentBox) {
                // (A) 전체화면 *진입* 시
                
                // 드래그로 인해 적용된 인라인 스타일 초기화
                historyModalContentBox.style.position = '';
                historyModalContentBox.style.top = '';
                historyModalContentBox.style.left = '';
                historyModalContentBox.style.transform = '';
                historyModalContentBox.dataset.hasBeenUncentered = 'false';

                // 오버레이(배경)의 정렬 클래스 *제거*
                historyModal.classList.remove('flex', 'items-center', 'justify-center');
                
                // 콘텐츠 박스의 크기 클래스를 *전체화면용*으로 변경
                historyModalContentBox.classList.remove('max-w-7xl', 'h-[90vh]');
                historyModalContentBox.classList.add('w-screen', 'h-screen', 'max-w-none');

                // 아이콘 변경
                icon.innerHTML = iconMinimize;
                toggleFullscreenBtn.title = "기본 크기로";

            } else if (document.fullscreenElement === null) { 
                // (B) 전체화면 *종료* 시 (Esc 또는 버튼 클릭)

                // 오버레이(배경)의 정렬 클래스 *복구*
                historyModal.classList.add('flex', 'items-center', 'justify-center');
                
                // 콘텐츠 박스의 크기 클래스를 *기본*으로 변경
                historyModalContentBox.classList.add('max-w-7xl', 'h-[90vh]');
                historyModalContentBox.classList.remove('w-screen', 'h-screen', 'max-w-none');

                // 아이콘 변경
                icon.innerHTML = iconMaximize;
                toggleFullscreenBtn.title = "전체화면";
            }
        };

        // 'document'에 리스너를 추가하여 'Esc' 키도 감지
        // (중복 등록 방지를 위해 플래그 사용)
        if (!document.fullscreenListenerAdded) {
            document.addEventListener('fullscreenchange', handleFullscreenChange);
            document.fullscreenListenerAdded = true; // 플래그 설정
        }

        // 3. (페이지 로드 시 초기 아이콘 설정 - 확대 아이콘)
        const icon = toggleFullscreenBtn.querySelector('svg');
        if (icon) {
             icon.innerHTML = iconMaximize;
        }

    } // ✅ [수정] --- 15번 항목 끝 ---
}

/**
 * 모달 팝업을 드래그 가능하게 만듭니다.
 */
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
        
        // 화면 밖으로 드래그할 수 있도록 경계 제한 로직 주석 처리
        /*
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const boxWidth = contentBox.offsetWidth;
        const boxHeight = contentBox.offsetHeight;

        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft + boxWidth > viewportWidth) newLeft = viewportWidth - boxWidth;
        if (newTop + boxHeight > viewportHeight) newTop = viewportHeight - boxHeight;
        */

        contentBox.style.left = `${newLeft}px`;
        contentBox.style.top = `${newTop}px`;
    }

    function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}