// === js/history-excel.js ===

// 여러 모듈로 쪼개진 엑셀/PDF 내보내기 기능들을 
// 기존 다른 파일에서 그대로 import 할 수 있도록 모아서 다시 export 합니다 (Facade Pattern).

export * from './history-excel-inspection.js?v=1e9d6ac401df-82bdbb32';
export * from './history-excel-work.js?v=256b7f5fe844-b5dbd7db';
export * from './history-excel-attendance.js?v=a44616a5c270-37edae26';
export * from './history-excel-reports.js?v=58fd5cb91059-9e309643';

// 유틸리티 파일에서는 PDF 변환 함수만 외부에서 사용할 수 있게 내보냅니다.
export { downloadContentAsPdf } from './history-excel-utils.js?v=8127f4479c47-e14ce92c';