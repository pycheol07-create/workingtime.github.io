// === js/history-enricher.js ===
// 설명: 이력 데이터에 연차/휴무 정보를 병합하는 순수 데이터 처리 로직입니다.

export function augmentHistoryWithPersistentLeave(historyData, leaveSchedule) {
    if (!leaveSchedule || !leaveSchedule.onLeaveMembers) {
        return historyData;
    }

    const leaves = Array.isArray(leaveSchedule.onLeaveMembers) 
        ? leaveSchedule.onLeaveMembers 
        : (leaveSchedule.onLeaveMembers ? Object.values(leaveSchedule.onLeaveMembers) : []);

    if (leaves.length === 0) {
        return historyData;
    }

    // 🟢 1. '외근', '재택근무' 등 누락된 근태 항목을 모두 통과하도록 조건 완화
    const persistentLeaves = leaves.filter(
        entry => entry.startDate || ['연차', '출장', '결근', '매장근무', '외근', '재택근무', '휴직', '공가'].includes(entry.type)
    );

    if (persistentLeaves.length === 0) return historyData;

    const existingEntriesMap = new Map();
    
    historyData.forEach(day => {
        const entries = new Set();
        const dayLeaves = Array.isArray(day.onLeaveMembers) 
            ? day.onLeaveMembers 
            : (day.onLeaveMembers ? Object.values(day.onLeaveMembers) : []);

        dayLeaves.forEach(entry => {
            if (entry.startDate || ['연차', '출장', '결근', '매장근무', '외근', '재택근무', '휴직'].includes(entry.type)) {
                entries.add(`${entry.member}::${entry.type}`);
            }
        });
        existingEntriesMap.set(day.id, entries);
    });

    persistentLeaves.forEach(pLeave => {
        if (!pLeave.startDate) return;

        const [sY, sM, sD] = pLeave.startDate.split('-').map(Number);
        const effectiveEndDate = pLeave.endDate || pLeave.startDate;
        const [eY, eM, eD] = effectiveEndDate.split('-').map(Number);

        const startDate = new Date(Date.UTC(sY, sM - 1, sD));
        const endDate = new Date(Date.UTC(eY, eM - 1, eD));

        for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
            // 주말(일요일, 토요일)은 무시
            const dayOfWeek = d.getUTCDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) continue;

            const dateKey = d.toISOString().slice(0, 10);
            let dayData = historyData.find(day => day.id === dateKey);
            
            // 🟢 2. 업무 기록(dayData)이 없는 날이더라도, 연차/매장근무 기록을 띄우기 위해 빈 날짜 객체를 강제 생성
            if (!dayData) {
                dayData = { id: dateKey, onLeaveMembers: [] };
                historyData.push(dayData);
                existingEntriesMap.set(dateKey, new Set());
            }

            const existingEntries = existingEntriesMap.get(dateKey);

            if (dayData && existingEntries) {
                const entryKey = `${pLeave.member}::${pLeave.type}`;
                if (!existingEntries.has(entryKey)) {
                    if (!dayData.onLeaveMembers) {
                        dayData.onLeaveMembers = [];
                    }
                    if (!Array.isArray(dayData.onLeaveMembers)) {
                        dayData.onLeaveMembers = Object.values(dayData.onLeaveMembers);
                    }
                    
                    dayData.onLeaveMembers.push({ ...pLeave });
                    existingEntries.add(entryKey);
                }
            }
        }
    });

    // 🟢 3. 새롭게 추가된 날짜들이 달력이나 리스트에서 꼬이지 않도록 날짜 최신순으로 다시 정렬
    historyData.sort((a, b) => b.id.localeCompare(a.id));

    return historyData;
}