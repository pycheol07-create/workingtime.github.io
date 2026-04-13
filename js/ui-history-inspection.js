// === js/ui-history-inspection.js ===
// 설명: 샘플검수(상품별/일자별) 및 전량검수 이력/통계 UI 렌더링 담당

import * as DOM from './dom-elements.js';
import { context, allHistoryData, db } from './state.js';
import { getWeekOfYear, getTodayDateString } from './utils.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 정렬 상태 관리 (로컬)
let sortState = { key: 'lastInspectionDate', dir: 'desc' };

const getSortIcon = (key) => {
    if (sortState.key !== key) return '<span class="text-gray-300 text-[10px] ml-1 opacity-50">↕</span>';
    return sortState.dir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

const formatDefectSummary = (defectSummary) => {
    if (!defectSummary || defectSummary.length === 0) {
        return '<span class="text-gray-400">-</span>';
    }
    const lastDefect = defectSummary[defectSummary.length - 1];
    return `<span class="text-red-600 font-medium text-xs truncate block max-w-[200px]" title="${lastDefect}">${lastDefect}</span>`;
};

/**
 * 검수 탭 기본 레이아웃 렌더링
 * '검수'를 '샘플검수'로 명칭 변경하고 '전량검수 현황' 버튼을 추가했습니다.
 */
export const renderInspectionLayout = (container) => {
    if (!container) return;
    const activeTab = context.inspectionViewMode || 'product';

    container.innerHTML = `
        <div class="flex flex-col h-full relative">
            <div class="flex justify-between items-end border-b border-gray-200 mb-4 shrink-0 overflow-x-auto">
                <div class="flex">
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'product' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="product">
                        📦 샘플검수(상품별)
                    </button>
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'list' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="list">
                        📅 샘플검수(일자별)
                    </button>
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'full' ? 'border-orange-600 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="full">
                        🔍 전량검수 현황
                    </button>
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'qc' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="qc">
                        📊 QC 통계 리포트
                    </button>
                </div>
                <div class="pb-1 pr-1 flex gap-2">
                    <button id="btn-add-pre-inspection" class="text-xs bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-1.5 px-3 rounded shadow-sm transition flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
                        수동 상품 추가
                    </button>
                    <button id="inspection-tab-download-btn" class="text-xs bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold py-1.5 px-3 rounded shadow-sm transition flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        다운로드
                    </button>
                </div>
            </div>
            <div id="inspection-content-area" class="flex-grow relative overflow-hidden"></div>
        </div>
    `;
};

/**
 * 샘플검수(일자별) 모드 렌더링
 */
export const renderInspectionListMode = (dateList, selectedDateData) => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;

    const selectedDate = context.selectedInspectionDate;

    let dateListHtml = '';
    if (!dateList || dateList.length === 0) {
        dateListHtml = `<div class="p-4 text-center text-sm text-gray-400">업로드된 리스트가 없습니다.</div>`;
    } else {
        dateList.forEach(d => {
            const isSelected = d.date === selectedDate;
            const activeClass = isSelected ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-transparent hover:bg-gray-50 text-gray-600';
            
            dateListHtml += `
                <button class="w-full text-left px-4 py-3 border-l-4 transition-all ${activeClass} group btn-select-insp-date" data-date="${d.date}">
                    <div class="flex justify-between items-center">
                        <span class="font-semibold text-sm">${d.date}</span>
                        <span class="text-xs bg-white border border-gray-200 px-2 py-0.5 rounded-full text-gray-500 group-hover:border-gray-300">${d.count}건</span>
                    </div>
                </button>
            `;
        });
    }

    let detailHtml = '';
    if (!selectedDate) {
        detailHtml = `<div class="flex h-full items-center justify-center text-gray-400 text-sm">좌측에서 날짜를 선택해주세요.</div>`;
    } else if (!selectedDateData) {
        detailHtml = `<div class="flex h-full items-center justify-center text-gray-400 text-sm">데이터를 불러올 수 없습니다.</div>`;
    } else if (selectedDateData.length === 0) {
        detailHtml = `
            <div class="flex flex-col h-full">
                <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center shrink-0">
                    <div class="flex items-center gap-2">
                        <h4 class="font-bold text-gray-700 text-sm">📅 ${selectedDate} 샘플검수 리스트 상세</h4>
                        <span class="text-xs text-gray-500">0건</span>
                    </div>
                </div>
                <div class="flex h-full items-center justify-center text-gray-400 text-sm">해당 날짜의 리스트 데이터가 없습니다.</div>
            </div>
        `;
    } else {
        const rows = selectedDateData.map((item, idx) => {
            const isCompleted = item.status === '완료';
            const statusBadge = isCompleted 
                ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">완료</span>`
                : `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">대기</span>`;
            
            return `
                <tr class="hover:bg-blue-50 transition border-b last:border-0 cursor-pointer btn-view-detail" 
                    data-product-name="${item.name}" 
                    data-product-option="${item.option || '-'}" 
                    data-product-code="${item.code || '-'}" 
                    data-target-date="${selectedDate}"
                    title="클릭하여 상세 이력 펼치기">
                    <td class="px-4 py-3 text-xs font-mono text-gray-500">${item.code || '-'}</td>
                    <td class="px-4 py-3 text-sm font-medium text-gray-900">${item.name}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">${item.option || '-'}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">${item.supplierName || '-'}</td>
                    <td class="px-4 py-3 text-xs text-center">${item.qty || 0}</td>
                    <td class="px-4 py-3 text-xs text-gray-500">${item.thickness || '-'}</td>
                    <td class="px-4 py-3 text-center">${statusBadge}</td>
                </tr>
            `;
        }).join('');

        detailHtml = `
            <div class="flex flex-col h-full">
                <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center shrink-0">
                    <div class="flex items-center gap-2">
                        <h4 class="font-bold text-gray-700 text-sm">📅 ${selectedDate} 샘플검수 리스트 상세</h4>
                        <span class="text-xs text-gray-500">상품을 클릭하면 상세내역이 펼쳐집니다.</span>
                    </div>
                    <button class="text-xs bg-white border border-red-200 hover:bg-red-50 text-red-600 font-bold py-1 px-2 rounded shadow-sm transition btn-delete-history-list" 
                            data-date="${selectedDate}" title="이 날짜의 리스트 전체 삭제">
                        🗑️ 리스트 삭제
                    </button>
                </div>
                <div class="flex-grow overflow-y-auto custom-scrollbar relative">
                    <table class="w-full text-left border-collapse">
                        <thead class="bg-white text-xs uppercase text-gray-500 sticky top-0 z-10 shadow-sm outline outline-1 outline-gray-200">
                            <tr>
                                <th class="px-4 py-2 font-semibold bg-gray-50">코드</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50">상품명</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50">옵션</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50">공급처</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50 text-center">수량</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50">기준</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50 text-center">상태</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-100">
                            ${rows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="absolute inset-0 flex border border-gray-200 rounded-lg overflow-hidden bg-white">
            <div class="w-1/4 min-w-[180px] border-r border-gray-200 bg-gray-50 overflow-y-auto custom-scrollbar shrink-0">
                ${dateListHtml}
            </div>
            <div class="flex-1 overflow-hidden bg-white relative">
                ${detailHtml}
            </div>
        </div>
    `;
};

/**
 * 샘플검수(상품별) 테이블 렌더링
 */
export const renderInspectionHistoryTable = (historyData) => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;

    const searchInput = DOM.inspectionHistorySearchInput;
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    let filteredData = historyData.filter(item => {
        const matchId = item.id.toLowerCase().includes(searchTerm);
        if (matchId) return true;
        
        const matchSupplierName = item.lastSupplierName && item.lastSupplierName.toLowerCase().includes(searchTerm);
        if (matchSupplierName) return true;

        if (item.logs && item.logs.length > 0) {
            const lastLog = item.logs[item.logs.length - 1];
            if (lastLog.code && lastLog.code.toLowerCase().includes(searchTerm)) return true;
            if (lastLog.option && lastLog.option.toLowerCase().includes(searchTerm)) return true;
            if (lastLog.supplierName && lastLog.supplierName.toLowerCase().includes(searchTerm)) return true;
        }
        return false;
    });

    if (DOM.inspectionTotalProductCount) {
        DOM.inspectionTotalProductCount.textContent = filteredData.length;
    }

    filteredData.sort((a, b) => {
        let valA = a[sortState.key];
        let valB = b[sortState.key];
        if (sortState.key === 'productName') { valA = a.id; valB = b.id; }
        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';
        if (valA < valB) return sortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.dir === 'asc' ? 1 : -1;
        return 0;
    });

    let html = `
        <div class="absolute inset-0 overflow-y-auto custom-scrollbar border border-gray-200 rounded-lg bg-white">
            <table class="w-full text-sm text-left text-gray-600 relative">
                <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-20 shadow-sm outline outline-1 outline-gray-200">
                    <tr>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-200 transition select-none bg-gray-100" data-sort-key="productName">
                            <div class="flex items-center">상품명 ${getSortIcon('productName')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3 bg-gray-100">공급처 상품명</th>
                        <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none bg-gray-100" data-sort-key="totalInbound">
                            <div class="flex items-center justify-center">총 입고(검수) ${getSortIcon('totalInbound')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none bg-gray-100" data-sort-key="lastInspectionDate">
                            <div class="flex items-center justify-center">최근 검수일 ${getSortIcon('lastInspectionDate')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3 bg-gray-100">최근 불량/특이사항</th>
                        <th scope="col" class="px-6 py-3 text-right bg-gray-100">관리</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 bg-white">
    `;

    if (filteredData.length === 0) {
        html += `<tr><td colspan="6" class="px-6 py-8 text-center text-gray-400">
            ${searchTerm ? `'${searchTerm}'에 대한 검색 결과가 없습니다.` : '저장된 샘플검수 이력이 없습니다.'}
        </td></tr>`;
    } else {
        filteredData.forEach(item => {
            let supplierName = '-';
            if (item.lastSupplierName) supplierName = item.lastSupplierName;

            if (supplierName === '-' && item.logs && item.logs.length > 0) {
                const lastLog = item.logs[item.logs.length - 1];
                supplierName = lastLog.supplierName || '-';
            }

            html += `
                <tr class="hover:bg-blue-50 transition group cursor-pointer btn-view-detail" data-product-name="${item.id}" title="클릭하여 상세 이력 펼치기">
                    <td class="px-6 py-4 font-medium text-gray-900">${item.id}</td>
                    <td class="px-6 py-4 text-xs text-gray-500 truncate max-w-[150px]" title="${supplierName}">
                        ${supplierName}
                    </td>
                    <td class="px-6 py-4 text-center">
                        <span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            ${item.totalInbound || 0}회
                        </span>
                    </td>
                    <td class="px-6 py-4 text-center font-mono text-xs text-gray-500">
                        ${item.lastInspectionDate || '-'}
                    </td>
                    <td class="px-6 py-4">
                        ${formatDefectSummary(item.defectSummary)}
                    </td>
                    <td class="px-6 py-4 text-right space-x-1">
                        <button class="text-indigo-600 hover:text-indigo-900 font-semibold text-xs border border-indigo-200 rounded px-3 py-1.5 hover:bg-indigo-50 transition pointer-events-none shadow-sm">
                            상세보기 ▾
                        </button>
                        <button class="text-red-500 hover:text-red-700 font-semibold text-xs border border-red-200 rounded px-3 py-1.5 hover:bg-red-50 transition btn-delete-product opacity-0 group-hover:opacity-100 shadow-sm" 
                                data-product-name="${item.id}" title="상품 전체 삭제">
                            삭제
                        </button>
                    </td>
                </tr>
            `;
        });
    }

    html += `</tbody></table></div>`;
    container.innerHTML = html;
};

/**
 * ✨ [신규 추가] 전량검수 현황 테이블 렌더링
 * Firestore 'full_inspections' 컬렉션의 데이터를 실시간으로 가져와 보여줍니다.
 */
export const renderFullInspectionTable = async () => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;

    container.innerHTML = `<div class="p-10 text-center text-gray-400 flex flex-col items-center justify-center">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mb-2"></div>
        전량검수 데이터를 불러오는 중...
    </div>`;

    try {
        const q = query(collection(db, 'full_inspections'), orderBy('startDate', 'desc'));
        const querySnapshot = await getDocs(q);
        
        let rowsHtml = '';
        if (querySnapshot.empty) {
            rowsHtml = `<tr><td colspan="7" class="px-6 py-10 text-center text-gray-400">기록된 전량검수 데이터가 없습니다.</td></tr>`;
        } else {
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                const total = data.totalInventory || 0;
                const done = data.cumulativeQty || 0;
                const progress = total > 0 ? ((done / total) * 100).toFixed(1) : 0;
                
                const statusClass = data.status === '완료' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-orange-100 text-orange-800 border border-orange-200';

                rowsHtml += `
                    <tr class="hover:bg-orange-50/30 transition border-b border-gray-100">
                        <td class="px-6 py-4 font-bold text-gray-900">${data.productName}</td>
                        <td class="px-6 py-4 text-xs text-gray-500 font-mono">${data.startDate} ~ ${data.endDate || '진행중'}</td>
                        <td class="px-6 py-4 text-center font-bold text-gray-700">${total.toLocaleString()}</td>
                        <td class="px-6 py-4 text-center">
                            <div class="flex flex-col items-center">
                                <span class="font-bold text-blue-600">${done.toLocaleString()}</span>
                                <div class="w-20 bg-gray-200 rounded-full h-1.5 mt-1.5 overflow-hidden">
                                    <div class="bg-orange-500 h-full rounded-full transition-all duration-500" style="width: ${progress}%"></div>
                                </div>
                                <span class="text-[10px] text-gray-400 mt-1">${progress}% 완료</span>
                            </div>
                        </td>
                        <td class="px-6 py-4 text-center text-green-600 font-bold">${(data.cumulativeNormal || 0).toLocaleString()}</td>
                        <td class="px-6 py-4 text-center text-red-500 font-bold">${(data.cumulativeDefect || 0).toLocaleString()}</td>
                        <td class="px-6 py-4 text-center">
                            <span class="px-3 py-1 rounded-full text-xs font-extrabold ${statusClass}">${data.status}</span>
                        </td>
                    </tr>
                `;
            });
        }

        container.innerHTML = `
            <div class="absolute inset-0 overflow-y-auto custom-scrollbar border border-gray-200 rounded-lg bg-white shadow-sm">
                <table class="w-full text-sm text-left text-gray-600 relative">
                    <thead class="text-xs text-orange-900 uppercase bg-orange-50 sticky top-0 z-20 shadow-sm border-b border-orange-100">
                        <tr>
                            <th class="px-6 py-4 font-bold">상품명</th>
                            <th class="px-6 py-4 font-bold">검수 기간</th>
                            <th class="px-6 py-4 font-bold text-center">총 재고</th>
                            <th class="px-6 py-4 font-bold text-center">누적 검수(진행률)</th>
                            <th class="px-6 py-4 font-bold text-center">정상 수량</th>
                            <th class="px-6 py-4 font-bold text-center">불량 수량</th>
                            <th class="px-6 py-4 font-bold text-center">현재 상태</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50 bg-white">
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    } catch (e) {
        console.error("전량검수 로드 실패:", e);
        container.innerHTML = `<div class="p-10 text-center text-red-500">데이터를 불러오는 중 오류가 발생했습니다.</div>`;
    }
};

// ui-history.js 에서의 import 에러 방지용
export const renderInspectionLogTable = (logs, productName) => {};

/**
 * 상세 이력 펼치기 로직 (샘플검수 전용)
 */
export const renderExpandedInspectionLog = (targetTr, logs, productName) => {
    const table = targetTr.closest('table');
    if (table) {
        table.querySelectorAll('.expanded-detail-row').forEach(row => row.remove());
    }

    const colspan = targetTr.children.length; 
    const isQcReport = targetTr.dataset.isQcReport === 'true';
    let displayLogs = logs;
    
    if (context.inspectionViewMode === 'list') {
        const targetOption = targetTr.dataset.productOption;
        const targetCode = targetTr.dataset.productCode;
        const targetDate = targetTr.dataset.targetDate;

        if (targetOption !== undefined) {
            displayLogs = logs.filter(log => {
                const logOption = log.option || '-';
                const logCode = log.code || '-';
                const logDate = log.date || '-';
                return logOption === targetOption && logCode === targetCode && logDate === targetDate;
            });
        }
    } 
    else if (isQcReport) {
        const pType = targetTr.dataset.qcPeriodType || 'month';
        const pVal = targetTr.dataset.qcPeriodValue || '';

        displayLogs = logs.filter(log => {
            if (pVal && log.date) {
                const logMonth = log.date.substring(0, 7);
                const logWeek = getWeekOfYear(new Date(log.date));
                const isMatch = (pType === 'month' && logMonth === pVal) || (pType === 'week' && logWeek === pVal);
                if (!isMatch) return false; 
            }
            let isDefect = log.status === '불량' || (log.defects && log.defects.length > 0);
            const normalValues = ['정상', '양호', '동일', '없음', '해당없음', '통과', '-', ''];
            if (log.checklist) {
                Object.entries(log.checklist).forEach(([key, val]) => {
                    if (key !== 'thickness' && val) {
                        const cleanVal = String(val).trim();
                        if (cleanVal && !normalValues.includes(cleanVal)) isDefect = true;
                    }
                });
            }
            return isDefect;
        });
    }

    const tr = document.createElement('tr');
    tr.className = 'expanded-detail-row bg-indigo-50/50 shadow-inner relative z-0';
    
    let logsHtml = '';
    if (!displayLogs || displayLogs.length === 0) {
        logsHtml = '<div class="p-6 text-center text-gray-500">상세 기록이 없습니다.</div>';
    } else {
        const groupedLogs = {};
        displayLogs.forEach((log, idx) => {
            const originalIdx = log.originalIndex !== undefined ? log.originalIndex : idx;
            const groupKey = `${log.code || '-'} / ${log.option || '-'}`;
            if (!groupedLogs[groupKey]) groupedLogs[groupKey] = [];
            groupedLogs[groupKey].push({ ...log, originalIndex: originalIdx });
        });

        let rowsHtml = '';
        Object.keys(groupedLogs).sort().forEach(groupKey => {
            const group = groupedLogs[groupKey];
            group.sort((a, b) => ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || '')));

            rowsHtml += `
                <tr class="bg-indigo-100/70 border-y border-indigo-200">
                    <td colspan="8" class="px-4 py-2 text-xs font-bold text-indigo-900">
                        🏷️ 분류 (코드 / 옵션) : <span class="text-indigo-700">${groupKey}</span> (${group.length}건)
                    </td>
                </tr>
            `;

            rowsHtml += group.map(item => {
                let checklistStr = [];
                const normalValues = ['정상', '양호', '동일', '없음', '해당없음'];
                const labelMap = { fabric: '원단', color: '컬러', distortion: '뒤틀림', unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추', lining: '안감', pilling: '보풀', dye: '이염' };
                
                if (item.checklist?.thickness) {
                    checklistStr.push(`<span class="inline-block bg-white px-1.5 py-0.5 rounded text-[11px] text-gray-600 border border-gray-200 mr-1 mb-1">두께: <strong>${item.checklist.thickness}</strong></span>`);
                }
                
                if (item.checklist) {
                    Object.entries(item.checklist).forEach(([k, v]) => {
                        if (k !== 'thickness' && v) {
                            const isDef = !normalValues.includes(String(v).trim());
                            checklistStr.push(`<span class="inline-block ${isDef ? 'text-red-700 bg-red-50 border-red-200 font-bold' : 'text-gray-600 bg-white border-gray-200'} px-1.5 py-0.5 rounded text-[11px] border mb-1 mr-1">${labelMap[k]||k}: ${v}</span>`);
                        }
                    });
                }

                const statusBadge = item.status === '정상' 
                    ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-green-100 text-green-800">정상</span>`
                    : `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800">불량</span>`;

                return `
                    <tr class="border-b border-indigo-100/50 hover:bg-white transition bg-white/40">
                        <td class="px-4 py-3 text-[11px] font-mono text-gray-500 whitespace-nowrap">${item.date}<br>${item.time}</td>
                        <td class="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">${item.packingDate || '-'}</td>
                        <td class="px-4 py-3 text-xs font-bold text-center">${(item.inboundQty || 0).toLocaleString()}</td>
                        <td class="px-4 py-3 text-center">${statusBadge}</td>
                        <td class="px-4 py-3 max-w-[300px] leading-tight">${checklistStr.join('') || '-'}</td>
                        <td class="px-4 py-3 text-xs text-gray-700 break-words max-w-[250px]">${item.note || '-'}</td>
                        <td class="px-4 py-3 text-center">${item.image ? `<img src="${item.image}" class="h-8 w-8 object-cover rounded border border-gray-300 hover:scale-150 transition-transform cursor-pointer" onclick="window.open(this.src)">` : '-'}</td>
                        <td class="px-4 py-3 text-right whitespace-nowrap">
                            <button class="text-blue-600 text-[11px] font-bold px-3 py-1.5 rounded border border-blue-200 hover:bg-blue-50 btn-edit-insp-log" data-index="${item.originalIndex}" data-product-name="${productName}">수정</button>
                        </td>
                    </tr>
                `;
            }).join('');
        });

        logsHtml = `
            <div class="p-4 bg-indigo-50/50 border-y border-indigo-200">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-bold text-indigo-900 text-sm">🔍 상세 샘플검수 이력: ${productName}</h4>
                    <button class="text-xs font-bold btn-close-expanded px-3 py-1 border rounded bg-white hover:bg-gray-100">닫기 ✖</button>
                </div>
                <div class="max-h-[400px] overflow-auto rounded-lg border border-indigo-200 bg-white">
                    <table class="w-full text-left">
                        <thead class="bg-indigo-100 text-[11px] text-indigo-800 uppercase sticky top-0 shadow-sm z-10">
                            <tr>
                                <th class="px-4 py-2 whitespace-nowrap">입고(검수)일시</th><th class="px-4 py-2 whitespace-nowrap">출고일자</th><th class="px-4 py-2 text-center whitespace-nowrap">수량</th>
                                <th class="px-4 py-2 text-center whitespace-nowrap">상태</th><th class="px-4 py-2">체크리스트</th><th class="px-4 py-2">특이사항</th>
                                <th class="px-4 py-2 text-center whitespace-nowrap">사진</th><th class="px-4 py-2 text-right whitespace-nowrap">관리</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    tr.innerHTML = `<td colspan="${colspan}" class="p-0 border-0 cursor-default">${logsHtml}</td>`;
    targetTr.after(tr); 
};

/**
 * QC 통계 리포트 렌더링
 */
export const renderQCStatsMode = (historyData, periodType = 'month', selectedPeriod = '') => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;

    if (!historyData || historyData.length === 0) {
        container.innerHTML = '<div class="text-center py-10 text-gray-500">데이터를 로드하는 중이거나 데이터가 없습니다.</div>';
        return;
    }

    const weeks = new Set(), months = new Set();
    historyData.forEach(product => {
        if (product.logs && Array.isArray(product.logs)) {
            product.logs.forEach(log => {
                if (log.date) {
                    months.add(log.date.substring(0, 7)); 
                    weeks.add(getWeekOfYear(new Date(log.date))); 
                }
            });
        }
    });

    const monthOptions = Array.from(months).sort().reverse();
    const weekOptions = Array.from(weeks).sort().reverse();

    if (!selectedPeriod) selectedPeriod = periodType === 'month' ? monthOptions[0] : weekOptions[0];

    let totalInspectedQty = 0, totalDefectQty = 0, totalInspectionCount = 0, totalDefectCount = 0;
    const inspectedProducts = new Set(), productStats = {}; 

    historyData.forEach(product => {
        if (product.logs && Array.isArray(product.logs)) {
            product.logs.forEach(log => {
                if (!log.date) return;
                const logMonth = log.date.substring(0, 7), logWeek = getWeekOfYear(new Date(log.date));
                const isMatch = (periodType === 'month' && logMonth === selectedPeriod) || (periodType === 'week' && logWeek === selectedPeriod);

                if (isMatch) {
                    inspectedProducts.add(product.id);
                    if (!productStats[product.id]) productStats[product.id] = { totalQty: 0, defectQty: 0, inspCount: 0, defectCount: 0, defectsList: [] };
                    const qty = Number(log.inboundQty) || Number(log.qty) || 1; 
                    productStats[product.id].inspCount += 1; totalInspectionCount += 1;
                    productStats[product.id].totalQty += qty; totalInspectedQty += qty;

                    let isDefect = false;
                    const defectReasons = [];
                    const normalValues = ['정상', '양호', '동일', '없음', '해당없음', '통과', '-', ''];
                    if (log.status === '불량' || (log.defects && log.defects.length > 0)) isDefect = true;
                    if (log.checklist) {
                        const labelMap = { fabric: '원단', color: '컬러', distortion: '뒤틀림', unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추', lining: '안감', pilling: '보풀', dye: '이염' };
                        Object.entries(log.checklist).forEach(([key, val]) => {
                            if (key !== 'thickness' && val && !normalValues.includes(String(val).trim())) {
                                isDefect = true; defectReasons.push(`${labelMap[key] || key}: ${val}`);
                            }
                        });
                    }
                    if (isDefect) {
                        productStats[product.id].defectCount += 1; totalDefectCount += 1;
                        productStats[product.id].defectQty += qty; totalDefectQty += qty;
                        productStats[product.id].defectsList.push(...defectReasons);
                    }
                }
            });
        }
    });

    const countDefectRate = totalInspectionCount > 0 ? ((totalDefectCount / totalInspectionCount) * 100).toFixed(1) : 0;
    const topDefectiveProducts = Object.entries(productStats)
        .map(([name, s]) => ({ name, inspCount: s.inspCount, defectCount: s.defectCount, countRate: s.inspCount > 0 ? ((s.defectCount / s.inspCount) * 100).toFixed(1) : 0 }))
        .sort((a, b) => b.defectCount - a.defectCount).slice(0, 15);

    container.innerHTML = `
        <div class="absolute inset-0 flex flex-col bg-gray-50 p-4 rounded-lg overflow-y-auto custom-scrollbar">
            <div class="bg-white p-4 rounded-lg shadow-sm border mb-4 flex gap-4 items-end shrink-0">
                <div><label class="block text-xs font-bold text-gray-600 mb-1">기준</label><select id="qc-period-type" class="border rounded p-1.5 text-sm"><option value="month" ${periodType==='month'?'selected':''}>월간</option><option value="week" ${periodType==='week'?'selected':''}>주간</option></select></div>
                <div><label class="block text-xs font-bold text-gray-600 mb-1">기간</label><select id="qc-period-value" class="border rounded p-1.5 text-sm min-w-[120px]">${periodType==='month'?monthOptions.map(m=>`<option value="${m}" ${selectedPeriod===m?'selected':''}>${m}</option>`).join(''):weekOptions.map(w=>`<option value="${w}" ${selectedPeriod===w?'selected':''}>${w}</option>`).join('')}</select></div>
                <button id="btn-refresh-qc" class="bg-indigo-600 text-white text-sm font-bold py-1.5 px-4 rounded shadow">조회</button>
            </div>
            <div class="grid grid-cols-4 gap-4 mb-6 shrink-0">
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-indigo-500"><div class="text-xs text-gray-500 mb-1">총 검수 횟수</div><div class="text-2xl font-bold">${totalInspectionCount}회</div></div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-blue-500"><div class="text-xs text-gray-500 mb-1">상품 종류</div><div class="text-2xl font-bold">${inspectedProducts.size}종</div></div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-red-500"><div class="text-xs text-gray-500 mb-1">불량 건수</div><div class="text-2xl font-bold text-red-600">${totalDefectCount}건</div></div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-orange-500"><div class="text-xs text-gray-500 mb-1">평균 불량률</div><div class="text-2xl font-bold text-orange-600">${countDefectRate}%</div></div>
            </div>
            <div class="bg-white rounded-lg shadow-sm border overflow-hidden"><div class="px-4 py-3 bg-gray-50 font-bold border-b">⚠️ QC 집중 관리 대상 TOP 15</div>
                <table class="w-full text-sm text-left"><thead class="bg-gray-50 text-xs uppercase text-gray-500"><tr><th class="px-4 py-3">상품명</th><th class="px-4 py-3 text-center">검수횟수</th><th class="px-4 py-3 text-center">불량횟수</th><th class="px-4 py-3 text-center">불량률</th></tr></thead>
                <tbody>${topDefectiveProducts.map((p,i)=>`
                    <tr class="hover:bg-indigo-50/50 transition cursor-pointer btn-view-detail" data-product-name="${p.name}" data-is-qc-report="true" data-qc-period-type="${periodType}" data-qc-period-value="${selectedPeriod}">
                        <td class="px-4 py-3 font-medium text-gray-900">${i+1}. ${p.name}</td>
                        <td class="px-4 py-3 text-center">${p.inspCount}회</td>
                        <td class="px-4 py-3 text-center text-red-600 font-bold">${p.defectCount}회</td>
                        <td class="px-4 py-3 text-center"><span class="bg-red-50 text-red-700 px-2 py-1 rounded font-bold">${p.countRate}%</span></td>
                    </tr>`).join('')}</tbody></table>
            </div>
        </div>
    `;
};

export const setSortState = (key) => {
    if (sortState.key === key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    else { sortState.key = key; sortState.dir = 'desc'; }
};