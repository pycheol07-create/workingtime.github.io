// === js/long-run-warn.js — 대시보드 '오래 켜진 업무' 경고(2026-11-26 앱 점검) ===
// 내 진행 중 기록이 6시간(js/lib/long-run.js LONG_RUN_MIN)을 넘으면 '내 업무' 위에 띠를 띄운다.
//   [끝난 시각 넣기] → '업무 기록 수정' 창(끝난 시각을 넣고 저장하면 완료 + 잠금 풀림 — js/listeners-form-record.js)
//   [계속 진행 중]   → 이 브라우저에서 3시간 동안 다시 안 띄움(localStorage — 못 쓰면 이번 화면에서만)
// 그리기는 app.js render() 와 1분마다(시간이 지나 6시간을 넘는 순간도 잡게). 데이터는 읽기만 한다.
import * as State from './state.js?v=c7f5fc984ef9-a2ce38c0';
import { getCurrentTime, escapeHtml, formatDuration, formatTimeTo24H } from './utils.js?v=a8117fdf6a07-c756d71e';
import { longRunning, pruneSnoozed, SNOOZE_MS } from './lib/long-run.js?v=86da0817a440-f9ae51b8';
import { openEditRecordModal } from './edit-record-open.js?v=1e02b5a65d31-e8d69915';

const KEY = 'longRunSnooze';
let memSnooze = {};
let wired = false;
let lastHtml = '';

function readSnooze() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return (v && typeof v === 'object') ? v : {}; }
    catch (_) { return memSnooze; }
}
function writeSnooze(map) {
    memSnooze = map;
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (_) { /* 저장소 막힘 — 이번 화면에서만 */ }
}

export function renderLongRunWarning() {
    const el = document.getElementById('long-run-warn');
    if (!el) return;
    wire(el);
    const now = Date.now();
    const snoozed = pruneSnoozed(readSnooze(), now);
    const list = longRunning(State.appState.workRecords, State.appState.currentUser, getCurrentTime(), { snoozed, nowMs: now });
    if (!list.length) { if (!el.hidden) { el.hidden = true; el.innerHTML = ''; lastHtml = ''; } return; }
    const html = list.map(x => `
        <div class="d-card px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2" style="border:1px solid var(--c-warn-line, #E3B341)">
            <svg class="w-5 h-5 shrink-0" style="color:var(--c-warn-text, #8A6011)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            <div class="flex-1 min-w-[12rem]">
                <div class="text-sm font-semibold t-1">'${escapeHtml(x.task)}' 업무가 ${escapeHtml(formatDuration(x.minutes))}째 켜져 있어요</div>
                <div class="text-xs t-2 mt-0.5">${escapeHtml(formatTimeTo24H(x.startTime))} 시작 · 이미 끝났다면 끝난 시각을 넣어 주세요(휴식 시간은 빼고 셈)</div>
            </div>
            <div class="flex gap-2 shrink-0">
                <button type="button" class="d-btn d-btn-sm d-btn-accent" data-lr-act="end" data-action="edit" data-record-id="${escapeHtml(x.id)}">끝난 시각 넣기</button>
                <button type="button" class="d-btn d-btn-sm" data-lr-act="keep" data-record-id="${escapeHtml(x.id)}">계속 진행 중</button>
            </div>
        </div>`).join('');
    if (html !== lastHtml) { el.innerHTML = html; lastHtml = html; }
    el.hidden = false;
}

function wire(el) {
    if (wired) return;
    wired = true;
    el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-lr-act]');
        if (!b) return;
        const id = b.dataset.recordId;
        if (b.dataset.lrAct === 'end') {
            openEditRecordModal(id);
        } else if (b.dataset.lrAct === 'keep') {
            const now = Date.now();
            writeSnooze({ ...pruneSnoozed(readSnooze(), now), [id]: now + SNOOZE_MS });
            renderLongRunWarning();
        }
    });
    setInterval(renderLongRunWarning, 60 * 1000);
}
