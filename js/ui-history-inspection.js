// === js/ui-history-inspection.js ===
import * as DOM from './dom-elements.js';
import { context, allHistoryData } from './state.js';
import { getWeekOfYear } from './utils.js';

// 정렬 상태 관리 (로컬)
let sortState = { key: 'lastInspectionDate', dir: 'desc' };

// 헬퍼: 정렬 아이콘 HTML 생성
const getSortIcon = (key) => {
    if (sortState.key !== key) return '<span class="text-gray-300 text-[10px] ml-1 opacity-50">↕</span>';
    return sortState.dir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

// 헬퍼: 불량 이력 요약 (최신 1건 표시)
const formatDefectSummary = (defectSummary) => {
    if (!defectSummary || defectSummary.length === 0) {
        return '<span class="text-gray-400">-</span>';
    }
    const lastDefect = defectSummary[defectSummary.length - 1];
    return `<span class="text-red-600 font-medium text-xs truncate block max-w-[200px]" title="${lastDefect}">${lastDefect}</span>`;
};

/**
 * 메인 프레임 렌더링 (탭 버튼 포함 + 다운로드 버튼 이동)
 */
export const renderInspectionLayout = (container) => {
    if (!container) return;
    const activeTab = context.inspectionViewMode || 'product';

    container.innerHTML = `
        <div class="flex flex-col h-full">
            <div class="flex justify-between items-end border-b border-gray-200 mb-4">
                <div class="flex">
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'product' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="product">
                        📦 상품별 보기
                    </button>
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'list' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="list">
                        📅 검수 일자별 보기
                    </button>
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'qc' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="qc">
                        📊 QC 통계 리포트
                    </button>
                </div>
                <div class="pb-1 pr-1 flex gap-2">
                    <button id="btn-add-pre-inspection" class="text-xs bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-1.5 px-3 rounded shadow-sm transition flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        수동 상품 추가
                    </button>
                    <button id="inspection-tab-download-btn" class="text-xs bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold py-1.5 px-3 rounded shadow-sm transition flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        다운로드
                    </button>
                </div>
            </div>
            <div id="inspection-content-area" class="flex-grow overflow-hidden relative"></div>
        </div>
    `;
};

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
                <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <h4 class="font-bold text-gray-700 text-sm">📅 ${selectedDate} 검수 리스트 상세</h4>
                        <span class="text-xs text-gray-500">0건</span>
                    </div>
                    <button class="text-xs bg-white border border-red-200 hover:bg-red-50 text-red-600 font-bold py-1 px-2 rounded shadow-sm transition" 
                            data-action="request-history-deletion" data-date-key="${selectedDate}" title="이 날짜의 리스트 전체 삭제">
                        🗑️ 리스트 삭제
                    </button>
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
                <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <h4 class="font-bold text-gray-700 text-sm">📅 ${selectedDate} 검수 리스트 상세</h4>
                        <span class="text-xs text-gray-500">상품을 클릭하면 검수 상세내역이 펼쳐집니다.</span>
                    </div>
                    <button class="text-xs bg-white border border-red-200 hover:bg-red-50 text-red-600 font-bold py-1 px-2 rounded shadow-sm transition" 
                            data-action="request-history-deletion" data-date-key="${selectedDate}" title="이 날짜의 리스트 전체 삭제">
                        🗑️ 리스트 삭제
                    </button>
                </div>
                <div class="flex-grow overflow-y-auto">
                    <table class="w-full text-left border-collapse">
                        <thead class="bg-white text-xs uppercase text-gray-500 sticky top-0 z-10 shadow-sm">
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
        <div class="flex h-full border border-gray-200 rounded-lg overflow-hidden bg-white">
            <div class="w-1/4 min-w-[180px] border-r border-gray-200 bg-gray-50 overflow-y-auto custom-scrollbar">
                ${dateListHtml}
            </div>
            <div class="flex-1 overflow-hidden bg-white relative">
                ${detailHtml}
            </div>
        </div>
    `;
};

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
        <div class="h-full overflow-y-auto border border-gray-200 rounded-lg">
            <table class="w-full text-sm text-left text-gray-600">
                <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10 shadow-sm">
                    <tr>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-200 transition select-none" data-sort-key="productName">
                            <div class="flex items-center">상품명 ${getSortIcon('productName')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3">공급처 상품명</th>
                        <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none" data-sort-key="totalInbound">
                            <div class="flex items-center justify-center">총 입고(검수) ${getSortIcon('totalInbound')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none" data-sort-key="lastInspectionDate">
                            <div class="flex items-center justify-center">최근 검수일 ${getSortIcon('lastInspectionDate')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3">최근 불량/특이사항</th>
                        <th scope="col" class="px-6 py-3 text-right">관리</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 bg-white">
    `;

    if (filteredData.length === 0) {
        html += `<tr><td colspan="6" class="px-6 py-8 text-center text-gray-400">
            ${searchTerm ? `'${searchTerm}'에 대한 검색 결과가 없습니다.` : '저장된 검수 이력이 없습니다.'}
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
                        <button class="text-indigo-600 hover:text-indigo-900 font-semibold text-xs border border-indigo-200 rounded px-3 py-1.5 hover:bg-indigo-50 transition pointer-events-none">
                            상세보기 ▾
                        </button>
                        <button class="text-red-500 hover:text-red-700 font-semibold text-xs border border-red-200 rounded px-3 py-1.5 hover:bg-red-50 transition btn-delete-product opacity-0 group-hover:opacity-100" 
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

// [중요] ui-history.js 에서의 import 에러 방지용 모달 렌더러 함수
export const renderInspectionLogTable = (logs, productName) => {
    // UI 변경으로 인해 사용되지 않지만, 다른 모듈의 참조 오류를 방지하기 위해 남겨둡니다.
};

export const renderExpandedInspectionLog = (targetTr, logs, productName) => {
    const table = targetTr.closest('table');
    if (table) {
        table.querySelectorAll('.expanded-detail-row').forEach(row => row.remove());
    }

    const colspan = targetTr.children.length; 

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

    const tr = document.createElement('tr');
    tr.className = 'expanded-detail-row bg-indigo-50/50 shadow-inner';
    
    let logsHtml = '';
    if (!displayLogs || displayLogs.length === 0) {
        logsHtml = '<div class="p-6 text-center text-gray-500">해당 조건의 상세 검수 기록이 없습니다.</div>';
    } else {
        const groupedLogs = {};
        displayLogs.forEach((log, idx) => {
            const originalIdx = log.originalIndex !== undefined ? log.originalIndex : idx;

            const code = log.code || '-';
            const option = log.option || '-';
            const groupKey = `${code} / ${option}`;
            
            if (!groupedLogs[groupKey]) {
                groupedLogs[groupKey] = [];
            }
            groupedLogs[groupKey].push({ ...log, originalIndex: originalIdx });
        });

        let rowsHtml = '';

        Object.keys(groupedLogs).sort().forEach(groupKey => {
            const group = groupedLogs[groupKey];
            
            group.sort((a, b) => {
                const tA = (a.date || '') + (a.time || '');
                const tB = (b.date || '') + (b.time || '');
                return tB.localeCompare(tA); 
            });

            rowsHtml += `
                <tr class="bg-indigo-100/70 border-y border-indigo-200">
                    <td colspan="8" class="px-4 py-2 text-xs font-bold text-indigo-900">
                        🏷️ 분류 (코드 / 옵션) : <span class="text-indigo-700">${groupKey}</span> 
                        <span class="text-gray-500 font-normal ml-2">(${group.length}건)</span>
                    </td>
                </tr>
            `;

            rowsHtml += group.map(item => {
                let checklistStr = [];
                const cl = item.checklist || {};
                const normalValues = ['정상', '양호', '동일', '없음', '해당없음'];
                
                if (cl.thickness) {
                    checklistStr.push(`<span class="inline-block bg-white px-1.5 py-0.5 rounded text-[11px] text-gray-600 border border-gray-200 shadow-sm mr-1 mb-1">두께: <strong class="text-indigo-600">${cl.thickness}</strong></span>`);
                }
                
                const labelMap = { fabric: '원단', color: '컬러', distortion: '뒤틀림', unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추', lining: '안감', pilling: '보풀', dye: '이염' };
                
                Object.entries(cl).forEach(([key, val]) => {
                    if (key !== 'thickness' && val) {
                        const isDefect = !normalValues.includes(val);
                        const colorClass = isDefect ? 'text-red-700 bg-red-50 border-red-200 font-bold' : 'text-gray-600 bg-white border-gray-200';
                        checklistStr.push(`<span class="inline-block ${colorClass} px-1.5 py-0.5 rounded text-[11px] border shadow-sm mb-1 mr-1">${labelMap[key]||key}: ${val}</span>`);
                    }
                });

                const statusBadge = item.status === '정상' 
                    ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-green-100 text-green-800">정상</span>`
                    : item.status === '사전메모' ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-orange-100 text-orange-800">사전메모</span>`
                    : `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800">불량</span>`;

                let defectText = item.defects && item.defects.length > 0 ? `<span class="text-red-600 font-bold mr-1">[${item.defects.join(', ')}]</span>` : '';
                let noteText = item.note || '';
                let fullNote = (defectText + noteText) || '<span class="text-gray-400">-</span>';

                let imageHtml = '<span class="text-gray-300 text-xs">-</span>';
                if (item.image) {
                    imageHtml = `
                        <div class="relative group cursor-pointer inline-block">
                            <img src="${item.image}" class="h-8 w-8 object-cover rounded border border-gray-300 hover:scale-150 transition-transform z-0 hover:z-10 bg-white" 
                                 onclick="const w=window.open('','_blank'); w.document.write('<img src=\\'${item.image}\\' style=\\'width:100%\\'/>');">
                        </div>`;
                }

                return `
                    <tr class="border-b border-indigo-100/50 hover:bg-white transition bg-white/40">
                        <td class="px-4 py-3 text-[11px] font-mono text-gray-500 whitespace-nowrap">${item.date}<br>${item.time}</td>
                        <td class="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">${item.inboundDate || '-'}</td>
                        <td class="px-4 py-3 text-xs font-bold text-gray-700 text-center">${item.inboundQty ? item.inboundQty.toLocaleString() : '-'}</td>
                        <td class="px-4 py-3 text-center">${statusBadge}</td>
                        <td class="px-4 py-3 max-w-[300px] leading-tight">${checklistStr.join('') || '-'}</td>
                        <td class="px-4 py-3 text-xs text-gray-700 break-words max-w-[250px]">${fullNote}</td>
                        <td class="px-4 py-3 text-center">${imageHtml}</td>
                        <td class="px-4 py-3 text-right whitespace-nowrap">
                            <button class="text-blue-600 hover:text-blue-800 text-[11px] font-bold px-3 py-1.5 rounded border border-blue-200 hover:bg-blue-50 btn-edit-insp-log transition shadow-sm" data-index="${item.originalIndex}" data-product-name="${productName}">수정</button>
                        </td>
                    </tr>
                `;
            }).join('');
        });

        logsHtml = `
            <div class="p-4 bg-indigo-50/50 border-y border-indigo-200">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-bold text-indigo-900 text-sm flex items-center gap-2">
                        🔍 상세 검수 이력 <span class="text-xs font-normal text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full border border-indigo-200">${productName}</span>
                    </h4>
                    <button class="text-xs text-gray-500 hover:text-gray-800 font-bold btn-close-expanded px-3 py-1 rounded hover:bg-gray-200 transition border border-gray-300 bg-white shadow-sm">닫기 ✖</button>
                </div>
                <div class="overflow-x-auto rounded-lg border border-indigo-200 bg-white shadow-sm">
                    <table class="w-full text-left">
                        <thead class="bg-indigo-100 text-[11px] text-indigo-800 uppercase">
                            <tr>
                                <th class="px-4 py-2 font-bold whitespace-nowrap w-[10%]">입고(검수)일시</th>
                                <th class="px-4 py-2 font-bold whitespace-nowrap w-[10%]">출고일자</th>
                                <th class="px-4 py-2 font-bold text-center whitespace-nowrap w-[5%]">수량</th>
                                <th class="px-4 py-2 font-bold text-center whitespace-nowrap w-[8%]">상태</th>
                                <th class="px-4 py-2 font-bold w-[30%]">검수항목 (체크리스트)</th>
                                <th class="px-4 py-2 font-bold w-[20%]">특이사항/메모</th>
                                <th class="px-4 py-2 font-bold text-center whitespace-nowrap w-[7%]">사진</th>
                                <th class="px-4 py-2 font-bold text-right whitespace-nowrap w-[10%]">관리</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    tr.innerHTML = `<td colspan="${colspan}" class="p-0 border-0 cursor-default">${logsHtml}</td>`;
    targetTr.after(tr); 
};

export const setSortState = (key) => {
    if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.key = key;
        sortState.dir = 'desc';
    }
};

/**
 * QC 통계 리포트 렌더링
 */
export const renderQCStatsMode = (periodType = 'month', selectedPeriod = '') => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;

    // 1. 기간 옵션 생성 (최근 데이터 기준)
    const weeks = new Set();
    const months = new Set();
    
    allHistoryData.forEach(day => {
        if (day.inspectionList && day.inspectionList.length > 0) {
            months.add(day.id.substring(0, 7)); // YYYY-MM
            weeks.add(getWeekOfYear(new Date(day.id))); // YYYY-Wxx
        }
    });

    const monthOptions = Array.from(months).sort().reverse();
    const weekOptions = Array.from(weeks).sort().reverse();

    // 기본 선택값 설정
    if (!selectedPeriod) {
        selectedPeriod = periodType === 'month' ? monthOptions[0] : weekOptions[0];
    }

    // 2. 선택된 기간의 데이터 집계
    let totalInspected = 0;
    let totalDefects = 0;
    const inspectedProducts = new Set();
    const productStats = {}; // { '상품명': { total: 0, defects: 0, types: [] } }

    allHistoryData.forEach(day => {
        const dayMonth = day.id.substring(0, 7);
        const dayWeek = getWeekOfYear(new Date(day.id));

        const isMatch = (periodType === 'month' && dayMonth === selectedPeriod) || 
                        (periodType === 'week' && dayWeek === selectedPeriod);

        if (isMatch && day.inspectionList) {
            day.inspectionList.forEach(log => {
                // 상품 이름 추출
                const pName = log.name || log.code || '알 수 없음';
                inspectedProducts.add(pName);
                
                if (!productStats[pName]) {
                    productStats[pName] = { total: 0, defects: 0, defectsList: [] };
                }

                // 검수 수량 누적
                const qty = Number(log.qty) || 1; 
                productStats[pName].total += qty;
                totalInspected += qty;

                // 불량 여부 확인
                const isDefect = log.status === '불량' || (log.defects && log.defects.length > 0);
                if (isDefect) {
                    productStats[pName].defects += qty;
                    totalDefects += qty;
                    if (log.defects) {
                        productStats[pName].defectsList.push(...log.defects);
                    }
                }
            });
        }
    });

    const defectRate = totalInspected > 0 ? ((totalDefects / totalInspected) * 100).toFixed(1) : 0;
    const totalProductTypes = inspectedProducts.size;

    // 불량률이 높은 상위 10개 상품 정렬
    const topDefectiveProducts = Object.entries(productStats)
        .map(([name, stats]) => ({
            name,
            total: stats.total,
            defects: stats.defects,
            rate: stats.total > 0 ? ((stats.defects / stats.total) * 100).toFixed(1) : 0,
            commonDefects: [...new Set(stats.defectsList)].join(', ') || '-'
        }))
        .filter(p => p.defects > 0)
        .sort((a, b) => b.defects - a.defects) // 불량 건수 순 정렬
        .slice(0, 10);

    // 3. HTML 생성
    container.innerHTML = `
        <div class="h-full flex flex-col bg-gray-50 p-4 rounded-lg overflow-y-auto">
            
            <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-4 flex gap-4 items-end">
                <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">통계 기준</label>
                    <select id="qc-period-type" class="border border-gray-300 rounded p-1.5 text-sm focus:ring-indigo-500">
                        <option value="month" ${periodType === 'month' ? 'selected' : ''}>월간 (Monthly)</option>
                        <option value="week" ${periodType === 'week' ? 'selected' : ''}>주간 (Weekly)</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">조회 기간</label>
                    <select id="qc-period-value" class="border border-gray-300 rounded p-1.5 text-sm focus:ring-indigo-500 min-w-[120px]">
                        ${periodType === 'month' 
                            ? monthOptions.map(m => `<option value="${m}" ${selectedPeriod === m ? 'selected' : ''}>${m}</option>`).join('')
                            : weekOptions.map(w => `<option value="${w}" ${selectedPeriod === w ? 'selected' : ''}>${w}</option>`).join('')
                        }
                    </select>
                </div>
                <button id="btn-refresh-qc" class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold py-1.5 px-4 rounded shadow transition">
                    조회
                </button>
            </div>

            ${!selectedPeriod ? `<div class="text-center text-gray-500 py-10">해당 기간에 검수 데이터가 없습니다.</div>` : `
            
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-indigo-500">
                    <div class="text-xs text-gray-500 mb-1">총 검수 수량</div>
                    <div class="text-2xl font-bold text-gray-800">${totalInspected.toLocaleString()} <span class="text-sm font-normal text-gray-500">건</span></div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-blue-500">
                    <div class="text-xs text-gray-500 mb-1">검수 상품 종류</div>
                    <div class="text-2xl font-bold text-gray-800">${totalProductTypes.toLocaleString()} <span class="text-sm font-normal text-gray-500">종</span></div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-red-500">
                    <div class="text-xs text-gray-500 mb-1">총 불량 발견 수</div>
                    <div class="text-2xl font-bold text-red-600">${totalDefects.toLocaleString()} <span class="text-sm font-normal text-gray-500">건</span></div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 ${defectRate > 5 ? 'border-red-500' : 'border-green-500'}">
                    <div class="text-xs text-gray-500 mb-1">평균 불량률</div>
                    <div class="text-2xl font-bold ${defectRate > 5 ? 'text-red-600' : 'text-gray-800'}">${defectRate} <span class="text-sm font-normal text-gray-500">%</span></div>
                </div>
            </div>

            <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex-grow">
                <div class="px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <h3 class="font-bold text-gray-700">⚠️ QC 집중 관리 대상 (불량 다발 상품 TOP 10)</h3>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left">
                        <thead class="text-xs text-gray-500 uppercase bg-gray-50">
                            <tr>
                                <th class="px-4 py-3">상품명</th>
                                <th class="px-4 py-3 text-center">검수 수량</th>
                                <th class="px-4 py-3 text-center">불량 건수</th>
                                <th class="px-4 py-3 text-center">불량률</th>
                                <th class="px-4 py-3">주요 불량 사유</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            ${topDefectiveProducts.length === 0 ? `
                                <tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">발견된 불량 내역이 없습니다. 🎉</td></tr>
                            ` : topDefectiveProducts.map((p, idx) => `
                                <tr class="hover:bg-red-50 transition">
                                    <td class="px-4 py-3 font-medium text-gray-900">
                                        <span class="inline-block w-4 h-4 text-center rounded-full ${idx < 3 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'} text-[10px] mr-1 leading-4">${idx + 1}</span>
                                        ${p.name}
                                    </td>
                                    <td class="px-4 py-3 text-center text-gray-600">${p.total}</td>
                                    <td class="px-4 py-3 text-center font-bold text-red-600">${p.defects}</td>
                                    <td class="px-4 py-3 text-center">
                                        <span class="px-2 py-1 rounded text-xs ${p.rate > 10 ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'}">
                                            ${p.rate}%
                                        </span>
                                    </td>
                                    <td class="px-4 py-3 text-xs text-gray-500">${p.commonDefects}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            `}
        </div>
    `;
};