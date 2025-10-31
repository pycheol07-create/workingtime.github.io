// === js/app.js (Refactored) ===

// 1. Firebase (Auth)
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirebase, auth } from './firebase.js'; // db, auth 인스턴스

// 2. API (Data Loading)
import { loadAppConfig, loadLeaveSchedule, startAutoSaveTimer } from './api.js';

// 3. Store (State Management & Listeners)
import { setAppConfig, setPersistentLeaveSchedule, setAppState, startRealtimeListeners, stopRealtimeListeners, setOfflineState, appState } from './store.js';

// 4. Core Logic & Timers
import { startElapsedTimer, stopElapsedTimer } from './timer.js';

// 5. UI (Rendering & Utils)
import { displayCurrentDate } from './utils.js';
import { renderDashboardLayout, renderTaskSelectionModal, render } from './ui/index.js';

// 6. Event Listeners
import { attachAllListeners } from './listeners/index.js';

// --- 전역 변수 (DOM 요소, 컨텍스트) ---
// (모든 컨텍스트 변수는 각 listeners/..js 파일 또는 window 전역으로 이동)
// (DOM 요소 변수들은 각 listeners/..js 파일 내부에서 필요시마다 getElementById로 참조)

/**
 * 사용자가 로그인한 후 앱의 핵심 기능을 시작합니다.
 * (app.js에서 이동)
 */
async function startAppAfterLogin(user) { 
  const loadingSpinner = document.getElementById('loading-spinner');
  if (loadingSpinner) loadingSpinner.style.display = 'block'; 

  try { 
      document.getElementById('connection-status').textContent = '설정 로딩 중...';
      
      // 1. 설정 및 근태 일정 로드 (api.js)
      const config = await loadAppConfig();
      const schedule = await loadLeaveSchedule();
      
      // 2. 전역 스토어에 저장 (store.js)
      setAppConfig(config);
      setPersistentLeaveSchedule(schedule);
      
      const userEmail = user.email;
      if (!userEmail) {
          throw new Error(`로그인한 사용자의 이메일을 찾을 수 없습니다. (UID: ${user.uid})`);
      }
      
      // 3. 역할 및 사용자 이름 확인
      const userEmailLower = userEmail.toLowerCase();
      const memberEmails = config.memberEmails || {}; 
      const memberRoles = config.memberRoles || {};

      const emailToMemberMap = Object.entries(memberEmails).reduce((acc, [name, email]) => {
          if (email) acc[email.toLowerCase()] = name;
          return acc;
      }, {});

      const currentUserName = emailToMemberMap[userEmailLower]; 
      const currentUserRole = memberRoles[userEmailLower] || 'user';
      
      if (!currentUserName) {
          throw new Error(`로그인했으나 앱에 등록된 사용자가 아닙니다. (${userEmail})`);
      }
      
      // 4. appState에 현재 사용자 정보 저장 (store.js)
      setAppState({ 
          currentUser: currentUserName, 
          currentUserRole: currentUserRole 
      });
      
      // 5. UI 업데이트 (역할 기반)
      document.getElementById('user-greeting').textContent = `${currentUserName}님 (${currentUserRole}), 안녕하세요.`;
      document.getElementById('user-greeting').classList.remove('hidden');
      document.getElementById('logout-btn').classList.remove('hidden');
      document.getElementById('logout-btn-mobile').classList.remove('hidden');
      
      const adminLinkBtn = document.getElementById('admin-link-btn');
      const resetAppBtn = document.getElementById('reset-app-btn');
      const openHistoryBtn = document.getElementById('open-history-btn');
      const adminLinkBtnMobile = document.getElementById('admin-link-btn-mobile');
      const resetAppBtnMobile = document.getElementById('reset-app-btn-mobile');

      if (currentUserRole === 'admin') {
          if (adminLinkBtn) adminLinkBtn.style.display = 'flex';
          if (adminLinkBtnMobile) adminLinkBtnMobile.style.display = 'flex';
          if (resetAppBtn) resetAppBtn.style.display = 'flex';
          if (resetAppBtnMobile) resetAppBtnMobile.style.display = 'flex';
          if (openHistoryBtn) openHistoryBtn.style.display = 'inline-block';
      } else {
          // (기본값은 'none'이므로 user일 때 숨김 처리)
          if (adminLinkBtn) adminLinkBtn.style.display = 'none';
          if (adminLinkBtnMobile) adminLinkBtnMobile.style.display = 'none';
          if (resetAppBtn) resetAppBtn.style.display = 'none';
          if (resetAppBtnMobile) resetAppBtnMobile.style.display = 'none';
          if (openHistoryBtn) openHistoryBtn.style.display = 'none';
      }
      
      // 6. 메인 UI 표시
      document.getElementById('current-date-display')?.classList.remove('hidden');
      document.getElementById('top-right-controls')?.classList.remove('hidden');
      document.querySelector('.bg-gray-800.shadow-lg')?.classList.remove('hidden'); 
      document.getElementById('main-content-area')?.classList.remove('hidden'); 
      document.querySelectorAll('.p-6.bg-gray-50.rounded-lg.border.border-gray-200').forEach(el => { 
          if(el.querySelector('#completed-log-content') || el.querySelector('#analysis-content')) {
              el.classList.remove('hidden');
          }
      });
      if (loadingSpinner) loadingSpinner.style.display = 'none'; 
      
      // 7. UI 렌더링 (ui/index.js)
      renderDashboardLayout(config); 
      renderTaskSelectionModal(config.taskGroups);
      // (render()는 store.js의 onSnapshot에서 최초 호출됨)

      // 8. 타이머 및 실시간 리스너 시작
      displayCurrentDate(); // utils.js
      startElapsedTimer();  // timer.js
      startAutoSaveTimer(); // api.js
      startRealtimeListeners(); // store.js

  } catch (e) { 
      console.error("앱 시작 실패:", e);
      showToast(e.message || "설정 정보 로드에 실패했습니다.", true);
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      if (auth) auth.signOut(); // 오류 발생 시 로그아웃
      document.getElementById('login-modal').classList.remove('hidden');
  }
}

/**
 * 앱 초기화 및 인증 처리
 */
async function main() {
  const loadingSpinner = document.getElementById('loading-spinner');
  if (loadingSpinner) loadingSpinner.style.display = 'block';

  try {
    initializeFirebase(); // firebase.js
    if (!auth) throw new Error("Firebase Auth 초기화 실패");
  } catch (e) {
    console.error("Firebase init failed:", e);
    if (loadingSpinner) loadingSpinner.style.display = 'none';
    return;
  }

  // 모든 DOM 이벤트 리스너 부착 (listeners/index.js)
  // (이 작업은 DOM 로드 후 한 번만 수행하면 됨)
  attachAllListeners(); 
  
  // 1분마다 새로고침 (기존 로직 유지)
  setInterval(() => {
    const activeModal = document.querySelector('.fixed.inset-0.z-50:not(.hidden), .fixed.inset-0.z-\[60\]:not(.hidden), .fixed.inset-0.z-\[99\]:not(.hidden)');
    if (!activeModal) {
        location.reload();
    } else {
        console.log("모달이 열려 있어 자동 새로고침을 건너뜁니다.");
    }
  }, 60000);

  // 인증 상태 감지
  onAuthStateChanged(auth, async user => {
    if (user) {
      // --- 로그인한 경우 ---
      document.getElementById('login-modal')?.classList.add('hidden'); 
      await startAppAfterLogin(user); 
    } else {
      // --- 로그아웃한 경우 ---
      stopRealtimeListeners(); // store.js
      stopElapsedTimer();      // timer.js
      setOfflineState();       // store.js (UI 숨기기 및 appState 초기화)
      
      document.getElementById('login-modal')?.classList.remove('hidden');
      if (loadingSpinner) loadingSpinner.style.display = 'none';
    }
  });
}

// 앱 시작
main();