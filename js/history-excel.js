// === history-excel.js (엑셀 다운로드 로직) ===

// ✅ [신규] DOM 요소와 상태 변수를 분리된 파일에서 가져옵니다.
import { 
    appState, appConfig, db, auth, 
    allHistoryData
} from './state.js'; 

// utils.js에서 헬퍼 함수들을 가져옵니다.
import { 
    formatTimeTo24H, formatDuration, getWeekOfYear, showToast 
} from './utils.js';

// (XLSX는 index.html에서 전역 로드)

// =================================================================
// 엑셀 다운로드 함수
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
    ws['!cols'] = objectMaxLength.map(w => ({ width: w + 2 }));
};

const appendTotalRow = (ws, data, headers) => {
    if (!data || data.length === 0) return;
    const total = {};
    const sums = {};

    headers.forEach(header => {
        if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)')) {
            sums[header] = data.reduce((acc, row) => acc + (Number(row[header]) || 0), 0);
        }
    });

    headers.forEach((header, index) => {
        if (index === 0) {
            total[header] = '총 합계';
        } else if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)')) {
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

        // Sheet 2: 업무 요약 (전일비 추가)
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

        // Sheet 4: 주별 요약
        const weeklyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string') return acc;
            try {
                const dateObj = new Date(day.id);
                if (isNaN(dateObj.getTime())) return acc;
                const weekKey = getWeekOfYear(dateObj);
                if (!weekKey) return acc;
                if (!acc[weekKey]) acc[weekKey] = { workRecords: [], taskQuantities: {} };
                acc[weekKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id })));
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[weekKey].taskQuantities[task] = (acc[weekKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) { console.error("Error processing day in weekly aggregation:", day.id, e); }
            return acc;
        }, {});

        const sheet4Data = [];
        const sheet4Headers = ['주(Week)', '업무', '총 시간(분)', '총 인건비(원)', '총 처리량(개)', '평균 처리량(개/분)', '평균 처리비용(원/개)', '총 참여인원(명)', '평균 처리시간(건)'];
        const sortedWeeks = Object.keys(weeklyData).sort((a,b) => a.localeCompare(b));

        for (const weekKey of sortedWeeks) {
            const dataset = weeklyData[weekKey];
            const records = dataset.workRecords || [];
            const quantities = dataset.taskQuantities || {};
            const taskSummary = records.reduce((acc, r) => {
                if (!r || !r.task) return acc;
                if (!acc[r.task]) acc[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 }; 
                acc[r.task].duration += (Number(r.duration) || 0);
                const wage = combinedWageMap[r.member] || 0;
                acc[r.task].cost += ((Number(r.duration) || 0) / 60) * wage;
                acc[r.task].members.add(r.member); 
                acc[r.task].recordCount += 1; 
                return acc;
            }, {});
            Object.entries(quantities || {}).forEach(([task, qtyValue]) => {
                const qty = Number(qtyValue) || 0;
                if (!taskSummary[task]) taskSummary[task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 }; 
                taskSummary[task].quantity = (taskSummary[task].quantity || 0) + qty;
            });
            Object.keys(taskSummary).sort().forEach(task => {
                const summary = taskSummary[task];
                const qty = summary.quantity || 0;
                const duration = summary.duration || 0;
                const cost = summary.cost || 0;
                const avgThroughput = duration > 0 ? (qty / duration).toFixed(2) : '0.00';
                const avgCostPerItem = qty > 0 ? (cost / qty).toFixed(0) : '0';
                const avgStaff = summary.members.size;
                const avgTime = (summary.recordCount > 0) ? (duration / summary.recordCount) : 0;
                
                sheet4Data.push({
                    '주(Week)': weekKey,
                    '업무': task,
                    '총 시간(분)': Math.round(duration),
                    '총 인건비(원)': Math.round(cost),
                    '총 처리량(개)': qty,
                    '평균 처리량(개/분)': avgThroughput,
                    '평균 처리비용(원/개)': avgCostPerItem,
                    '총 참여인원(명)': avgStaff, 
                    '평균 처리시간(건)': formatDuration(avgTime) 
                });
            });
        }
        const worksheet4 = XLSX.utils.json_to_sheet(sheet4Data, { header: sheet4Headers });
        fitToColumn(worksheet4);
        XLSX.utils.book_append_sheet(workbook, worksheet4, '주별 업무 요약 (전체)');

        // Sheet 5: 월별 요약
        const monthlyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string' || day.id.length < 7) return acc;
            try {
                const monthKey = day.id.substring(0,7);
                if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc;
                if (!acc[monthKey]) acc[monthKey] = { workRecords: [], taskQuantities: {} };
                acc[monthKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id })));
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[monthKey].taskQuantities[task] = (acc[monthKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) { console.error("Error processing day in monthly aggregation:", day.id, e); }
            return acc;
        }, {});

        const sheet5Data = [];
        const sheet5Headers = ['월(Month)', '업무', '총 시간(분)', '총 인건비(원)', '총 처리량(개)', '평균 처리량(개/분)', '평균 처리비용(원/개)', '총 참여인원(명)', '평균 처리시간(건)'];
        const sortedMonths = Object.keys(monthlyData).sort((a,b) => a.localeCompare(b));

        for (const monthKey of sortedMonths) {
            const dataset = monthlyData[monthKey];
            const records = dataset.workRecords || [];
            const quantities = dataset.taskQuantities || {};
            const taskSummary = records.reduce((acc, r) => {
                if (!r || !r.task) return acc;
                if (!acc[r.task]) acc[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 };
                acc[r.task].duration += (Number(r.duration) || 0);
                const wage = combinedWageMap[r.member] || 0;
                acc[r.task].cost += ((Number(r.duration) || 0) / 60) * wage;
                acc[r.task].members.add(r.member);
                acc[r.task].recordCount += 1;
                return acc;
            }, {});
            Object.entries(quantities || {}).forEach(([task, qtyValue]) => {
                const qty = Number(qtyValue) || 0;
                if (!taskSummary[task]) taskSummary[task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 };
                taskSummary[task].quantity = (taskSummary[task].quantity || 0) + qty;
            });
            Object.keys(taskSummary).sort().forEach(task => {
                const summary = taskSummary[task];
                const qty = summary.quantity || 0;
                const duration = summary.duration || 0;
                const cost = summary.cost || 0;
                const avgThroughput = duration > 0 ? (qty / duration).toFixed(2) : '0.00';
                const avgCostPerItem = qty > 0 ? (cost / qty).toFixed(0) : '0';
                const avgStaff = summary.members.size;
                const avgTime = (summary.recordCount > 0) ? (duration / summary.recordCount) : 0;
                
                sheet5Data.push({
                    '월(Month)': monthKey,
                    '업무': task,
                    '총 시간(분)': Math.round(duration),
                    '총 인건비(원)': Math.round(cost),
                    '총 처리량(개)': qty,
                    '평균 처리량(개/분)': avgThroughput,
                    '평균 처리비용(원/개)': avgCostPerItem,
                    '총 참여인원(명)': avgStaff,
                    '평균 처리시간(건)': formatDuration(avgTime)
                });
            });
        }
        const worksheet5 = XLSX.utils.json_to_sheet(sheet5Data, { header: sheet5Headers });
        fitToColumn(worksheet5);
        XLSX.utils.book_append_sheet(workbook, worksheet5, '월별 업무 요약 (전체)');

        XLSX.writeFile(workbook, `업무기록_${dateKey}_및_전체요약.xlsx`);

    } catch (error) {
        console.error('Excel export failed:', error);
        showToast('Excel 파일 생성에 실패했습니다.', true);
    }
};


/**
 * 선택한 기간의 엑셀을 다운로드하는 함수
 */
export const downloadPeriodHistoryAsExcel = async (startDate, endDate) => {
    if (!startDate || !endDate) {
        return showToast('시작일과 종료일을 모두 선택해야 합니다.', true);
    }
    if (endDate < startDate) {
        return showToast('종료일은 시작일보다 이후여야 합니다.', true);
    }

    showToast('선택 기간 엑셀 생성 중... (데이터가 많으면 오래 걸릴 수 있습니다)');

    try {
        // 1. 선택 기간 데이터 필터링
        const filteredData = allHistoryData.filter(d => {
            const date = d.id;
            return date >= startDate && date <= endDate;
        });

        if (filteredData.length === 0) {
            return showToast('선택한 기간에 해당하는 이력 데이터가 없습니다.', true);
        }

        const workbook = XLSX.utils.book_new();

        // 2. WageMap 생성 (전체 이력 기준)
        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        // 3. (시트 1) 상세 기록 (기간 합산)
        const sheet1Headers = ['날짜', '팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)', '인건비(원)'];
        const sheet1Data = filteredData.flatMap(day => {
            return (day.workRecords || []).map(r => {
                const duration = Number(r.duration) || 0;
                const wage = combinedWageMap[r.member] || 0;
                const cost = (duration / 60) * wage;

                return {
                    '날짜': day.id,
                    '팀원': r.member || '',
                    '업무 종류': r.task || '',
                    '시작 시간': formatTimeTo24H(r.startTime),
                    '종료 시간': formatTimeTo24H(r.endTime),
                    '소요 시간(분)': Math.round(duration),
                    '인건비(원)': Math.round(cost)
                };
            });
        }).sort((a,b) => { // 날짜순, 그다음 팀원순 정렬
            if (a['날짜'] !== b['날짜']) return a['날짜'].localeCompare(b['날짜']);
            return a['팀원'].localeCompare(b['팀원']);
        });

        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        if (sheet1Data.length > 0) appendTotalRow(worksheet1, sheet1Data, sheet1Headers);
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상세 기록 (기간)`);

        // 4. (시트 2) 업무 요약 (✅ 일별, 기간별 정리)
        const sheet2Data = [];
        
        // 날짜별로 순회하며 요약 데이터 생성
        filteredData.forEach(day => {
            const dateKey = day.id;
            const dayRecords = day.workRecords || [];
            const dayQuantities = day.taskQuantities || {};
            const dayTaskSummary = {};

            // 해당 일자의 업무 기록 집계
            dayRecords.forEach(r => {
                 if (!r || !r.task) return;
                 if (!dayTaskSummary[r.task]) {
                     dayTaskSummary[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 };
                 }
                 const duration = Number(r.duration) || 0;
                 const wage = combinedWageMap[r.member] || 0;
                 dayTaskSummary[r.task].duration += duration;
                 dayTaskSummary[r.task].cost += (duration / 60) * wage;
                 dayTaskSummary[r.task].members.add(r.member);
                 dayTaskSummary[r.task].recordCount += 1;
            });

            // 해당 일자에 기록이 있거나 수량이 있는 모든 업무에 대해 행 생성
            const allDayTasks = new Set([...Object.keys(dayTaskSummary), ...Object.keys(dayQuantities)]);
            
            allDayTasks.forEach(task => {
                const summary = dayTaskSummary[task] || { duration: 0, cost: 0, members: new Set(), recordCount: 0 };
                const qty = Number(dayQuantities[task]) || 0;
                const duration = summary.duration;
                const cost = summary.cost;

                const avgThroughput = duration > 0 ? (qty / duration).toFixed(2) : '0.00';
                const avgCostPerItem = qty > 0 ? (cost / qty).toFixed(0) : '0';
                const avgStaff = summary.members.size;
                const avgTime = (summary.recordCount > 0) ? (duration / summary.recordCount) : 0;

                sheet2Data.push({
                    '날짜': dateKey,
                    '업무 종류': task,
                    '총 소요 시간(분)': Math.round(duration),
                    '총 인건비(원)': Math.round(cost),
                    '총 처리량(개)': qty,
                    '평균 처리량(개/분)': avgThroughput,
                    '평균 처리비용(원/개)': avgCostPerItem,
                    '총 참여인원(명)': avgStaff,
                    '평균 처리시간(건)': formatDuration(avgTime)
                });
            });
        });

        // 날짜순 -> 업무명순 정렬
        sheet2Data.sort((a, b) => {
            if (a['날짜'] !== b['날짜']) return a['날짜'].localeCompare(b['날짜']);
            return a['업무 종류'].localeCompare(b['업무 종류']);
        });

        const sheet2Headers = [
            '날짜',
            '업무 종류', 
            '총 소요 시간(분)', 
            '총 인건비(원)', 
            '총 처리량(개)', 
            '평균 처리량(개/분)', 
            '평균 처리비용(원/개)', 
            '총 참여인원(명)', 
            '평균 처리시간(건)'
        ];

        const worksheet2 = XLSX.utils.json_to_sheet(sheet2Data, { header: sheet2Headers });
        if (sheet2Data.length > 0) appendTotalRow(worksheet2, sheet2Data, sheet2Headers); 
        fitToColumn(worksheet2);
        XLSX.utils.book_append_sheet(workbook, worksheet2, `업무 요약 (일별)`);
        
        // 5. (시트 3) 근태 기록 (기간 합산)
        const sheet3Headers = ['날짜', '이름', '유형', '시간 / 기간'];
        const sheet3Data = filteredData.flatMap(day => {
            return (day.onLeaveMembers || []).map(entry => {
                let detailText = '-';
                if (entry.startTime) {
                    detailText = formatTimeTo24H(entry.startTime);
                    if (entry.endTime) detailText += ` ~ ${formatTimeTo24H(entry.endTime)}`;
                    else if (entry.type === '외출') detailText += ' ~';
                } else if (entry.startDate) {
                    detailText = entry.startDate;
                    if (entry.endDate && entry.endDate !== entry.startDate) detailText += ` ~ ${entry.endDate}`;
                }
                return {
                    '날짜': day.id,
                    '이름': entry.member || '',
                    '유형': entry.type || '',
                    '시간 / 기간': detailText
                };
            });
        }).sort((a,b) => { // 날짜순, 그다음 이름순 정렬
            if (a['날짜'] !== b['날짜']) return a['날짜'].localeCompare(b['날짜']);
            return a['이름'].localeCompare(b['이름']);
        });

        const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
        fitToColumn(worksheet3);
        XLSX.utils.book_append_sheet(workbook, worksheet3, `근태 기록 (기간)`);


        // 6. 파일 저장
        XLSX.writeFile(workbook, `업무기록_요약_${startDate}_to_${endDate}.xlsx`);

    } catch (error) {
        console.error('Period Excel export failed:', error);
        showToast('기간 엑셀 파일 생성에 실패했습니다.', true);
    }
};