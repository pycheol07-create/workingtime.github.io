// === js/app-history-logic.js ===
import * as State from './state.js';
import { getWeekOfYear } from './utils.js';

// 이력 데이터에 연차/근태 정보를 병합하는 핵심 로직
export const augmentHistoryWithPersistentLeave = (historyData, leaveSchedule) => {
    if (!historyData || !Array.isArray(historyData)) return;
    
    historyData.forEach(day => {
        const dateStr = day.id;
        const leaveInfo = leaveSchedule ? leaveSchedule[dateStr] : null;
        
        if (leaveInfo) {
            day.onLeaveMembers = leaveInfo.members || [];
        } else {
            day.onLeaveMembers = [];
        }
    });
};

// 특정 날짜의 Firestore 문서 경로 생성
export const getDailyDocRef = (dateKey) => {
    const date = dateKey || new Date().toISOString().split('T')[0];
    return import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
        .then(({ doc, getFirestore }) => {
            const db = getFirestore();
            return doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', date);
        });
};

// 일별 상세 렌더링 로직 (데이터를 받아 HTML로 변환)
export const renderHistoryDetail = (dateKey, previousDayData) => {
    const container = document.getElementById('history-daily-view');
    if (!container) return;
    
    const dayData = State.allHistoryData.find(d => d.id === dateKey);
    if (!dayData) {
        container.innerHTML = `<div class="p-8 text-center text-gray-400">선택한 날짜(${dateKey})의 데이터가 없습니다.</div>`;
        return;
    }

    // UI 렌더링을 위해 데이터를 HTML 문자열로 변환 (기존 로직 유지)
    const records = dayData.workRecords || [];
    let html = `
        <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <h3 class="font-bold text-lg mb-4">${dateKey} 업무 상세</h3>
            <table class="w-full text-sm">
                <thead>
                    <tr class="text-gray-500 border-b">
                        <th class="py-2 text-left">직원</th>
                        <th class="py-2 text-left">업무명</th>
                        <th class="py-2 text-right">소요시간(분)</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    if (records.length === 0) {
        html += `<tr><td colspan="3" class="py-4 text-center text-gray-400">기록된 업무가 없습니다.</td></tr>`;
    } else {
        records.forEach(r => {
            html += `
                <tr class="border-b">
                    <td class="py-2 font-medium">${r.member}</td>
                    <td class="py-2">${r.taskName || '-'}</td>
                    <td class="py-2 text-right">${r.duration || 0}</td>
                </tr>
            `;
        });
    }
    html += `</tbody></table></div>`;
    container.innerHTML = html;
};

// 데이터 정합성 검사 (통계용)
export const checkMissingQuantities = (dayData) => {
    const missing = [];
    if (!dayData.taskQuantities) return missing;
    
    // 업무 유형별로 데이터 확인
    Object.keys(State.appConfig.quantityTaskTypes || {}).forEach(type => {
        if (!(type in dayData.taskQuantities) && !(dayData.confirmedZeroTasks || []).includes(type)) {
            missing.push(type);
        }
    });
    return missing;
};