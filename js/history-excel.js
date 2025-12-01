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

// Firestore 함수 임포트
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"; // ✅ [수정] collection, getDocs 추가

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
// ✅ [신규] 검수 이력 엑셀 다운로드 함수
// =================================================================

export const downloadInspectionHistory = async (format = 'xlsx') => { // ✅ 함수 이름 수정
    showToast('검수 이력 데이터를 불러오는 중...');
    
    let inspectionData = [];
    try {
        // Firestore에서 product_history 컬렉션 전체 조회
        const colRef = collection(db, 'product_history');
        const snapshot = await getDocs(colRef);

        snapshot.forEach(doc => {
            inspectionData.push({
                id: doc.id,
                ...doc.data()
            });
        });
    } catch (e) {
        console.error("Error fetching inspection history:", e);
        return showToast('검수 이력 데이터를 불러오는 데 실패했습니다.', true);
    }
    
    if (!inspectionData || inspectionData.length === 0) {
        return showToast('다운로드할 검수 이력 데이터가 없습니다.', true);
    }
    
    try {
        const workbook = XLSX.utils.book_new();

        // --- Sheet 1: 상품별 요약 ---
        const sheet1Headers = [
            '상품명', '코드', '옵션', '공급처 상품명', '총 입고 횟수', '최근 검수일', '최근 불량 요약'
        ];
        const sheet1Data = inspectionData.map(item => ({
            '상품명': item.id,
            '코드': item.lastCode || '-',
            '옵션': item.lastOption || '-',
            '공급처 상품명': item.lastSupplierName || '-',
            '총 입고 횟수': item.totalInbound || 0,
            '최근 검수일': item.lastInspectionDate || '-',
            '최근 불량 요약': (item.defectSummary && item.defectSummary.length > 0) ? item.defectSummary[item.defectSummary.length - 1] : '-'
        }));
        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상품별_요약`);

        // CSV인 경우 요약 시트만 저장하고 종료
        if (format === 'csv') {
             XLSX.writeFile(workbook, `검수이력_${getTodayDateString()}.csv`);
             return;
        }

        // --- Sheet 2: 상세 로그 (모든 상품 통합) ---
        const sheet2Headers = [
            '상품명', '공급처 상품명', '일시(날짜)', '일시(시간)', '담당', '입고일자/패킹No', '코드', '옵션', '수량', '상태', '특이사항',
            '두께(실측)', '원단 상태', '컬러', '뒤틀림', '올 풀림', '실밥 마감', '지퍼', '단추', '안감', '보풀', '이염'
        ];
        
        const allLogs = inspectionData.flatMap(item => {
            const logs = item.logs || [];
            return logs.map(log => ({
                '상품명': item.id,
                '공급처 상품명': log.supplierName || item.lastSupplierName || '-',
                '일시(날짜)': log.date || '-',
                '일시(시간)': log.time || '-',
                '담당': log.inspector || '-',
                '입고일자/패킹No': log.inboundDate || log.packingNo || '-',
                '코드': log.code || '-',
                '옵션': log.option || '-',
                '수량': log.inboundQty || 0,
                '상태': log.status || '-',
                '특이사항': (log.defects?.length > 0 ? `[${log.defects.join(', ')}] ` : '') + (log.note || ''),
                '두께(실측)': log.checklist?.thickness || '-',
                '원단 상태': log.checklist?.fabric || '-',
                '컬러': log.checklist?.color || '-',
                '뒤틀림': log.checklist?.distortion || '-',
                '올 풀림': log.checklist?.unraveling || '-',
                '실밥 마감': log.checklist?.finishing || '-',
                '지퍼': log.checklist?.zipper || '-',
                '단추': log.checklist?.button || '-',
                '안감': log.checklist?.lining || '-',
                '보풀': log.checklist?.pilling || '-',
                '이염': log.checklist?.dye || '-'
            }));
        }).sort((a, b) => b['일시(날짜)'].localeCompare(a['일시(날짜)'])); // 최신순 정렬

        const worksheet2 = XLSX.utils.json_to_sheet(allLogs, { header: sheet2Headers });
        fitToColumn(worksheet2);
        XLSX.utils.book_append_sheet(workbook, worksheet2, `상세_로그`);


        XLSX.writeFile(workbook, `검수이력_${getTodayDateString()}.${format}`);
        showToast('검수 이력 다운로드가 완료되었습니다.'); // ✅ 성공 토스트

    } catch (error) {
        console.error('Export inspection history failed:', error);
        showToast('파일 생성에 실패했습니다.', true);
    }
};


// =================================================================
// [기존] 업무 이력 엑셀/CSV 다운로드
// =================================================================

export const downloadHistoryAsExcel = async (dateKey, format = 'xlsx') => {
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

        // Sheet 1: 상세 기록 (CSV일 경우 이것만 저장됨)
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

        // Excel인 경우에만 추가 시트 생성
        if (format === 'xlsx') {
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
        }

        XLSX.writeFile(workbook, `업무기록_${dateKey}.${format}`);

    } catch (error) {
        console.error('Export failed:', error);
        showToast('파일 생성에 실패했습니다.', true);
    }
};

export const downloadPeriodHistoryAsExcel = async (startDate, endDate, customFileName = null, format = 'xlsx') => {
    if (!startDate || !endDate) return showToast('기간을 선택해주세요.', true);

    try {
        const filteredData = allHistoryData.filter(d => d.id >= startDate && d.id <= endDate);
        if (filteredData.length === 0) return showToast('선택한 기간에 데이터가 없습니다.', true);

        const workbook = XLSX.utils.book_new();
        const historyWageMap = { ...(appConfig.memberWages || {}) };

        // Sheet 1: 상세 기록 (기간) - CSV 시 이것만 저장
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

        const fileName = customFileName || `업무기록_기간_${startDate}_${endDate}.${format}`;
        XLSX.writeFile(workbook, fileName);

    } catch (error) {
        console.error('Period export failed:', error);
        showToast('기간 데이터 다운로드 실패', true);
    }
};

export const downloadWeeklyHistoryAsExcel = async (weekKey, format = 'xlsx') => {
    if (!weekKey) return showToast('주간 정보가 없습니다.', true);
    const weekData = allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === weekKey);
    if (weekData.length === 0) return showToast(`${weekKey} 데이터가 없습니다.`, true);
    weekData.sort((a, b) => a.id.localeCompare(b.id));
    await downloadPeriodHistoryAsExcel(weekData[0].id, weekData[weekData.length - 1].id, `주간업무요약_${weekKey}.${format}`, format);
};

export const downloadMonthlyHistoryAsExcel = async (monthKey, format = 'xlsx') => {
     if (!monthKey) return showToast('월간 정보가 없습니다.', true);
     const monthData = allHistoryData.filter(d => d.id.startsWith(monthKey));
     if (monthData.length === 0) return showToast(`${monthKey} 데이터가 없습니다.`, true);
     monthData.sort((a, b) => a.id.localeCompare(b.id));
     await downloadPeriodHistoryAsExcel(monthData[0].id, monthData[monthData.length - 1].id, `월간업무요약_${monthKey}.${format}`, format);
};

export const downloadAttendanceExcel = (viewMode, key, format = 'xlsx') => {
    let dataList = [];
    let fileName = '';
    if (viewMode === 'daily') {
        const day = allHistoryData.find(d => d.id === key);
        if (day) dataList = [day];
        fileName = `근태기록_일별_${key}.${format}`;
    } else if (viewMode === 'weekly') {
        dataList = allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === key);
        fileName = `근태기록_주별_${key}.${format}`;
    } else if (viewMode === 'monthly') {
        dataList = allHistoryData.filter(d => d.id.startsWith(key));
        fileName = `근태기록_월별_${key}.${format}`;
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
            if (entry.type !== '연차') rec['총 횟수']++;
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
// ✅ 업무 리포트(Report) 엑셀/CSV 다운로드
// =================================================================
export const downloadReportExcel = (reportData, format = 'xlsx') => {
    if (!reportData) return showToast('리포트 데이터가 없습니다.', true);

    try {
        const workbook = XLSX.utils.book_new();
        const { type, title, tMetrics, tData } = reportData;

        // --- 각 시트 데이터 준비 ---
        
        // 4. 업무별 상세 (CSV일 경우 이것을 메인으로 사용)
        const taskSummary = tMetrics.aggr.taskSummary;
        const taskData = Object.keys(taskSummary).map(t => ({
            '업무': t,
            '총 시간': formatDuration(taskSummary[t].duration),
            '총 인건비(원)': Math.round(taskSummary[t].cost),
            '총 처리량(개)': taskSummary[t].quantity,
            '분당 처리량': taskSummary[t].avgThroughput.toFixed(2),
            '개당 처리비용(원)': Math.round(taskSummary[t].avgCostPerItem),
            '평균 투입인원': (taskSummary[t].avgDailyStaff || 0).toFixed(1),
            '총 인원(명)': taskSummary[t].avgStaff,
            '인당 효율': taskSummary[t].efficiency.toFixed(2)
        }));
        const wsTask = XLSX.utils.json_to_sheet(taskData);
        fitToColumn(wsTask);

        // CSV인 경우 업무별 상세만 저장
        if (format === 'csv') {
            XLSX.utils.book_append_sheet(workbook, wsTask, '업무별 상세');
            XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.csv`);
            return;
        }

        // Excel인 경우 모든 시트 추가
        
        // 1. KPI 요약
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

        // 2. 파트별 요약
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

        // 3. 인원별 상세
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

        // 4. 업무별 상세 (위에서 생성함)
        XLSX.utils.book_append_sheet(workbook, wsTask, '업무별 상세');

        XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.xlsx`);
    } catch (e) {
        console.error(e);
        showToast('리포트 다운로드 중 오류 발생', true);
    }
};


// =================================================================
// ✅ 개인 리포트 엑셀/CSV 다운로드
// =================================================================
export const downloadPersonalReportExcel = (reportData, format = 'xlsx') => {
    if (!reportData) return showToast('개인 리포트 데이터가 없습니다.', true);

    try {
        const workbook = XLSX.utils.book_new();
        const { title, stats, memberName, dateKey } = reportData;

        // 3. 일자별 활동 로그 (CSV일 경우 이것을 메인으로)
        let logData = [];
        if (stats.dailyLogs.length > 0) {
            logData = stats.dailyLogs.map(log => ({
                '날짜': log.date,
                '근태 상태': log.attendance,
                '출근': log.inTime ? formatTimeTo24H(log.inTime) : '-',
                '퇴근': log.outTime ? formatTimeTo24H(log.outTime) : '-',
                '주요 업무': log.mainTask,
                '총 근무 시간': formatDuration(log.workTime)
            }));
        } else {
             logData = [{'결과': '기록 없음'}];
        }
        const wsLog = XLSX.utils.json_to_sheet(logData);
        fitToColumn(wsLog);

        // CSV인 경우 일자별 활동만 저장
        if (format === 'csv') {
            XLSX.utils.book_append_sheet(workbook, wsLog, '일자별 활동');
            XLSX.writeFile(workbook, `${title.replace(/ /g, '_')}.csv`);
            return;
        }

        // Excel인 경우 모든 시트 추가
        
        // 1. 요약
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

        // 2. 업무별 통계
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

        // 3. 일자별 활동 (위에서 생성)
        XLSX.utils.book_append_sheet(workbook, wsLog, '일자별 활동');

        // 4. 근태 상세 기록
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
        showToast('개인 리포트 다운로드 중 오류 발생', true);
    }
};


// =================================================================
// ✅ [수정] PDF 다운로드 (레이아웃 최적화 및 잘림 방지)
// =================================================================
export const downloadContentAsPdf = (elementId, title) => {
    const originalElement = document.getElementById(elementId);
    if (!originalElement) return showToast('출력할 내용을 찾을 수 없습니다.', true);

    showToast('PDF 변환을 시작합니다. (잠시만 기다려주세요)');

    // 1. 임시 컨테이너 생성 (화면 밖으로 숨김)
    // A4 가로 너비(297mm)에 근접한 픽셀 값(1120px)을 강제로 설정하여
    // 렌더링 시 우측이 잘리지 않도록 함.
    const tempContainer = document.createElement('div');
    tempContainer.id = 'pdf-temp-container';
    tempContainer.style.position = 'fixed'; // Use fixed to take it out of flow completely
    tempContainer.style.top = '0';
    tempContainer.style.left = '0';
    tempContainer.style.width = '1120px'; // ✅ 중요: A4 가로 너비(약 1123px)에 맞춤
    tempContainer.style.height = 'auto';
    tempContainer.style.background = 'white';
    tempContainer.style.zIndex = '-9999';
    tempContainer.style.overflow = 'visible'; // Allow content to expand
    
    // 2. 인쇄용 CSS 주입 (줄바꿈 방지, 배경색, 폰트 크기 조정)
    tempContainer.innerHTML = `<style>
        #pdf-temp-container * {
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
            scrollbar-width: none !important;
        }
        /* 페이지 넘김 시 테이블/행 잘림 방지 */
        #pdf-temp-container table { 
            page-break-inside: auto; 
            width: 100% !important; 
            table-layout: fixed !important; 
        }
        #pdf-temp-container tr { 
            page-break-inside: avoid; 
            page-break-after: auto; 
        }
        #pdf-temp-container thead { display: table-header-group; }
        #pdf-temp-container tfoot { display: table-footer-group; }
        
        /* 카드나 주요 구획도 잘리지 않게 */
        .break-inside-avoid, .p-4, .p-5, .p-6 { page-break-inside: avoid !important; }

        /* 배경색 및 텍스트 강제 설정 (가독성) */
        body, .bg-gray-50 { background: white !important; }
        .bg-white { background: white !important; box-shadow: none !important; border: 1px solid #e5e7eb !important; }
        
        /* 텍스트 줄바꿈 강제 (잘림 방지) */
        th, td, p, div { 
            word-wrap: break-word; 
            white-space: normal !important; 
        }
    </style>`;
    
    // 3. 콘텐츠 복제
    const clonedElement = originalElement.cloneNode(true);
    
    // Remove interactive elements that look bad in PDF
    clonedElement.querySelectorAll('button, input, select, .no-print').forEach(el => el.remove());

    // 4. 복제된 콘텐츠 정리 (DOM 조작)
    // 스크롤을 유발하거나 높이를 제한하는 클래스를 모두 제거합니다.
    const allElements = clonedElement.querySelectorAll('*');
    allElements.forEach(el => {
        // Tailwind 클래스 제거
        el.classList.remove(
            'overflow-y-auto', 'overflow-x-auto', 'overflow-hidden', 'overflow-auto',
            'max-h-40', 'max-h-48', 'max-h-60', 'max-h-96', 
            'max-h-screen', 
            'max-h-[60vh]', 'max-h-[70vh]', 'max-h-[85vh]', 'max-h-[90vh]',
            'h-full', 'h-screen',
            'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-2xl', // 그림자 제거
            'fixed', 'absolute', 'sticky' // Positioning can mess up flow
        );
        
        // 인라인 스타일 초기화
        el.style.maxHeight = 'none';
        el.style.height = 'auto';
        el.style.overflow = 'visible';
        el.style.position = 'static'; // Force static flow
        el.style.width = ''; // 너비 제한 해제 (상위 컨테이너 1120px 따름)
    });

    tempContainer.appendChild(clonedElement);
    document.body.appendChild(tempContainer);

    // 5. Canvas(차트) 복구 (CloneNode는 캔버스 내용을 복사하지 않음)
    const originalCanvases = originalElement.querySelectorAll('canvas');
    const clonedCanvases = clonedElement.querySelectorAll('canvas');
    originalCanvases.forEach((origCanvas, index) => {
        if (clonedCanvases[index]) {
            const ctx = clonedCanvases[index].getContext('2d');
            clonedCanvases[index].width = origCanvas.width;
            clonedCanvases[index].height = origCanvas.height;
            ctx.drawImage(origCanvas, 0, 0);
            // 차트 크기 스타일 강제 조정
            clonedCanvases[index].style.width = '100%';
            clonedCanvases[index].style.height = 'auto';
        }
    });

    // 6. html2pdf 설정 (A4 가로)
    const opt = {
        margin:       [10, 10, 10, 10], // 여백 (mm)
        filename:     `${title}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { 
            scale: 2, // 해상도 2배 (선명하게)
            useCORS: true,
            scrollY: 0,
            windowWidth: 1120, // ✅ 렌더링할 가상 창 너비 (A4 가로 픽셀 근사치)
            height: tempContainer.scrollHeight // Capture full height
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' }, // 가로 모드
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] } // 페이지 넘김 최적화
    };

    // 7. 변환 실행
    html2pdf().from(tempContainer).set(opt).save()
        .then(() => {
            showToast('PDF 저장이 완료되었습니다.');
        })
        .catch(err => {
            console.error('PDF generation error:', err);
            showToast('PDF 생성 중 오류가 발생했습니다.', true);
        })
        .finally(() => {
            // 8. 임시 컨테이너 정리
            document.body.removeChild(tempContainer);
        });
};