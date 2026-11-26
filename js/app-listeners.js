// === js/app-listeners.js ===

import { setupMainScreenListeners } from './listeners-main.js?v=193e16cb3e53-55e9c40a';
import { setupHistoryModalListeners } from './listeners-history.js?v=55c7730cb756-39640069';
import { setupGeneralModalListeners } from './listeners-modals.js?v=0a09f1c402a8-6b98da4f';
import { setupConfirmationModalListeners } from './listeners-modals-confirm.js?v=90159c50ef38-d6a40e96';
import { setupFormModalListeners } from './listeners-modals-form.js?v=193e16cb3e53-11e89e07';
import { setupAuthListeners } from './listeners-auth.js?v=d7a61b93b7ae-b7f394a4';
// ✅ [신규] 분리된 메인 현황판 리스너 임포트
import { setupMainBoardListeners } from './listeners-main-board.js?v=193e16cb3e53-d29a0c8e';
// ✅ [신규] 전량 검수 리스너 임포트
import { setupTotalInspectionListeners } from './listeners-form-total-inspection.js?v=ceeedb80dd84-d308cb1b';

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