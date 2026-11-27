// === js/app-listeners.js ===

import { setupMainScreenListeners } from './listeners-main.js?v=c0c47b4823db-55e9c40a';
import { setupHistoryModalListeners } from './listeners-history.js?v=60c62e2f1118-39640069';
import { setupGeneralModalListeners } from './listeners-modals.js?v=0a09f1c402a8-6b98da4f';
import { setupConfirmationModalListeners } from './listeners-modals-confirm.js?v=ec9cd3f19a63-d6a40e96';
import { setupFormModalListeners } from './listeners-modals-form.js?v=c0c47b4823db-11e89e07';
import { setupAuthListeners } from './listeners-auth.js?v=d7a61b93b7ae-b7f394a4';
// ✅ [신규] 분리된 메인 현황판 리스너 임포트
import { setupMainBoardListeners } from './listeners-main-board.js?v=c0c47b4823db-b4b5f222';
// ✅ [신규] 전량 검수 리스너 임포트
import { setupTotalInspectionListeners } from './listeners-form-total-inspection.js?v=caea92c5a53a-d308cb1b';

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