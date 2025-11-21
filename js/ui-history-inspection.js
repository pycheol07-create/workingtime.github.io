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
    // 배열의 마지막 요소가 가장 최신이라고 가정 (DB 저장 로직에 따름)
    // 혹은 문자열 날짜를 비교해야 할 수도 있음. 
    // inspection-logic.js에서 arrayUnion으로 추가하므로 뒤쪽이 최신일 가능성 높음.
    const lastDefect = defectSummary[defectSummary.length - 1];
    return `<span class="text-red-600 font-medium text-xs truncate block max-w-[200px]" title="${lastDefect}">${lastDefect}</span>`;
};

/**
 * 메인 렌더링 함수
 * @param {Array} historyData - product_history 컬렉션의 모든 문서 배열
 */
export const renderInspectionHistoryTable = (historyData) => {
    const container = DOM.inspectionHistoryViewContainer;
    if (!container) return;

    const searchInput = DOM.inspectionHistorySearchInput;
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    // 1. 필터링
    let filteredData = historyData.filter(item => {
        // id(상품명) 검색
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

        // id(상품명) 정렬 예외 처리
        if (sortState.key === 'productName') {
            valA = a.id;
            valB = b.id;
        }

        // null/undefined 처리
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
                        <div class="text-xs text-gray-400 mt-0.5">ID: ${item.id}</div>
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

    // 4. 정렬 이벤트 리스너 연결 (Event Delegation)
    // 기존 리스너가 중복되지 않도록 container 자체에 한번만 연결하는 것이 좋으나,
    // 렌더링 될 때마다 헤더가 새로 그려지므로 여기서 처리하거나 상위 리스너에서 처리해야 함.
    // listeners-history.js에서 처리하도록 data attribute만 잘 설정해두면 됨.
};

/**
 * 외부에서 정렬 상태를 변경할 때 사용하는 함수
 */
export const setSortState = (key) => {
    if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.key = key;
        sortState.dir = 'desc'; // 기본 내림차순
    }
};