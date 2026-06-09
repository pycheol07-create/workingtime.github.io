// === js/ui-history-milestones.js ===
// 📍 운영 마일스톤 관리: 변경사항 기록 + before/after KPI 자동 비교

import * as State from './state.js';
import { showToast, getTodayDateString } from './utils.js';
import {
    doc, collection, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const TYPE_LABELS = {
    location_change: { label: '🗺️ 로케이션 변경', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
    staffing:        { label: '👥 인력 변화',     color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    process:         { label: '🔧 프로세스',      color: 'bg-amber-100 text-amber-800 border-amber-300' },
    inflow:          { label: '📦 입출고 패턴',   color: 'bg-orange-100 text-orange-800 border-orange-300' },
    policy:          { label: '🎯 정책',          color: 'bg-purple-100 text-purple-800 border-purple-300' },
    system:          { label: '⚙️ 시스템/장비',   color: 'bg-gray-100 text-gray-800 border-gray-300' },
    memo:            { label: '📝 기타 메모',     color: 'bg-blue-100 text-blue-800 border-blue-300' }
};

// 메모리 캐시 (firestore에서 onSnapshot으로 갱신)
let _milestones = [];
let _filterType = 'all';
let _currentCompareWindow = 14;
let _currentCompareTarget = null; // 비교 모달이 보고 있는 마일스톤
let _unsubMilestones = null;

const colRef = () => collection(State.db, 'artifacts', 'team-work-logger-v2', 'operationMilestones');

// ============================================================
// 데이터 로드 (실시간)
// ============================================================
export function subscribeMilestones() {
    if (_unsubMilestones) return; // 중복 구독 방지
    _unsubMilestones = onSnapshot(colRef(), (snap) => {
        _milestones = [];
        snap.forEach(d => _milestones.push({ id: d.id, ...d.data() }));
        _milestones.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        renderList();
        // 비교 모달이 열려 있고 해당 마일스톤이 갱신되었으면 비교도 재렌더
        if (_currentCompareTarget) {
            const updated = _milestones.find(m => m.id === _currentCompareTarget.id);
            if (updated) {
                _currentCompareTarget = updated;
                renderCompareResults();
            }
        }
    }, (err) => {
        console.error('milestones subscribe failed:', err);
    });
}

// ============================================================
// 리스트 렌더링
// ============================================================
function renderList() {
    const listEl = document.getElementById('milestone-list');
    const emptyEl = document.getElementById('milestone-empty-state');
    if (!listEl) return;

    const filtered = _filterType === 'all'
        ? _milestones
        : _milestones.filter(m => m.type === _filterType);

    if (filtered.length === 0) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
    } else {
        if (emptyEl) emptyEl.classList.add('hidden');
        listEl.innerHTML = filtered.map(m => {
            const typeInfo = TYPE_LABELS[m.type] || TYPE_LABELS.memo;
            const tagHtml = (m.tags || []).map(t => `<span class="inline-block bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-[10px] px-2 py-0.5 rounded-full">${escapeHtml(t)}</span>`).join('');
            const taskHtml = (m.affectedTasks || []).map(t => `<span class="inline-block bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] px-2 py-0.5 rounded">${escapeHtml(t)}</span>`).join('');
            const descPreview = (m.description || '').slice(0, 100) + ((m.description || '').length > 100 ? '...' : '');
            return `
                <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition">
                    <div class="flex justify-between items-start gap-3 flex-wrap">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 flex-wrap mb-1">
                                <span class="inline-block ${typeInfo.color} border text-xs font-bold px-2 py-0.5 rounded-full">${typeInfo.label}</span>
                                <span class="text-xs text-gray-500 dark:text-gray-400 font-mono">📅 ${m.date || '-'}</span>
                            </div>
                            <div class="font-bold text-gray-800 dark:text-gray-100 text-base">${escapeHtml(m.title || '(제목 없음)')}</div>
                            ${descPreview ? `<div class="text-xs text-gray-600 dark:text-gray-400 mt-1">${escapeHtml(descPreview)}</div>` : ''}
                            <div class="flex flex-wrap gap-1 mt-2">${tagHtml}</div>
                            ${taskHtml ? `<div class="flex flex-wrap gap-1 mt-1"><span class="text-[10px] text-gray-500">영향:</span>${taskHtml}</div>` : ''}
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button data-action="compare" data-id="${m.id}" class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-1.5 px-3 rounded-lg shadow-sm">📊 효과 비교</button>
                            <button data-action="edit" data-id="${m.id}" class="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs font-bold py-1.5 px-3 rounded-lg">✏️</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
    renderTypeFilters();
}

function renderTypeFilters() {
    const el = document.getElementById('milestone-type-filters');
    if (!el) return;
    const counts = { all: _milestones.length };
    _milestones.forEach(m => { counts[m.type] = (counts[m.type] || 0) + 1; });
    const types = ['all', ...Object.keys(TYPE_LABELS)];
    el.innerHTML = types.map(t => {
        const isActive = _filterType === t;
        const label = t === 'all' ? `전체 (${counts.all || 0})` : `${TYPE_LABELS[t].label} (${counts[t] || 0})`;
        const cls = isActive
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400';
        return `<button data-filter="${t}" class="milestone-filter-btn border ${cls} px-3 py-1.5 rounded-full font-bold transition">${label}</button>`;
    }).join('');
}

const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

// ============================================================
// 등록/수정 모달
// ============================================================
export function openEditModal(milestoneId = null, presetData = null) {
    const modal = document.getElementById('milestone-edit-modal');
    if (!modal) return;
    const existing = milestoneId ? _milestones.find(m => m.id === milestoneId) : null;
    const data = existing || presetData || {};

    document.getElementById('milestone-edit-id').value = milestoneId || '';
    document.getElementById('milestone-edit-title').textContent = existing ? '✏️ 마일스톤 수정' : '📍 새 마일스톤 등록';
    document.getElementById('milestone-edit-date').value = data.date || getTodayDateString();
    document.getElementById('milestone-edit-type').value = data.type || 'location_change';
    document.getElementById('milestone-edit-title-input').value = data.title || '';
    document.getElementById('milestone-edit-description').value = data.description || '';
    document.getElementById('milestone-edit-tags').value = (data.tags || []).join(', ');

    // 영향 받는 업무 체크박스 — keyTasks 기준
    const tasksEl = document.getElementById('milestone-edit-tasks');
    const keyTasks = State.appConfig?.keyTasks || ['국내배송', '중국제작', '직진배송', '채우기'];
    const checkedSet = new Set(data.affectedTasks || []);
    tasksEl.innerHTML = keyTasks.map(t => `
        <label class="inline-flex items-center gap-1.5 cursor-pointer bg-gray-100 dark:bg-gray-700 hover:bg-blue-100 dark:hover:bg-blue-900/30 px-3 py-1.5 rounded-full transition">
            <input type="checkbox" value="${escapeHtml(t)}" ${checkedSet.has(t) ? 'checked' : ''} class="milestone-task-chk">
            <span class="text-xs font-bold">${escapeHtml(t)}</span>
        </label>
    `).join('');

    document.getElementById('milestone-edit-delete-btn').classList.toggle('hidden', !existing);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

async function saveMilestone() {
    const id = document.getElementById('milestone-edit-id').value;
    const date = document.getElementById('milestone-edit-date').value;
    const type = document.getElementById('milestone-edit-type').value;
    const title = document.getElementById('milestone-edit-title-input').value.trim();
    const description = document.getElementById('milestone-edit-description').value.trim();
    const tags = document.getElementById('milestone-edit-tags').value.split(',').map(s => s.trim()).filter(Boolean);
    const affectedTasks = Array.from(document.querySelectorAll('.milestone-task-chk:checked')).map(c => c.value);

    if (!date) { showToast('일자를 선택해주세요.', true); return; }
    if (!title) { showToast('제목을 입력해주세요.', true); return; }

    const payload = {
        date, type, title, description, tags, affectedTasks,
        updatedAt: serverTimestamp(),
        updatedBy: State.appState?.currentUser || 'unknown'
    };
    if (!id) {
        payload.createdAt = serverTimestamp();
        payload.createdBy = payload.updatedBy;
    }

    try {
        const newId = id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await setDoc(doc(colRef(), newId), payload, { merge: !!id });
        showToast(id ? '마일스톤이 수정되었습니다.' : '마일스톤이 등록되었습니다.');
        const modal = document.getElementById('milestone-edit-modal');
        modal.classList.add('hidden'); modal.classList.remove('flex');
    } catch (e) {
        console.error('milestone save error:', e);
        showToast('저장 실패: ' + (e.message || e), true);
    }
}

async function deleteMilestone(id) {
    if (!confirm('이 마일스톤을 삭제하시겠습니까?')) return;
    try {
        await deleteDoc(doc(colRef(), id));
        showToast('삭제되었습니다.');
        const modal = document.getElementById('milestone-edit-modal');
        modal.classList.add('hidden'); modal.classList.remove('flex');
    } catch (e) {
        console.error('milestone delete error:', e);
        showToast('삭제 실패: ' + (e.message || e), true);
    }
}

// ============================================================
// before/after KPI 비교
// ============================================================
/**
 * 기간 윈도우의 KPI 평균 계산.
 * @param {string} startDate YYYY-MM-DD (포함)
 * @param {string} endDate   YYYY-MM-DD (포함)
 * @param {string[]} taskFilter — 빈 배열이면 모든 업무, 채워져 있으면 해당 업무만
 */
function computeKpiWindow(startDate, endDate, taskFilter = []) {
    const filter = new Set(taskFilter);
    const useFilter = filter.size > 0;
    const days = (State.allHistoryData || []).filter(d => d.id >= startDate && d.id <= endDate);

    let totalDuration = 0; // 분
    let totalQty = 0;
    let totalCost = 0;
    let dayCount = 0;
    const memberSet = new Set();
    const perTaskAgg = {}; // task → { duration, qty }

    days.forEach(day => {
        const records = day.workRecords || [];
        if (records.length === 0) return;
        let dayHasData = false;
        records.forEach(r => {
            if (useFilter) {
                const matched = [...filter].some(t => (r.taskType && r.taskType.includes(t)) || (r.task && r.task.includes(t)));
                if (!matched) return;
            }
            totalDuration += (r.duration || 0);
            if (r.member) memberSet.add(r.member);
            const taskName = r.task || r.taskType || '기타';
            if (!perTaskAgg[taskName]) perTaskAgg[taskName] = { duration: 0, qty: 0 };
            perTaskAgg[taskName].duration += (r.duration || 0);
            dayHasData = true;
        });
        const qtyMap = day.taskQuantities || {};
        Object.entries(qtyMap).forEach(([k, v]) => {
            const num = Number(v) || 0;
            if (useFilter) {
                const matched = [...filter].some(t => k.includes(t));
                if (!matched) return;
            }
            totalQty += num;
            const key = k;
            if (!perTaskAgg[key]) perTaskAgg[key] = { duration: 0, qty: 0 };
            perTaskAgg[key].qty += num;
            dayHasData = true;
        });
        if (dayHasData) dayCount++;
    });

    const hours = totalDuration / 60;
    const uph = hours > 0 ? totalQty / hours : 0;

    return {
        dayCount,
        totalDuration,
        totalQty,
        uph,
        memberCount: memberSet.size,
        avgQtyPerDay: dayCount > 0 ? totalQty / dayCount : 0,
        avgDurationPerDay: dayCount > 0 ? totalDuration / dayCount : 0,
        perTaskAgg
    };
}

function addDaysStr(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

export function openCompareModal(milestoneId) {
    const m = _milestones.find(x => x.id === milestoneId);
    if (!m) { showToast('마일스톤을 찾을 수 없습니다.', true); return; }
    _currentCompareTarget = m;
    document.getElementById('milestone-compare-title').textContent = `📊 ${m.title}`;
    const typeInfo = TYPE_LABELS[m.type] || TYPE_LABELS.memo;
    document.getElementById('milestone-compare-subtitle').textContent = `${typeInfo.label} · 기준일: ${m.date}`;
    // 기본 14일 윈도우
    _currentCompareWindow = 14;
    document.querySelectorAll('.milestone-compare-window-btn').forEach(b => {
        const w = Number(b.dataset.window);
        if (w === _currentCompareWindow) b.classList.add('bg-blue-600', 'text-white');
        else b.classList.remove('bg-blue-600', 'text-white');
    });
    renderCompareResults();
    const modal = document.getElementById('milestone-compare-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function renderCompareResults() {
    const el = document.getElementById('milestone-compare-results');
    if (!el || !_currentCompareTarget) return;
    const m = _currentCompareTarget;
    const w = _currentCompareWindow;

    const beforeEnd = addDaysStr(m.date, -1);
    const beforeStart = addDaysStr(m.date, -w);
    const afterStart = m.date;
    const afterEnd = addDaysStr(m.date, w - 1);

    const taskFilter = m.affectedTasks && m.affectedTasks.length > 0 ? m.affectedTasks : [];
    const before = computeKpiWindow(beforeStart, beforeEnd, taskFilter);
    const after = computeKpiWindow(afterStart, afterEnd, taskFilter);

    const today = getTodayDateString();
    const afterDaysObserved = after.dayCount;
    const afterFullDays = Math.min(w, Math.max(0, Math.floor((new Date(today + 'T00:00:00') - new Date(m.date + 'T00:00:00')) / (24 * 60 * 60 * 1000)) + 1));

    const pctChange = (b, a) => b === 0 ? (a > 0 ? Infinity : 0) : ((a - b) / b) * 100;
    const fmtPct = (v) => isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '∞';
    const colorOf = (v, betterIfHigh = true) => {
        if (!isFinite(v) || v === 0) return 'text-gray-500';
        const good = (betterIfHigh && v > 0) || (!betterIfHigh && v < 0);
        return good ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold';
    };
    const arrow = (v, betterIfHigh = true) => {
        if (!isFinite(v) || Math.abs(v) < 0.1) return '—';
        const good = (betterIfHigh && v > 0) || (!betterIfHigh && v < 0);
        return good ? '✅' : '⚠️';
    };

    const tasksDisplay = taskFilter.length > 0 ? taskFilter.join(', ') : '전체 업무';

    // 업무별 비교 행
    const taskRows = [];
    if (taskFilter.length > 0) {
        taskFilter.forEach(t => {
            const bAgg = Object.entries(before.perTaskAgg).filter(([k]) => k.includes(t)).reduce((acc, [, v]) => ({ duration: acc.duration + v.duration, qty: acc.qty + v.qty }), { duration: 0, qty: 0 });
            const aAgg = Object.entries(after.perTaskAgg).filter(([k]) => k.includes(t)).reduce((acc, [, v]) => ({ duration: acc.duration + v.duration, qty: acc.qty + v.qty }), { duration: 0, qty: 0 });
            const bUph = bAgg.duration > 0 ? bAgg.qty / (bAgg.duration / 60) : 0;
            const aUph = aAgg.duration > 0 ? aAgg.qty / (aAgg.duration / 60) : 0;
            const bAvg = before.dayCount > 0 ? bAgg.qty / before.dayCount : 0;
            const aAvg = after.dayCount > 0 ? aAgg.qty / after.dayCount : 0;
            taskRows.push(`
                <tr class="border-b border-gray-100 dark:border-gray-700">
                    <td class="px-3 py-2 font-bold text-gray-800 dark:text-gray-100">${escapeHtml(t)}</td>
                    <td class="px-3 py-2 text-right text-gray-600 dark:text-gray-300">${bUph.toFixed(1)}</td>
                    <td class="px-3 py-2 text-right text-gray-600 dark:text-gray-300">${aUph.toFixed(1)}</td>
                    <td class="px-3 py-2 text-right ${colorOf(pctChange(bUph, aUph))}">${fmtPct(pctChange(bUph, aUph))} ${arrow(pctChange(bUph, aUph))}</td>
                    <td class="px-3 py-2 text-right text-gray-600 dark:text-gray-300">${Math.round(bAvg).toLocaleString()}</td>
                    <td class="px-3 py-2 text-right text-gray-600 dark:text-gray-300">${Math.round(aAvg).toLocaleString()}</td>
                    <td class="px-3 py-2 text-right ${colorOf(pctChange(bAvg, aAvg))}">${fmtPct(pctChange(bAvg, aAvg))} ${arrow(pctChange(bAvg, aAvg))}</td>
                </tr>
            `);
        });
    }

    // 종합
    const uphChange = pctChange(before.uph, after.uph);
    const qtyChange = pctChange(before.avgQtyPerDay, after.avgQtyPerDay);
    const durChange = pctChange(before.avgDurationPerDay, after.avgDurationPerDay);

    el.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50">
                <div class="text-xs text-gray-500 mb-1">⬅️ Before (${beforeStart} ~ ${beforeEnd})</div>
                <div class="text-2xl font-extrabold text-gray-800 dark:text-gray-100">${before.dayCount} <span class="text-xs font-medium text-gray-500">/ ${w} 일</span></div>
                <div class="text-xs text-gray-500 mt-1">관측된 데이터 일수</div>
            </div>
            <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-emerald-50 dark:bg-emerald-900/20">
                <div class="text-xs text-gray-500 mb-1">➡️ After (${afterStart} ~ ${afterEnd})</div>
                <div class="text-2xl font-extrabold text-gray-800 dark:text-gray-100">${after.dayCount} <span class="text-xs font-medium text-gray-500">/ ${afterFullDays} 일</span></div>
                <div class="text-xs text-gray-500 mt-1">관측된 데이터 일수</div>
            </div>
        </div>

        <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
                <div class="text-[10px] text-gray-500 font-bold">전체 UPH (시간당 처리)</div>
                <div class="text-sm text-gray-600 dark:text-gray-300">${before.uph.toFixed(1)} → ${after.uph.toFixed(1)}</div>
                <div class="text-base ${colorOf(uphChange)}">${fmtPct(uphChange)} ${arrow(uphChange)}</div>
            </div>
            <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
                <div class="text-[10px] text-gray-500 font-bold">일평균 처리량</div>
                <div class="text-sm text-gray-600 dark:text-gray-300">${Math.round(before.avgQtyPerDay).toLocaleString()} → ${Math.round(after.avgQtyPerDay).toLocaleString()}</div>
                <div class="text-base ${colorOf(qtyChange)}">${fmtPct(qtyChange)} ${arrow(qtyChange)}</div>
            </div>
            <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
                <div class="text-[10px] text-gray-500 font-bold">일평균 작업시간</div>
                <div class="text-sm text-gray-600 dark:text-gray-300">${Math.round(before.avgDurationPerDay)}분 → ${Math.round(after.avgDurationPerDay)}분</div>
                <div class="text-base ${colorOf(durChange, false)}">${fmtPct(durChange)} ${arrow(durChange, false)}</div>
            </div>
        </div>

        ${taskRows.length > 0 ? `
            <div class="mt-5 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div class="bg-gray-100 dark:bg-gray-800 px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-200">업무별 상세 (영향: ${escapeHtml(tasksDisplay)})</div>
                <table class="w-full text-xs">
                    <thead class="bg-gray-50 dark:bg-gray-800/50 text-gray-500">
                        <tr>
                            <th class="px-3 py-2 text-left">업무</th>
                            <th class="px-3 py-2 text-right">UPH(전)</th>
                            <th class="px-3 py-2 text-right">UPH(후)</th>
                            <th class="px-3 py-2 text-right">UPH 변화</th>
                            <th class="px-3 py-2 text-right">일평균(전)</th>
                            <th class="px-3 py-2 text-right">일평균(후)</th>
                            <th class="px-3 py-2 text-right">처리량 변화</th>
                        </tr>
                    </thead>
                    <tbody>${taskRows.join('')}</tbody>
                </table>
            </div>
        ` : '<div class="mt-5 text-xs text-gray-500 italic">※ 영향 받는 업무를 지정하면 업무별 세부 비교가 표시됩니다.</div>'}

        <div class="mt-5 text-[11px] text-gray-500 leading-relaxed">
            ℹ️ 비교 기간: 기준일 전 ${w}일 ↔ 후 ${w}일 (관측 일수가 적으면 ⚠️ 통계적 노이즈 가능성).<br>
            ℹ️ "UPH 변화 ✅"는 시간당 처리량이 증가했음을 의미합니다. "작업시간 ✅"은 일평균 작업시간이 감소했음을 의미합니다.
        </div>
    `;
}

// ============================================================
// 이벤트 바인딩 (한 번만)
// ============================================================
let _bound = false;
export function bindMilestoneListeners() {
    if (_bound) return;
    _bound = true;

    document.getElementById('milestone-add-btn')?.addEventListener('click', () => openEditModal(null));
    document.getElementById('milestone-edit-save-btn')?.addEventListener('click', saveMilestone);
    document.getElementById('milestone-edit-delete-btn')?.addEventListener('click', () => {
        const id = document.getElementById('milestone-edit-id').value;
        if (id) deleteMilestone(id);
    });

    // 리스트 이벤트 위임
    document.getElementById('milestone-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'edit') openEditModal(id);
        else if (action === 'compare') openCompareModal(id);
    });

    // 분류 필터 위임
    document.getElementById('milestone-type-filters')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-filter]');
        if (!btn) return;
        _filterType = btn.dataset.filter;
        renderList();
    });

    // 비교 윈도우 토글
    document.querySelectorAll('.milestone-compare-window-btn').forEach(b => {
        b.addEventListener('click', () => {
            _currentCompareWindow = Number(b.dataset.window);
            document.querySelectorAll('.milestone-compare-window-btn').forEach(x => {
                x.classList.remove('bg-blue-600', 'text-white');
            });
            b.classList.add('bg-blue-600', 'text-white');
            renderCompareResults();
        });
    });
}

// 외부에서 자동 등록 트리거 (예: 로케이션 추천 엑셀 다운로드 후)
window.suggestMilestoneFromRecommendation = function (extra = {}) {
    const today = getTodayDateString();
    openEditModal(null, {
        date: today,
        type: 'location_change',
        title: extra.title || '🗺️ 로케이션 변경 적용',
        description: extra.description || `로케이션 변경 추천 리스트를 적용했습니다. (${extra.count || 0}건)`,
        tags: ['로케이션', '동선최적화'],
        affectedTasks: ['국내배송', '직진배송', '채우기']
    });
};
