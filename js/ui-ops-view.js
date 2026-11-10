// === js/ui-ops-view.js ===
// 📊 운영 리포트 탭 안 그리기(운영 리포트 내용 통합, 2026-11-05) — 요약·생산성·인력·비용 탭과 업무 상세(겹침 화면).
//   숫자는 js/lib/ops-view-model.js buildOpsModel 한 번(기간·권한이 같으면 탭끼리 같이 씀). 여기는 그리기만 한다.
//   무거운 것만 옛 함수를 그대로 쓴다: 앞으로의 인원 수급(renderStaffingOutlook) · 채우기→오류 차트(renderFillErrorSection)
//   · 상세 표(renderReport* {only:'tables'}) · 담당 변화(renderTaskOwnerTab — 최근 13개월).
//   펼쳐 보기는 <details>, 그 안 차트는 처음 열 때 그린다. 탭을 바꾸면 차트를 모두 정리한다(destroyOpsCharts).
//   탭 전환·권한·기간·상세 표 열고 닫기는 js/ui-history-ops-report.js.
// 금액: 모델이 권한(data.reports) 없으면 금액 칸을 null 로 준다 — 여기서는 null 을 '—' 로만 그린다.
// 담당 변화(직원 이름·사람별 UPH)는 data.reports(ctx.canOwner)일 때만 그린다 — 없으면 '권한이 없습니다', 요약은 건수만.
// ⚠️ role=dialog·data-act 금지(업무마감봇 선택자). 직원 이름·금액을 콘솔에 찍지 않는다. 모델에는 직원 이름이 없다.

import * as State from './state.js?v=202611101659';
import { escapeHtml as esc, getTodayDateString } from './utils.js?v=202611101659';
import { aliasHistoryView } from './lib/task-alias-view.js?v=202611101659';
import { buildOpsModel, opsModelInputs } from './lib/ops-view-model.js?v=202611101659';
import { revenueTotalOf } from './revenue-channels.js?v=202611101659';
import { D, alpha } from './d-chart.js?v=202611101659';
import { renderStaffingOutlook } from './ui-history-staffing.js?v=202611101659';
import { ensureMibalHistory, ensureCorrectCtx } from './ui-history-prediction.js?v=202611101659';
import { fetchPlannedData } from './history-data-manager.js?v=202611101659';
import { renderFillErrorSection, destroyFillErrorCharts } from './ui-history-productivity.js?v=202611101659';
import { renderReportDaily, renderReportWeekly, renderReportMonthly, renderReportYearly } from './ui-history-reports.js?v=202611101659';
import { taskListOf } from './lib/task-owner.js?v=202611101659';
import { TASK, tName } from './task-names.js?v=202611101659';
import { higherOpenThan } from './modal-above.js?v=202611101659';
import { buildOwnerAdvice, adviceForOutput } from './lib/plan-owner-advice.js?v=202611101659';
import { PEOPLE_NOTE } from './lib/plan-skills.js?v=202611101659';
import { nextWeekAvailable } from './ui-ops-plan-people.js?v=202611101659';

const $ = (id) => document.getElementById(id);

// ── 숫자 표시 ─────────────────────────────────────────────────────
const ok = (v) => v != null && isFinite(v);
const n0 = (v) => (ok(v) ? Math.round(v).toLocaleString() : '—');
const n1 = (v) => (ok(v) ? (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
const hrs = (min) => (ok(min) ? n1(min / 60) : '—');
const signed1 = (v) => (ok(v) ? (v > 0 ? '+' : v < 0 ? '−' : '±') + n1(Math.abs(v)) : '—');
const unitSpan = (u) => (u ? `<span class="opv-kpi-unit">${esc(u)}</span>` : '');

/** 비교 한 줄 — vs(변화 %·%p), better('up'|'down'|null) 로 색. 비교 못 하면 '—'. */
function cmpHtml(label, vs, kind = 'pct', better = 'up') {
    if (!ok(vs)) return `<span>${esc(label)} —</span>`;
    const unit = kind === 'pp' ? '%p' : '%';
    const flat = Math.abs(vs) < 0.5;
    const arrow = flat ? '–' : vs > 0 ? '▲' : '▼';
    const cls = flat || !better ? 'opv-flat' : ((vs > 0) === (better === 'up') ? 'opv-up' : 'opv-down');
    return `<span>${esc(label)} <b class="${cls}">${arrow} ${n1(Math.abs(vs))}${unit}</b></span>`;
}

function kpiCard({ label, value, unit = '', sub = '', cmps = [], title = '' }) {
    return `<div class="opv-kpi"${title ? ` title="${esc(title)}"` : ''}>
        <div class="opv-kpi-label">${esc(label)}</div>
        <div class="opv-kpi-value">${value}${value === '—' ? '' : unitSpan(unit)}</div>
        ${sub ? `<div class="opv-note">${sub}</div>` : ''}
        ${cmps.length ? `<div class="opv-kpi-cmp">${cmps.join('')}</div>` : ''}
    </div>`;
}

const card = (title, body, hint = '') => `<div class="opv-card">
    <div class="opv-card-head"><h4 class="opv-h">${esc(title)}</h4>${hint ? `<span class="opv-note">${hint}</span>` : ''}</div>
    ${body}
</div>`;

/** 펼쳐 보기(<details>) — fold 이름은 처음 열 때 무엇을 그릴지(js 가 [data-fold] 로 찾음). */
const fold = (name, title, body, hint = '') => `<details class="opv-fold" data-fold="${name}">
    <summary>${esc(title)}${hint ? ` <span class="opv-fold-hint">${hint}</span>` : ''}</summary>
    <div class="opv-fold-body">${body}</div>
</details>`;

const empty = (msg) => `<div class="opv-empty">${esc(msg)}</div>`;
const fmtDay = (id) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(id || ''));
    if (!m) return esc(id || '');
    const w = '일월화수목금토'[new Date(`${id}T00:00:00`).getDay()];
    return `${Number(m[2])}/${Number(m[3])}(${w})`;
};

// ── 모델(기간·권한이 같으면 다시 계산하지 않음) ─────────────────────
let cache = null;   // { sig, model, days }

/** 이력·설정이 바뀌었을 때(날짜 클릭·새로고침·기록 수정) — js/ui-history-ops-report.js renderOpsReport 가 부른다. */
export function invalidateOpsModel() { cache = null; }

function modelFor({ gran, key, canCost }) {
    const all = State.allHistoryData || [];
    const sig = `${gran}|${key}|${canCost ? 1 : 0}|${all.length}`;
    if (cache && cache.sig === sig && cache.all === all) return cache;
    const cfg = State.appConfig || {};
    const view = aliasHistoryView(all, cfg) || [];
    const inp = key ? opsModelInputs(gran, key, view) : { days: [], prevDays: [], baselineDays: [], baselineLabel: '' };
    const model = buildOpsModel({
        ...inp, allDays: view, ownerDays: view, cfg, today: getTodayDateString(), canCost: !!canCost
    });
    // 담당 변화 화면(js/ui-history-task-owner.js viewOf)과 같은 대상 업무 — 관리자 개별업무·기록 없는 업무는 빠진다
    const ownerTasks = new Set(taskListOf(view, { exclude: [tName(TASK.admin)] }));
    cache = { sig, all, model, days: inp.days || [], ownerTasks };
    return cache;
}

// ── 차트 ─────────────────────────────────────────────────────────
const charts = {};
function mkChart(name, canvas, config) {
    if (charts[name]) { try { charts[name].destroy(); } catch (e) { /* */ } delete charts[name]; }
    if (!canvas || typeof Chart === 'undefined') return null;
    charts[name] = new Chart(canvas, config);
    return charts[name];
}

/** 탭을 바꿀 때 — 이 화면이 만든 차트 + 채우기→오류 차트를 모두 정리한다(숨은 캔버스에 남기지 않게). */
export function destroyOpsCharts() {
    for (const k of Object.keys(charts)) { try { charts[k].destroy(); } catch (e) { /* */ } delete charts[k]; }
    destroyFillErrorCharts();
}

// ─────────────────────────────────────────────────────────────────
// 요약
// ─────────────────────────────────────────────────────────────────
function periodLine(m) {
    const meta = m.meta;
    if (meta.empty) return '';
    const range = meta.from === meta.to ? fmtDay(meta.from) : `${fmtDay(meta.from)} ~ ${fmtDay(meta.to)}`;
    const base = meta.baselineLabel ? ` · 평소 = ${esc(meta.baselineLabel)}` : '';
    return `<p class="opv-note">${range} · 운영일 ${meta.operatingDays}일 · 전기 = 직전 같은 단위 기간${base}</p>`;
}

function headlineHtml(m) {
    const H = Object.fromEntries(m.headline.map(h => [h.key, h]));
    const cmp = (h) => [cmpHtml('전기', h.vsPrev, h.deltaKind, h.better), cmpHtml('평소', h.vsBase, h.deltaKind, h.better)];
    const out = [];
    const q = H.qty;
    if (q) out.push(kpiCard({ label: q.label, value: n0(q.value), unit: q.unit, sub: `하루 평균 ${n0(q.perDay)}${esc(q.unit)}`, cmps: cmp(q), title: '전기·평소 비교는 하루 평균끼리' }));
    const u = H.uph;
    if (u) out.push(kpiCard({ label: u.label, value: n1(u.value), unit: u.unit, cmps: cmp(u), title: '전체 처리량 ÷ 전체 업무 기록 시간' }));
    const s = H.staff;
    if (s) {
        const gapTxt = ok(s.gap) ? `<b class="${s.gap < -0.5 ? 'opv-down' : 'opv-flat'}">${signed1(s.gap)}명</b>` : '—';
        out.push(kpiCard({
            label: '출근 / 필요', value: `${n1(s.value)}<span class="opv-kpi-unit">/ ${n1(s.required)}명</span>`,
            sub: `과부족 ${gapTxt}`, cmps: [cmpHtml('출근 전기', s.vsPrev, 'pct', null), cmpHtml('출근 평소', s.vsBase, 'pct', null)],
            title: '일평균 출근 인원 / 평상시 속도로 그날 물량에 필요한 인원(가동률 설정 반영)'
        }));
    }
    const o = H.oee;
    if (o) {
        const lv = { good: ['is-ok', '좋음'], warn: ['is-warn', '보통'], bad: ['is-risk', '낮음'] }[o.level];
        out.push(kpiCard({
            label: o.label, value: n1(o.value), unit: o.unit, sub: lv ? `<span class="opv-chip ${lv[0]}">${lv[1]}</span>` : '',
            cmps: cmp(o), title: '가동률 × 효율 × 품질 (가동률·효율은 100% 상한)'
        }));
    }
    const c = H.unitCost;
    if (c) {
        out.push(c.locked
            ? kpiCard({ label: c.label, value: '—', sub: '비용 권한이 있어야 보입니다' })
            : kpiCard({ label: c.label, value: n0(c.value), unit: c.unit, cmps: cmp(c), title: '건당 출고원가(인건비·자재·택배 등)' }));
    }
    return `<div class="opv-kpis">${out.join('')}</div>`;
}

const TONE_DOT = { good: 'is-ok', warn: 'is-warn', bad: 'is-risk', info: '' };
const diagHtml = (m) => card('진단', `<ul class="opv-diag">${m.diagnoses.map(d =>
    `<li><span class="opv-dot ${TONE_DOT[d.tone] || ''}"></span><span>${esc(d.text)}</span></li>`).join('')}</ul>`);

const notesHtml = (m) => (m.notes && m.notes.length
    ? `<div class="opv-notes"><b>데이터 주의</b><ul>${m.notes.map(n => `<li>${esc(n.text)}</li>`).join('')}</ul></div>` : '');

function problemsHtml(m, canOwner) {
    const p = m.problems;
    const loss = p.lossTasks.length
        ? `<ul class="opv-diag">${p.lossTasks.map(t => `<li><span class="opv-dot is-warn"></span><span>
            <button type="button" class="opv-row-btn" data-ops-task="${esc(t.task)}">${esc(t.task)}</button>
            — 평상시보다 ${hrs(t.lossMinutes)}시간 더 걸림 <span class="opv-note">(UPH ${n1(t.uph)} / 평상시 ${n1(t.stdUph)})</span></span></li>`).join('')}</ul>`
        : `<p class="opv-note">평상시보다 30분 이상 더 걸린 업무가 없습니다.</p>`;
    const short = p.shortDayCount
        ? `<p class="opv-note">부족한 날 ${p.shortDayCount}일${p.spareDayCount ? ` · 여유 있는 날 ${p.spareDayCount}일` : ''}</p>
           <ul class="opv-diag">${p.shortDays.map(d => `<li><span class="opv-dot is-risk"></span><span>${fmtDay(d.date)} 출근 ${n0(d.attended)}명 / 필요 ${n1(d.required)}명 (<b class="opv-down">${signed1(d.gap)}명</b>)</span></li>`).join('')}</ul>`
        : (m.meta.hasBaseline ? `<p class="opv-note">인원이 부족한 날이 없습니다${p.spareDayCount ? ` (여유 있는 날 ${p.spareDayCount}일)` : ''}.</p>`
            : `<p class="opv-note">평상시 속도가 없어 필요 인원을 계산하지 못했습니다.</p>`);
    let owner = `<p class="opv-note">담당 변화를 계산하지 않았습니다.</p>`;
    if (m.owner && !canOwner) {
        owner = `<p class="opv-note">${esc(m.owner.windowLabel)} 담당이 바뀐 업무 ${m.owner.changedTasks}개 · 이 기간 안 ${m.owner.inPeriodTasks}개</p>
            <p class="opv-note">업무별 내용은 리포트 권한이 있어야 보입니다.</p>`;
    } else if (m.owner) {
        const items = m.owner.items.slice().sort((a, b) => Number(b.inPeriod) - Number(a.inPeriod)).slice(0, 5);
        owner = `<p class="opv-note">${esc(m.owner.windowLabel)} 담당이 바뀐 업무 ${m.owner.changedTasks}개 · 이 기간 안 ${m.owner.inPeriodTasks}개</p>`
            + (items.length ? `<ul class="opv-diag">${items.map(i => `<li><span class="opv-dot ${i.inPeriod ? 'is-warn' : ''}"></span><span>
                <button type="button" class="opv-row-btn" data-ops-task="${esc(i.task)}">${esc(i.task)}</button>
                <span class="opv-note">${fmtDay(i.date)} 주부터 새 담당${i.inPeriod ? ' · 이 기간' : ''}${i.tentative ? ' · 잠정(이번 주 기록 기준)' : ''}</span></span></li>`).join('')}</ul>` : '');
    }
    return card('문제 있는 곳', `<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div><div class="opv-sub-title">손실 큰 업무</div>${loss}</div>
        <div><div class="opv-sub-title">인원 부족</div>${short}</div>
        <div><div class="opv-sub-title">담당 바뀐 업무</div>${owner}</div>
    </div>`, '업무 이름을 누르면 업무 상세');
}

/** 재고회전율(추정) = 기간 매출 ÷ 평균 재고금액 — 비율만 보인다(금액은 안 그림). */
function turnoverOf(days) {
    let rev = 0, inv = 0, invDays = 0;
    (days || []).forEach(d => {
        const g = d.management || {};
        rev += revenueTotalOf(g);
        if (Number(g.inventoryAmt) > 0) { inv += Number(g.inventoryAmt); invDays++; }
    });
    const avg = invDays > 0 ? inv / invDays : 0;
    return avg > 0 ? rev / avg : null;
}

function renderSummary(host, c, { canOwner = false } = {}) {
    const m = c.model;
    if (m.meta.empty) { host.innerHTML = periodLine(m) + diagHtml(m) + notesHtml(m); return; }
    host.innerHTML = `
        ${periodLine(m)}
        ${headlineHtml(m)}
        ${diagHtml(m)}
        ${notesHtml(m)}
        ${card('UPH · 인원 추이', m.trend.ids.length ? '<div class="opv-chart"><canvas id="ops-chart-trend"></canvas></div>' : empty('운영일이 없습니다.'), '운영일별')}
        ${problemsHtml(m, canOwner)}
        ${fold('milestones', '마일스톤별 효과', '<div id="ops-milestones-widget"><div class="opv-empty">불러오는 중...</div></div>')}
        ${fold('extras', '근무일수 · 재고회전율', `<div class="opv-kpis">
            ${kpiCard({ label: '평균 근무일수', value: n1(m.extras.avgWorkDays), unit: '일', title: '출근 연인원 ÷ 기간 안 출근한 사람 수(그날 등록 알바 제외)' })}
            ${kpiCard({ label: '재고회전율 (추정)', value: (v => (ok(v) ? v.toFixed(2) : '—'))(turnoverOf(c.days)), unit: '회', title: '기간 매출 ÷ 평균 재고금액(경영 지표 입력값)' })}
        </div>`)}`;
    drawTrend(m);
}

function drawTrend(m) {
    const t = m.trend;
    const canvas = $('ops-chart-trend');
    if (!canvas || !t.ids.length) return;
    const sets = [
        { type: 'line', label: 'UPH', data: t.uph, borderColor: D.accent, backgroundColor: alpha(D.accent, 0.10), fill: true, tension: 0.3, spanGaps: true, yAxisID: 'y' },
        { type: 'bar', label: '출근 인원', data: t.attended, backgroundColor: D.lineStrong, borderRadius: 4, maxBarThickness: 40, yAxisID: 'y1' }
    ];
    if (m.meta.hasBaseline) sets.push({ type: 'line', label: '필요 인원', data: t.required, borderColor: D.warn, backgroundColor: D.warn, borderDash: [5, 4], pointRadius: 2, fill: false, yAxisID: 'y1' });
    mkChart('trend', canvas, {
        type: 'bar',
        data: { labels: t.labels, datasets: sets },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top', labels: { usePointStyle: true } } },
            scales: {
                y: { position: 'left', beginAtZero: true, title: { display: true, text: 'UPH (개/시)' } },
                y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: '인원 (명)' } }
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────────
// 생산성
// ─────────────────────────────────────────────────────────────────
function renderProductivity(host, c, { canTaskTable }) {
    const m = c.model;
    if (m.meta.empty) { host.innerHTML = periodLine(m) + diagHtml(m); return; }
    const P = m.productivity;
    const uph = m.headline.find(h => h.key === 'uph') || {};
    const pp = (k) => [cmpHtml('전기', P.prev && ok(P[k]) && ok(P.prev[k]) ? P[k] - P.prev[k] : null, 'pp'),
        cmpHtml('평소', P.base && ok(P[k]) && ok(P.base[k]) ? P[k] - P.base[k] : null, 'pp')];
    const kpis = `<div class="opv-kpis">
        ${kpiCard({ label: 'UPH', value: n1(uph.value), unit: '개/시', cmps: [cmpHtml('전기', uph.vsPrev), cmpHtml('평소', uph.vsBase)] })}
        ${kpiCard({ label: '가동률', value: n1(P.utilization), unit: '%', cmps: pp('utilization'), title: '업무 기록 시간 ÷ 재실(출근~퇴근) 시간' })}
        ${kpiCard({ label: '효율', value: n1(P.efficiency), unit: '%', cmps: pp('efficiency'), title: '평상시 속도로 걸렸을 시간 ÷ 실제 업무 시간' })}
        ${kpiCard({ label: 'OEE', value: n1(P.oee), unit: '%', cmps: pp('oee'), title: `가동률 × 효율 × 품질(${n1(P.quality)}%)` })}
    </div>`;

    const partRows = m.parts.map(p => `<tr${p.id === 'total' ? ' style="font-weight:700"' : ''}>
        <td>${esc(p.name)}</td><td class="r">${hrs(p.minutes)}</td><td class="r">${n0(p.qty)}</td><td class="r">${n0(p.members)}</td>
        <td class="r">${n1(p.uph)}</td><td class="r">${cmpHtml('', p.vsPrevUph)}</td><td class="r">${cmpHtml('', p.vsBaseUph)}</td></tr>`).join('');
    const parts = card('파트', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>파트</th><th class="r">시간(h)</th><th class="r">처리량</th><th class="r">인원</th><th class="r">UPH</th><th class="r">전기 대비</th><th class="r">평소 대비</th></tr></thead>
        <tbody>${partRows}</tbody></table></div>`);

    let tasks;
    if (!canTaskTable) tasks = card('업무', '<p class="opv-note">권한이 없습니다.</p>');
    else if (!m.tasks.length) tasks = card('업무', empty('업무 기록이 없습니다.'));
    else {
        const rows = m.tasks.map(t => `<tr data-task-row="1" data-ops-task="${esc(t.task)}">
            <td><button type="button" class="opv-row-btn" data-ops-task="${esc(t.task)}">${esc(t.task)}</button></td>
            <td class="r">${hrs(t.minutes)}</td><td class="r">${n1(t.share)}%</td><td class="r">${t.isQty ? n0(t.qty) : '—'}</td>
            <td class="r">${n1(t.uph)}</td><td class="r">${n1(t.stdUph)}</td><td class="r">${ok(t.efficiency) ? n1(t.efficiency) + '%' : '—'}</td>
            <td class="r">${t.lossMinutes > 0 ? hrs(t.lossMinutes) : '—'}</td><td class="r">${cmpHtml('', t.vsPrevMinutes, 'pct', null)}</td></tr>`).join('');
        tasks = card('업무', `<div class="opv-table-wrap"><table class="opv-table">
            <thead><tr><th>업무</th><th class="r">시간(h)</th><th class="r">시간 비중</th><th class="r">처리량</th><th class="r">UPH</th><th class="r" title="이력 전체(오늘 제외, 기간 끝까지)의 평상시 속도">평상시 UPH</th><th class="r">효율</th><th class="r" title="평상시 속도보다 더 걸린 시간">손실(h)</th><th class="r">시간 전기 대비</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`, '행을 누르면 업무 상세(UPH 추세·담당 변화)');
    }
    host.innerHTML = `${periodLine(m)}${kpis}${parts}${tasks}
        ${fold('bubble', '리소스 투입 대비 효율', '<p class="opv-note">X축: 투입 시간, Y축: 처리량, 원 크기: 투입 인원</p><div class="opv-chart"><canvas id="ops-chart-bubble"></canvas></div>')}`;
}

function drawBubble(m) {
    const canvas = $('ops-chart-bubble');
    if (!canvas) return;
    const colors = [D.ok, D.warn, D.accentMid, D.risk];
    const list = m.parts.filter(p => p.id !== 'total');
    const maxM = Math.max(1, ...list.map(p => p.members));
    mkChart('bubble', canvas, {
        type: 'bubble',
        data: {
            datasets: list.map((p, i) => ({
                label: p.name, backgroundColor: alpha(colors[i % colors.length], 0.75),
                data: [{ x: Math.round(p.minutes / 6) / 10, y: p.qty, r: p.minutes > 0 ? 6 + 18 * (p.members / maxM) : 0, members: p.members }]
            }))
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { beginAtZero: true, title: { display: true, text: '투입 시간 (h)' } }, y: { beginAtZero: true, title: { display: true, text: '처리량 (개)' } } },
            plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.x}h · ${Number(ctx.raw.y).toLocaleString()}개 · ${ctx.raw.members}명` } } }
        }
    });
}

// ─────────────────────────────────────────────────────────────────
// 인력
// ─────────────────────────────────────────────────────────────────
function renderStaffing(host, foldsHost, c) {
    const m = c.model;
    const S = m.staffing;
    const staffH = m.headline.find(h => h.key === 'staff') || {};
    if (m.meta.empty) { host.innerHTML = periodLine(m) + diagHtml(m); if (foldsHost) foldsHost.innerHTML = ''; }
    else {
        const gapCls = ok(S.gap) ? (S.gap < -0.5 ? 'opv-down' : S.gap > 1 ? 'opv-up' : 'opv-flat') : 'opv-flat';
        host.innerHTML = `${periodLine(m)}<div class="opv-kpis">
            ${kpiCard({ label: '출근 인원', value: n1(S.attended), unit: '명', sub: '일평균, 출근 기록 기준', cmps: [cmpHtml('전기', staffH.vsPrev, 'pct', null), cmpHtml('평소', staffH.vsBase, 'pct', null)] })}
            ${kpiCard({ label: '실근무 인원', value: n1(S.workers), unit: '명', sub: '업무 기록에 이름이 있는 사람', title: '출근했어도 업무 기록이 없으면 빠집니다' })}
            ${kpiCard({ label: '필요 인원', value: n1(S.required), unit: '명', sub: `평상시 속도 · 가동률 설정 ${ok(S.utilizationSetting) ? Math.round(S.utilizationSetting * 100) + '%' : '—'}` })}
            ${kpiCard({ label: '과부족', value: `<span class="${gapCls}">${ok(S.gap) ? signed1(S.gap) : '—'}</span>`, unit: '명', sub: '출근 − 필요' })}
        </div>`;
        // 처리량 입력 전인 날은 빼고(모델 집계 shortAll·spareAll 과 같게)
        const rows = m.staffDays.filter(d => ok(d.gap) && d.required > 0 && d.qty > 0 && (d.gap < -0.5 || d.gap > 1)).map(d => `<tr class="${d.gap < -0.5 ? 'is-short' : ''}">
            <td>${fmtDay(d.date)}${d.estimated ? ' <span class="opv-chip" title="출퇴근 기록이 없어 추정">추정</span>' : ''}</td>
            <td class="r">${n0(d.attended)}</td><td class="r">${n0(d.worked)}</td><td class="r">${n1(d.required)}</td>
            <td class="r"><b class="${d.gap < -0.5 ? 'opv-down' : 'opv-up'}">${signed1(d.gap)}</b></td></tr>`).join('');
        const days = !m.meta.hasBaseline ? '<p class="opv-note">평상시 속도가 없어 필요 인원을 계산하지 못했습니다.</p>'
            : rows ? `<div class="opv-table-wrap"><table class="opv-table">
                <thead><tr><th>날짜</th><th class="r">출근</th><th class="r">실근무</th><th class="r">필요</th><th class="r">과부족</th></tr></thead><tbody>${rows}</tbody></table></div>`
                : '<p class="opv-note">부족(−0.5명 미만)·여유(+1명 초과)인 날이 없습니다.</p>';
        const step = (label, v, note) => `<tr><td>${esc(label)}</td><td class="r">${n1(v)}명</td><td class="opv-note">${esc(note)}</td></tr>`;
        const fte = `<div class="opv-table-wrap"><table class="opv-table"><tbody>
            ${step('출근', S.attended, '출근 기록이 있는 사람(일평균)')}
            ${step('실작업', S.worked, '업무 기록 시간 ÷ 1인 재실 시간')}
            ${step('실작업 필요', S.requiredWork, '평상시 속도로 그날 물량에 필요한 실작업 인원')}
            ${step('유효 인력', S.effective, '실작업 × 효율 × 품질')}
            ${step('명부(참고)', S.rosterAvg, '명부 − 휴가')}
        </tbody></table></div><p class="opv-note">1인 평균 재실 ${n1(S.avgPresenceHours)}시간</p>`;
        if (foldsHost) foldsHost.innerHTML = fold('days', '부족 · 여유 일자', days, `부족 ${m.problems.shortDayCount}일 · 여유 ${m.problems.spareDayCount}일`)
            + fold('fte', 'FTE 단계', fte);
    }
    // 앞날 전망은 선택 기간과 무관하다(예정 물량 기반) — 위쪽이 비어도 그린다. 예정 물량·미발 이력이 실리면 한 번 더.
    renderStaffingOutlook();
    Promise.all([fetchPlannedData(), ensureMibalHistory(), ensureCorrectCtx()]).then(() => renderStaffingOutlook()).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────
// 비용(권한 data.reports — 탭 자체가 그 권한일 때만 열린다)
// ─────────────────────────────────────────────────────────────────
function renderCost(host, c) {
    const m = c.model;
    const C = m.costs;
    if (C.locked) { host.innerHTML = card('비용', '<p class="opv-note">권한이 없습니다.</p>'); return; }
    if (m.meta.empty) { host.innerHTML = periodLine(m) + diagHtml(m); return; }
    const L = C.loss;
    const kpis = `<div class="opv-kpis">
        ${kpiCard({ label: '건당 원가', value: n0(C.unitCost && C.unitCost.total), unit: '원', cmps: [cmpHtml('전기', C.vsPrevUnitCost, 'pct', 'down')], title: '건당 출고원가(인건비·자재·택배 등)' })}
        ${kpiCard({ label: '개당 인건비', value: n0(C.laborPerItem), unit: '원', cmps: [cmpHtml('전기', C.vsPrevLaborPerItem, 'pct', 'down')], title: '인건비 합계 ÷ 처리량' })}
        ${kpiCard({ label: '총 손실', value: n0(L.total.cost), unit: '원', sub: `${hrs(L.total.minutes)}시간`, cmps: [cmpHtml('전기', L.vsPrevTotalCost, 'pct', 'down')] })}
    </div>`;
    const lrow = (label, x, note) => `<tr><td>${esc(label)}<div class="opv-note">${esc(note)}</div></td><td class="r">${hrs(x.minutes)}</td><td class="r">${n0(x.cost)}</td></tr>`;
    const lossTable = card('손실', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>종류</th><th class="r">시간(h)</th><th class="r">금액(원)</th></tr></thead>
        <tbody>
            ${lrow('기록 없는 시간', L.availability, '재실(출근~퇴근) 중 업무 기록이 없는 시간')}
            ${lrow('느려서 더 걸린 시간', L.performance, '평상시 속도보다 더 걸린 시간')}
            ${lrow('품질 업무', L.quality, '검수·오류 처리 등 품질 업무 시간')}
            <tr style="font-weight:700"><td>합계</td><td class="r">${hrs(L.total.minutes)}</td><td class="r">${n0(L.total.cost)}</td></tr>
        </tbody></table></div>`, '금액 = 실제 시급표');

    const u = C.unitCost;
    const ratio = ok(C.totalLaborCost) && C.revenue > 0 ? (C.totalLaborCost / C.revenue) * 100 : null;
    const rev = `<div class="opv-table-wrap"><table class="opv-table"><tbody>
        <tr><td>매출 (경영 지표)</td><td class="r">${n0(C.revenue)}원</td></tr>
        <tr><td>주문 건수</td><td class="r">${n0(C.orders)}건</td></tr>
        <tr><td>인건비 합계</td><td class="r">${n0(C.totalLaborCost)}원</td></tr>
        <tr><td>매출 대비 인건비</td><td class="r">${ok(ratio) ? n1(ratio) + '%' : '—'}</td></tr>
        ${u ? `<tr><td>건당 원가 — 인건비</td><td class="r">${n0(u.labor)}원</td></tr>
        <tr><td>건당 원가 — 자재</td><td class="r">${n0(u.material)}원</td></tr>
        <tr><td>건당 원가 — 택배</td><td class="r">${n0(u.shipping)}원</td></tr>
        <tr><td>건당 원가 — 직진배송${u.directDeliveryDays ? ` (${n0(u.directDeliveryDays)}일)` : ''}</td><td class="r">${n0(u.directDelivery)}원</td></tr>` : ''}
    </tbody></table></div><p class="opv-note">매출은 경영 지표에 입력한 채널 합계입니다(여기서 입력하지 않습니다).</p>`;
    const top = m.tasks.filter(t => t.lossMinutes > 0).slice().sort((a, b) => (b.lossCost || 0) - (a.lossCost || 0) || b.lossMinutes - a.lossMinutes).slice(0, 10);
    const topHtml = top.length ? `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>업무</th><th class="r">손실(h)</th><th class="r">손실 금액(원)</th><th class="r">인건비(원)</th></tr></thead>
        <tbody>${top.map(t => `<tr><td><button type="button" class="opv-row-btn" data-ops-task="${esc(t.task)}">${esc(t.task)}</button></td>
            <td class="r">${hrs(t.lossMinutes)}</td><td class="r">${n0(t.lossCost)}</td><td class="r">${n0(t.cost)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="opv-note">평상시보다 더 걸린 업무가 없습니다.</p>';
    host.innerHTML = `${periodLine(m)}${kpis}${lossTable}
        ${fold('revenue', '매출 연동', rev)}
        ${fold('losstop', '손실 상위 업무', topHtml, '평상시 속도보다 더 걸린 시간의 인건비')}`;
}

// ─────────────────────────────────────────────────────────────────
// 바깥에서 부르는 것
// ─────────────────────────────────────────────────────────────────
/**
 * 탭 하나 그리기. ctx = { gran, key, canCost, canTaskTable }.
 * 그리기 전에 이 화면 차트를 정리한다(지금 보이는 탭만 차트가 있다).
 */
export function renderOpsTab(tab, ctx) {
    bindOnce();
    destroyOpsCharts();
    const c = modelFor(ctx);
    lastCtx = ctx || {};
    if (tab === 'summary') renderSummary($('ops-summary-body'), c, ctx);
    else if (tab === 'productivity') {
        renderProductivity($('ops-productivity-body'), c, ctx);
        const fe = $('ops-fold-fillerror');
        if (fe && fe.open) renderFillErrorSection();    // 펼쳐 둔 채로 다시 그리면 차트도 다시
    } else if (tab === 'staffing') renderStaffing($('ops-staffing-body'), $('ops-staffing-folds'), c);
    else if (tab === 'cost') renderCost($('ops-cost-body'), c);
    // 업무 상세가 열린 채 기간이 바뀌었으면 머리 숫자도 새 기간으로
    if (isTaskDetailOpen() && detailTask) fillDetailHead(detailTask);
}

/** 상세 표(옛 업무 리포트의 표 4개) — 펼쳐 보기를 열었을 때와 기간이 바뀌었을 때. 단위별 칸 하나만 보인다. */
const REPORT_VIEW = { day: 'report-daily-view', week: 'report-weekly-view', month: 'report-monthly-view', year: 'report-yearly-view' };
const REPORT_RENDER = { day: renderReportDaily, week: renderReportWeekly, month: renderReportMonthly, year: renderReportYearly };
export function renderDetailTables({ gran, key, rangeData }) {
    const g = REPORT_VIEW[gran] ? gran : 'day';
    for (const [k, id] of Object.entries(REPORT_VIEW)) $(id)?.classList.toggle('hidden', k !== g);
    const view = $(REPORT_VIEW[g]);
    if (!key) { if (view) view.innerHTML = empty('왼쪽 목록에서 기간을 고르세요.'); return; }
    REPORT_RENDER[g](key, rangeData || [], State.appConfig, State.context, { only: 'tables' });
}

// ── 업무 상세(겹침 화면) ───────────────────────────────────────────
// 열려 있는 동안 밑의 탭 칸(.ops-pane·결산)은 inert(포커스·클릭 막음), Esc 는 문서 어디서든(더 위의 창이 없을 때) 닫는다.
let detailReturnFocus = null;
let detailTask = null;
let lastCtx = {};
const UNDER_IDS = ['ops-summary-panel', 'ops-productivity-panel', 'ops-staffing-panel', 'ops-cost-panel', 'ops-plan-panel', 'ops-settle-wrap'];
const setUnderInert = (on) => UNDER_IDS.forEach(id => { const el = $(id); if (el) el.inert = !!on; });
function onDocKey(e) {
    if (e.key !== 'Escape' || !isTaskDetailOpen()) return;
    const host = $('history-modal');
    // 기록 창 자체가 닫혀 있으면(X 로 닫음) Esc 를 막지 않고 상세만 정리한다 — 다른 창의 Esc 를 먹지 않게
    if (!host || host.classList.contains('hidden') || host.offsetParent === null) { closeTaskDetail(); return; }
    if (higherOpenThan(host)) return;     // 위에 다른 창(확인창 등)이 떠 있으면 그 창 몫
    e.stopPropagation();
    e.preventDefault();
    closeTaskDetail();
}
export const isTaskDetailOpen = () => !!($('ops-task-detail') && !$('ops-task-detail').classList.contains('hidden'));

/** 업무 상세 열기 — task 가 없으면 담당 변화 화면의 첫 업무(옛 #tab=taskowner). */
export function openTaskDetail(task, ctx = null) {
    const box = $('ops-task-detail');
    if (!box) return;
    const c = ctx || lastCtx;
    const wasOpen = isTaskDetailOpen();
    if (!wasOpen) detailReturnFocus = document.activeElement;
    detailTask = task || null;
    box.classList.remove('hidden');
    setUnderInert(true);
    if (!wasOpen) document.addEventListener('keydown', onDocKey, true);
    fillDetailHead(task);
    const sec = $('taskowner-body');
    if (!c.canOwner) {
        // 담당 변화는 직원 이름·사람별 UPH 가 보인다 — 리포트 권한(data.reports)일 때만
        if (sec) sec.innerHTML = empty('권한이 없습니다. 담당 변화는 리포트 권한이 있어야 보입니다.');
    } else if (task && cache && cache.ownerTasks && !cache.ownerTasks.has(task)) {
        if (sec) sec.innerHTML = empty('이 업무는 담당 변화 대상이 아닙니다(관리자 개별업무 또는 최근 13개월 기록 없음).');
    } else import('./ui-history-task-owner.js?v=202611101659').then(mod => {
        mod.renderTaskOwnerTab(task ? { task } : {});
    }).catch(err => {
        console.error('taskowner module load failed:', err && err.message);
        if (sec) sec.innerHTML = empty('담당 변화 화면을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    });
    box.scrollTop = 0;
    $('ops-task-detail-close')?.focus();
}

// 담당 재배치 추천(운영 계획 v2 D5) — 이력 길이·오늘이 같으면 다시 계산하지 않는다. 이름은 메모리·리포트 권한 화면에서만.
let adviceCache = null;
function adviceFor(task) {
    const all = State.allHistoryData || [];
    const today = getTodayDateString();
    if (!adviceCache || adviceCache.all !== all || adviceCache.len !== all.length || adviceCache.today !== today) {
        let list = [];
        try {
            const cfg = State.appConfig || {};
            // 후보 = 다음 주 출근 가능한 사람(운영 계획 주간 '사람·배치' 와 같은 기준)
            const available = nextWeekAvailable(today);
            list = buildOwnerAdvice(aliasHistoryView(all, cfg) || [], cfg, { today, available: available.size ? available : null, excludeTasks: [tName(TASK.admin)] });
        } catch (e) { console.warn('담당 재배치 추천 계산 실패:', e && e.message); }
        adviceCache = { all, len: all.length, today, list };
    }
    return adviceCache.list.find(a => a.task === task) || null;
}
/** 업무 상세 한 줄 — 리포트 권한이면 이름 있는 문장, 아니면 이름 없는 문장(adviceForOutput) */
function adviceLine(task, canOwner) {
    const ad = task ? adviceFor(task) : null;
    if (!ad) return '';
    const text = canOwner ? ad.text : adviceForOutput(ad)[0].text;
    return `<p class="opv-notes">담당 재배치 추천: ${esc(text)}${canOwner ? '' : ` — ${esc(PEOPLE_NOTE)}`}</p>`;
}

/** 업무 상세 머리(제목 + 고른 기간의 이 업무 숫자) — 담당 변화 화면에서 업무를 바꿔도 다시 부른다. */
function fillDetailHead(task) {
    $('ops-task-detail-title').textContent = task ? `업무 상세 — ${task}` : '업무 담당 변화';
    const body = $('ops-task-detail-body');
    const row = task && cache ? cache.model.tasks.find(t => t.task === task) : null;
    if (body) {
        body.innerHTML = !task ? '' : row ? `<div class="opv-kpis">
            ${kpiCard({ label: '시간', value: hrs(row.minutes), unit: 'h', sub: `전체의 ${n1(row.share)}%`, cmps: [cmpHtml('전기', row.vsPrevMinutes, 'pct', null)] })}
            ${row.isQty ? kpiCard({ label: '처리량', value: n0(row.qty), unit: '개' }) : ''}
            ${row.isQty ? kpiCard({ label: 'UPH', value: n1(row.uph), unit: '개/시', sub: `평상시 ${n1(row.stdUph)}`, cmps: [cmpHtml('전기', row.vsPrevUph)] }) : ''}
            ${row.isQty ? kpiCard({ label: '효율', value: n1(row.efficiency), unit: '%', sub: row.lossMinutes > 0 ? `평상시보다 ${hrs(row.lossMinutes)}시간 더 걸림` : '' }) : ''}
        </div>` : `<p class="opv-note">왼쪽에서 고른 기간에는 이 업무 기록이 없습니다.</p>`;
        if (task) body.insertAdjacentHTML('beforeend', adviceLine(task, !!(lastCtx && lastCtx.canOwner)));
    }
}

export function closeTaskDetail() {
    const box = $('ops-task-detail');
    if (!box || box.classList.contains('hidden')) return;
    box.classList.add('hidden');
    setUnderInert(false);
    document.removeEventListener('keydown', onDocKey, true);
    detailTask = null;
    const f = detailReturnFocus;
    detailReturnFocus = null;
    if (f && document.contains(f) && typeof f.focus === 'function') f.focus();
}

// ── 이벤트(한 번만) ───────────────────────────────────────────────
let bound = false;
function bindOnce() {
    if (bound) return;
    const panel = $('ops-panel');
    if (!panel) return;
    bound = true;
    panel.addEventListener('click', (e) => {
        if (e.target.closest('#ops-task-detail-close')) { closeTaskDetail(); return; }
        const t = e.target.closest('[data-ops-task]');
        if (t && panel.contains(t) && !e.target.closest('#ops-task-detail')) { openTaskDetail(t.dataset.opsTask); }
    });
    // 담당 변화 화면에서 업무를 바꾸면 머리 숫자도 그 업무로(담당 변화 자체는 task-owner 가 다시 그린다)
    $('ops-task-detail')?.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'taskowner-task') { detailTask = e.target.value; fillDetailHead(e.target.value); }
    });
    // 펼쳐 보기 — 처음 열 때(또는 다시 그린 뒤 열 때) 그 안 차트를 그린다. toggle 은 버블링하지 않아 capture 로 받는다.
    panel.addEventListener('toggle', (e) => {
        const d = e.target;
        if (!(d instanceof HTMLDetailsElement) || !d.open) return;
        const name = d.dataset.fold;
        if (name === 'bubble' && cache) drawBubble(cache.model);
        else if (name === 'fillerror') renderFillErrorSection();
        else if (name === 'milestones') {
            const host = $('ops-milestones-widget');
            if (host && !host.dataset.done) {
                host.dataset.done = '1';
                import('./ui-history-milestones.js?v=202611101659').then(mod => mod.renderMilestonesInsightWidget(host))
                    .catch(err => { console.warn('milestones widget load failed:', err && err.message); host.innerHTML = empty('마일스톤을 불러오지 못했습니다.'); });
            }
        }
    }, true);
}
