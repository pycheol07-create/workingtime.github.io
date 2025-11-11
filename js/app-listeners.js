// === js/app-listeners.js ===

import { setupMainScreenListeners } from './listeners-main.js';
import { setupHistoryModalListeners } from './listeners-history.js';
import { setupGeneralModalListeners } from './listeners-modals.js';
import { setupSimulationModalListeners } from './listeners-modals-sim.js';
import { setupConfirmationModalListeners } from './listeners-modals-confirm.js';
// ✅ [신규] 분리된 폼 모달 리스너 임포트
import { setupFormModalListeners } from './listeners-modals-form.js';

export function initializeAppListeners() {
    setupMainScreenListeners();
    setupHistoryModalListeners();
    setupGeneralModalListeners(); // (공통 닫기 버튼)
    setupSimulationModalListeners(); 
    setupConfirmationModalListeners();
    setupFormModalListeners(); // ✅ [신규] 폼 모달 리스너 호출
}