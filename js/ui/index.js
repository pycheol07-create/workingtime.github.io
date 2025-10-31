// === js/ui/index.js ===

// 5개 파일의 모든 export 함수들을 가져와서
// 다시 그대로 export 합니다.
export * from './dashboard.js';
export * from './main.js';
export * from './analysis.js';
export * from './history.js';
export * from './modals.js';

// --- ⬇️ [수정] 이 파일을 맨 아래에 추가 ⬇️ ---

// (app.js에 있던 render 함수를 여기로 이동)
// 이 함수는 store.js의 onSnapshot 리스너가 호출합니다.
import { appState, appConfig } from '../store.js';
import { showToast } from '../utils.js';

// (각 파일에서 렌더링 함수들을 가져옴)
import { renderRealtimeStatus, renderCompletedWorkLog } from './main.js';
import { updateSummary } from './dashboard.js';
import { renderTaskAnalysis } from './analysis.js';

/**
 * 메인 화면의 핵심 UI 컴포넌트들을 모두 새로고침합니다.
 */
export const render = () => {
  try {
    // (store.js에서 appState와 appConfig를 직접 가져와 사용)
    renderRealtimeStatus(appState, appConfig.teamGroups, appConfig.keyTasks || []);
    renderCompletedWorkLog(appState);
    updateSummary(appState, appConfig);
    renderTaskAnalysis(appState, appConfig);
  } catch (e) {
    console.error('Render error:', e);
    showToast('화면 렌더링 오류 발생.', true);
  }
};