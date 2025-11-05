import { setupMainScreenListeners } from './listeners-main.js';
import { setupHistoryModalListeners } from './listeners-history.js';
import { setupGeneralModalListeners } from './listeners-modals.js';

export function initializeAppListeners() {
    setupMainScreenListeners();
    setupHistoryModalListeners();
    setupGeneralModalListeners();
}