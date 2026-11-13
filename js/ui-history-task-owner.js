// === js/ui-history-task-owner.js ===
// 데이터 관리 「업무 담당 변화」(레일 '보고' > 업무 담당 변화, #tab=taskowner, 2026-11-05).
// 업무 하나 + [주|월] → ① 기간별 주 인원 표 ② 주 인원이 바뀐 지점과 그 전후 지표 변화 ③ 속도 선 차트(변경 시점 세로 점선).
// 계산은 js/lib/task-owner.js(순수). 이 파일은 그리기만 한다.
// 읽기만 한다 — 메모리의 최근 13개월 이력(State.allHistoryData, + 이번 달)만 쓰고 Firestore 를 따로 읽지 않는다.
// ⚠️ 콘솔·로그에 직원 이름을 찍지 않는다. role="dialog"·data-act 를 쓰지 않는다(업무마감봇 선택자).
import * as State from './state.js?v=202611131354';
import { escapeHtml as esc, getTodayDateString } from './utils.js?v=202611131354';
import { aliasHistoryView, aliasTaskName } from './lib/task-alias-view.js?v=202611131354';
import { TASK, tName } from './task-names.js?v=202611131354';
import { D, alpha } from './d-chart.js?v=202611131354';
import {
    ownerByPeriod, detectOwnerChanges, mapOwnerChanges, compareAroundView, compareWeeksOf, taskDays, taskListOf, pctChange,
    CAP_MINUTES, MIN_SOLO_DAYS, MIN_COMPARE_DAYS
} from './lib/task-owner.js?v=202611131354';

const DEFAULTS = { week: { hold: 2, n: 4 }, month: { hold: 2, n: 2 } };
const HOLD_CHOICES = [1, 2, 3, 4];
const N_CHOICES = { week: [2, 4, 6, 8], month: [1, 2, 3] };

const opts = { task: '', gran: 'week', hold: DEFAULTS.week.hold, n: DEFAULTS.week.n };
let chart = null;
let bound = false;

/** 지금 이름으로 바꾼 이력 + 업무 목록(관리자 개별업무·기록 없는 업무 제외).
 *  캐시를 두지 않는다 — State.allHistoryData 는 같은 배열에서 행만 바뀌거나(새로고침) 행 안의 기록만 늘어(오늘) 참조로는 바뀐 걸 모른다.
 *  aliasHistoryView 는 자체 캐시가 있고, 업무 목록은 아래 ownerByPeriod 와 같은 한 번 훑기라 그릴 때마다 다시 만든다. */
function viewOf() {
    const view = aliasHistoryView(State.allHistoryData || [], State.appConfig || {}) || [];
    return { view, tasks: taskListOf(view, { exclude: [tName(TASK.admin)] }) };
}

const isQtyTask = (task) => {
    const cfg = State.appConfig || {};
    return (cfg.quantityTaskTypes || []).some(n => aliasTaskName(n, cfg) === task);
};

// ── 표시 도우미 ─────────────────────────────────────────────────────
const num = (v, digits = 0) => (v == null || !isFinite(v)) ? '–'
    : (digits === 0 ? Math.round(v).toLocaleString() : v.toFixed(digits));
const pctTxt = (share) => `${Math.round(share * 100)}%`;
const who = (name, pt) => name ? `${esc(name)}${pt ? ' <span class="text-[11px] text-gray-400">(알바)</span>' : ''}` : '–';
const md = (s) => `${s.slice(5, 7)}/${s.slice(8, 10)}`;
const periodLabel = (row, gran) => gran === 'month' ? row.key : `${row.start.slice(2, 4)}.${md(row.start).replace('/', '.')}~${md(row.end).replace('/', '.')}`;
const chartLabel = (row, gran) => gran === 'month' ? row.key.slice(2).replace('-', '.') : md(row.start);

const STATUS_TEXT = { mixed: '여럿', thin: '표본 부족' };

/** 변화 칩 — 운영 마일스톤(ui-history-milestones.js makeChangeChip)과 같은 색 규칙. 값이 없으면 '–'. */
function chip(label, b, a, digits, betterIfHigh, suffix = '') {
    const pct = pctChange(b, a);
    let cls = 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600';
    let tag = '';
    if (pct != null) {
        const flat = Math.abs(pct) < 0.5;
        const good = (betterIfHigh && pct > 0) || (!betterIfHigh && pct < 0);
        if (!flat) cls = good
            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700'
            : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700';
        tag = `${flat ? '—' : (good ? '개선' : '악화')} ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    }
    return `<div class="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${cls}">
        <span class="text-[11px] font-bold opacity-80">${esc(label)}</span>
        <span class="text-[11px] font-mono">${esc(num(b, digits))}${esc(b == null ? '' : suffix)}→${esc(num(a, digits))}${esc(a == null ? '' : suffix)}</span>
        ${tag ? `<span class="text-[11px] font-bold">${tag}</span>` : ''}
    </div>`;
}

// 지표 [라벨, 칸, 소수, 높을수록 좋음, 단위]
const QTY_METRICS = [
    ['UPH', 'uph', 1, true, ''], ['하루 처리량', 'avgQtyPerDay', 0, true, ''], ['하루 투입시간', 'avgMinutesPerDay', 0, false, '분'],
    ['개당 시간', 'minPerUnit', 2, false, '분'], ['하루 인원', 'avgHeadcount', 1, false, '명'], ['주 인원 본인 UPH', 'ownerUph', 1, true, '']
];
const TIME_METRICS = [
    ['하루 투입시간', 'avgMinutesPerDay', 0, false, '분'], ['하루 인원', 'avgHeadcount', 1, false, '명'], ['건당 시간', 'minPerRecord', 1, false, '분']
];

// ── 그리기 ─────────────────────────────────────────────────────────
function controlsHtml(tasks) {
    const sel = (id, list, cur, fmt) => `<select id="${esc(id)}" class="p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100">
        ${list.map(v => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(fmt(v))}</option>`).join('')}</select>`;
    const granBtn = (g, label) => `<button type="button" class="taskowner-gran-btn px-3 py-1 text-xs font-bold ${opts.gran === g ? 'bg-blue-600 text-white' : 'text-gray-700 dark:text-gray-200'}" data-gran="${esc(g)}">${esc(label)}</button>`;
    const unit = opts.gran === 'month' ? '개월' : '주';
    return `<div class="flex flex-wrap items-center gap-x-4 gap-y-2 bg-white dark:bg-gray-800 p-3 md:p-4 rounded-xl border border-gray-200 dark:border-gray-700 depth-panel text-sm">
        <label class="flex items-center gap-2"><span class="font-bold text-gray-600 dark:text-gray-300">업무</span>${sel('taskowner-task', tasks, opts.task, v => v)}</label>
        <div class="inline-flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600">${granBtn('week', '주')}${granBtn('month', '월')}</div>
        <label class="flex items-center gap-2"><span class="font-bold text-gray-600 dark:text-gray-300">바뀜 판단</span>${sel('taskowner-hold', HOLD_CHOICES, opts.hold, v => `${v}주 연속 1위`)}</label>
        <label class="flex items-center gap-2"><span class="font-bold text-gray-600 dark:text-gray-300">전후 비교</span>${sel('taskowner-n', N_CHOICES[opts.gran], opts.n, v => opts.gran === 'month' ? `${compareWeeksOf('month', v)}주씩(약 ${v}개월)` : `${v}${unit}씩`)}</label>
    </div>`;
}

function changesHtml(items, qty) {
    if (!items.length) {
        return `<div class="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">이 기간에 주 인원이 바뀐 지점이 없습니다.</div>`;
    }
    const metrics = qty ? QTY_METRICS : TIME_METRICS;
    return items.slice().reverse().map(({ change, cmp }) => {
        const b = cmp.before, a = cmp.after;
        const warn = cmp.lowSample
            ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">표본 적음(${qty ? '처리량 입력된 날' : '진행'} ${esc(MIN_COMPARE_DAYS)}일 미만)</span>` : '';
        const solo = qty ? `<span class="text-[11px] text-gray-400">처리량 입력된 날 ${esc(b.qtyDays)}일 → ${esc(a.qtyDays)}일 · 본인 UPH 단독일 ${esc(b.soloDays)}일 → ${esc(a.soloDays)}일</span>` : '';
        return `<div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 md:p-4 space-y-2 depth-panel">
            <div class="flex flex-wrap items-center gap-2">
                <span class="font-bold text-gray-800 dark:text-gray-100">${esc(change.date)}</span>
                <span class="text-sm text-gray-700 dark:text-gray-200">${who(change.from)} → ${who(change.to)}</span>
                ${change.tentative ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700" title="이번 주 기록이 더 쌓이면 바뀔 수 있습니다">잠정(이번 주 기록 기준)</span>` : ''}
                ${warn}
            </div>
            <div class="text-[11px] text-gray-500 dark:text-gray-400">전 ${esc(b.from)}~${esc(b.to)} (진행 ${esc(b.days)}일) · 후 ${esc(a.from)}~${esc(a.to)} (진행 ${esc(a.days)}일) ${solo}</div>
            <div class="flex flex-wrap gap-2">${metrics.map(([l, k, d, hi, u]) => chip(l, b[k], a[k], d, hi, u)).join('')}</div>
        </div>`;
    }).join('');
}

function tableHtml(rows, line, qty) {
    const today = getTodayDateString();
    const speedHead = qty ? 'UPH' : '하루 투입시간';
    const body = rows.slice().reverse().map((r, ri) => {
        const i = rows.length - 1 - ri;
        // 이어 온 주 인원(주 단위 판정 결과)이 이 칸 1위와 다르면 같이 보인다
        const owner = r.status === 'owner'
            ? `<span class="font-bold text-gray-800 dark:text-gray-100">${who(r.owner, r.ownerPartTimer)}</span>${line[i] && line[i] !== r.owner ? `<div class="text-[11px] text-gray-400">이어서 ${esc(line[i])}</div>` : ''}`
            : `<span class="text-gray-400">${esc(STATUS_TEXT[r.status])}</span>${line[i] ? `<div class="text-[11px] text-gray-400">이어서 ${esc(line[i])}</div>` : ''}`;
        const share = r.top ? (r.status === 'owner' ? pctTxt(r.ownerShare) : `<span class="text-gray-400">${who(r.top.name, r.top.partTimer)} ${esc(pctTxt(r.top.share))}</span>`) : '–';
        const second = r.second ? `${who(r.second.name, r.second.partTimer)} ${pctTxt(r.second.share)}` : '–';
        const speed = qty ? num(r.uph, 1) : `${num(r.avgMinutesPerDay)}분`;
        const live = r.end >= today ? ' <span class="text-[11px] text-blue-600">오늘까지</span>' : '';
        const cap = r.capped ? ` <span class="text-[11px] text-amber-600" title="${esc(CAP_MINUTES)}분 넘는 기록 ${esc(r.capped)}건은 ${esc(CAP_MINUTES)}분으로 셈">상한 ${esc(r.capped)}</span>` : '';
        return `<tr class="border-b border-gray-100 dark:border-gray-700">
            <td class="px-3 py-2 whitespace-nowrap">${esc(periodLabel(r, opts.gran))}${live}</td>
            <td class="px-3 py-2 whitespace-nowrap">${owner}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">${share}</td>
            <td class="px-3 py-2 whitespace-nowrap">${second}</td>
            <td class="px-3 py-2 text-right">${esc(r.days)}</td>
            <td class="px-3 py-2 text-right">${esc(qty ? num(r.qty) : '–')}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">${esc(speed)}${cap}</td>
            <td class="px-3 py-2 text-right">${esc(r.headcount)}</td>
        </tr>`;
    }).join('');
    return `<div class="overflow-x-auto">
        <table class="w-full text-sm text-left text-gray-600 dark:text-gray-300">
            <thead class="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
                <tr><th class="px-3 py-2">기간</th><th class="px-3 py-2">주 인원</th><th class="px-3 py-2 text-right">비중</th><th class="px-3 py-2">2순위</th>
                    <th class="px-3 py-2 text-right">진행 일수</th><th class="px-3 py-2 text-right">처리량</th><th class="px-3 py-2 text-right">${esc(speedHead)}</th><th class="px-3 py-2 text-right">인원</th></tr>
            </thead>
            <tbody>${body}</tbody>
        </table>
    </div>`;
}

function drawChart(rows, changes, qty) {
    if (chart) { try { chart.destroy(); } catch (e) { /* 이미 없어짐 */ } chart = null; }
    const el = document.getElementById('taskowner-chart');
    if (!el || typeof Chart === 'undefined' || !rows.length) return;
    const labels = rows.map(r => chartLabel(r, opts.gran));
    const values = rows.map(r => {
        const v = qty ? r.uph : r.avgMinutesPerDay;
        return v == null ? null : Math.round(v * 10) / 10;
    });
    const top = Math.max(1, ...values.filter(v => v != null)) * 1.1;
    // 변경 시점 = 세로 점선 하나의 데이터셋({x: 라벨, y} 두 점 + 끊김). 플러그인은 더하지 않는다.
    const marks = [];
    changes.forEach(c => {
        const x = labels[c.rowIndex];
        marks.push({ x, y: 0 }, { x, y: top }, { x, y: null });
    });
    chart = new Chart(el, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: qty ? 'UPH(개/시)' : '하루 평균 투입시간(분)', data: values, borderColor: D.accent,
                  backgroundColor: alpha(D.accent, 0.1), pointRadius: 3, tension: 0.25, spanGaps: true },
                { label: '주 인원 바뀐 시점', data: marks, borderColor: D.risk, borderDash: [4, 4], borderWidth: 1.5,
                  pointRadius: 0, spanGaps: false, fill: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            scales: { y: { beginAtZero: true, suggestedMax: top } },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
        }
    });
}

/** 화면 그리기 — 운영 리포트 업무 상세(js/ui-ops-view.js)를 열 때와 조건을 바꿀 때 부른다.
 *  task 를 주면 그 업무로 연다(지금 이름 — 목록에 없으면 첫 업무). */
export function renderTaskOwnerTab({ task: want = null } = {}) {
    const body = document.getElementById('taskowner-body');
    if (!body) return;
    bindOnce(body);
    if (want) opts.task = want;
    const { view, tasks } = viewOf();
    if (!tasks.length) {
        if (chart) { try { chart.destroy(); } catch (e) { /* */ } chart = null; }
        body.innerHTML = `<div class="text-center py-16 text-gray-400 text-sm">최근 13개월 업무 기록이 없습니다.</div>`;
        return;
    }
    if (!tasks.includes(opts.task)) opts.task = tasks[0];
    const task = opts.task;
    const qty = isQtyTask(task);

    const list = taskDays(view, task);
    const rows = ownerByPeriod(view, task, { gran: opts.gran, qtyTask: qty });
    const today = getTodayDateString();
    // 바뀜 판정은 언제나 주 단위(진행 중 주도 활동 2일·60분 이상이면 셈) — 월 화면은 그 결과를 칸에 맞춰 보여 주기만(2026-11-10)
    const weekRows = opts.gran === 'week' ? rows : ownerByPeriod(view, task, { gran: 'week' });
    const det = mapOwnerChanges(rows, weekRows, detectOwnerChanges(weekRows, { hold: opts.hold, today, liveOk: true }));
    const line = det.line;
    // 전후 비교도 주 단위(변경 날짜 = 주 시작 기준, 월 화면은 n개월 ≈ 4n주)
    const items = det.changes.map((c, i) => ({
        change: c,
        cmp: compareAroundView(view, task, c, {
            gran: opts.gran, n: opts.n, qtyTask: qty, list, today,
            nextDate: det.changes[i + 1] ? det.changes[i + 1].date : null,
            prevDate: i > 0 ? det.changes[i - 1].date : null
        })
    }));
    const nowOwner = line.length ? line[line.length - 1] : null;
    const capped = rows.reduce((a, r) => a + r.capped, 0);
    const unit = opts.gran === 'month' ? '개월' : '주';
    const cw = compareWeeksOf(opts.gran, opts.n);
    const cmpLabel = opts.gran === 'month' ? `전 ${cw}주 vs 후 ${cw}주(약 ${opts.n}개월)` : `전 ${cw}주 vs 후 ${cw}주`;

    body.innerHTML = `
        ${controlsHtml(tasks)}
        <div class="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-700 dark:text-gray-200">
            <span>지금 주 인원 <b>${nowOwner ? esc(nowOwner) : '–'}</b></span>
            <span>처음 주 인원 <b>${det.initial ? esc(det.initial) : '–'}</b></span>
            <span>바뀐 횟수 <b>${det.changes.length}</b></span>
            <span class="text-gray-500 dark:text-gray-400">${qty ? '처리량 입력 업무' : '시간 업무(처리량 없음)'} · ${rows.length}${esc(unit)}</span>
        </div>
        <div class="space-y-2">
            <h3 class="text-sm font-bold text-gray-800 dark:text-gray-100">주 인원 바뀐 지점 <span class="font-normal text-xs text-gray-500">${esc(cmpLabel)} (다음 변경 전날에서 자름)</span></h3>
            ${changesHtml(items, qty)}
        </div>
        <div class="bg-white dark:bg-gray-800 p-3 md:p-4 rounded-xl border border-gray-200 dark:border-gray-700 depth-panel">
            <h3 class="text-sm font-bold text-gray-800 dark:text-gray-100 mb-2">${qty ? 'UPH 추이' : '하루 평균 투입시간 추이'}</h3>
            <div class="relative h-56 md:h-64"><canvas id="taskowner-chart"></canvas></div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 depth-panel">
            <h3 class="text-sm font-bold text-gray-800 dark:text-gray-100 px-3 md:px-4 pt-3">기간별 주 인원</h3>
            ${tableHtml(rows, line, qty)}
        </div>
        <ul class="text-[11px] text-gray-500 dark:text-gray-400 list-disc pl-5 space-y-0.5">
            <li>주 인원 = 그 기간 이 업무 투입시간 비중 1위. 1위가 40% 미만이거나 1·2위 차가 5%p 이하면 '여럿', 총 60분 미만이거나 진행 1일이면 '표본 부족'(둘 다 앞 주 인원을 잇습니다).</li>
            <li>바뀜은 언제나 주 단위로 봅니다 — 새 사람이 ${esc(opts.hold)}주 연속 1위일 때 바뀐 것으로 보고, 바뀐 날짜는 그 사람의 첫 주 시작일입니다${opts.gran === 'week' ? '' : '(월로 볼 때는 그 주의 첫 기록이 든 달에 표시하고, 각 달의 이어 온 주 인원은 그 달 끝까지의 주 판정입니다. 전후 비교도 주 단위 — 1개월을 4주로 봅니다)'}. 진행 중인 이번 주는 오늘까지 기록으로 세되, 이번 주에 이 업무를 2일 이상·60분 이상 했을 때만 셉니다('오늘까지' 표시). 이번 주 기록으로 정해진 변경은 '잠정'으로 표시합니다 — 이번 주 기록이 더 쌓이면 바뀔 수 있습니다. 전후 비교에서는 오늘을 뺍니다.</li>
            ${qty ? `<li>UPH·하루 처리량·개당 시간은 시간과 처리량이 둘 다 입력된 날만 봅니다. UPH 는 하루 10분 이상 한 날의 하루 UPH 가운데값입니다(3일 미만이면 합계로 계산). 주 인원 본인 UPH 는 그 사람이 그날 이 업무 시간의 80% 이상을 맡은 날(단독일)만 보고, 단독일이 ${esc(MIN_SOLO_DAYS)}일 미만이면 '–' 입니다.</li>` : ''}
            <li>'종료'를 누르지 않아 길게 잡힌 기록은 1건당 ${esc(CAP_MINUTES)}분까지만 셉니다${esc(capped ? ` (이 업무 ${capped}건)` : '')}.</li>
            <li>직원은 기록에 남은 이름으로 셉니다 — 이름이 바뀐 직원은 다른 사람으로 보입니다. 최근 13개월 기록만 봅니다.</li>
        </ul>`;
    drawChart(rows, det.changes, qty);
}

function bindOnce(body) {
    if (bound) return;
    bound = true;
    body.addEventListener('change', (e) => {
        const t = e.target;
        if (t.id === 'taskowner-task') opts.task = t.value;
        else if (t.id === 'taskowner-hold') opts.hold = Number(t.value) || DEFAULTS[opts.gran].hold;
        else if (t.id === 'taskowner-n') opts.n = Number(t.value) || DEFAULTS[opts.gran].n;
        else return;
        renderTaskOwnerTab();
    });
    body.addEventListener('click', (e) => {
        const btn = e.target.closest('.taskowner-gran-btn');
        if (!btn || !body.contains(btn)) return;
        const g = btn.dataset.gran === 'month' ? 'month' : 'week';
        if (g === opts.gran) return;
        opts.gran = g;
        opts.n = DEFAULTS[g].n;   // 바뀜 판단(hold)은 주 단위라 단위를 바꿔도 그대로 둔다
        renderTaskOwnerTab();
    });
}
