// === js/history-excel.js ===

// 여러 모듈로 쪼개진 엑셀/PDF 내보내기 기능들을 
// 기존 다른 파일에서 그대로 import 할 수 있도록 모아서 다시 export 합니다 (Facade Pattern).

export * from './history-excel-inspection.js?v=cf07b773efdf-82bdbb32';
export * from './history-excel-work.js?v=e17d9573d743-b5dbd7db';
export * from './history-excel-attendance.js?v=33be808d8208-37edae26';
export * from './history-excel-reports.js?v=b0d2e2e28f02-9e309643';

// 유틸리티 파일에서는 PDF 변환 함수만 외부에서 사용할 수 있게 내보냅니다.
export { downloadContentAsPdf } from './history-excel-utils.js?v=5f2bbfe332af-e14ce92c';