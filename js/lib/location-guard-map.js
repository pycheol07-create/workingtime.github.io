// === js/lib/location-guard-map.js ===
// 로케이션 관리(location.html·js/location.js) 위험 기능 → 기능 id 연결표 (권한 개편 5단계, 2026-10-19 — 설계 4.4).
// js/location-guard.js 가 이 표대로 감싸고, tests/perm-gate.test.js 가 이름이 location.js·location.html 에 실제로 있는지 지킨다.
// ⚠️ location.js 에서 아래 함수 이름을 바꾸면 여기도 같이 고칠 것(안 고치면 감싸기가 조용히 꺼진다 — 테스트가 잡는다).

// window.* 함수 — 권한이 없으면 안내만 하고 원래 함수를 부르지 않는다
export const GUARDED_FUNCTIONS = {
    // 일괄 수정·개별 추가·선택 삭제
    openLocBulkEdit: 'location.bulkEdit',
    applyLocBulkEdit: 'location.bulkEdit',
    addSingleLocationFromSetting: 'location.bulkEdit',
    deleteSelectedLocations: 'location.bulkEdit',
    applyAllRecommendations: 'location.bulkEdit',   // 입고대기 '추천 자리 일괄 적용' — 구역 문서에 자리 여러 개를 한 번에 쓴다(규칙: 20키 넘으면 bulkEdit)
    // 주문 분석 업로드·초기화·단종 페어 정리
    processOrderData: 'location.dataUpload',
    resetOrderAnalysis: 'location.dataUpload',
    cleanupDeprecatedPairs: 'location.dataUpload',
    // 입고 시트 동기화·반영
    syncIncomingData: 'location.incoming',
    applyIncomingNow: 'location.incoming',
    // 환경설정(INFO_CONFIG 공용 설정 쓰기)
    saveSheetUrl: 'location.settings',
    saveMasterSettingsModal: 'location.settings',
    saveHeaderSettings: 'location.settings',
    saveIncomingPriorities: 'location.settings',
    saveCapacity2F: 'location.settings',
    // 선지정 해제
    releasePreAssign: 'location.preassign',
    releaseAllCancelledPreAssigns: 'location.preassign',
    // 오늘 재고 올리기 뒤 재고 스냅샷(artifacts/.../locationStock/latest)
    _v44_saveStockSnapshot: 'location.upload'
};

// 자동으로 불리는 함수 — 거부해도 안내 토스트를 띄우지 않는다(업로드 뒤 setTimeout 으로 불린다)
export const QUIET_FUNCTIONS = ['cleanupDeprecatedPairs', '_v44_saveStockSnapshot'];

// 파일 input id → 기능 (change 를 캡처 단계에서 끊는다)
export const GUARDED_FILE_INPUTS = {
    'excel-upload-a': 'location.upload',
    'excel-upload-permanent': 'location.upload',
    'excel-upload-zikjin': 'location.dataUpload',
    'excel-upload-weekly': 'location.dataUpload',
    'excel-upload-orders': 'location.dataUpload'
};

// 동적으로 그려지는 버튼(정보 툴팁의 편집·기본값 복원·저장 — INFO_CONFIG.customTooltips)
export const GUARDED_CLICKS = {
    '.tt-btn-edit, .tt-btn-reset, .tt-btn-save': 'location.settings'
};

// 끌기 시작(dragstart)을 캡처 단계에서 막는다 — 열 머리 끌어 순서 바꾸기는 INFO_CONFIG.visibleColumns 공용 설정을 저장한다
export const GUARDED_DRAGS = {
    '#dynamic-thead-tr th[data-col]': 'location.settings'
};

// 판정 결과를 <html> 클래스로도 건다 — 동적 요소를 CSS 로 숨기는 데 쓴다(location.html 스타일)
export const HTML_FLAGS = {
    'perm-loc-settings': 'location.settings'
};
