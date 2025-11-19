// === js/history-excel.js ===

// DOM 요소와 상태 변수를 분리된 파일에서 가져옵니다.
import { 
    appState, appConfig, db, auth, 
    allHistoryData
} from './state.js'; 

// utils.js에서 헬퍼 함수들을 가져옵니다.
import { 
    formatTimeTo24H, formatDuration, getWeekOfYear, showToast, calculateDateDifference
} from './utils.js';

// (XLSX와 html2pdf는 index.html에서 전역 로드됨)

// =================================================================
// 엑셀 다운로드 헬퍼 함수
// =================================================================
const fitToColumn = (ws) => {
    const objectMaxLength = [];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (!data || data.length === 0) return;
    if (data[0]) {
        Object.keys(data[0]).forEach((key, index) => {
            objectMaxLength[index] = String(data[0][key]).length;
        });
    }
    data.slice(1).forEach(row => {
        Object.keys(row).forEach((key, index) => {
            const cellLength = String(row[key] ?? '').length;
            objectMaxLength[index] = Math.max(objectMaxLength[index] || 10, cellLength);
        });
    });
    ws['!cols'] = objectMaxLength.map(w => ({ width: w + 5 })); // 여유 공간 추가
};

const appendTotalRow = (ws, data, headers) => {
    if (!data || data.length === 0) return;
    const total = {};
    const sums = {};

    headers.forEach(header => {
        if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)') || header.includes('횟수')) {
            // ✅ 문법 오류 수정 완료: (acc, row => ...) -> (acc, row) => ...
            sums[header] = data.reduce((acc, row) => acc + (Number(row[header]) || 0), 0);
        }
    });

    headers.forEach((header, index) => {
        if (index === 0) {
            total[header] = '총 합계';
        } else if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)') || header.includes('횟수')) {
            if (header === '개당 처리비용(원)') {
                 const totalCost = sums['총 인건비(원)'] || 0;
                 const totalQty = sums['총 처리량(개)'] || 0;
                 const totalCostPerItem = (totalQty > 0) ? (totalCost / totalQty) : 0;
                 total[header] = Math.round(totalCostPerItem);
            } else {
                 total[header] = Math.round(sums[header]);
            }
        } else {
            total[header] = '';
        }
    });
    XLSX.utils.sheet_add_json(ws, [total], { skipHeader: true, origin: -1 });
};

// =================================================================
// [기존] 업무 이력 엑셀 다운로드
// =================================================================

export const downloadHistoryAsExcel = async (dateKey) => {
    try {
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }
        
        const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
        const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) 
                                ? allHistoryData[currentIndex + 1] 
                                : null;

        const workbook = XLSX.utils.book_new();

        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        // Sheet 1: 상세 기록
        const dailyRecords = data.workRecords || [];
        const dailyQuantities = data.taskQuantities || {};
        
        const sheet1Headers = ['팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)', '인건비(원)'];
        const sheet1Data = dailyRecords.map(r => {
            const duration = Number(r.duration) || 0;
            const wage = combinedWageMap[r.member] || 0;
            const cost = (duration / 60) * wage;
            
            return {
                '팀원': r.member || '',
                '업무 종류': r.task || '',
                '시작 시간': formatTimeTo24H(r.startTime),
                '종료 시간': formatTimeTo24H(r.endTime),
                '소요 시간(분)': Math.round(duration),
                '인건비(원)': Math.round(cost)
            };
        });
        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        if (sheet1Data.length > 0) appendTotalRow(worksheet1, sheet1Data, sheet1Headers);
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상세 기록 (${dateKey})`);

        // Sheet 2: 업무 요약
        let prevTaskSummary = {};
        if (previousDayData) {
            const prevRecords = previousDayData.workRecords || [];
            (prevRecords).forEach(r => {
                if (!prevTaskSummary[r.task]) {
                    prevTaskSummary[r.task] = { totalDuration: 0, totalCost: 0, members: new Set() };
                }
                const wage = combinedWageMap[r.member] || 0;
                const cost = ((Number(r.duration) || 0) / 60) * wage;
                prevTaskSummary[r.task].totalDuration += (Number(r.duration) || 0);
                prevTaskSummary[r.task].totalCost += cost;
                prevTaskSummary[r.task].members.add(r.member);
            });
        }
        
        const summaryByTask = {};
        dailyRecords.forEach(r => {
            if (!summaryByTask[r.task]) {
                summaryByTask[r.task] = { totalDuration: 0, totalCost: 0, members: new Set() };
            }
            const wage = combinedWageMap[r.member] || 0;
            const cost = ((Number(r.duration) || 0) / 60) * wage;
            summaryByTask[r.task].totalDuration += (Number(r.duration) || 0);
            summaryByTask[r.task].totalCost += cost;
            summaryByTask[r.task].members.add(r.member); 
        });
        
        const sheet2Headers = [
            '업무 종류', '진행 인원수', '총 소요 시간(분)', '총 인건비(원)', '총 처리량(개)', '개당 처리비용(원)',
            '진행 인원수(전일비)', '총 시간(전일비)', '총 인건비(전일비)', '총 처리량(전일비)', '개당 처리비용(전일비)'
        ];
        
        const sheet2Data = Object.keys(summaryByTask).sort().map(task => {
            const taskQty = Number(dailyQuantities[task]) || 0;
            const taskCost = summaryByTask[task].totalCost;
            const costPerItem = (taskQty > 0) ? (taskCost / taskQty) : 0;
            const staffCount = summaryByTask[task].members.size;
            const duration = summaryByTask[task].totalDuration;
            
            const prevSummary = prevTaskSummary[task] || { totalDuration: 0, totalCost: 0, members: new Set() };
            const prevQty = Number(previousDayData?.taskQuantities?.[task]) || 0;
            const prevCost = prevSummary.totalCost;
            const prevCostPerItem = (prevQty > 0) ? (prevCost / prevQty) : 0;
            const prevStaffCount = prevSummary.members.size;
            const prevDuration = prevSummary.totalDuration;

            return {
                '업무 종류': task,
                '진행 인원수': staffCount,
                '총 소요 시간(분)': Math.round(duration),
                '총 인건비(원)': Math.round(taskCost),
                '총 처리량(개)': taskQty,
                '개당 처리비용(원)': Math.round(costPerItem),
                '진행 인원수(전일비)': staffCount - prevStaffCount,
                '총 시간(전일비)': Math.round(duration - prevDuration),
                '총 인건비(전일비)': Math.round(taskCost - prevCost),
                '총 처리량(전일비)': taskQty - prevQty,
                '개당 처리비용(전일비)': Math.round(costPerItem - prevCostPerItem)
            };
        });
        
        const worksheet2 = XLSX.utils.json_to_sheet(sheet2Data, { header: sheet2Headers });
        if (sheet2Data.length > 0) appendTotalRow(worksheet2, sheet2Data, sheet2Headers); 
        fitToColumn(worksheet2);
        XLSX.utils.book_append_sheet(workbook, worksheet2, `업무 요약 (${dateKey})`);

        // Sheet 3: 파트별 인건비
        const sheet3Headers = ['파트', '총 인건비(원)'];
        const memberToPartMap = new Map();
        (appConfig.teamGroups || []).forEach(group => group.members.forEach(member => memberToPartMap.set(member, group.name)));
        const summaryByPart = {};
        dailyRecords.forEach(r => {
            const part = memberToPartMap.get(r.member) || '알바';
            if (!summaryByPart[part]) summaryByPart[part] = { totalCost: 0 };
            const wage = combinedWageMap[r.member] || 0;
            const cost = ((Number(r.duration) || 0) / 60) * wage;
            summaryByPart[part].totalCost += cost;
        });
        const sheet3Data = Object.keys(summaryByPart).sort().map(part => ({
            '파트': part,
            '총 인건비(원)': Math.round(summaryByPart[part].totalCost)
        }));
        const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
        if (sheet3Data.length > 0) appendTotalRow(worksheet3, sheet3Data, sheet3Headers);
        fitToColumn(worksheet3);
        XLSX.utils.book_append_sheet(workbook, worksheet3, `파트 인건비 (${dateKey})`);

        XLSX.writeFile(workbook, `업무기록_${dateKey}.xlsx`);

    } catch (error) {
        console.error('Excel export failed:', error);
        showToast('Excel 파일 생성에 실패했습니다.', true);
    }
};

export const downloadPeriodHistoryAsExcel = async (startDate, endDate, customFileName = null) => {
    if (!startDate || !endDate) return showToast('기간을 선택해주세요.', true);

    try {
        const filteredData = allHistoryData.filter(d => d.id >= startDate && d.id <= endDate);
        if (filteredData.length === 0) return showToast('선택한 기간에 데이터가 없습니다.', true);

        const workbook = XLSX.utils.book_new();
        const historyWageMap = { ...(appConfig.memberWages || {}) };

        // Sheet 1: 상세 기록 (기간)
        const sheet1Headers = ['날짜', '팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)', '인건비(원)'];
        const sheet1Data = filteredData.flatMap(day => 
            (day.workRecords || []).map(r => {
                const duration = Number(r.duration) || 0;
                const wage = historyWageMap[r.member] || (appConfig.defaultPartTimerWage || 10000);
                return {
                    '날짜': day.id,
                    '팀원': r.member || '',
                    '업무 종류': r.task || '',
                    '시작 시간': formatTimeTo24H(r.startTime),
                    '종료 시간': formatTimeTo24H(r.endTime),
                    '소요 시간(분)': Math.round(duration),
                    '인건비(원)': Math.round((duration / 60) * wage)
                };
            })
        ).sort((a,b) => a['날짜'].localeCompare(b['날짜']));

        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        if(sheet1Data.length) appendTotalRow(worksheet1, sheet1Data, sheet1Headers);
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상세 기록 (기간)`);

        const fileName = customFileName || `업무기록_기간_${startDate}_${endDate}.xlsx`;
        XLSX.writeFile(workbook, fileName);

    } catch (error) {
        console.error('Period Excel export failed:', error);
        showToast('기간 엑셀 생성 실패', true);
    }
};

export const downloadWeeklyHistoryAsExcel = async (weekKey) => {
    if (!weekKey) return showToast('주간 정보가 없습니다.', true);
    const weekData = allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === weekKey);
    // ✅ 문법 오류 수정: ', true)
    if (weekData.length === 0) return showToast(`${weekKey} 데이터가 없습니다.`, true); 
    weekData.sort((a, b) => a.id.localeCompare(b.id));
    await downloadPeriodHistoryAsExcel(weekData[0].id, weekData[weekData.length - 1].id, `주간업무요약_${weekKey}.xlsx`);
};

export const downloadMonthlyHistoryAsExcel = async (monthKey) => {
     if (!monthKey) return showToast('월간 정보가 없습니다.', true);
     const monthData = allHistoryData.filter(d => d.id.startsWith(monthKey));
     // ✅ 문법 오류 수정: ', true)
     if (monthData.length === 0) return showToast(`${monthKey} 데이터가 없습니다.`, true); 
     monthData.sort((a, b) => a.id.localeCompare(b.id));
     await downloadPeriodHistoryAsExcel(monthData[0].id, monthData[monthData.length - 1].id, `월간업무요약_${monthKey}.xlsx`);
};

export const downloadAttendanceExcel = (viewMode, key) => {
    let dataList = [];
    let fileName = '';
    if (viewMode === 'daily') {
        const day = allHistoryData.find(d => d.id === key);
        if (day) dataList = [day];
        fileName = `근태기록_일별_${key}.xlsx`;
    } else if (viewMode === 'weekly') {
        dataList = allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === key);
        fileName = `근태기록_주별_${key}.xlsx`;
    } else if (viewMode === 'monthly') {
        dataList = allHistoryData.filter(d => d.id.startsWith(key));
        fileName = `근태기록_월별_${key}.xlsx`;
    }

    if (dataList.length === 0) return showToast('다운로드할 데이터가 없습니다.', true);

    const summary = {};
    dataList.forEach(day => {
        (day.onLeaveMembers || []).forEach(entry => {
            if (!summary[entry.member]) {
                summary[entry.member] = { '이름': entry.member, '지각':0, '외출':0, '조퇴':0, '결근':0, '연차':0, '출장':0, '총 횟수':0, '총 결근일수':0, '총 연차일수':0 };
            }
            const rec = summary[entry.member];
            if (rec.hasOwnProperty(entry.type)) rec[entry.type]++;
            rec['총 횟수']++;
            if (entry.type === '결근') rec['총 결근일수'] += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
            if (entry.type === '연차') rec['총 연차일수'] += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
        });
    });

    const sheetData = Object.values(summary).sort((a, b) => a['이름'].localeCompare(b['이름']));
    if (sheetData.length === 0) return showToast('근태 기록이 없습니다.', true);

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(sheetData);
    fitToColumn(worksheet);
    XLSX.utils.book_append_sheet(workbook, worksheet, '근태 요약');
    XLSX.writeFile(workbook, fileName);
};


// =================================================================
// ✅ 업무 리포트(Report) 엑셀 다운로드
// =================================================================
export const downloadReportExcel = (reportData) => {
    if (!reportData) return showToast('리포트 데이터가 없습니다.', true);

    try {
        const workbook = XLSX.utils.book_new();
        const { type, title, tMetrics, tData } = reportData;

        // 1. KPI 요약 시트
        const kpis = tMetrics.kpis;
        const kpiData = [
            { '항목': '총 업무 시간', '값': formatDuration(kpis.totalDuration) },
            { '항목': '총 인건비', '값': `${Math.round(kpis.totalCost).toLocaleString()} 원` },
            { '항목': '총 처리량', '값': `${kpis.totalQuantity.toLocaleString()} 개` },
            { '항목': '분당 처리량', '값': `${kpis.overallAvgThroughput.toFixed(2)} 개/분` },
            { '항목': '개당 처리비용', '값': `${kpis.overallAvgCostPerItem.toFixed(0)} 원/개` },
            { '항목': '평균 근무 인원', '값': `${Number(kpis.activeMembersCount).toFixed(1)} 명` },
            { '항목': '비업무 시간', '값': formatDuration(kpis.nonWorkMinutes) },
            { '항목': 'COQ(품질비용) 비율', '값': `${kpis.coqPercentage.toFixed(1)} %` }
        ];
        const wsKPI = XLSX.utils.json_to_sheet(kpiData);
        fitToColumn(wsKPI);
        XLSX.utils.book_append_sheet(workbook, wsKPI, '주요 지표(KPI)');

        // 2. 파트별 요약 시트
        const partSummary = tMetrics.aggr.partSummary;
        const partData = Object.keys(partSummary).map(part => ({
            '파트': part,
            '총 업무시간': formatDuration(partSummary[part].duration),
            '총 인건비(원)': Math.round(partSummary[part].cost),
            '참여 인원(명)': partSummary[part].members.size
        }));
        const wsPart = XLSX.utils.json_to_sheet(partData);
        fitToColumn(wsPart);
        XLSX.utils.book_append_sheet(workbook, wsPart, '파트별 요약');

        // 3. 인원별 상세 시트
        const memberSummary = tMetrics.aggr.memberSummary;
        const memberData = Object.keys(memberSummary).map(m => ({
            '이름': m,
            '파트': tData.memberToPartMap.get(m) || '알바',
            '총 업무시간': formatDuration(memberSummary[m].duration),
            '총 인건비(원)': Math.round(memberSummary[m].cost),
            '수행 업무 수': memberSummary[m].tasks.size
        }));
        const wsMember = XLSX.utils.json_to_sheet(memberData);
        fitToColumn(wsMember);
        XLSX.utils.book_append_sheet(workbook, wsMember, '인원별 상세');

        // 4. 업무별 상세 시트
        const taskSummary = tMetrics.aggr.taskSummary;
        const taskData = Object.keys(taskSummary).map(t => ({
            '업무': t,
            '총 시간': formatDuration(taskSummary[t].duration),
            '총 인건비(원)': Math.round(taskSummary[t].cost),
            '총 처리량(개)': taskSummary[t].quantity,
            '분당 처리량': taskSummary[t].avgThroughput.toFixed(2),
            '개당 처리비용(원)': Math.round(taskSummary[t].avgCostPerItem),
            '총 인원(명)': taskSummary[t].avgStaff,
            '인당 효율': taskSummary[t].efficiency.toFixed(2)
        }));
        const wsTask = XLSX.utils.json_to_sheet(taskData);
        fitToColumn(wsTask);
        XLSX.utils.book_append_sheet(workbook, wsTask, '업무별 상세');

        XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.xlsx`);
    } catch (e) {
        console.error(e);
        showToast('리포트 엑셀 변환 중 오류 발생', true);
    }
};


// =================================================================
// ✅ 개인 리포트 엑셀 다운로드
// =================================================================
export const downloadPersonalReportExcel = (reportData) => {
    if (!reportData) return showToast('개인 리포트 데이터가 없습니다.', true);

    try {
        const workbook = XLSX.utils.book_new();
        const { title, stats, memberName, dateKey } = reportData;

        // 1. 요약 시트
        const summaryData = [
            { '항목': '이름', '값': memberName },
            { '항목': '기간/날짜', '값': dateKey },
            { '항목': '총 근무일', '값': `${stats.workDaysCount}일` },
            { '항목': '총 업무 시간', '값': formatDuration(stats.totalWorkMinutes) },
            { '항목': '예상 급여(세전)', '값': `${Math.round(stats.totalWageCost).toLocaleString()} 원` },
            { '항목': '근태 특이사항', '값': Object.entries(stats.attendanceCounts).filter(([,c])=>c>0).map(([t,c])=>`${t} ${c}회`).join(', ') || '없음' }
        ];
        const wsSummary = XLSX.utils.json_to_sheet(summaryData);
        fitToColumn(wsSummary);
        XLSX.utils.book_append_sheet(workbook, wsSummary, '개인 요약');

        // 2. 업무별 통계 시트
        const taskData = Object.entries(stats.taskStats).map(([task, data]) => ({
            '업무명': task,
            '수행 횟수': data.count,
            '총 소요 시간': formatDuration(data.duration),
            '비중(%)': (stats.totalWorkMinutes > 0 ? (data.duration / stats.totalWorkMinutes * 100).toFixed(1) : 0),
            '평균 시간/건': formatDuration(data.count > 0 ? data.duration / data.count : 0)
        }));
        const wsTask = XLSX.utils.json_to_sheet(taskData);
        fitToColumn(wsTask);
        XLSX.utils.book_append_sheet(workbook, wsTask, '업무별 통계');

        // 3. 일자별 활동 로그 시트
        if (stats.dailyLogs.length > 0) {
            const logData = stats.dailyLogs.map(log => ({
                '날짜': log.date,
                '근태 상태': log.attendance,
                '주요 업무': log.mainTask,
                '총 근무 시간': formatDuration(log.workTime)
            }));
            const wsLog = XLSX.utils.json_to_sheet(logData);
            fitToColumn(wsLog);
            XLSX.utils.book_append_sheet(workbook, wsLog, '일자별 활동');
        }

        // 4. 근태 상세 기록 시트
        if (stats.attendanceLogs.length > 0) {
            const attData = stats.attendanceLogs.map(log => ({
                '날짜': log.date,
                '유형': log.type,
                '상세 내용': log.detail
            }));
            const wsAtt = XLSX.utils.json_to_sheet(attData);
            fitToColumn(wsAtt);
            XLSX.utils.book_append_sheet(workbook, wsAtt, '근태 상세 기록');
        }

        XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.xlsx`);
    } catch (e) {
        console.error(e);
        showToast('개인 리포트 엑셀 변환 중 오류 발생', true);
    }
};


// =================================================================
// ✅ [수정] PDF 다운로드 (가로 모드 + 전체 내용 펼치기)
// =================================================================
export const downloadContentAsPdf = (elementId, title) => {
    const originalElement = document.getElementById(elementId);
    if (!originalElement) return showToast('출력할 내용을 찾을 수 없습니다.', true);

    showToast('PDF 변환을 시작합니다. (잠시만 기다려주세요)');

    // 1. 임시 컨테이너 생성 (화면 밖으로 숨김)
    // A4 가로 너비(약 297mm)에 맞춰 넉넉한 픽셀 너비 설정 (1800px -> 4000px로 증가)
    const tempContainer = document.createElement('div');
    tempContainer.id = 'pdf-temp-container';
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';
    tempContainer.style.top = '0';
    tempContainer.style.width = '4000px'; // 🚀 1800px -> 4000px로 대폭 확장
    tempContainer.style.background = 'white';
    tempContainer.style.zIndex = '-9999';
    // 테이블 줄바꿈 방지 스타일 주입
    tempContainer.innerHTML = `<style>
        /* PDF에 캡처될 때 폰트 크기를 줄여 한 페이지에 더 많은 내용을 담고, 테이블 패딩을 줄여 너비를 확보합니다. */
        .pdf-content-wrapper { font-size: 9px !important; } /* ✅ 9px로 추가 축소 */
        .pdf-content-wrapper table { table-layout: fixed !important; width: 100% !important; border-collapse: collapse; }
        .pdf-content-wrapper td, .pdf-content-wrapper th { 
            padding: 3px !important; /* ✅ 3px로 추가 축소 */
            min-width: unset !important; 
            white-space: nowrap !important; /* ✅ !important 적용 */
        }
        /* 페이지 분할 방지 */
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; page-break-after: auto; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
    </style>`;
    document.body.appendChild(tempContainer);

    // 2. 콘텐츠 복제
    const clonedElement = originalElement.cloneNode(true);
    // ✅ 복제된 최상위 요소에 폰트 크기 조절을 위한 클래스 추가
    clonedElement.classList.add('pdf-content-wrapper');
    tempContainer.appendChild(clonedElement);

    // 3. 복제된 콘텐츠의 스크롤/높이 제한 제거 (전체 펼치기)
    const allElements = clonedElement.querySelectorAll('*');
    allElements.forEach(el => {
        // Tailwind 등 클래스로 인한 높이 제한 제거
        if (el.classList.contains('overflow-y-auto') || el.classList.contains('overflow-x-auto') || 
            el.classList.contains('max-h-48') || el.classList.contains('max-h-60') || 
            el.classList.contains('max-h-96') || el.classList.contains('max-h-[60vh]') || 
            el.classList.contains('max-h-[70vh]')) {
            
            el.style.maxHeight = 'none';
            el.style.height = 'auto';
            el.style.overflow = 'visible';
        }
        // 인라인 스타일 강제 제거
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
        el.style.minWidth = 'unset'; // 테이블 강제 줄바꿈 방지를 위해 min-width 해제
    });

    // 4. Canvas(차트) 복구 (CloneNode는 캔버스 내용을 복사하지 않음)
    const originalCanvases = originalElement.querySelectorAll('canvas');
    const clonedCanvases = clonedElement.querySelectorAll('canvas');
    originalCanvases.forEach((origCanvas, index) => {
        if (clonedCanvases[index]) {
            const ctx = clonedCanvases[index].getContext('2d');
            // 캔버스 크기도 복사
            clonedCanvases[index].width = origCanvas.width;
            clonedCanvases[index].height = origCanvas.height;
            ctx.drawImage(origCanvas, 0, 0);
        }
    });

    // 5. PDF 생성 옵션 (가로 모드 설정)
    const opt = {
        margin:       [5, 5, 5, 5], // ✅ 마진 추가 축소
        filename:     `${title}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { 
            scale: 2, // scale 2 유지 (고화질)
            useCORS: true,
            scrollY: 0,
            windowWidth: 4000 // 🚀 컨테이너 너비와 일치 (4000px)
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' }, // ✅ 가로 모드
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    // 6. 변환 실행
    html2pdf().from(clonedElement).set(opt).save()
        .then(() => {
            showToast('PDF 저장이 완료되었습니다.');
        })
        .catch(err => {
            console.error('PDF generation error:', err);
            showToast('PDF 생성 중 오류가 발생했습니다.', true);
        })
        .finally(() => {
            // 7. 임시 컨테이너 제거
            document.body.removeChild(tempContainer);
        });
};