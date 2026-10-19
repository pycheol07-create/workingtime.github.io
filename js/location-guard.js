// === js/location-guard.js ===
// 로케이션 관리 화면의 위험 기능 가림 (권한 개편 5단계, 2026-10-19 — 설계 4.4).
// location.html 에서 js/location.js **다음에** 싣는다 — location.js 가 window.* 함수를 다 만든 뒤 바깥에서 감싼다.
// location.js 본문은 채우기·변경 추천 카드 시작(whenPerm)만 바꿨다. 나머지는 여기서 막는다:
//   ① [data-feature] 정적 버튼 숨김  ② window.* 위험 함수 감싸기  ③ 업로드 input change 캡처 차단  ④ 툴팁 편집 버튼 캡처 차단
//   ⑤ 열 머리 끌기(dragstart) 캡처 차단
// 연결표: js/lib/location-guard-map.js. 판정: js/page-gate.js 의 window.__perm.
import { onPerm, applyFeatureVisibility, guardFunctions, guardFileInputs, guardClicks, guardDrags, canFeature } from './feature-gate.js?v=202610200831';
import { GUARDED_FUNCTIONS, QUIET_FUNCTIONS, GUARDED_FILE_INPUTS, GUARDED_CLICKS, GUARDED_DRAGS, HTML_FLAGS } from './lib/location-guard-map.js?v=202610200831';

guardFunctions(GUARDED_FUNCTIONS, { quiet: QUIET_FUNCTIONS });
guardFileInputs(GUARDED_FILE_INPUTS);
guardClicks(GUARDED_CLICKS);
guardDrags(GUARDED_DRAGS);

onPerm(() => {
    applyFeatureVisibility();
    for (const [cls, id] of Object.entries(HTML_FLAGS)) document.documentElement.classList.toggle(cls, canFeature(id));
});
