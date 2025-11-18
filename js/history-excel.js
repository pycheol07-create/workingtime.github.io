// === js/history-excel.js ===
// 설명: 각종 이력 및 리포트 데이터를 엑셀(.xlsx) 또는 PDF로 다운로드하는 기능을 담당합니다.

import { formatDuration, getWeekOfYear, calculateDateDifference, formatTimeTo24H } from './utils.js';
import { allHistoryData, appConfig, context, LEAVE_TYPES } from './state.js';
// 업무 리포트 데이터 생성 로직 재사용
import { generateReportData } from './ui-history-reports-logic.js'; 

// --- (기존) 업무 이력 엑셀 다운로드 ---
export const downloadHistoryAsExcel = (dateKey) => {
    const dayData = allHistoryData.find(d => d.id === dateKey);
    if (!dayData) { alert("해당 날짜의 데이터가 없습니다."); return; }

    const wb = XLSX.utils.book_new();
    
    // 1. 업무 기록 시트
    const records = (dayData.workRecords || []).map(r => ({
        '이름': r.member,
        '업무': r.task,
        '시작시간': r.startTime,
        '종료시간': r.endTime || '(진행중)',
        '소요시간': r.duration ? formatDuration(r.duration) : '-',
        '상태': r.status === 'completed' ? '완료' : '진행중'
    }));
    const wsRecords = XLSX.utils.json_to_sheet(records);
    XLSX.utils.book_append_sheet(wb, wsRecords, "업무기록");

    // 2. 처리량 시트
    const qtys = Object.entries(dayData.taskQuantities || {}).map(([task, qty]) => ({
        '업무명': task,
        '처리량': qty
    }));
    const wsQtys = XLSX.utils.json_to_sheet(qtys);
    XLSX.utils.book_append_sheet(wb, wsQtys, "처리량");

    // 3. 근태 시트
    const leaves = (dayData.onLeaveMembers || []).map(l => ({
        '이름': l.member,
        '유형': l.type,
        '시작': l.startTime || l.startDate || '-',
        '종료': l.endTime || l.endDate || '-'
    }));
    const wsLeaves = XLSX.utils.json_to_sheet(leaves);
    XLSX.utils.book_append_sheet(wb, wsLeaves, "근태");

    XLSX.writeFile(wb, `업무이력_${dateKey}.xlsx`);
};

// --- (기존) 기간별 업무 이력 엑셀 다운로드 ---
export const downloadPeriodHistoryAsExcel = (startDate, endDate) => {
    const filteredData = allHistoryData.filter(d => d.id >= startDate && d.id <= endDate);
    if (filteredData.length === 0) { alert("해당 기간의 데이터가 없습니다."); return; }

    const wb = XLSX.utils.book_new();
    const allRecords = [];
    
    filteredData.forEach(day => {
        (day.workRecords || []).forEach(r => {
            allRecords.push({
                '날짜': day.id,
                '이름': r.member,
                '업무': r.task,
                '시작시간': r.startTime,
                '종료시간': r.endTime || '-',
                '소요시간': r.duration ? formatDuration(r.duration) : '-'
            });
        });
    });
    
    const ws = XLSX.utils.json_to_sheet(allRecords);
    XLSX.utils.book_append_sheet(wb, ws, "기간별_업무이력");
    XLSX.writeFile(wb, `업무이력_${startDate}_${endDate}.xlsx`);
};

// --- (기존) 주간/월간 업무 이력 ---
export const downloadWeeklyHistoryAsExcel = (weekKey) => {
    alert("주간 업무 이력 엑셀 다운로드는 '기간 엑셀' 기능을 이용해주세요.");
};
export const downloadMonthlyHistoryAsExcel = (monthKey) => {
    alert("월간 업무 이력 엑셀 다운로드는 '기간 엑셀' 기능을 이용해주세요.");
};


// --- (기존) 근태 이력 엑셀 다운로드 ---
export const downloadAttendanceExcel = (viewMode, dateKey) => {
    let filteredData = [];
    let fileName = `근태이력_${dateKey}`;

    if (viewMode === 'daily') {
        const day = allHistoryData.find(d => d.id === dateKey);
        if (day) filteredData = [day];
    } else if (viewMode === 'weekly') {
        filteredData = allHistoryData.filter(d => getWeekOfYear(new Date(d.id)) === dateKey);
    } else if (viewMode === 'monthly') {
        filteredData = allHistoryData.filter(d => d.id.startsWith(dateKey));
    }

    if (filteredData.length === 0) { alert("데이터가 없습니다."); return; }

    const wb = XLSX.utils.book_new();
    const rows = [];

    filteredData.forEach(day => {
        (day.onLeaveMembers || []).forEach(l => {
            rows.push({
                '날짜': day.id,
                '이름': l.member,
                '유형': l.type,
                '상세': (l.startTime ? `${l.startTime}~${l.endTime||''}` : `${l.startDate}~${l.endDate||''}`)
            });
        });
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "근태기록");
    XLSX.writeFile(wb, `${fileName}.xlsx`);
};


// =========================================================================================
// ✅ [신규] 업무 리포트 다운로드 (Excel & PDF)
// =========================================================================================

export const downloadReportExcel = (viewMode, dateKey) => {
    const { tMetrics } = generateReportData(allHistoryData, appConfig, viewMode, dateKey);
    if (!tMetrics.aggr) { alert("데이터가 없습니다."); return; }
    const aggr = tMetrics.aggr;

    const wb = XLSX.utils.book_new();

    // 1. KPI 시트
    const kpiRows = [
        ['지표', '값'],
        ['총 업무 시간', formatDuration(tMetrics.kpis.totalDuration)],
        ['총 인건비', tMetrics.kpis.totalCost],
        ['총 처리량', tMetrics.kpis.totalQuantity],
        ['분당 처리량', tMetrics.kpis.overallAvgThroughput.toFixed(2)],
        ['평균 근무 인원', tMetrics.kpis.activeMembersCount.toFixed(1)],
        ['COQ 비율', `${tMetrics.kpis.coqPercentage.toFixed(1)}%`]
    ];
    const wsKPI = XLSX.utils.aoa_to_sheet(kpiRows);
    XLSX.utils.book_append_sheet(wb, wsKPI, "KPI_요약");

    // 2. 파트별 시트
    const partRows = Object.entries(aggr.partSummary).map(([name, d]) => ({
        '파트': name,
        '총시간': formatDuration(d.duration),
        '총인건비': d.cost,
        '인원수': d.members.size
    }));
    const wsPart = XLSX.utils.json_to_sheet(partRows);
    XLSX.utils.book_append_sheet(wb, wsPart, "파트별");

    // 3. 업무별 시트
    const taskRows = Object.entries(aggr.taskSummary).map(([name, d]) => ({
        '업무명': name,
        '총시간': formatDuration(d.duration),
        '총인건비': d.cost,
        '처리량': d.quantity,
        '분당처리량': d.avgThroughput.toFixed(2),
        '개당비용': d.avgCostPerItem.toFixed(0),
        '투입인원': d.avgStaff.toFixed(1)
    }));
    const wsTask = XLSX.utils.json_to_sheet(taskRows);
    XLSX.utils.book_append_sheet(wb, wsTask, "업무별");

    // 4. 인원별 시트
    const memberRows = Object.entries(aggr.memberSummary).map(([name, d]) => ({
        '이름': name,
        '총시간': formatDuration(d.duration),
        '총인건비': d.cost,
        '수행업무수': d.tasks.size
    }));
    const wsMember = XLSX.utils.json_to_sheet(memberRows);
    XLSX.utils.book_append_sheet(wb, wsMember, "인원별");

    XLSX.writeFile(wb, `업무리포트_${dateKey}.xlsx`);
};

export const downloadReportPdf = (viewMode, dateKey) => {
    if (!window.jspdf) {
        alert("PDF 생성을 위한 라이브러리가 로드되지 않았습니다."); 
        return;
    }
    
    const { tMetrics } = generateReportData(allHistoryData, appConfig, viewMode, dateKey);
    if (!tMetrics.aggr) { alert("데이터가 없습니다."); return; }

    const doc = new window.jspdf.jsPDF();
    const aggr = tMetrics.aggr;

    doc.setFontSize(16);
    doc.text(`Work Report - ${dateKey}`, 14, 20);

    doc.setFontSize(12);
    doc.text(`Total Cost: ${Math.round(tMetrics.kpis.totalCost).toLocaleString()}`, 14, 30);
    doc.text(`Total Time: ${formatDuration(tMetrics.kpis.totalDuration)}`, 14, 38);

    const taskBody = Object.entries(aggr.taskSummary).map(([name, d]) => [
        name, 
        formatDuration(d.duration), 
        Math.round(d.cost).toLocaleString(), 
        d.quantity, 
        d.avgThroughput.toFixed(2)
    ]);

    if (doc.autoTable) {
        doc.autoTable({
            startY: 50,
            head: [['Task', 'Duration', 'Cost', 'Qty', 'Speed']],
            body: taskBody,
        });
    } else {
        console.warn("jspdf-autotable plugin not found.");
    }

    doc.save(`Report_${dateKey}.pdf`);
};


// =========================================================================================
// ✅ [신규] 개인 리포트 다운로드 (Excel & PDF)
// =========================================================================================

const _aggregatePersonalDataForExcel = (allHistoryData, viewMode, dateKey, memberName) => {
    const filteredDays = allHistoryData.filter(day => {
        if (!day.id) return false;
        if (viewMode === 'personal-daily') return day.id === dateKey;
        if (viewMode === 'personal-weekly') return getWeekOfYear(new Date(day.id)) === dateKey;
        if (viewMode === 'personal-monthly') return day.id.startsWith(dateKey);
        if (viewMode === 'personal-yearly') return day.id.startsWith(dateKey);
        return false;
    });

    const stats = {
        totalWorkMinutes: 0,
        totalWageCost: 0,
        workDaysCount: 0,
        taskStats: {},
        attendanceCounts: {},
        dailyLogs: []
    };
    LEAVE_TYPES.forEach(t => stats.attendanceCounts[t] = 0);

    let wage = appConfig.memberWages?.[memberName] || 0;
    if (wage === 0) wage = appConfig.defaultPartTimerWage || 10000;

    filteredDays.sort((a, b) => a.id.localeCompare(b.id)).forEach(day => {
        const date = day.id;
        let dayWorkMinutes = 0;
        
        const myRecords = (day.workRecords || []).filter(r => r.member === memberName);
        if (myRecords.length > 0) {
            stats.workDaysCount++;
            myRecords.forEach(r => {
                const duration = Number(r.duration) || 0;
                const cost = (duration / 60) * wage;
                
                dayWorkMinutes += duration;
                stats.totalWorkMinutes += duration;
                stats.totalWageCost += cost;

                if (!stats.taskStats[r.task]) stats.taskStats[r.task] = { count: 0, duration: 0 };
                stats.taskStats[r.task].count++;
                stats.taskStats[r.task].duration += duration;
            });
        }
        
        const myLeaves = (day.onLeaveMembers || []).filter(l => l.member === memberName);
        myLeaves.forEach(l => {
            if (stats.attendanceCounts.hasOwnProperty(l.type)) stats.attendanceCounts[l.type]++;
            else if (l.type) stats.attendanceCounts[l.type] = (stats.attendanceCounts[l.type] || 0) + 1;
        });

        stats.dailyLogs.push({
            date: date,
            workTime: dayWorkMinutes,
            leaves: myLeaves.map(l => l.type).join(', ')
        });
    });

    return stats;
};

export const downloadPersonalReportExcel = (viewMode, dateKey, memberName) => {
    if (!memberName) { alert("직원이 선택되지 않았습니다."); return; }
    
    const stats = _aggregatePersonalDataForExcel(allHistoryData, viewMode, dateKey, memberName);
    if (stats.workDaysCount === 0 && stats.dailyLogs.length === 0) { alert("데이터가 없습니다."); return; }

    const wb = XLSX.utils.book_new();

    // 1. 요약 시트
    const summaryRows = [
        ['항목', '값'],
        ['이름', memberName],
        ['기간', dateKey],
        ['총 근무일', stats.workDaysCount],
        ['총 근무 시간', formatDuration(stats.totalWorkMinutes)],
        ['예상 급여', Math.round(stats.totalWageCost)],
        ...Object.entries(stats.attendanceCounts).filter(([, c]) => c > 0).map(([t, c]) => [t, c])
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, "요약");

    // 2. 업무 상세 시트
    const taskRows = Object.entries(stats.taskStats).map(([task, d]) => ({
        '업무명': task,
        '횟수': d.count,
        '시간': formatDuration(d.duration),
        '비중(%)': stats.totalWorkMinutes > 0 ? ((d.duration / stats.totalWorkMinutes) * 100).toFixed(1) : '0'
    }));
    const wsTasks = XLSX.utils.json_to_sheet(taskRows);
    XLSX.utils.book_append_sheet(wb, wsTasks, "업무별");

    // 3. 일자별 시트
    const dailyRows = stats.dailyLogs.map(l => ({
        '날짜': l.date,
        '근무시간': formatDuration(l.workTime),
        '근태': l.leaves || '-'
    }));
    const wsDaily = XLSX.utils.json_to_sheet(dailyRows);
    XLSX.utils.book_append_sheet(wb, wsDaily, "일자별");

    XLSX.writeFile(wb, `개인리포트_${memberName}_${dateKey}.xlsx`);
};

export const downloadPersonalReportPdf = (viewMode, dateKey, memberName) => {
    if (!window.jspdf) { alert("PDF 라이브러리가 필요합니다."); return; }
    if (!memberName) { alert("직원이 선택되지 않았습니다."); return; }

    const stats = _aggregatePersonalDataForExcel(allHistoryData, viewMode, dateKey, memberName);
    const doc = new window.jspdf.jsPDF();

    doc.setFontSize(16);
    doc.text(`Personal Report: ${memberName} (${dateKey})`, 14, 20);

    doc.setFontSize(12);
    doc.text(`Total Work Days: ${stats.workDaysCount}`, 14, 30);
    doc.text(`Total Work Time: ${formatDuration(stats.totalWorkMinutes)}`, 14, 38);
    doc.text(`Est. Cost: ${Math.round(stats.totalWageCost).toLocaleString()}`, 14, 46);

    const taskBody = Object.entries(stats.taskStats).map(([t, d]) => [
        t, d.count, formatDuration(d.duration)
    ]);

    if (doc.autoTable) {
        doc.autoTable({
            startY: 55,
            head: [['Task', 'Count', 'Duration']],
            body: taskBody
        });
    }

    doc.save(`Personal_${memberName}_${dateKey}.pdf`);
};