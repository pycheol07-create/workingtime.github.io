// === js/lib/history-dot.js ===
// 데이터관리 > 업무 이력 날짜 목록의 점 색 — 순수 함수(브라우저·Firebase 없음). tests/planned-fields.test.js 가 본다.
// 점은 '선택한 날짜' 가 아니라 **그 날 이력(서버 데이터) 기준** 이다 — 어느 PC 에서 봐도 같은 색이어야 한다.
//   선택 표시는 버튼 배경(is-on · bg-blue-100)만 쓴다.
//   red  : 처리량 누락(checkMissingQuantities 결과가 있다) — 다른 판정보다 앞선다
//   blue : 처리량 입력 완료 — taskQuantities 에 0 보다 큰 값이 하나라도 있거나 '0건 확인'(confirmedZeroTasks)이 있다
//   gray : 그 밖

/** 그 날 처리량을 하나라도 넣었나(값>0 또는 0건 확인). */
export const hasQuantityInput = (dayData) => {
    if (!dayData) return false;
    const q = dayData.taskQuantities || {};
    if (Object.values(q).some(v => Number(v) > 0)) return true;
    const z = dayData.confirmedZeroTasks;
    return Array.isArray(z) && z.length > 0;
};

/** 'missing' | 'done' | 'none'. missingTasks = checkMissingQuantities(dayData). */
export const historyDotState = (dayData, missingTasks = []) => {
    if (Array.isArray(missingTasks) && missingTasks.length > 0) return 'missing';
    return hasQuantityInput(dayData) ? 'done' : 'none';
};
