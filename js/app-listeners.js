// === app-listeners.js (메인 리스너 인덱스 파일) ===

// ✅ [수정] 분리된 리스너 함수들 import
import { setupMainScreenListeners } from './listeners-main.js';
import { setupHistoryModalListeners } from './listeners-history.js';
import { setupGeneralModalListeners } from './listeners-modals.js';


/**
 * 앱의 모든 DOM 이벤트 리스너를 초기화합니다.
 * (실제 로직은 분리된 파일들에 있습니다.)
 */
export function initializeAppListeners() {
    
    setupMainScreenListeners();
    setupHistoryModalListeners();
    setupGeneralModalListeners();
    
} // <-- initializeAppListeners() 함수 끝

// (모든 리스너 로직이 listeners-*.js 파일로 이동되었습니다.)