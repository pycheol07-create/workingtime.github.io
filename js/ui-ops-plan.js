// === js/ui-ops-plan.js ===
// 📋 운영 리포트 '운영 계획' 탭 — 주간(MVP-1, 2026-11-05) + 목표·확정·계획 대비 실적·월간(MVP-2, 2026-11-05).
//   주간: js/lib/plan-build.js buildWeekPlan. 수요·공급은 업무 예상 엔진(getStaffingOutlook, from·until) 그대로 →
//     인력 탭 '앞으로 인원 수급' 표와 같은 필요·가용·과부족. 지난주 실적·최근 4주 기록 누락은 운영 리포트 모델(buildOpsModel).
//   월간: js/ui-ops-plan-month.js(→ js/lib/plan-month.js). [주간 | 월간] 활성, 연간은 준비 중.
//   목표: js/ui-ops-plan-targets.js(카드 + 설정 창). 기본 제안 = 최근 8주 평소(js/lib/plan-targets.js).
//   확정: 관리자만 [계획 확정] → OpsPlan/{week|month}_{기간} (version + 1, js/ops-plan-store.js). 확정본이 있으면 과제 체크는 확정본(done)에,
//     없으면 이 브라우저 localStorage(키 = 과제 key). 지난 기간 확정본이 있으면 맨 위 '지난 계획 대비 실적'(js/lib/plan-compare.js).
//   기간은 다음 주 월~일 / 다음 달 고정(날짜 트리 숨김 — js/lib/ops-report-route.js isOpsTreeless).
//   [인쇄/PDF] = 지금 보이는 계획서를 body 바로 밑 사본(#ops-plan-print)으로 옮겨 브라우저 인쇄.
//   비용·예산(확장-2, js/ui-ops-plan-budget.js): 관리자만 섹션·숫자가 있다(비관리자는 모델도 locked). 금액은 adminPrivate 에만 저장.
//     계획 기준(연장 한도·알바 준비 일·표준시간)은 OpsPlan/settings — 주간·월간 계산이 cfg.opsPlan 으로 읽는다(planCfg).
//   연간(확장-3, js/ui-ops-plan-year.js): 내년 1~12월, 신뢰도 항상 낮음·참고용. 개선 로드맵(손실 → 과제 → 분기, [실행] = 운영 마일스톤 등록, 효과 = 전후 14일)·
//     시뮬레이터(인원·물량·속도 슬라이더, 금액은 관리자만)는 주간·월간·연간 공통(js/ui-ops-plan-extras.js).
//   사람·배치(확장-1, js/ui-ops-plan-people.js): 이름은 화면(data.reports)에서만 — 인쇄 사본은 그 섹션을 수만 다시 그리고, 이름이 남았으면 인쇄를 멈춘다.
// 금액·직원 이름 없음 — 휴무는 '수'만 받는다. 콘솔에도 이름·금액·문서 본문을 찍지 않는다.
// ⚠️ role=dialog·data-act 금지(업무마감봇 선택자).

import * as State from './state.js?v=202611131354';
import { getTodayDateString, getWeekOfYear, showToast } from './utils.js?v=202611131354';
import { aliasHistoryView, aliasTaskName } from './lib/task-alias-view.js?v=202611131354';
import { buildOpsModel, opsModelInputs } from './lib/ops-view-model.js?v=202611131354';
import { taskNameOf } from './lib/task-ids.js?v=202611131354';
import { buildWeekPlan } from './lib/plan-build.js?v=202611131354';
import { nextWeekRange, planSettingsOf, addDaysStr, OVERTIME_LAW_NOTE } from './lib/plan-week.js?v=202611131354';
import { baselineOf, defaultTargets, targetsFor, gapRows, shortToTargetHours } from './lib/plan-targets.js?v=202611131354';
import { planDocId, confirmDocOf, planVsActual, monthErrsOf, monthConfirmYms, monthConfirmsOf } from './lib/plan-compare.js?v=202611131354';
import { getStaffingOutlook, ensureMibalHistory, ensureCorrectCtx, precedingHolidayNameOf, getLoadedAccuracyHourErr } from './ui-history-prediction.js?v=202611131354';
import { fetchPlannedData } from './history-data-manager.js?v=202611131354';
import { onLeaveScheduleChanged } from './leave-schedule-sync.js?v=202611131354';
import { esc, n0, n1, pct0, fmtDay, card, kpi, fillText, actionsHtml, compareCardHtml, signed1, ok } from './ui-ops-plan-parts.js?v=202611131354';
import { targetsCardHtml, openTargetsEditor, closeTargetsEditor } from './ui-ops-plan-targets.js?v=202611131354';
import { computeMonthPlan, monthBodyHtml, lastMonthKeyOf } from './ui-ops-plan-month.js?v=202611131354';
import { loadPlanDoc, peekPlanDoc, confirmPlan, saveDone } from './ops-plan-store.js?v=202611131354';
import { computePeople, peopleHtml, peoplePrintHtml, assignCountsOf, busForPlan, namesOf, ignoreWordsOf } from './ui-ops-plan-people.js?v=202611131354';
import { namesLeak } from './lib/plan-skills.js?v=202611131354';
import { computeBudget, computeYearBudget, budgetHtml, yearBudgetHtml, openCostEditor, closeCostEditor, isAdminNow } from './ui-ops-plan-budget.js?v=202611131354';
import { budgetEntryOf, trimBudgetPlans, costSettingsOf, MONTH_DAYS } from './lib/plan-budget.js?v=202611131354';
import { computeYearPlan, yearBodyHtml } from './ui-ops-plan-year.js?v=202611131354';
import { buildRoadmap, attachMilestones, CAUSE_MS_TYPE } from './lib/plan-roadmap.js?v=202611131354';
import { simRowsOf } from './lib/plan-sim.js?v=202611131354';
import { roadmapHtml, simHtml, simResultHtml } from './ui-ops-plan-extras.js?v=202611131354';
import { COST_DOC } from './ops-plan-store.js?v=202611131354';
import { recordRateOf } from './lib/plan-confidence.js?v=202611131354';
import { loadMonthlies, autoBuildMonthlies, rebuildMonth } from './ops-monthly-store.js?v=202611131354';
import { finishedMonths } from './lib/plan-monthly.js?v=202611131354';
import { buildQuarterPlan, nextQuarterOf } from './lib/plan-quarter.js?v=202611131354';
import { seasonCalendar, bundleForecast } from './lib/plan-season.js?v=202611131354';
import { SEASON_BUNDLES } from './lib/plan-season-catalog.js?v=202611131354';
import { buildAutomationRoadmap } from './lib/plan-automation.js?v=202611131354';
import { buildDataGaps } from './lib/plan-data-gaps.js?v=202611131354';
import { cleanYearDocSections, YEARDOC_SECTIONS } from './lib/plan-yeardoc.js?v=202611131354';
import { quarterBodyHtml } from './ui-ops-plan-quarter.js?v=202611131354';
import { yearDocHtml, readYearDocInputs } from './ui-ops-plan-yeardoc.js?v=202611131354';
import { saveYearDoc } from './ops-plan-store.js?v=202611131354';
import { listItems, createItem, updateItem, itemLog, claimOverdueNotice } from './ops-plan-items-store.js?v=202611131354';
import { makeButton, draftOf, itemsCardHtml, logHtml, openGoalsEditor, closeGoalsEditor } from './ui-ops-plan-items.js?v=202611131354';
import { isOverdue, pickOverdueNotices, OVERDUE_MESSAGE } from './lib/plan-items.js?v=202611131354';
import { actualsOf } from './lib/plan-cascade.js?v=202611131354';
import { sendNotification } from './app-notifications.js?v=202611131354';

const $ = (id) => document.getElementById(id);
const isAdmin = () => !!(State.appState && State.appState.currentUserRole === 'admin');

// ── 상태·캐시 ─────────────────────────────────────────────────────
let horizon = 'week';      // 'week' | 'month'
let selDate = null;        // 배치 초안 날짜
const SIM0 = { staffDelta: 0, qtyPct: 0, speedPct: 0 };
let simLever = { ...SIM0 };   // 시뮬레이터 슬라이더(기간을 바꾸면 0 으로)
let simBase = null;           // 마지막으로 그린 시뮬레이터 기본값
let msMod = null;             // 운영 마일스톤 모듈(로드맵 '실행됨'·효과) — 처음 그릴 때 불러 구독
// 📆 월 요약(v2 D1) — 연간 계산에 쓰는 달별 운영일·처리량(메모리 13개월 밖). 관리자는 한 번 자동으로 빠진 달을 만든다.
let monthlies = null;         // null = 아직 안 읽음, [] = 없음
let monthlyBusy = false, autoBuilt = false;
// 📐 지난 월간 확정본(월간 신뢰도의 확정 대비 오차) — 달마다 한 묶음만 읽는다(읽을 달은 plan-compare monthConfirmYms).
let monthConfirmKey = null, monthConfirmBusy = false;
let monthConfirmDocs = {}, monthConfirmFailed = 0;   // { 'YYYY-MM': 문서|null }, 읽지 못한 달 수
let cache = null;          // { sig, models, week, month? }
let token = 0;             // 늦게 끝난 앞 요청이 새 화면을 덮지 않게
let loaded = false;        // 예정 물량·미발 이력을 한 번 기다렸나
let lastCtx = {};
const docErr = new Map();  // 문서 id → 오류 코드(권한 없음 등)
let items = null;          // 실행 관리 과제(OpsPlanItems, 올해·내년) — null = 아직 안 읽음
let itemsBusy = false, itemsAgain = false;
let itemQ = Promise.resolve();   // 과제 고치기를 한 줄로 — 동시에 두 번 쓰면 규칙(version + 1)이 뒤엣것을 거부한다
export function invalidateOpsPlan() { cache = null; }

const plannedSum = () => (State.plannedData || []).reduce((t, d) => t + Object.values((d && d.plannedQuantities) || {}).reduce((a, v) => a + (Number(v) || 0), 0), 0);
// 퇴사·팀 구성 열쇠 — 숙련도(퇴사자 제외)·공급·교육 후보(팀 그룹)가 바뀐다. 이름은 길이·글자 합으로만 접는다(문자열로 남기지 않음)
const peopleKey = () => {
    const cfg = State.appConfig || {};
    const s = JSON.stringify([cfg.resignedMembers || {}, (cfg.teamGroups || []).map(g => (g && g.members) || [])]);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return `${s.length}:${h}`;
};
/** 계획 계산에 쓸 설정 — appConfig + OpsPlan/settings(관리자가 [비용·설정]에서 바꾼 연장·알바 기준, 금액 아님) */
const SETTING_KEYS = ['overtimeDailyMax', 'overtimeWeeklyMax', 'tempLeadDays', 'stdHours'];
function planCfg() {
    const cfg = State.appConfig || {};
    const s = docOf('settings');
    if (!s) return cfg;
    const o = {};
    SETTING_KEYS.forEach(k => { if (s[k] != null) o[k] = s[k]; });
    return { ...cfg, opsPlan: { ...(cfg.opsPlan || {}), ...o } };
}
const settingsKey = () => { const s = docOf('settings'); return s ? SETTING_KEYS.map(k => s[k]).join(',') : '-'; };
const sigOf = (from, ctx) => `${from}|${(State.allHistoryData || []).length}|${(State.plannedData || []).length}|${plannedSum()}|${ctx && ctx.canAnalysis === false ? 0 : 1}|${loaded ? 1 : 0}|${peopleKey()}|${settingsKey()}`;

const mondayOf = (id) => { const w = new Date(`${id}T00:00:00`).getDay(); return addDaysStr(id, -((w + 6) % 7)); };

/** 운영 리포트 모델 묶음 — 최근 4주·그 앞 4주·최근 8주·지난주. 주간·월간·목표가 같이 쓴다. */
function computeModels(today) {
    const cfg = State.appConfig || {};
    const view = aliasHistoryView(State.allHistoryData || [], cfg) || [];
    const span = (from, to) => view.filter(d => d && typeof d.id === 'string' && d.id >= from && d.id < to);
    const mk = (days) => (days.length ? buildOpsModel({ days, allDays: view, ownerDays: false, cfg, today, canCost: false }) : null);
    const recentModel = mk(span(addDaysStr(today, -28), today));
    const prevModel = mk(span(addDaysStr(today, -56), addDaysStr(today, -28)));
    const baseModel = mk(span(addDaysStr(today, -56), today));
    const lastMon = addDaysStr(mondayOf(today), -7);
    const inp = opsModelInputs('week', getWeekOfYear(new Date(`${lastMon}T00:00:00`)), view);
    const lastWeekModel = (inp.days || []).length ? buildOpsModel({ ...inp, allDays: view, ownerDays: false, cfg, today, canCost: false }) : null;
    return { view, recentModel, prevModel, baseModel, lastWeekModel, lastMon };
}

/** 주간 계획 — 입력 모으기 → buildWeekPlan. DOM 을 읽지 않는다. */
function computeWeek(today, models) {
    const cfg = planCfg();
    const range = nextWeekRange(today);
    const S = planSettingsOf(cfg);
    const prepNames = S.prepTaskIds.map(id => taskNameOf(id, cfg)).filter(Boolean);
    const outlookRows = (getStaffingOutlook(7, { from: range.from, until: range.to }) || []).map(r => {
        const remap = (m) => { const th = {}; Object.entries(m || {}).forEach(([k, v]) => { const nk = aliasTaskName(k, cfg) || k; th[nk] = (th[nk] || 0) + (Number(v) || 0); }); return th; };
        return { ...r, taskHours: remap(r.taskHours), ...(r.riskTaskHours ? { riskTaskHours: remap(r.riskTaskHours) } : {}) };
    });
    // 사람(숙련도·한 사람 의존·배치 초안) — 이름은 메모리에서만, 계획(과제·리스크)에는 수만 넘긴다
    let people = null;
    try { people = computePeople(today, range, outlookRows); }
    catch (err) { console.warn('운영 계획 사람·배치 계산 실패:', err && err.message); }
    const plan = buildWeekPlan({
        today, range, outlookRows, cfg, prepNames,
        afterHoliday: precedingHolidayNameOf,
        recentModel: models.recentModel, lastWeekModel: models.lastWeekModel, accuracyErr: getLoadedAccuracyHourErr(),
        recordRate: recordRateOf(models.view, today),   // 신뢰도 v2 — 최근 8주 기록률
        bus: busForPlan(people)
    });
    // 📐 업무 예상 보정 계획이 걸렸는지 근거에 한 줄(필요·공급 숫자는 이미 보정 값)
    const cor = outlookRows.filter(r => r && r.correction);
    if (cor.length && plan && plan.meta && Array.isArray(plan.meta.basis)) {
        const on = cor.filter(r => r.correction.applied).length;
        plan.meta.basis.push(on > 0 ? `업무 예상 보정 계획 적용(${on}/${cor.length}일) — 지난 실적으로 업무별 편향·계획 밖 반복 업무·돌발 여유를 더함` : '업무 예상 보정 전 계획');
    }
    return { plan, people };
}

/** 이번 화면의 기간 정보 — { periodKey, id(확정본), prevId(지난 기간), prevLabel, prevDays(실제 하루 문서) } */
function periodOf(p, models) {
    if (horizon === 'quarter') {   // 분기(v2 D2) — 지난 분기 비교는 아직 없다
        return { periodKey: p.meta.key, id: planDocId('quarter', p.meta.key), prevId: null, prevLabel: '', prevDays: () => [] };
    }
    if (horizon === 'year') {   // 연간 — 지난 연간 확정본 비교는 하지 않는다
        return { periodKey: p.meta.key, id: planDocId('year', p.meta.key), prevId: null, prevLabel: '', prevDays: () => [] };
    }
    if (horizon === 'month') {
        const lk = lastMonthKeyOf(p.meta.today);
        return {
            periodKey: p.meta.key, id: planDocId('month', p.meta.key), prevId: lk ? planDocId('month', lk) : null,
            prevLabel: lk ? `지난달(${lk})` : '', prevDays: () => models.view.filter(d => d && typeof d.id === 'string' && lk && d.id.startsWith(lk + '-'))
        };
    }
    const lm = models.lastMon;
    return {
        periodKey: p.meta.from, id: planDocId('week', p.meta.from), prevId: planDocId('week', lm),
        prevLabel: `지난주(${fmtDay(lm)}~${fmtDay(addDaysStr(lm, 6))})`,
        prevDays: () => models.view.filter(d => d && typeof d.id === 'string' && d.id >= lm && d.id <= addDaysStr(lm, 6))
    };
}

// ── 원격 문서(목표·확정본) — 읽고 나면 다시 그린다 ─────────────────────
function want(id) {
    if (!id || peekPlanDoc(id) !== undefined || docErr.has(id)) return;
    docErr.set(id, 'loading');
    // 계획 기준(settings)이 오면 다시 계산, 나머지는 다시 그리기만
    //   비용 설정이 오면 연간(성수기 준비 주 = 채용 + 교육 주)을 다시 계산
    loadPlanDoc(id).then(() => {
        docErr.delete(id);
        if (id === 'admin:' + COST_DOC && cache) cache.year = null;
        if (id === 'settings' || id === 'admin:' + COST_DOC) renderOpsPlan(); else repaint();
    })
        .catch(err => { docErr.set(id, (err && err.code) || 'error'); console.warn('운영 계획 문서 읽기 실패:', id, err && err.code); repaint(); });
}
const docOf = (id) => { const v = peekPlanDoc(id); return v === undefined ? null : v; };
const docState = (id) => (docErr.has(id) ? docErr.get(id) : peekPlanDoc(id) === undefined ? 'loading' : 'ok');

// ── 그리기 ────────────────────────────────────────────────────────
const CONF_CHIP = { high: 'is-ok', mid: 'is-warn', low: 'is-risk' };

function headHtml(p, per, confirmed) {
    const c = p.meta.confidence;
    const range = horizon === 'quarter' ? `다음 분기 ${p.meta.label}(${fmtDay(p.meta.from)} ~ ${fmtDay(p.meta.to)})` : horizon === 'year' ? `내년 ${p.meta.key}년 1~12월` : horizon === 'month' ? `다음 달 ${fmtDay(p.meta.from)} ~ ${fmtDay(p.meta.to)}` : `다음 주 ${fmtDay(p.meta.from)} ~ ${fmtDay(p.meta.to)}`;
    const st = docState(per.id);
    const conf = st === 'loading' ? '확정본 확인 중…'
        : st !== 'ok' ? '확정본을 읽지 못했습니다(권한 또는 연결)'
            : confirmed ? `확정본 v${confirmed.version}${confirmed.confirmedAt && confirmed.confirmedAt.toDate ? ` · ${fmtDay(ymd(confirmed.confirmedAt.toDate()))} 확정` : ''} — 아래는 지금 다시 계산한 값입니다`
                : '아직 확정하지 않은 미리보기입니다';
    const confBtn = isAdmin()
        ? `<button type="button" id="ops-plan-confirm-btn" class="ops-make-btn opp-noprint" title="지금 계획을 확정본으로 저장합니다(다시 확정하면 버전 + 1)">${esc(confirmed ? `다시 확정(v${(confirmed.version || 0) + 1})` : '계획 확정')}</button>` : '';
    // 신뢰도 v2 — 근거(reasons)와 올리려면(nextUpgrade)
    const confNote = (horizon === 'quarter' ? '연간 어림을 따름 · ' : '') + (c.reasons || []).join(' · ') + (c.nextUpgrade ? ` · 올리려면(${c.nextUpgrade.when}): ${c.nextUpgrade.need}` : '');
    return `<div class="opp-head">
        <div class="ops-tabs opp-gran" aria-label="계획 기간">
            <button type="button" class="ops-tab${horizon === 'week' ? ' is-on' : ''}" data-plan-horizon="week" aria-pressed="${esc(horizon === 'week')}">주간</button>
            <button type="button" class="ops-tab${horizon === 'month' ? ' is-on' : ''}" data-plan-horizon="month" aria-pressed="${esc(horizon === 'month')}">월간</button>
            <button type="button" class="ops-tab${horizon === 'quarter' ? ' is-on' : ''}" data-plan-horizon="quarter" aria-pressed="${esc(horizon === 'quarter')}">분기</button>
            <button type="button" class="ops-tab${horizon === 'year' ? ' is-on' : ''}" data-plan-horizon="year" aria-pressed="${esc(horizon === 'year')}">연간 계획서</button>
        </div>
        <span class="opv-note">${esc(range)} · ${esc(conf)}</span>
        <span class="opp-head-btns">${confBtn}<button type="button" id="ops-plan-print-btn" class="opv-btn opp-noprint" title="지금 보이는 계획서를 인쇄합니다(인쇄 창에서 PDF 로 저장 가능)">인쇄 / PDF</button></span>
    </div>
    <div class="opp-conf">
        <span class="opv-chip ${esc(CONF_CHIP[c.level] || '')}">신뢰도 ${esc(c.label)}</span>
        <span class="opv-note">${esc(confNote)}</span>
    </div>`;
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const summaryHtml = (p) => card('요약', `<ul class="opv-diag">${p.summary.map(s => `<li><span class="opv-dot"></span><span>${esc(s)}</span></li>`).join('')}</ul>`);

function daysHtml(p) {
    const rows = p.days.map(d => {
        if (!d.workday) return `<tr class="opp-off"><td>${fmtDay(d.date)}</td><td colspan="8" class="opv-note">${d.holiday ? esc(d.holidayName || '공휴일') : '주말'} — 쉬는 날</td></tr>`;
        if (!d.hasRow || d.failed) return `<tr><td>${fmtDay(d.date)}</td><td colspan="8" class="opv-note">${d.failed ? '업무 예상 계산에 실패했습니다' : '업무 예상 범위 밖이라 숫자가 없습니다'}</td></tr>`;
        const short = d.gap < 0;
        const gapTxt = d.gap === 0 ? '적정' : d.gap > 0 ? `+${d.gap}명` : `${d.gap}명`;
        const use = d.spareFTE > 0 ? `${esc(d.recommend)}명 <span class="opv-note">(교육·정리 ${esc(d.spareFTE)}명)</span>` : `${d.recommend}명`;
        return `<tr class="${short ? 'is-short' : ''}">
            <td>${fmtDay(d.date)}</td><td class="r">${esc(n1(d.demandHours))}</td><td class="r">${esc(n1(d.reqFTE))}</td>
            <td class="r">${esc(d.supplyFTE)}명${d.leaveCount ? ` <span class="opv-note">(휴무 ${esc(d.leaveCount)})</span>` : ''}</td>
            <td class="r"><b class="${esc(short ? 'opv-down' : d.gap > 0 ? 'opv-up' : 'opv-flat')}">${esc(gapTxt)}</b></td>
            <td class="r">${esc(pct0(d.fillRate))}</td><td class="r">${use}</td>
            <td>${short ? esc(fillText(d.fill)) || '—' : '—'}</td>
            <td><span class="opv-chip ${d.hasPlanned ? 'is-warn' : ''}" title="${d.hasPlanned ? '저장해 둔 예정 물량으로 계산' : '예정 물량이 없어 실적 기반 추정'}">${d.hasPlanned ? '예정' : '추정'}</span></td>
        </tr>`;
    }).join('');
    return card('날짜별 계획', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>날짜</th><th class="r" title="그날 모든 업무의 인시 합계(업무 예상과 같음)">작업량(인시)</th><th class="r" title="반올림 전 필요 인원">필요</th>
        <th class="r" title="재직 − 휴무 − 관리자 개별업무">공급</th><th class="r" title="공급 − 필요(반올림) — 인력 탭 표와 같음">과부족</th><th class="r">충족률</th>
        <th class="r" title="필요 인원(올림), 공급을 넘지 않음">권장 투입</th><th>메우기</th><th>근거</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`, '수요·공급 = 업무 예상과 같은 계산');
}

function fillTotalsHtml(p) {
    const T = p.fillTotals, S = p.meta.settings;
    return card('부족 메우기 합계', `<div class="opv-kpis">
        ${kpi('부족 합계', n1(T.need), '시간')}
        ${kpi('① 전날 선처리', n1(T.prep), '시간', '준비 기간 0일')}
        ${kpi('② 연장', n1(T.overtime), '시간', `1인 주 ${n1(T.overtimePerPersonWeek)}시간 / 상한 ${n1(S.overtimeWeeklyMax)}시간`)}
        ${kpi('③ 알바', n0(T.tempPeople), '명·일', `${n1(T.temp)}시간 · 요청 후 ${n0(T.leadDays.temp)}일`)}
    </div>
    <p class="opv-note opp-law">${esc(OVERTIME_LAW_NOTE)}</p>
    <p class="opv-note">지금 기준: 1인 하루 연장 ${esc(n1(S.overtimeDailyMax))}시간 · 주 ${esc(n1(S.overtimeWeeklyMax))}시간, 알바 1인일 ${esc(n1(S.stdHours))}시간 · 요청 후 ${esc(n0(S.tempLeadDays))}일(관리자 [비용·설정]에서 바꿈).</p>`,
    '순서: 선처리 → 연장 → 알바 · 시간·인원만');
}

const notesLine = (p) => ((p.meta.notes || []).length ? `<p class="opv-note">${p.meta.notes.map(esc).join(' ')}</p>` : '');
function risksHtml(p) {
    if (!p.risks.length) return card('리스크', `${notesLine(p)}<p class="opv-note">눈에 띄는 리스크가 없습니다.</p>`);
    const lv = (v) => ['', '낮음', '보통', '높음'][v] || '—';
    const rows = p.risks.map(r => `<tr>
        <td>${esc(r.title)}</td><td class="r">${lv(r.likelihood)}</td><td class="r">${lv(r.impact)}</td><td class="r"><b>${esc(r.score)}</b></td>
        <td class="opp-wrap">${esc(r.trigger)}</td><td class="opp-wrap">${esc(r.response)}</td><td>${esc(r.owner)}</td></tr>`).join('');
    return card('리스크', `${notesLine(p)}<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>항목</th><th class="r">가능성</th><th class="r">영향</th><th class="r">점수</th><th>근거</th><th>대응 제안</th><th>담당</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`);
}

const ST_TXT = { off: ['', '쉼'], none: ['', '—'], short: ['is-risk', '부족'], spare: ['is-ok', '여유'], ok: ['', '적정'] };
function meetingHtml(p, prevCmp) {
    const M = p.meeting;
    const L = M.lastWeek;
    const last = L ? `<p class="opv-note">${fmtDay(L.from)} ~ ${fmtDay(L.to)} · 운영일 ${esc(L.operatingDays)}일</p><div class="opv-kpis">
        ${kpi('처리량', n0(L.qty), '개', `하루 평균 ${n0(L.qtyPerDay)}개`)}
        ${kpi('충족률', pct0(L.fillRate), '', `출근 ${n1(L.attended)} / 필요 ${n1(L.required)}명 · 부족한 날 ${L.shortDays == null ? '—' : L.shortDays}일`)}
        ${kpi('UPH', n1(L.uph), '개/시')}
        ${kpi('OEE', n1(L.oee), '%')}
    </div>` : '<p class="opv-note">지난주 기록이 없습니다.</p>';
    const vs = prevCmp ? `<p class="opv-note opp-gap"><b>지난주 계획 대비</b> — 확정본 v${esc(prevCmp.summary.version)}: 필요 인원 오차 ${esc(ok(prevCmp.summary.reqErrPct) ? signed1(prevCmp.summary.reqErrPct) + '%' : '—')} · 부족한 날 계획 ${esc(prevCmp.summary.planShortDays)}일 / 실제 ${esc(prevCmp.summary.actualShortDays)}일 · 지킨 과제 ${esc(prevCmp.summary.actionsDone)}/${esc(prevCmp.summary.actionsTotal)}</p>`
        : '<p class="opv-note opp-gap">지난주 확정본이 없어 계획 대비 실적은 비웁니다.</p>';
    const week = `<div class="opp-week">${M.week.map(w => {
        const [cls, txt] = ST_TXT[w.status] || ['', ''];
        const extra = w.status === 'short' ? ` ${w.gap}명` : w.status === 'spare' ? ` +${w.spareFTE}명` : '';
        return `<div class="opp-week-day"><div class="opv-note">${fmtDay(w.date)}</div><span class="opv-chip ${cls}">${esc(txt)}${esc(extra)}</span></div>`;
    }).join('')}</div>`;
    const dec = M.decisions.length ? `<ul class="opv-diag">${M.decisions.map(d => `<li><span class="opv-dot ${d.late ? 'is-risk' : 'is-warn'}"></span><span>${esc(d.text)}${d.due ? ` <span class="opv-note">— ${fmtDay(d.due)}까지${d.late ? '(이미 지남 — 준비 기간이 모자랍니다)' : ''}</span>` : ''}</span></li>`).join('')}</ul>`
        : '<p class="opv-note">결정할 것이 없습니다.</p>';
    const top = M.topRisks.length ? `<ul class="opv-diag">${M.topRisks.map(r => `<li><span class="opv-dot is-warn"></span><span>${esc(r.title)} <span class="opv-note">— ${esc(r.response)} (${esc(r.owner)})</span></span></li>`).join('')}</ul>`
        : '<p class="opv-note">없음</p>';
    const sch = `<ul class="opv-diag">${M.schedule.map(s => `<li><span class="opv-dot"></span><span><b>${esc(s.when)}</b> ${esc(s.what)}</span></li>`).join('')}</ul>`;
    return card('주간 회의 자료', `<div class="opv-sub-title">지난주 실적</div>${last}${vs}
        <div class="opv-sub-title opp-gap">다음 주 날짜별</div>${week}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 opp-gap">
            <div><div class="opv-sub-title">결정할 것</div>${dec}</div>
            <div><div class="opv-sub-title">상위 리스크 3</div>${top}</div>
            <div><div class="opv-sub-title">다음 일정</div>${sch}</div>
        </div>`);
}

const basisHtml = (p) => `<p class="opv-note">${p.meta.basis.map(esc).join(' · ')}</p>`;

/** 목표 카드 입력 — 현재(최근 8주 평소, 충족률은 이 계획 예측)·목표(저장/제안)·차이 환산 맥락 */
function targetsBlock(p, per, models, budget) {
    const base = baselineOf(models.baseModel);
    const money = budget && !budget.locked;   // 관리자 — 인건비율 행
    const defaults = defaultTargets(money ? { ...base, laborRatio: budget.baseLaborRatio } : base);
    const tDoc = docOf('targets');
    const { targets, src } = targetsFor(tDoc, horizon, per.periodKey, defaults);
    const work = p.days.filter(d => d.workday && d.hasRow);
    const fr = work.map(d => d.fillRate).filter(v => v != null);
    const cur = { ...base, fillRate: fr.length ? (fr.reduce((a, b) => a + b, 0) / fr.length) * 100 : null };
    const qty = (base.qtyPerDay || 0) * work.length;
    const workHours = work.reduce((t, d) => t + d.supplyFTE * (d.hoursPerPerson || 8), 0);
    const rows = gapRows(cur, targets, { qty, workHours, shortToTarget: shortToTargetHours(work, targets.fillRate),
        laborRatio: money ? { current: budget.ratio != null ? budget.ratio * 100 : null } : null });
    const st = docState('targets');
    const note = st === 'loading' ? '저장된 목표를 확인하는 중…' : st !== 'ok' ? '저장된 목표를 읽지 못해 제안값으로 보입니다.' : (tDoc ? '' : '저장된 목표가 없어 제안값(최근 8주 평소 기준)으로 보입니다.');
    return { html: targetsCardHtml(rows, src, { note, isAdmin: isAdmin() }), targets, defaults, tDoc };
}

let view = null;   // 마지막으로 그린 것 { p, per, confirmed, targets, defaults, tDoc }

/** 하루 문서들 → 운영 리포트 모델 staffDays(계획 대비 실적의 '실제') */
function staffDaysFrom(days, models, today) {
    const m = days.length ? buildOpsModel({ days, allDays: models.view, ownerDays: false, cfg: State.appConfig || {}, today, canCost: false }) : null;
    return m ? m.staffDays : [];
}

function paint(host) {
    const c = cache;
    const p = horizon === 'quarter' ? quarterPlanOf(c) : horizon === 'year' ? c.year : horizon === 'month' ? c.month : c.week;
    const per = periodOf(p, c.models);
    want('targets'); want(per.id); want(per.prevId);
    if (isAdminNow()) want('admin:' + COST_DOC);
    // 💰 관리자만 — 비관리자는 locked(숫자 없음)이고 섹션을 그리지 않는다
    const costDoc = isAdminNow() ? docOf('admin:' + COST_DOC) : null;
    const budget = horizon === 'quarter' ? { locked: true } : horizon === 'year' ? computeYearBudget(p, { today: p.meta.today, costDoc })
        : computeBudget(horizon, p, { today: p.meta.today, cfgPlan: planCfg(), costDoc });
    const confirmed = docOf(per.id);
    const prev = docOf(per.prevId);
    let prevCmp = null;
    if (prev) {
        prevCmp = planVsActual(prev, staffDaysFrom(per.prevDays(), c.models, p.meta.today));
    }
    // 연간은 목표 카드 없이(달별 행이라 차이 환산 기준이 다르다) — 확정본 targets 는 저장값·제안값 그대로
    const T = horizon === 'year' || horizon === 'quarter' ? { html: '', targets: {}, defaults: null, tDoc: docOf('targets') } : targetsBlock(p, per, c.models, budget);
    // 개선 로드맵 — 최근 4주 손실에서, 운영 마일스톤(planTaskKey)과 이어 '실행됨·효과'
    ensureMilestones();
    const rmBase = buildRoadmap(c.models.recentModel, { from: p.meta.from });
    const rm = { ...rmBase, items: attachMilestones(rmBase.items, msMod ? msMod.getMilestonePlanLinks() : [], c.models.view, { cfg: State.appConfig || {}, today: p.meta.today }) };
    // 시뮬레이터 기본값(금액은 관리자만)
    simBase = horizon === 'quarter' ? { rows: [], oee: null, money: { canMoney: false } } : simBaseOf(p, c.models, budget, costDoc);
    view = { p, per, confirmed, targets: T.targets, defaults: T.defaults, tDoc: T.tDoc, budget, roadmap: rm };
    const money = budget && !budget.locked ? (horizon === 'year' ? yearBudgetHtml(budget) : budgetHtml(budget, { horizon })) : '';
    ensureItems();
    const rmHtml = roadmapHtml(rm, { isAdmin: isAdmin(), loading: !msMod, makeBtn: mk });
    const extras = horizon === 'year' ? simHtml(simBase, simLever) : horizon === 'quarter' ? rmHtml : `${rmHtml}${simHtml(simBase, simLever)}`;
    const mode = confirmed ? (isAdmin() ? 'doc' : 'view') : 'local';
    const doneMap = confirmed ? (confirmed.done || {}) : null;
    const done = (k) => (doneMap ? doneMap[k] === true : localDone(k));
    const body = horizon === 'quarter'
        ? `${quarterBodyHtml(p, { done, makeBtn: mk, itemsHtml: itemsBlock(i => i.quarter === p.meta.key, { title: `${p.meta.label} 과제 진행`, today: p.meta.today, empty: '이 분기 과제가 아직 없습니다. 핵심 과제의 [과제로 만들기]로 만듭니다.' }) })}${extras}`
        : horizon === 'year'
        ? `${yearDocOf(p, c, rm, rmHtml, money, actionsHtml(p.actions, { done, mode, title: '연간 과제', empty: '내년에 따로 준비할 일이 없습니다.' }))}${extras}`
        : horizon === 'month'
        ? `${monthBodyHtml(p)}${money}${actionsHtml(p.actions, { done, mode, title: '월간 과제 (우선순위)', empty: '다음 달에 따로 준비할 일이 없습니다.' })}${extras}`
        : `${daysHtml(p)}${fillTotalsHtml(p)}${money}${actionsHtml(p.actions, { done, mode, empty: '다음 주에 따로 준비할 일이 없습니다.' })}${risksHtml(p)}${peopleHtml(c.people, { canNames: !!lastCtx.canNames, selDate, makeBtn: mk })}${meetingHtml(p, prevCmp)}${weekItemsHtml(p.meta.today)}${extras}`;
    host.innerHTML = `<div id="ops-plan-sheet" class="opv-stack">
        ${headHtml(p, per, confirmed)}
        ${prevCmp ? compareCardHtml(prevCmp, per.prevLabel) : ''}
        ${summaryHtml(p)}
        ${T.html}
        ${body}
        ${basisHtml(p)}
    </div>`;
}

function repaint() {
    const host = $('ops-plan-body');
    if (!host || !cache || !document.getElementById('ops-plan-sheet')) return;
    if ((horizon === 'month' && !cache.month) || ((horizon === 'year' || horizon === 'quarter') && !cache.year)) return;
    try { paint(host); } catch (err) { console.error('운영 계획 그리기 실패:', err && err.message); }
}

/** 운영 계획 탭 그리기 — js/ui-history-ops-report.js renderTab('plan'). ctx = { canAnalysis } */
export function renderOpsPlan(ctx = lastCtx) {
    lastCtx = ctx || {};
    bindOnce();
    const host = $('ops-plan-body');
    if (!host) return;
    const today = getTodayDateString();
    const range = nextWeekRange(today);
    const my = ++token;
    want('settings');   // 계획 기준 — 오면 다시 계산(want 안에서)
    ensureMonthlies(today);
    if (horizon === 'month') ensureMonthConfirms(today);
    const draw = () => {
        if (my !== token) return;
        const sig = sigOf(range.from, lastCtx);
        try {
            if (!cache || cache.sig !== sig) {
                const models = computeModels(today);
                const w = computeWeek(today, models);
                cache = { sig, models, week: w.plan, people: w.people, month: null };
            }
            if (horizon === 'month' && !cache.month) cache.month = monthPlanOf(today, cache.models);
            if ((horizon === 'year' || horizon === 'quarter') && !cache.year) {   // 분기도 연간 어림(달별 인력·Y 과제)을 쓴다
                // 성수기 준비 기간 = 관리자 비용 설정(채용 + 교육 주) — 비관리자는 기본 6주(금액 아님)
                const cs = isAdminNow() && docOf('admin:' + COST_DOC) ? costSettingsOf(docOf('admin:' + COST_DOC)) : null;
                cache.year = computeYearPlan(today, planCfg(), { leadWeeks: cs ? cs.hireLeadWeeks + cs.trainWeeksDefault : null, monthlies: monthlies || [] });
            }
        } catch (err) {
            console.error('운영 계획 계산 실패:', err && err.message);
            host.innerHTML = '<div class="opv-empty">운영 계획을 계산하지 못했습니다. 새로고침 후 다시 시도해 주세요.</div>';
            return;
        }
        paint(host);
    };
    if (!(State.allHistoryData || []).length) { host.innerHTML = '<div class="opv-empty">기록을 불러오는 중...</div>'; return; }
    if (loaded) { draw(); return; }
    host.innerHTML = '<div class="opv-empty">예정 물량을 불러오는 중...</div>';
    // 업무 예상과 같은 숫자 — 예정 물량·미발 이력(입고일 국내배송)을 기다린 뒤 계산한다(인력 탭과 같은 순서)
    Promise.all([fetchPlannedData(), ensureMibalHistory(), ensureCorrectCtx()])   // 보정 계획(지난 스냅샷)도 — 업무 예상과 같은 숫자
        .catch(() => {})
        .then(() => { loaded = true; cache = null; draw(); });
}

// 지난 스냅샷을 새로 읽은 뒤(정확도 새로고침·스냅샷 삭제·자정) — 보고 있는 계획의 보정 숫자·실측 오차를 다시 계산한다
window.addEventListener('forecast-correction-ready', () => {
    const host = $('ops-plan-body');
    if (!loaded || !host || !host.offsetParent) return;
    cache = null;
    try { renderOpsPlan(); } catch (e) { console.warn('운영 계획 다시 그리기 실패:', e && e.message); }
});

// ── 완료 체크 ────────────────────────────────────────────────────
const localDone = (key) => { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } };

async function onDoneChange(cb) {
    const key = cb.dataset.planDone;
    const v = view;
    if (v && v.confirmed) {
        if (!isAdmin()) { cb.checked = !cb.checked; return; }
        if (!(v.confirmed.actions || []).some(a => a.key === key)) {
            showToast('이 과제는 확정할 때 없던 과제라 확정본에 저장되지 않습니다 — 다시 확정해 주세요.');
            cb.checked = !cb.checked;
            return;
        }
        cb.disabled = true;
        try {
            await saveDone(v.per.id, key, cb.checked);   // 칸 하나만 — 다른 체크를 덮지 않는다
            await loadPlanDoc(v.per.id, { force: true });
            repaint();
        } catch (err) {
            console.error('운영 계획 완료 체크 저장 실패:', err && err.code);
            showToast('완료 체크를 저장하지 못했습니다.');
            cb.checked = !cb.checked; cb.disabled = false;
        }
        return;
    }
    try { if (cb.checked) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch (err) { /* 저장 못 해도 화면만 */ }
    cb.closest('.opp-act')?.classList.toggle('is-done', cb.checked);
}

// ── 확정 ─────────────────────────────────────────────────────────
let armTimer = null;
/** 지금 확정하면 안 되는 이유(읽는 중) — 없으면 ''. 지난 확정본 없이 계산한 낮은 점수·빈 설정으로 계산한 금액이 굳지 않게 */
function confirmWaitMsg() {
    if (horizon === 'month' && monthConfirmBusy) return '지난 확정본을 불러오는 중입니다. 잠시 뒤 다시 확정해 주세요.';
    if (view.budget && !view.budget.locked && isAdminNow() && docState('admin:' + COST_DOC) === 'loading') return '비용 설정을 불러오는 중입니다. 잠시 뒤 다시 확정해 주세요.';
    return '';
}
async function onConfirm(btn) {
    if (!isAdmin() || !view) return;
    const waitMsg = confirmWaitMsg();
    if (waitMsg) { showToast(waitMsg); return; }
    // 실수로 누르지 않게 두 번 누름(확인 창 대신 — role=dialog 를 쓰지 않는다)
    if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.dataset.label = btn.textContent;
        btn.textContent = '한 번 더 누르면 확정합니다';
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { if (btn.isConnected) { btn.textContent = btn.dataset.label; delete btn.dataset.armed; } }, 5000);
        return;
    }
    clearTimeout(armTimer);
    btn.disabled = true;
    const { p, per, targets } = view;
    try {
        // 배치 초안은 업무별 인원·시간 합계만(이름 없음 — redactForOutput 을 지난 값)
        const assignCounts = horizon === 'week' && cache && cache.people ? assignCountsOf(cache.people) : null;
        const body = confirmDocOf(p, { horizon, periodKey: per.periodKey, targets, assignCounts });
        // 이 브라우저(localStorage)의 체크는 옮기지 않는다. 다시 확정이면 같은 과제의 확정본 체크만 이어받는다(ops-plan-store confirmPlan).
        // 💰 관리자 예산(금액)은 같은 트랜잭션으로 adminPrivate/opsPlanBudget 에만 — 확정본(OpsPlan)에는 금액 0
        const b = view.budget;
        let budget = b && !b.locked && isAdminNow() ? { entry: budgetEntryOf(b, Date.now()), trim: trimBudgetPlans } : null;
        if (budget) {
            // 비용 설정을 읽지 못했으면 예산을 저장하지 않는다(빈 설정으로 계산한 금액을 남기지 않게)
            const cs = docState('admin:' + COST_DOC);
            if (cs !== 'ok') { budget = null; showToast('비용 설정을 읽지 못해 이번 확정에는 예산을 저장하지 않습니다.'); }
        }
        const ver = await confirmPlan(per.id, body, budget);
        await loadPlanDoc(per.id, { force: true });
        showToast(`계획을 확정했습니다(v${ver}).`);
        repaint();
    } catch (err) {
        console.error('운영 계획 확정 실패:', err && err.code);
        showToast('계획을 확정하지 못했습니다(권한 또는 연결).');
        btn.disabled = false;
    }
}

// ── 인쇄 ─────────────────────────────────────────────────────────
function printPlan() {
    const sheet = $('ops-plan-sheet');
    if (!sheet) return;
    let box = $('ops-plan-print');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'ops-plan-print';
    box.className = 'opp-print';
    box.innerHTML = `${horizon === 'year' ? '' : `<h1 class="opp-print-title">${esc(horizon === 'quarter' ? '분기' : horizon === 'month' ? '월간' : '주간')} 운영 계획서</h1>`}${sheet.innerHTML}`;   // 연간은 표지가 제목
    // 사람·배치는 이름 없는 인쇄용으로 바꿔 넣는다(redactForOutput 을 지난 수만)
    //   검사는 사람 섹션 인쇄본만(다른 섹션은 원래 이름이 없다), 업무명·고정 문구는 빼고 본다.
    const ppl = box.querySelector('#ops-plan-people');
    if (ppl) {
        const html = peoplePrintHtml(cache && cache.people);
        const probe = document.createElement('div');
        probe.innerHTML = html;
        if (namesLeak(probe.textContent, namesOf(cache && cache.people), { ignore: ignoreWordsOf(cache && cache.people) })) {
            // 어떤 이름인지는 찍지 않는다
            console.warn('운영 계획 인쇄 중단: 사람 섹션에 이름과 같은 글자가 있습니다.');
            showToast('사람 이름과 같은 글자가 있어 인쇄를 멈췄습니다.');
            return;
        }
        ppl.outerHTML = html;
    }
    box.querySelectorAll('.opp-noprint, .opp-gran, .opp-names').forEach(el => el.remove());
    // 연간 계획서 — 표지·목차를 맨 앞으로
    const toc = box.querySelector('.opp-toc'), cover = box.querySelector('.opp-cover');
    if (toc) box.prepend(toc);
    if (cover) box.prepend(cover);
    box.querySelectorAll('details').forEach(el => { el.open = true; });
    box.querySelectorAll('input[type="checkbox"]').forEach(el => { el.disabled = true; });
    document.body.appendChild(box);
    document.documentElement.classList.add('opp-printing');
    const done = () => {
        document.documentElement.classList.remove('opp-printing');
        $('ops-plan-print')?.remove();
        window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    try { window.print(); } catch (e) { done(); }
}

// ── 이벤트(한 번만) ───────────────────────────────────────────────
let bound = false;
function bindOnce() {
    if (bound) return;
    const panel = $('ops-plan-panel');
    if (!panel) return;
    bound = true;
    panel.addEventListener('click', (e) => {
        if (e.target.closest('#ops-plan-print-btn')) { printPlan(); return; }
        const hb = e.target.closest('[data-plan-horizon]');
        if (hb && !hb.disabled) {
            const h = hb.dataset.planHorizon;
            if (h !== horizon) { horizon = h; simLever = { ...SIM0 }; renderOpsPlan(); }
            return;
        }
        const pm = e.target.closest('[data-pi-make]');
        if (pm && isAdmin()) { onMakeItem(pm); return; }
        const pl = e.target.closest('[data-pi-log]');
        if (pl) { onShowLog(pl); return; }
        if (e.target.closest('#ops-goals-open') && isAdminNow()) { onOpenGoals(); return; }
        const yd = e.target.closest('#ops-yd-save');
        if (yd && isAdminNow()) { onSaveYearDoc(yd); return; }
        const mb = e.target.closest('#ops-plan-monthly-rebuild');
        if (mb && isAdminNow()) { onRebuildMonthly(mb); return; }
        const rb = e.target.closest('[data-plan-roadmap]');
        if (rb && isAdmin()) { runRoadmap(rb.dataset.planRoadmap); return; }
        const cbtn = e.target.closest('#ops-plan-confirm-btn');
        if (cbtn) { onConfirm(cbtn); return; }
        if (e.target.closest('#ops-plan-cost-open') && view && isAdminNow()) {
            openCostEditor({
                costDoc: docOf('admin:' + COST_DOC), settings: docOf('settings'), suggest: view.budget && view.budget.suggestRegular,
                onSaved: () => {
                    Promise.all([loadPlanDoc('admin:' + COST_DOC, { force: true }), loadPlanDoc('settings', { force: true })])
                        .catch(() => {}).then(() => { cache = null; renderOpsPlan(); });
                }
            });
            return;
        }
        if (e.target.closest('#ops-plan-targets-open') && view) {
            openTargetsEditor({ doc: view.tDoc, defaults: view.defaults, isAdmin: isAdmin(), onSaved: () => { loadPlanDoc('targets', { force: true }).then(repaint).catch(() => repaint()); } });
        }
    });
    // 시뮬레이터 슬라이더 — 결과 칸만 다시 그린다(계획은 다시 계산하지 않음)
    panel.addEventListener('input', (e) => {
        const sl = e.target.closest && e.target.closest('input[data-sim]');
        if (!sl) return;
        simLever = { ...simLever, [sl.dataset.sim]: Number(sl.value) };
        const lab = panel.querySelector(`[data-sim-val="${sl.dataset.sim}"]`);
        if (lab) lab.textContent = `${simLever[sl.dataset.sim] > 0 ? '+' : ''}${simLever[sl.dataset.sim]}${sl.dataset.sim === 'staffDelta' ? '명' : '%'}`;
        const out = $('ops-plan-sim-result');
        if (out) out.innerHTML = simResultHtml(simBase, simLever);
    });
    // 운영 마일스톤을 저장하면(로드맵 [실행]) 상태·효과를 다시
    document.addEventListener('milestone-saved', () => setTimeout(repaint, 800));
    panel.addEventListener('change', (e) => {
        const cb = e.target.closest('input[data-plan-done]');
        if (cb) { onDoneChange(cb); return; }
        const pi = e.target.closest('[data-pi-status],[data-pi-progress],[data-pi-check]');
        if (pi) { onItemChange(pi); return; }
        if (e.target && e.target.id === 'ops-plan-assign-date') { selDate = e.target.value; repaint(); }
    });
    // 휴무가 바뀌면 공급이 바뀐다 — 운영 계획 탭을 보는 중이면 다시 그린다(읽기만)
    onLeaveScheduleChanged('ops-plan', () => {
        cache = null;
        const c = State.context || {};
        if (c.activeHistoryView === 'ops' && c.activeOpsTab === 'plan' && !c.opsSettleOpen && !panel.classList.contains('hidden')) renderOpsPlan();
    });
}

// ── 개선 로드맵 · 시뮬레이터 ────────────────────────────────────────
/** 운영 마일스톤 모듈을 한 번 불러 구독(로드맵 '실행됨'·효과). 읽기만 — 등록은 [실행]으로 연 마일스톤 창에서 사람이 저장한다. */
function ensureMilestones() {
    if (msMod || ensureMilestones.busy) return;
    ensureMilestones.busy = true;
    import('./ui-history-milestones.js?v=202611131354').then(mod => {
        msMod = mod;
        try { mod.subscribeMilestones(); mod.bindMilestoneListeners(); } catch (e) { /* 마일스톤 화면 칸이 없어도 계획은 그린다 */ }
        return mod.ensureMilestonesLoaded();
    }).catch(err => console.warn('운영 마일스톤 불러오기 실패:', err && err.message))
        .then(() => { ensureMilestones.busy = false; setTimeout(repaint, 300); });
}

/** [실행] — 운영 마일스톤 등록 창을 과제 내용으로 연다(저장은 사람이 창에서). */
function runRoadmap(key) {
    const it = view && view.roadmap ? view.roadmap.items.find(x => x.key === key) : null;
    if (!it || !msMod) { showToast('운영 마일스톤을 불러오는 중입니다. 잠시 뒤 다시 눌러 주세요.'); return; }
    msMod.openEditModal(null, {
        date: getTodayDateString(), type: CAUSE_MS_TYPE[it.cause] || 'process', title: it.title,
        description: `운영 계획 개선 로드맵 과제 — 지표 ${it.kpi.name} ${it.kpi.from ?? '—'} → ${it.kpi.to ?? '—'}`,
        tags: ['운영계획'], affectedTasks: it.kpi.task ? [it.kpi.task] : [], planTaskKey: it.key
    });
}

/** 시뮬레이터 기본값 — 행(필요·공급)·평소 OEE·(관리자만) 금액 */
function simBaseOf(p, models, budget, costDoc) {
    const rows = simRowsOf(p);
    const oee = models.baseModel && models.baseModel.productivity ? models.baseModel.productivity.oee : null;
    let money = { canMoney: false };
    if (budget && !budget.locked && isAdminNow()) {
        const cs = costSettingsOf(costDoc);
        const monthly = cs.regularMonthlyBase != null ? cs.regularMonthlyBase : budget.suggestRegular;
        const factor = horizon === 'year' ? 12 : horizon === 'month' ? 1 : (p.days || []).length / MONTH_DAYS;
        const paid = (budget.means || []).filter(m => (m.key === 'overtime' || m.key === 'temp') && m.perHour != null).map(m => m.perHour);
        money = {
            canMoney: true, laborBase: budget.labor ? budget.labor.total : null, revenueBase: budget.revenue,
            perPersonCost: monthly != null ? monthly * factor : 0,
            // 연간은 연간 예산과 같은 대체값(알바 시급 → 없으면 연장 시급), 주·월은 비교표의 싼 유료 수단
            fillHourly: horizon === 'year' && budget.fillHourly != null ? budget.fillHourly
                : paid.length ? Math.min(...paid) : (cs.tempHourly != null ? cs.tempHourly : 0)
        };
    }
    return { rows, oee, money };
}

// ── 분기·연간 계획서(v2 D2) ─────────────────────────────────────────
/** 분기 계획(다음 분기) — 연간 어림·목표 연결·운영 목표·로드맵·자동화·데이터 관리를 모은다. 목표 연결 문서는 읽어 오면 다시 그린다. */
function quarterPlanOf(c) {
    const today = getTodayDateString();
    const Q = nextQuarterOf(today);
    // 다음 분기가 올해(1~3분기)면 연간 어림(내년)과 해가 다르다 — 그 해로 따로 어림한다
    let yp = c.year;
    if (!yp || Number(yp.meta.key) !== Q.year) {
        if (!c.yearForQ || Number(c.yearForQ.meta.key) !== Q.year) {
            const cs = isAdminNow() && docOf('admin:' + COST_DOC) ? costSettingsOf(docOf('admin:' + COST_DOC)) : null;
            c.yearForQ = computeYearPlan(today, planCfg(), { leadWeeks: cs ? cs.hireLeadWeeks + cs.trainWeeksDefault : null, monthlies: monthlies || [], year: Q.year });
        }
        yp = c.yearForQ;
    }
    want(`goals_${Q.year}`);
    const base = baselineOf(c.models.baseModel);
    const q = buildQuarterPlan({
        today, quarter: Q, goals: docOf(`goals_${Q.year}`), targets: docOf('targets'), current: base, yearPlan: yp,
        roadmap: buildRoadmap(c.models.recentModel, { from: Q.start }).items,
        automation: buildAutomationRoadmap(monthlies || [], { from: Q.start, cfg: State.appConfig || {} }).items,
        dataGaps: buildDataGaps(monthlies || [], { from: today }).items
    });
    // 신뢰도는 연간 어림을 따른다(분기 인력·과제가 연간에서 온다)
    q.meta.confidence = yp && yp.meta.confidence ? yp.meta.confidence : { level: 'low', label: '낮음', reasons: ['연간 어림 없음'], nextUpgrade: null };
    q.meta.basis = ['목표 = 목표 연결(분기 → 연) > 운영 목표(연)', '핵심 과제 = 연간 과제·개선 로드맵·자동화·데이터 관리 중 이 분기 것', '월별 인력 = 연간 계획 어림(1년치 기록 기준·참고용)'];
    q.actions = q.initiatives.map(i => ({ key: i.key, rule: i.kind, title: i.title, due: i.due, role: i.role, score: 0, basis: '', effect: '' }));
    return q;
}

/** 연간 계획서(문서형 12장) — 장 내용 모으기 */
function yearDocOf(p, c, rm, rmHtml, money, yActionsHtml) {
    const key = p.meta.key;
    want(`goals_${key}`); want(`yearDoc_${key}`);
    const ms = monthlies || [];
    const yms = Array.from({ length: 12 }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`);
    const forecasts = {};
    SEASON_BUNDLES.forEach(b => { const f = bundleForecast(ms, b.key, yms); if (f) forecasts[b.key] = f; });
    const automation = buildAutomationRoadmap(ms, { from: `${key}-01-01`, cfg: State.appConfig || {} });
    const dataGaps = buildDataGaps(ms, { from: p.meta.today });
    const qOf = (d) => (d && d.startsWith(key) ? Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1 : null);
    const scheduleItems = [
        ...p.actions.filter(a => a.target && /^\d{4}-\d{2}$/.test(a.target)).map(a => ({ title: a.title, kind: '연간', q: qOf(`${a.target}-01`) })),
        ...rm.items.filter(r => r.quarter && r.quarter.startsWith(key)).map(r => ({ title: r.title, kind: '개선', q: Number(r.quarter.slice(-3, -2)) })),
        ...automation.items.filter(a => a.quarter && a.quarter.startsWith(key)).map(a => ({ title: a.title, kind: '자동화', q: Number(a.quarter.slice(-1)) })),
        ...dataGaps.items.map(d => ({ title: d.what, kind: '데이터', q: qOf(d.startBy) || 1 }))
    ].filter(x => x.q);
    return yearDocHtml({
        today: p.meta.today, yearPlan: p, monthlies: ms, season: seasonCalendar(ms), forecasts,
        goals: docOf(`goals_${key}`), targets: docOf('targets'), roadmapHtml: rmHtml, automation, dataGaps,
        budgetHtml: money, actionsHtml: yActionsHtml, yearDoc: docOf(`yearDoc_${key}`), isAdmin: isAdminNow(), scheduleItems,
        makeBtn: mk, actuals: actualsOf(ms, Number(key)),
        itemsHtml: itemsBlock(i => Number(i.year) === Number(key), { title: `${key}년 과제 진행`, today: p.meta.today, empty: '이 해 과제가 아직 없습니다. 자동화·데이터 관리·로드맵의 [과제로 만들기]로 만듭니다.' }),
        yearBodyHtml: yearBodyHtml(p, { isAdmin: isAdminNow(), monthlies, months: finishedMonths(p.meta.today, 13) })
    });
}

/** [문장 저장](관리자) — 이름 검사(plan-yeardoc) 뒤 OpsPlan/yearDoc_YYYY */
async function onSaveYearDoc(btn) {
    const p = view && view.p;
    if (!p || horizon !== 'year' || !isAdminNow()) return;
    // 이름 검사 목록 — 명부(teamGroups)·이메일 명부·퇴사자·기록에 나온 이름(알바 포함). 메모리에서만
    const cfgN = State.appConfig || {};
    const nameSet = new Set(namesOf(cache && cache.people));
    Object.keys(cfgN.memberEmails || {}).forEach(n => nameSet.add(n));
    Object.keys(cfgN.resignedMembers || {}).forEach(n => nameSet.add(n));
    (State.allHistoryData || []).forEach(d => {
        (d.workRecords || []).forEach(r => r && r.member && nameSet.add(r.member));
        (Array.isArray(d.partTimers) ? d.partTimers : []).forEach(pt => pt && pt.name && nameSet.add(pt.name));
    });
    const names = [...nameSet];
    const r = cleanYearDocSections(readYearDocInputs($('ops-plan-yeardoc')), names);
    if (!r.ok) {
        const nos = r.leaks.map(id => YEARDOC_SECTIONS.findIndex(s => s.id === id) + 1).join('·');
        showToast(`${nos}장에 직원 이름과 같은 글자가 있어 저장하지 않았습니다. 이름을 빼고 다시 저장해 주세요.`);
        return;
    }
    btn.disabled = true;
    try {
        await saveYearDoc(p.meta.key, r.sections);
        await loadPlanDoc(`yearDoc_${p.meta.key}`, { force: true });
        showToast('연간 계획서 문장을 저장했습니다.');
        repaint();
    } catch (err) {
        console.error('연간 계획서 문장 저장 실패:', err && err.code);
        showToast('문장을 저장하지 못했습니다(권한 또는 연결).');
        btn.disabled = false;
    }
}

// ── 월 요약(v2 D1) ──────────────────────────────────────────────
/** 월 요약을 한 번 읽는다(최근 끝난 36달, 1일 캐시). 관리자는 먼저 빠진 달(메모리 13개월 안)을 자동으로 만든다. 다 되면 연간을 다시 계산. */
function ensureMonthlies(today) {
    if (monthlies || monthlyBusy || !(State.allHistoryData || []).length) return;
    monthlyBusy = true;
    const auto = isAdminNow() && !autoBuilt
        ? (autoBuilt = true, autoBuildMonthlies().then(r => { if (r.built.length) console.info('월 요약 만듦:', r.built.length, '달'); }).catch(() => {}))
        : Promise.resolve();
    auto.then(() => loadMonthlies(finishedMonths(today, 36)))
        .then(list => { monthlies = list || []; })
        .catch(() => { monthlies = []; })
        .then(() => { monthlyBusy = false; if (cache) cache.year = null; if (horizon === 'year' || horizon === 'quarter') renderOpsPlan(); });
}

/** 지난 월간 확정본을 한 묶음으로 읽는다(달마다 1회, 실패해도 같은 달엔 다시 읽지 않음). 문서가 있거나 실패가 있으면 월간을 다시 계산. */
function ensureMonthConfirms(today) {
    const key = String(today).slice(0, 7);
    if (monthConfirmBusy || monthConfirmKey === key || lastCtx.canAnalysis === false) return;
    monthConfirmKey = key;
    const yms = monthConfirmYms(today);
    if (!yms.length) return;
    monthConfirmBusy = true;
    Promise.allSettled(yms.map(ym => loadPlanDoc(planDocId('month', ym)))).then(results => {
        const { docs, failed, recompute } = monthConfirmsOf(yms, results);
        monthConfirmDocs = docs;
        monthConfirmFailed = failed;
        monthConfirmBusy = false;
        if (failed) console.warn('운영 계획 지난 확정본 읽기 실패:', failed, '건');
        if (!recompute) return;
        if (cache) cache.month = null;
        const host = $('ops-plan-body');
        if (horizon === 'month' && host && host.offsetParent) renderOpsPlan();
    });
}

/** 지난 확정본 대비 오차 — 계산이 실패해도 월간 계획은 그린다 */
function monthConfirmErrs(today, models) {
    try {
        return monthErrsOf(monthConfirmDocs, (ym) => staffDaysFrom(models.view.filter(d => d && typeof d.id === 'string' && d.id.startsWith(ym + '-')), models, today), { today });
    } catch (err) {
        console.warn('운영 계획 확정 대비 오차 계산 실패:', err && err.message);
        return [];
    }
}

function monthPlanOf(today, models) {
    const plan = computeMonthPlan(today, models, planCfg(), monthConfirmErrs(today, models));
    if (monthConfirmFailed) plan.meta.confidence.reasons.push('지난 확정본 일부를 읽지 못함');
    return plan;
}

/** [월 요약 다시 만들기](관리자) — 고른 달 원본만 다시 읽는다 */
async function onRebuildMonthly(btn) {
    const sel = $('ops-plan-monthly-ym');
    const ym = sel && sel.value;
    if (!ym || !isAdminNow()) return;
    btn.disabled = true;
    try {
        const r = await rebuildMonth(ym);
        showToast(`${ym} 월 요약을 다시 만들었습니다(기록 ${r.srcDocs}일).`);
        monthlies = null; if (cache) cache.year = null;
        ensureMonthlies(getTodayDateString());
    } catch (err) {
        console.error('월 요약 다시 만들기 실패:', err && (err.code || err.message));
        showToast('월 요약을 다시 만들지 못했습니다(권한 또는 연결).');
        btn.disabled = false;
    }
}

// ── 실행 관리(v2 D4) ───────────────────────────────────────────────
/** 과제 목록을 한 번 읽는다(올해·내년, 1분 캐시). 다 되면 다시 그리고, 관리자면 기한 초과 알림을 고른다. */
function ensureItems(force = false) {
    if (itemsBusy) { if (force) itemsAgain = true; return; }
    if ((items && !force) || lastCtx.canAnalysis === false) return;
    itemsBusy = true;
    const y = Number(getTodayDateString().slice(0, 4));
    listItems([y, y + 1], { force, openYears: [y - 1] })   // 지난해는 끝·그만 아닌 것만(주간 갱신·기한 초과 알림)
        .then(list => { items = list || []; })
        .catch(err => { console.warn('운영 과제 읽기 실패:', err && err.code); if (!items) items = []; })
        .then(() => {
            itemsBusy = false;
            if (itemsAgain) { itemsAgain = false; ensureItems(true); return; }
            repaint(); notifyOverdue();
        });
}
/** [과제로 만들기] 버튼 — 과제 목록을 읽기 전이면 그리지 않는다(같은 과제 두 번 만들기 방지) */
const mk = (key, draft) => (items ? makeButton(key, draft, { items, isAdmin: isAdmin() }) : '');
function itemsBlock(pred, opts) {
    if (lastCtx.canAnalysis === false) return '';
    if (!items) return card(opts.title, '<p class="opv-note">과제를 불러오는 중…</p>');
    return itemsCardHtml(items.filter(pred), { ...opts, canEdit: true });
}
/** 주간 회의 자료의 '과제 진행 갱신' — 끝·그만이 아닌 것 중 기한 지남·3주 안 기한·진행 중 */
function weekItemsHtml(today) {
    const lim = addDaysStr(today, 21);
    return itemsBlock(i => i.status !== 'done' && i.status !== 'drop' && (isOverdue(i, today) || i.status === 'doing' || (i.due && i.due <= lim)),
        { title: '과제 진행 갱신', hint: '주간 회의에서 상태·진행을 고칩니다', today, empty: '기한이 가깝거나 진행 중인 과제가 없습니다.' });
}
async function onMakeItem(btn) {
    const draft = draftOf(btn.dataset.piMake);
    if (!draft) return;
    btn.disabled = true;
    try {
        await createItem(draft, { today: getTodayDateString() });
        showToast('과제를 만들었습니다.');
        items = null; ensureItems(true);   // 다시 읽을 때까지 [과제로 만들기]를 숨긴다(두 번 만들기 방지)
    } catch (err) {
        console.error('과제 만들기 실패:', err && err.code);
        showToast('과제를 만들지 못했습니다(권한 또는 연결).');
        btn.disabled = false;
    }
}
async function onItemChange(el) {
    const id = el.dataset.piStatus || el.dataset.piProgress || el.dataset.piCheck;
    const it = (items || []).find(x => x.id === id);
    if (!it) return;
    let change;
    if (el.dataset.piStatus) change = { status: el.value };
    else if (el.dataset.piProgress) change = { progress: Number(el.value) };
    else change = { check: { idx: Number(el.dataset.piIdx), ok: el.checked } };   // 한 칸만 — 저장소가 서버 값에 적용
    el.disabled = true;
    const run = async () => {
        try {
            const changed = await updateItem(id, change);
            if (changed) showToast('과제를 고쳤습니다.');
        } catch (err) {
            console.error('과제 고치기 실패:', err && err.code);
            showToast('과제를 고치지 못했습니다(권한 또는 연결). 다시 그립니다.');
        }
        ensureItems(true);
    };
    itemQ = itemQ.then(run, run);
    await itemQ;
}
async function onShowLog(btn) {
    const box = document.getElementById(`pi-log-${btn.dataset.piLog}`);
    if (!box) return;
    if (box.innerHTML) { box.innerHTML = ''; return; }
    box.textContent = '불러오는 중…';
    try { box.innerHTML = logHtml(await itemLog(btn.dataset.piLog)); }
    catch (err) { box.textContent = '이력을 읽지 못했습니다.'; }
}
/** 목표 연결 편집(관리자) — 연간 계획서의 해. 월 지수 = 시즌 캘린더 출고 지수, 업무일 = 연간 어림의 달별 업무일 */
function onOpenGoals() {
    const p = view && view.p;
    if (!p || horizon !== 'year') return;
    const key = Number(p.meta.key);
    const out = seasonCalendar(monthlies || []).rows.find(r => r.key === 'outbound');
    const index = {}, workdays = {};
    (out ? out.cells : []).forEach((c, i) => { if (c && c.index != null) index[i + 1] = c.index; });
    (p.months || []).forEach(m => { if (m && m.workdays) workdays[m.m] = m.workdays; });
    openGoalsEditor({ year: key, goals: docOf(`goals_${key}`), targets: docOf('targets'), index, workdays,
        onSaved: () => { loadPlanDoc(`goals_${key}`, { force: true }).catch(() => {}).then(repaint); } });
}
/** 기한 초과 앱 알림(관리자 브라우저만) — 하루 1번·과제당 1번·하루 최대 5명. 문구는 고정(과제 내용·이름 없음).
 *  중복 방지 = OpsPlan/notify(그날·보낸 과제 id)를 트랜잭션으로 먼저 쓴 관리자만 보낸다. localStorage 는 '오늘은 확인함'(다시 읽지 않기)만 */
const NOTIFY_KEY = 'opsPlanOverdueNotified';
async function notifyOverdue() {
    if (!isAdminNow() || !items || notifyOverdue.busy) return;
    const today = getTodayDateString();
    let local = null;
    try { local = JSON.parse(localStorage.getItem(NOTIFY_KEY) || 'null'); } catch (e) { local = null; }
    if (local && local.day === today) return;
    const cfg = State.appConfig || {};
    if (!pickOverdueNotices(items, { today, cfg }).targets.length) return;   // 기한 지난 과제 없음 — 문서를 읽지 않는다
    notifyOverdue.busy = true;
    try {
        const r = await claimOverdueNotice(today, (sent) => pickOverdueNotices(items, { today, cfg, sent }));
        try { localStorage.setItem(NOTIFY_KEY, JSON.stringify({ day: today })); } catch (e) { /* 저장 못 해도 문서가 막는다 */ }
        if (r) {
            const res = await Promise.all(r.targets.map(t => sendNotification(t, OVERDUE_MESSAGE, 'warning')));
            console.info('기한 지난 운영 과제 알림:', res.filter(Boolean).length, '건');
        }
    } catch (e) { console.warn('기한 지난 운영 과제 알림 건너뜀:', e && e.code); }   // 다른 관리자가 먼저 씀(권한 거부) 등 — 화면에 영향 없음
    notifyOverdue.busy = false;
}

/** 운영 계획을 떠날 때(다른 탭) — 목표 창을 닫는다 */
export function leaveOpsPlan() { closeTargetsEditor(); closeCostEditor(); closeGoalsEditor(); }
