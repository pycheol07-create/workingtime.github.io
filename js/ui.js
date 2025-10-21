// === ui.js (ver.2.1 — 휴무 유형/시간 표시 지원 완성본) ===
// 변경 요약:
// - onLeaveMembers 구조 변경({name,type,start,end}) 호환
// - renderRealtimeStatus(): 이름 옆에 “조퇴(14:00~18:00)” 등 표시
// - updateSummary(): 휴무 객체 배열 기반 집계
// - 기존 기능(완료 로그, 분석)은 그대로 유지

import { formatDuration } from './utils.js';
import { teamGroups } from './config.js';

// ✅ 휴무 상태 문구 생성: "조퇴 (14:00~18:00)" / "외출 중 (10:00~)" / "연차"
const formatLeaveDisplay = (leave) => {
  if (!leave) return '휴무';
  const { type, start, end } = leave || {};
  if (type === '외출' && start && !end) return `${type} 중 (${start}~)`;
  if (start && end) return `${type} (${start}~${end})`;
  return type || '휴무';
};

// ✅ 팀원 이름으로 휴무 객체 찾기 (문자열 형태도 하위 호환)
const findLeaveInfo = (memberName, onLeaveMembers) => {
  if (!Array.isArray(onLeaveMembers)) return null;
  const found = onLeaveMembers.find(m => (typeof m === 'string' ? m === memberName : m?.name === memberName));
  if (!found) return null;
  return typeof found === 'string' ? { name: found, type: '휴무', start: '', end: '' } : found;
};

// ✅ 실시간 현황판 — 휴무 유형/시간 뱃지 표시 버전
export const renderRealtimeStatus = (appState) => {
  const board = document.getElementById('team-status-board');
  if (!board) return;
  board.innerHTML = '';

  const { workRecords = [], onLeaveMembers = [], partTimers = [] } = appState;

  // 현재 업무 중인 멤버
  const activeMembers = new Set(
    workRecords
      .filter(r => r.status === 'ongoing' || r.status === 'paused')
      .map(r => r.member)
  );

  // 정규 팀원 카드
  teamGroups.forEach(group => {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow p-4';

    const groupTitle = `<h3 class="font-bold text-lg text-gray-800 mb-2">${group.name}</h3>`;

    const membersHtml = (group.members || []).map(member => {
      const isWorking = activeMembers.has(member);
      const leaveInfo = findLeaveInfo(member, onLeaveMembers);
      const leaveLabel = leaveInfo ? formatLeaveDisplay(leaveInfo) : '';
      const workingCls = isWorking ? 'text-blue-600 font-semibold' : '';
      const leaveBadgeCls = leaveInfo ? 'bg-gray-100 text-gray-600 rounded px-2 py-0.5 text-xs ml-2' : '';

      return `
        <div class="flex justify-between items-center py-0.5">
          <!-- 이름 클릭 시 app.js의 openLeaveModal(member) 실행 -->
          <button data-member-toggle-leave="${member}" class="text-left flex-1 ${workingCls}">
            ${member}
            ${leaveInfo ? `<span class="${leaveBadgeCls}">${leaveLabel}</span>` : ''}
          </button>
        </div>`;
    }).join('');

    card.innerHTML = groupTitle + `<div class="divide-y divide-gray-100">${membersHtml}</div>`;
    board.appendChild(card);
  });

  // 알바 팀 카드
  if ((partTimers || []).length > 0) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow p-4';

    const groupTitle = `<h3 class="font-bold text-lg text-gray-800 mb-2">알바</h3>`;

    const membersHtml = partTimers.map(p => {
      const name = p.name;
      const isWorking = activeMembers.has(name);
      const leaveInfo = findLeaveInfo(name, onLeaveMembers);
      const leaveLabel = leaveInfo ? formatLeaveDisplay(leaveInfo) : '';
      const workingCls = isWorking ? 'text-blue-600 font-semibold' : '';
      const leaveBadgeCls = leaveInfo ? 'bg-gray-100 text-gray-600 rounded px-2 py-0.5 text-xs ml-2' : '';

      return `
        <div class="flex justify-between items-center py-0.5">
          <button data-member-toggle-leave="${name}" class="text-left flex-1 ${workingCls}">
            ${name}
            ${leaveInfo ? `<span class="${leaveBadgeCls}">${leaveLabel}</span>` : ''}
          </button>
        </div>`;
    }).join('');

    card.innerHTML = groupTitle + `<div class="divide-y divide-gray-100">${membersHtml}</div>`;
    board.appendChild(card);
  }
};

// ✅ 완료 로그
export const renderCompletedWorkLog = (appState) => {
  const container = document.getElementById('work-log-body');
  if (!container) return;
  const completed = (appState.workRecords || []).filter(r => r.status === 'completed');
  container.innerHTML = '';
  if (completed.length === 0) {
    container.innerHTML = `<div class="text-center text-gray-500 text-sm py-4">완료된 업무가 없습니다.</div>`;
    return;
  }
  completed.sort((a, b) => b.endTime.localeCompare(a.endTime));
  completed.forEach(r => {
    const item = document.createElement('div');
    item.className = 'flex justify-between text-sm border-b pb-1';
    item.innerHTML = `
      <div><span class="font-semibold">${r.member}</span> — ${r.task}</div>
      <div class="text-gray-500">${formatDuration(r.duration)}</div>`;
    container.appendChild(item);
  });
};

// ✅ 요약판 — 휴무(객체 배열) / 근무중 / 총 완료시간 표시
export const updateSummary = (appState) => {
  const summaryLeaveStaffEl = document.getElementById('summary-leave-staff');
  const summaryWorkingStaffEl = document.getElementById('summary-working-staff');
  const summaryTotalWorkTimeEl = document.getElementById('summary-total-work-time');

  const allStaffMembers = new Set((window.teamGroups || teamGroups).flatMap(g => g.members));
  const totalStaffCount = allStaffMembers.size;

  // ✅ 휴무 인원 수 (객체 배열)
  const leaveCount = Array.isArray(appState.onLeaveMembers) ? appState.onLeaveMembers.length : 0;
  if (summaryLeaveStaffEl) summaryLeaveStaffEl.textContent = `${leaveCount}`;

  // ✅ 근무중 인원
  const workingMembers = new Set(
    (appState.workRecords || [])
      .filter(r => r.status === 'ongoing' || r.status === 'paused')
      .map(r => r.member)
  );
  if (summaryWorkingStaffEl) summaryWorkingStaffEl.textContent = `${workingMembers.size}`;

  // ✅ 완료 업무 총 시간
  const completedMinutes = (appState.workRecords || [])
    .filter(r => r.status === 'completed')
    .reduce((sum, r) => sum + (r.duration || 0), 0);
  if (summaryTotalWorkTimeEl) summaryTotalWorkTimeEl.textContent = formatDuration(completedMinutes);
};

// ✅ 업무 분석 — 각 업무별 시간 비중 표시
export const renderTaskAnalysis = (appState) => {
  const el = document.getElementById('task-analysis');
  if (!el) return;
  const { workRecords = [] } = appState;
  if (workRecords.length === 0) {
    el.innerHTML = `<div class="text-center text-gray-500 text-sm py-4">데이터가 없습니다.</div>`;
    return;
  }
  const total = workRecords.reduce((s, r) => s + (r.duration || 0), 0);
  const byTask = {};
  workRecords.forEach(r => { byTask[r.task] = (byTask[r.task] || 0) + (r.duration || 0); });

  el.innerHTML = `
    <div class="space-y-2">
      ${Object.entries(byTask).sort(([,a],[,b]) => b-a).map(([task, min]) => {
        const pct = total > 0 ? ((min/total)*100).toFixed(1) : 0;
        return `<div class="flex justify-between text-sm">
          <span class="font-semibold text-gray-700">${task}</span>
          <span>${formatDuration(min)} (${pct}%)</span>
        </div>`;
      }).join('')}
    </div>`;
};
