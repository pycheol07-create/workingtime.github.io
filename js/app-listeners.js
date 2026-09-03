// === js/app-listeners.js ===

import { setupMainScreenListeners } from './listeners-main.js?v=202609031149';
import { setupHistoryModalListeners } from './listeners-history.js?v=202609031149';
import { setupGeneralModalListeners } from './listeners-modals.js?v=202609031149';
import { setupSimulationModalListeners } from './listeners-modals-sim.js?v=202609031149';
import { setupConfirmationModalListeners } from './listeners-modals-confirm.js?v=202609031149';
import { setupFormModalListeners } from './listeners-modals-form.js?v=202609031149';
import { setupAuthListeners } from './listeners-auth.js?v=202609031149';
// ✅ [신규] 분리된 메인 현황판 리스너 임포트
import { setupMainBoardListeners } from './listeners-main-board.js?v=202609031149';
// ✅ [신규] 전량 검수 리스너 임포트
import { setupTotalInspectionListeners } from './listeners-form-total-inspection.js?v=202609031149';

export function initializeAppListeners() {
    setupMainScreenListeners(); // (출퇴근, 하단 로그, 메뉴 등)
    setupHistoryModalListeners();
    setupGeneralModalListeners(); // (공통 닫기 버튼)
    setupSimulationModalListeners(); 
    setupConfirmationModalListeners();
    setupFormModalListeners();
    setupAuthListeners();
    setupMainBoardListeners(); // ✅ [신규] 메인 현황판 리스너 호출
    setupTotalInspectionListeners(); // ✅ [신규] 전량 검수 리스너 호출
}