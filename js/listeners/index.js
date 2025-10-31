// === js/listeners/index.js ===

import { attachMainListeners } from './main.js';
import { attachHistoryListeners } from './history.js';
import { attachModalListeners } from './modals.js';
import { attachAuthListeners } from './auth.js';
import { attachUtilListeners } from './utils.js';

/**
 * 앱의 모든 DOM 이벤트 리스너를 부착합니다.
 */
export function attachAllListeners() {
    attachAuthListeners();    // 로그인, 로그아웃
    attachUtilListeners();    // 메뉴, 드래그, 접기/펴기
    attachMainListeners();    // 메인 화면 (업무 카드, 완료 로그)
    attachHistoryListeners(); // 이력 모달
    attachModalListeners();   // 기타 모든 모달 (확인/취소 버튼)
}