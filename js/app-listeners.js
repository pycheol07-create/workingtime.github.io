// === js/app-listeners.js ===

import { setupMainScreenListeners } from './listeners-main.js?v=09dc61be80cb-55e9c40a';
import { setupHistoryModalListeners } from './listeners-history.js?v=c96ed3120530-39640069';
import { setupGeneralModalListeners } from './listeners-modals.js?v=0a09f1c402a8-6b98da4f';
import { setupConfirmationModalListeners } from './listeners-modals-confirm.js?v=25eec4c7f4a7-d6a40e96';
import { setupFormModalListeners } from './listeners-modals-form.js?v=09dc61be80cb-11e89e07';
import { setupAuthListeners } from './listeners-auth.js?v=d7a61b93b7ae-b7f394a4';
// ✅ [신규] 분리된 메인 현황판 리스너 임포트
import { setupMainBoardListeners } from './listeners-main-board.js?v=09dc61be80cb-d29a0c8e';
// ✅ [신규] 전량 검수 리스너 임포트
import { setupTotalInspectionListeners } from './listeners-form-total-inspection.js?v=fa1946cd0439-d308cb1b';

export function initializeAppListeners() {
    setupMainScreenListeners(); // (출퇴근, 하단 로그, 메뉴 등)
    setupHistoryModalListeners();
    setupGeneralModalListeners(); // (공통 닫기 버튼)
    setupConfirmationModalListeners();
    setupFormModalListeners();
    setupAuthListeners();
    setupMainBoardListeners(); // ✅ [신규] 메인 현황판 리스너 호출
    setupTotalInspectionListeners(); // ✅ [신규] 전량 검수 리스너 호출
}