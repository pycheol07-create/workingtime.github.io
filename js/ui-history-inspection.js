// === js/ui-history-inspection.js ===
// 설명: 검수 이력 데이터를 테이블 형태로 렌더링합니다.

import * as DOM from './dom-elements.js';

// 정렬 상태 관리 (로컬)
let sortState = { key: 'lastInspectionDate', dir: 'desc' };

/**
 * 헬퍼: 정렬 아이콘 HTML 생성
 */
const getSortIcon = (key) => {
    if (sortState.key !== key) return '<span class="text-gray-300 text-[10px] ml-1 opacity-50">↕</span>';
    return sortState.dir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

/**
 * 헬퍼: 불량 이력 요약 (최신 1건 표시)
 */
const formatDefectSummary = (defectSummary) => {
    if (!defectSummary || defectSummary.length === 0) {
        return '<span class="text-gray-400">-</span>';
    }
    const lastDefect = defectSummary[defectSummary.length - 1];
    return `<span class="text-red-600 font-medium text-xs truncate block max-w-[200px]" title="${lastDefect}">${lastDefect}</span>`;
};

/**
 * 메인 렌더링 함수 (전체 상품 목록)
 * @param {Array} historyData - product_history 컬렉션의 모든 문서 배열
 */
export const renderInspectionHistoryTable = (historyData) => {
    const container = DOM.inspectionHistoryViewContainer;
    if (!container) return;

    const searchInput = DOM.inspectionHistorySearchInput;
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    // 1. 필터링
    let filteredData = historyData.filter(item => {
        return item.id.toLowerCase().includes(searchTerm);
    });

    // 총 개수 업데이트
    if (DOM.inspectionTotalProductCount) {
        DOM.inspectionTotalProductCount.textContent = filteredData.length;
    }

    // 2. 정렬
    filteredData.sort((a, b) => {
        let valA = a[sortState.key];
        let valB = b[sortState.key];

        if (sortState.key === 'productName') {
            valA = a.id;
            valB = b.id;
        }

        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';

        if (valA < valB) return sortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.dir === 'asc' ? 1 : -1;
        return 0;
    });

    // 3. HTML 생성
    let html = `
        <table class="w-full text-sm text-left text-gray-600 border border-gray-200">
            <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10">
                <tr>
                    <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-200 transition select-none" data-sort-key="productName">
                        <div class="flex items-center">상품명 ${getSortIcon('productName')}</div>
                    </th>
                    <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none" data-sort-key="totalInbound">
                        <div class="flex items-center justify-center">총 입고 ${getSortIcon('totalInbound')}</div>
                    </th>
                    <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none" data-sort-key="lastInspectionDate">
                        <div class="flex items-center justify-center">최근 검수일 ${getSortIcon('lastInspectionDate')}</div>
                    </th>
                    <th scope="col" class="px-6 py-3">
                        최근 불량 내역
                    </th>
                    <th scope="col" class="px-6 py-3 text-right">
                        관리
                    </th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 bg-white">
    `;

    if (filteredData.length === 0) {
        html += `<tr><td colspan="5" class="px-6 py-8 text-center text-gray-400">
            ${searchTerm ? `'${searchTerm}'에 대한 검색 결과가 없습니다.` : '저장된 검수 이력이 없습니다.'}
        </td></tr>`;
    } else {
        filteredData.forEach(item => {
            html += `
                <tr class="hover:bg-gray-50 transition">
                    <td class="px-6 py-4 font-medium text-gray-900">
                        ${item.id}
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
                    <td class="px-6 py-4 text-right">
                        <button class="text-indigo-600 hover:text-indigo-900 font-semibold text-xs border border-indigo-200 rounded px-3 py-1.5 hover:bg-indigo-50 transition btn-view-detail" 
                                data-product-name="${item.id}">
                            상세보기
                        </button>
                    </td>
                </tr>
            `;
        });
    }

    html += `</tbody></table>`;
    container.innerHTML = html;
};

/**
 * ✅ [신규] 상품별 상세 검수 로그(logs) 테이블 렌더링
 * @param {Array} logs - 특정 상품의 logs 배열
 * @param {String} productName - 상품명
 */
export const renderInspectionLogTable = (logs, productName) => {
    const tbody = DOM.inspectionLogTableBody;
    const titleEl = DOM.inspectionLogProductName;
    
    if (!tbody) return;
    if (titleEl) titleEl.textContent = productName;

    tbody.innerHTML = '';

    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-400">검수 기록이 없습니다.</td></tr>';
        return;
    }

    // 1. 원본 인덱스 매핑 (수정/삭제 시 식별용)
    const logsWithIndex = logs.map((log, idx) => ({ ...log, originalIndex: idx }));
    
    // 2. 최신순 정렬 (날짜+시간 내림차순)
    logsWithIndex.sort((a, b) => {
        const tA = (a.date || '') + (a.time || '');
        const tB = (b.date || '') + (b.time || '');
        return tB.localeCompare(tA);
    });

    logsWithIndex.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition border-b';

        const statusBadge = item.status === '정상' 
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">정상</span>`
            : `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">불량</span>`;

        let defectText = '';
        if (item.defects && item.defects.length > 0) {
            defectText = `<span class="text-red-600 font-bold mr-1">[${item.defects.join(', ')}]</span>`;
        }
        const noteText = item.note || '';
        const fullText = (defectText + noteText) || '<span class="text-gray-300">-</span>';

        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-gray-600 font-mono text-xs">
                ${item.date}<br>${item.time}
            </td>
            <td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                ${item.inspector || '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-gray-500 font-mono text-xs">
                ${item.packingNo || '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-center font-bold text-gray-700">
                ${item.inboundQty ? item.inboundQty.toLocaleString() : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-center">
                ${statusBadge}
            </td>
            <td class="px-6 py-4 text-sm text-gray-600 max-w-xs break-words">
                ${fullText}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right">
                <button class="text-blue-600 hover:text-blue-900 font-medium text-xs border border-blue-200 rounded px-2 py-1 hover:bg-blue-50 transition btn-edit-insp-log" 
                        data-index="${item.originalIndex}">
                    수정
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
};

/**
 * 외부에서 정렬 상태를 변경할 때 사용하는 함수
 */
export const setSortState = (key) => {
    if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.key = key;
        sortState.dir = 'desc';
    }
};