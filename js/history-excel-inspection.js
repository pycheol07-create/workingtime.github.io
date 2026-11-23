// === js/history-excel-inspection.js ===
import { db, allHistoryData, appConfig } from './state.js?v=202611231535';
import { showToast, getTodayDateString } from './utils.js?v=202611231535';
import { fitToColumn } from './history-excel-utils.js?v=202611231535';
import { dayInspItems } from './lib/insp-day.js?v=202611231535';
import { csvSafeSheet, csvSafeBook } from './lib/csv-safe.js?v=202611231535';
import { inspTypeLabel } from './lib/insp-manual.js?v=202611231535';   // '유형' 열 — 전량 / 샘플 / 샘플(개별) / 요청확인(화면과 같은 이름)
import { EXCEL_HEADERS, excelRow } from './lib/total-insp.js?v=202611231535';
import { historyRangeStart } from './lib/history-window.js?v=202611231535';
import { fetchTotalInspLogs, totalInspLogsTruncated, TOTAL_LOG_LIMIT } from './ui-history-inspection.js?v=202611231535';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 전량검수 기록(total_inspection_logs, 2026-11-17) — '전량검수_기록' 시트. 작업자는 이름만(lib/total-insp.js inspectorLabel).
//   검수이력 탭이 읽어 둔 캐시(보기 기간 시작일 이후, 최대 TOTAL_LOG_LIMIT 건)를 그대로 쓴다 — 캐시가 없을 때만 한 번 읽는다.
//   기간 다운로드는 그 안에서 [시작, 끝] 만 거른다(보기 기간보다 앞 날짜는 들어가지 않는다 — 이력 화면과 같은 범위).
//   csv 는 첫 시트만 나가므로(SheetJS) 전량 시트는 xlsx 에서만 보인다. csv 일 때도 csvSafeBook 이 모든 시트를 고친다.
const loadTotalLogs = async (fromDate = '', toDate = '') => {
    try {
        const logs = await fetchTotalInspLogs(historyRangeStart(getTodayDateString(), 13));
        if (totalInspLogsTruncated()) showToast(`전량검수 기록은 최근 ${TOTAL_LOG_LIMIT}건만 들어갑니다.`, true);
        return logs.filter(l => (!fromDate || String(l.date || '') >= fromDate) && (!toDate || String(l.date || '') <= toDate));
    } catch (e) {
        console.warn('전량검수 기록 읽기 실패:', e && e.code ? e.code : e);
        showToast('전량검수 기록을 읽지 못해 빼고 받습니다.', true);
        return [];
    }
};
const appendTotalSheet = (workbook, logs) => {
    if (!logs || !logs.length) return 0;
    const emails = (appConfig && appConfig.memberEmails) || {};
    const rows = logs.slice()
        .sort((a, b) => (String(b.date || '') + String(b.time || '')).localeCompare(String(a.date || '') + String(a.time || '')))
        .map(l => excelRow(l, emails));
    const ws = XLSX.utils.json_to_sheet(rows, { header: [...EXCEL_HEADERS] });
    fitToColumn(ws);
    XLSX.utils.book_append_sheet(workbook, ws, '전량검수_기록');
    return rows.length;
};

const downloadListInspectionHistory = async (format = 'xlsx') => {
    showToast('입고 리스트 데이터를 준비 중입니다...');
    const allLists = [];
    allHistoryData.forEach(day => {
        dayInspItems(day).forEach(item => { allLists.push({ date: day.id, ...item }); });
    });
    const totals = await loadTotalLogs();

    if (allLists.length === 0 && totals.length === 0) return showToast('다운로드할 입고 리스트 데이터가 없습니다.', true);

    try {
        const workbook = XLSX.utils.book_new();
        const headers = ['날짜', '유형', '코드', '상품명', '옵션', '공급처', '수량', '기준 두께', '상태'];
        allLists.sort((a, b) => b.date.localeCompare(a.date));
        const sheetData = allLists.map(item => ({
            '날짜': item.date, '유형': inspTypeLabel(item), '코드': item.code || '-', '상품명': item.name, '옵션': item.option || '-',
            '공급처': item.supplierCode || item.supplierName || '-', '수량': item.qty || 0, '기준 두께': item.thickness || '-', '상태': item.status || '대기'
        }));
        const worksheet = XLSX.utils.json_to_sheet(sheetData, { header: headers });
        fitToColumn(worksheet);
        XLSX.utils.book_append_sheet(workbook, worksheet, '입고_리스트_내역');
        appendTotalSheet(workbook, totals);
        csvSafeBook(workbook, format);   // csv 일 때만 — 수식 주입 막기
        XLSX.writeFile(workbook, `입고리스트_이력_${getTodayDateString()}.${format}`);
        showToast('입고 리스트 다운로드 완료');
    } catch (e) {
        console.error("Export list inspection history failed:", e);
        showToast('파일 생성 실패', true);
    }
};

const downloadProductInspectionHistory = async (format = 'xlsx') => {
    showToast('검수 이력(상품별) 데이터를 불러오는 중...');
    let inspectionData = [];
    try {
        const colRef = collection(db, 'product_history');
        const snapshot = await getDocs(colRef);
        snapshot.forEach(doc => { inspectionData.push({ id: doc.id, ...doc.data() }); });
    } catch (e) {
        console.error("Error fetching inspection history:", e);
        return showToast('데이터 불러오기 실패', true);
    }
    
    if (!inspectionData || inspectionData.length === 0) return showToast('다운로드할 데이터가 없습니다.', true);
    
    try {
        const workbook = XLSX.utils.book_new();
        const sheet1Headers = ['상품명', '코드', '옵션', '공급처 상품명', '총 입고 횟수', '최근 검수일', '최근 불량 요약'];
        const sheet1Data = inspectionData.map(item => ({
            '상품명': item.id, '코드': item.lastCode || '-', '옵션': item.lastOption || '-', '공급처 상품명': item.lastSupplierCode || item.lastSupplierName || '-',
            '총 입고 횟수': item.totalInbound || 0, '최근 검수일': item.lastInspectionDate || '-', '최근 불량 요약': (item.defectSummary && item.defectSummary.length > 0) ? item.defectSummary[item.defectSummary.length - 1] : '-'
        }));
        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상품별_요약`);

        if (format === 'csv') {
             csvSafeSheet(worksheet1);   // = + - @ 로 시작하는 글자 칸이 수식으로 열리지 않게
             XLSX.writeFile(workbook, `검수이력_상품별_${getTodayDateString()}.csv`); return;
        }

        const sheet2Headers = ['상품명', '유형', '공급처 상품명', '일시(날짜)', '일시(시간)', '담당', '입고일자/패킹No', '코드', '옵션', '수량', '상태', '특이사항', '두께(실측)', '원단 상태', '컬러', '뒤틀림', '올 풀림', '실밥 마감', '지퍼', '단추', '안감', '보풀', '이염', '기모'];
        const allLogs = inspectionData.flatMap(item => {
            const logs = item.logs || [];
            return logs.map(log => ({
                '상품명': item.id, '유형': inspTypeLabel(log), '공급처 상품명': log.supplierCode || log.supplierName || item.lastSupplierCode || item.lastSupplierName || '-', '일시(날짜)': log.date || '-', '일시(시간)': log.time || '-', '담당': log.inspector || '-', '입고일자/패킹No': log.inboundDate || log.packingNo || '-', '코드': log.code || '-', '옵션': log.option || '-', '수량': log.inboundQty || 0, '상태': log.status || '-', '특이사항': (log.defects?.length > 0 ? `[${log.defects.join(', ')}] ` : '') + (log.note || ''),
                '두께(실측)': log.checklist?.thickness || '-', '원단 상태': log.checklist?.fabric || '-', '컬러': log.checklist?.color || '-', '뒤틀림': log.checklist?.distortion || '-', '올 풀림': log.checklist?.unraveling || '-', '실밥 마감': log.checklist?.finishing || '-', '지퍼': log.checklist?.zipper || '-', '단추': log.checklist?.button || '-', '안감': log.checklist?.lining || '-', '보풀': log.checklist?.pilling || '-', '이염': log.checklist?.dye || '-', '기모': log.checklist?.brushed || '-'
            }));
        }).sort((a, b) => b['일시(날짜)'].localeCompare(a['일시(날짜)']));

        const worksheet2 = XLSX.utils.json_to_sheet(allLogs, { header: sheet2Headers });
        fitToColumn(worksheet2);
        XLSX.utils.book_append_sheet(workbook, worksheet2, `상세_로그`);
        appendTotalSheet(workbook, await loadTotalLogs());
        XLSX.writeFile(workbook, `검수이력_상품별_${getTodayDateString()}.${format}`);
        showToast('검수 이력(상품별) 다운로드 완료');
    } catch (error) {
        console.error('Export inspection history failed:', error);
        showToast('파일 생성 실패', true);
    }
};

export const downloadInspectionHistory = async (format = 'xlsx', viewMode = 'product') => {
    if (viewMode === 'list') { await downloadListInspectionHistory(format); }
    else { await downloadProductInspectionHistory(format); }
};

export const downloadPeriodInspectionAsExcel = async (startDate, endDate, format = 'xlsx') => {
    if (!startDate || !endDate) return showToast('기간을 선택해주세요.', true);
    const allLists = [];
    allHistoryData.filter(d => d.id >= startDate && d.id <= endDate).forEach(day => {
        dayInspItems(day).forEach(item => { allLists.push({ date: day.id, ...item }); });
    });
    const totals = await loadTotalLogs(startDate, endDate);

    if (allLists.length === 0 && totals.length === 0) return showToast('선택한 기간에 검수 리스트 데이터가 없습니다.', true);

    const workbook = XLSX.utils.book_new();
    const headers = ['날짜', '코드', '상품명', '옵션', '공급처', '수량', '기준 두께', '상태'];
    allLists.sort((a, b) => b.date.localeCompare(a.date));
    const sheetData = allLists.map(item => ({
        '날짜': item.date, '코드': item.code || '-', '상품명': item.name, '옵션': item.option || '-', '공급처': item.supplierCode || item.supplierName || '-', '수량': item.qty || 0, '기준 두께': item.thickness || '-', '상태': item.status || '대기'
    }));

    const worksheet = XLSX.utils.json_to_sheet(sheetData, { header: headers });
    fitToColumn(worksheet);
    XLSX.utils.book_append_sheet(workbook, worksheet, '입고_리스트_내역');
    appendTotalSheet(workbook, totals);
    csvSafeBook(workbook, format);   // csv 일 때만 — 수식 주입 막기
    XLSX.writeFile(workbook, `검수이력_리스트_기간_${startDate}_${endDate}.${format}`);
    showToast('기간별 검수이력 다운로드 완료');
};