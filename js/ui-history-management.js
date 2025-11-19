// === js/ui-history-management.js ===
// 설명: 경영 지표(재고, 매출 등)의 입력 및 기간별 분석 리포트 렌더링을 담당합니다.

import { formatDuration, getWeekOfYear } from './utils.js';
import { getDiffHtmlForMetric } from './ui-history-reports-logic.js';

// 헬퍼: 숫자를 통화 형식(콤마)으로 변환
const formatCurrency = (num) => {
    return (Number(num) || 0).toLocaleString();
};

// 헬퍼: 재고 순환율 계산 (기간 매출 합계 / 기간 평균 재고 금액)
// * 일반적인 회전율 공식: 매출액 / 평균재고고
const calculateTurnoverRatio = (totalRevenue, avgInventoryAmt) => {
    if (!avgInventoryAmt || avgInventoryAmt <= 0) return 0;
    return totalRevenue / avgInventoryAmt;
};

// 헬퍼: 데이터 집계 함수
const aggregateManagementData = (dataList) => {
    const result = {
        revenue: 0,
        orderCount: 0,
        inventoryQtySum: 0,
        inventoryAmtSum: 0,
        daysWithInventory: 0,
        avgInventoryQty: 0,
        avgInventoryAmt: 0
    };

    dataList.forEach(day => {
        const mgmt = day.management || {};
        result.revenue += (Number(mgmt.revenue) || 0);
        result.orderCount += (Number(mgmt.orderCount) || 0);
        
        const invQty = Number(mgmt.inventoryQty) || 0;
        const invAmt = Number(mgmt.inventoryAmt) || 0;

        if (invQty > 0 || invAmt > 0) {
            result.inventoryQtySum += invQty;
            result.inventoryAmtSum += invAmt;
            result.daysWithInventory++;
        }
    });

    if (result.daysWithInventory > 0) {
        result.avgInventoryQty = result.inventoryQtySum / result.daysWithInventory;
        result.avgInventoryAmt = result.inventoryAmtSum / result.daysWithInventory;
    }

    return result;
};


/**
 * 1. 일별 입력 및 조회 화면 렌더링
 */
export const renderManagementDaily = (dateKey, allHistoryData) => {
    const container = document.getElementById('management-view-container');
    const saveBtn = document.getElementById('management-save-btn');
    if (!container) return;

    // 저장 버튼 활성화 및 날짜 데이터 바인딩
    if (saveBtn) {
        saveBtn.classList.remove('hidden');
        saveBtn.dataset.dateKey = dateKey;
    }

    const dayData = allHistoryData.find(d => d.id === dateKey);
    const mgmt = (dayData && dayData.management) ? dayData.management : {};

    // 이전 데이터 찾기 (전일 대비 비교용)
    const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
    const prevDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) 
                        ? allHistoryData[currentIndex + 1] : null;
    const prevMgmt = (prevDayData && prevDayData.management) ? prevDayData.management : {};

    const getValue = (val) => (val !== undefined && val !== null) ? val : '';

    container.innerHTML = `
        <div class="max-w-4xl mx-auto">
            <div class="mb-6 flex items-center justify-between">
                <h3 class="text-xl font-bold text-gray-800 flex items-center gap-2">
                    📅 ${dateKey} 경영 지표 입력
                </h3>
                <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                    * 숫자를 입력하면 전일 대비 증감이 자동 계산됩니다.
                </span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white p-6 rounded-xl border border-blue-100 shadow-sm">
                    <h4 class="font-bold text-blue-800 mb-4 flex items-center">
                        💰 매출 현황
                    </h4>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">일 매출액 (원)</label>
                            <div class="flex items-center gap-2">
                                <input type="number" id="mgmt-input-revenue" class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-right font-bold text-gray-800" 
                                    placeholder="0" value="${getValue(mgmt.revenue)}">
                                <span class="text-sm font-medium w-20 text-right">
                                    ${getDiffHtmlForMetric('totalCost', mgmt.revenue, prevMgmt.revenue)}
                                </span>
                            </div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">주문 건수 (건)</label>
                            <div class="flex items-center gap-2">
                                <input type="number" id="mgmt-input-orderCount" class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-right font-bold text-gray-800" 
                                    placeholder="0" value="${getValue(mgmt.orderCount)}">
                                <span class="text-sm font-medium w-20 text-right">
                                    ${getDiffHtmlForMetric('quantity', mgmt.orderCount, prevMgmt.orderCount)}
                                </span>
                            </div>
                        </div>
                        <div class="pt-3 border-t mt-2">
                            <div class="flex justify-between text-sm">
                                <span class="text-gray-600">건당 평균 매출 (객단가)</span>
                                <span class="font-bold text-gray-800">
                                    ${(Number(mgmt.orderCount) > 0) ? Math.round(Number(mgmt.revenue) / Number(mgmt.orderCount)).toLocaleString() : '0'} 원
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="bg-white p-6 rounded-xl border border-indigo-100 shadow-sm">
                    <h4 class="font-bold text-indigo-800 mb-4 flex items-center">
                        📦 재고 현황
                    </h4>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">총 재고량 (개)</label>
                            <div class="flex items-center gap-2">
                                <input type="number" id="mgmt-input-inventoryQty" class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-right font-bold text-gray-800" 
                                    placeholder="0" value="${getValue(mgmt.inventoryQty)}">
                                <span class="text-sm font-medium w-20 text-right">
                                    ${getDiffHtmlForMetric('quantity', mgmt.inventoryQty, prevMgmt.inventoryQty)}
                                </span>
                            </div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">재고 금액 (원)</label>
                            <div class="flex items-center gap-2">
                                <input type="number" id="mgmt-input-inventoryAmt" class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-right font-bold text-gray-800" 
                                    placeholder="0" value="${getValue(mgmt.inventoryAmt)}">
                                <span class="text-sm font-medium w-20 text-right">
                                    ${getDiffHtmlForMetric('totalCost', mgmt.inventoryAmt, prevMgmt.inventoryAmt)}
                                </span>
                            </div>
                        </div>
                        <div class="pt-3 border-t mt-2">
                            <div class="flex justify-between text-sm">
                                <span class="text-gray-600">재고 순환율 (매출/재고)</span>
                                <span class="font-bold text-indigo-600">
                                    ${(Number(mgmt.inventoryAmt) > 0) ? (Number(mgmt.revenue) / Number(mgmt.inventoryAmt) * 100).toFixed(1) : '0.0'} %
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="mt-8 p-4 bg-yellow-50 border border-yellow-100 rounded-lg text-sm text-yellow-800">
                💡 <strong>Tip:</strong> 입력한 데이터는 우측 상단 <strong>[저장]</strong> 버튼을 눌러야 반영됩니다. 저장된 데이터는 주간/월간 리포트에서 합산되어 분석됩니다.
            </div>
        </div>
    `;
};


/**
 * 2. 기간별(주/월/년) 요약 및 분석 화면 렌더링
 */
export const renderManagementSummary = (viewMode, key, allHistoryData) => {
    const container = document.getElementById('management-view-container');
    const saveBtn = document.getElementById('management-save-btn');
    if (!container) return;

    // 요약 모드에서는 저장 버튼 숨김
    if (saveBtn) saveBtn.classList.add('hidden');

    // 1. 데이터 필터링
    const filteredData = allHistoryData.filter(d => {
        if (viewMode === 'management-weekly') return getWeekOfYear(new Date(d.id)) === key;
        if (viewMode === 'management-monthly') return d.id.startsWith(key);
        if (viewMode === 'management-yearly') return d.id.startsWith(key);
        return false;
    });

    if (filteredData.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10">해당 기간(${key})에 입력된 경영 지표 데이터가 없습니다.</div>`;
        return;
    }

    // 2. 현재 기간 집계
    const currentStats = aggregateManagementData(filteredData);

    // 3. 이전 기간 데이터 찾기 및 집계 (비교용)
    let prevKey = null;
    // 간단하게 이전 키 추정 로직 (정확한 날짜 연산보다는 문자열 기반 처리)
    if (viewMode === 'management-monthly') {
        const [y, m] = key.split('-').map(Number);
        const prevDate = new Date(y, m - 2, 1); // 한 달 전
        prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    } else if (viewMode === 'management-yearly') {
        prevKey = String(Number(key) - 1);
    }
    // (주간 비교는 복잡하므로 생략하거나 필요한 경우 추가 구현)

    let prevStats = null;
    if (prevKey) {
        const prevData = allHistoryData.filter(d => {
            if (viewMode === 'management-monthly') return d.id.startsWith(prevKey);
            if (viewMode === 'management-yearly') return d.id.startsWith(prevKey);
            return false;
        });
        if (prevData.length > 0) {
            prevStats = aggregateManagementData(prevData);
        }
    }

    // 4. 주요 지표 계산
    const turnoverRatio = calculateTurnoverRatio(currentStats.revenue, currentStats.avgInventoryAmt);
    const prevTurnoverRatio = prevStats ? calculateTurnoverRatio(prevStats.revenue, prevStats.avgInventoryAmt) : 0;
    
    const avgOrderPrice = currentStats.orderCount > 0 ? currentStats.revenue / currentStats.orderCount : 0;
    const prevAvgOrderPrice = (prevStats && prevStats.orderCount > 0) ? prevStats.revenue / prevStats.orderCount : 0;

    // 5. 렌더링
    let comparisonTitle = prevKey ? `(vs ${prevKey})` : '(이전 데이터 없음)';

    container.innerHTML = `
        <div class="max-w-5xl mx-auto">
            <h3 class="text-xl font-bold text-gray-800 mb-6 text-center">
                📊 ${key} 경영 성과 요약 <span class="text-sm font-normal text-gray-500 ml-2">${comparisonTitle}</span>
            </h3>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden group hover:border-blue-400 transition">
                    <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition">
                        <svg class="w-16 h-16 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <h4 class="text-sm font-semibold text-gray-500 mb-1">총 매출액</h4>
                    <div class="text-2xl font-extrabold text-gray-800 mb-2">
                        ${formatCurrency(currentStats.revenue)} <span class="text-sm font-medium text-gray-600">원</span>
                    </div>
                    <div class="text-sm">
                        ${getDiffHtmlForMetric('totalCost', currentStats.revenue, prevStats?.revenue)}
                    </div>
                </div>

                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden group hover:border-green-400 transition">
                    <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition">
                        <svg class="w-16 h-16 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                    </div>
                    <h4 class="text-sm font-semibold text-gray-500 mb-1">총 주문 건수</h4>
                    <div class="text-2xl font-extrabold text-gray-800 mb-2">
                        ${formatCurrency(currentStats.orderCount)} <span class="text-sm font-medium text-gray-600">건</span>
                    </div>
                    <div class="text-sm">
                        ${getDiffHtmlForMetric('quantity', currentStats.orderCount, prevStats?.orderCount)}
                    </div>
                </div>

                <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden group hover:border-purple-400 transition">
                    <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition">
                        <svg class="w-16 h-16 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    </div>
                    <h4 class="text-sm font-semibold text-gray-500 mb-1">재고 순환율 (회전율)</h4>
                    <div class="text-2xl font-extrabold text-purple-600 mb-2">
                        ${turnoverRatio.toFixed(2)} <span class="text-sm font-medium text-gray-500">회</span>
                    </div>
                    <div class="text-sm">
                        ${getDiffHtmlForMetric('efficiencyRatio', turnoverRatio, prevTurnoverRatio)}
                    </div>
                    <p class="text-[10px] text-gray-400 mt-1">* 매출액 ÷ 평균 재고금액</p>
                </div>
            </div>

            <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table class="w-full text-sm text-left text-gray-600">
                    <thead class="bg-gray-50 text-gray-700 font-bold border-b">
                        <tr>
                            <th class="px-6 py-3">지표 항목</th>
                            <th class="px-6 py-3 text-right">이번 기간 (${key})</th>
                            <th class="px-6 py-3 text-right">이전 기간 (${prevKey || '-'})</th>
                            <th class="px-6 py-3 text-right">증감</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        <tr class="hover:bg-gray-50">
                            <td class="px-6 py-3 font-medium">객단가 (건당 평균 매출)</td>
                            <td class="px-6 py-3 text-right font-bold">${Math.round(avgOrderPrice).toLocaleString()} 원</td>
                            <td class="px-6 py-3 text-right text-gray-500">${Math.round(prevAvgOrderPrice).toLocaleString()} 원</td>
                            <td class="px-6 py-3 text-right">${getDiffHtmlForMetric('totalCost', avgOrderPrice, prevAvgOrderPrice)}</td>
                        </tr>
                        <tr class="hover:bg-gray-50">
                            <td class="px-6 py-3 font-medium">평균 재고 금액</td>
                            <td class="px-6 py-3 text-right font-bold">${Math.round(currentStats.avgInventoryAmt).toLocaleString()} 원</td>
                            <td class="px-6 py-3 text-right text-gray-500">${Math.round(prevStats?.avgInventoryAmt || 0).toLocaleString()} 원</td>
                            <td class="px-6 py-3 text-right">${getDiffHtmlForMetric('totalCost', currentStats.avgInventoryAmt, prevStats?.avgInventoryAmt)}</td>
                        </tr>
                        <tr class="hover:bg-gray-50">
                            <td class="px-6 py-3 font-medium">평균 재고 수량</td>
                            <td class="px-6 py-3 text-right font-bold">${Math.round(currentStats.avgInventoryQty).toLocaleString()} 개</td>
                            <td class="px-6 py-3 text-right text-gray-500">${Math.round(prevStats?.avgInventoryQty || 0).toLocaleString()} 개</td>
                            <td class="px-6 py-3 text-right">${getDiffHtmlForMetric('quantity', currentStats.avgInventoryQty, prevStats?.avgInventoryQty)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
};