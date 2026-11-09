// === js/ui-ops-plan-budget.js ===
// 💰 운영 계획 확장-2 — '비용·예산' 섹션(관리자만 — 비관리자는 섹션 자체를 그리지 않고, 모델도 locked) + 비용·설정 겹침 창(#ops-plan-cost).
//   숫자는 js/lib/plan-budget.js buildBudget. 시급표(memberWages)는 관리자 설정에만 있다(adminPrivate/settings → State.appConfig).
//   비용 설정 = adminPrivate/opsPlanCost(관리자만), 계획 기준(연장 한도·알바 준비 일·표준시간, 금액 아님) = OpsPlan/settings(분석 권한이 읽음).
// ⚠️ 금액·직원 이름을 콘솔에 찍지 않는다. 이름은 시급 평균·합계를 낼 때만 메모리에서 쓰고 결과에 담지 않는다.
// ⚠️ role=dialog·data-act 금지(업무마감봇 선택자) — 겹침 창은 section.

import * as State from './state.js?v=202611091159';
import { getRegularMembersForCount, showToast } from './utils.js?v=202611091159';
import { aliasHistoryView } from './lib/task-alias-view.js?v=202611091159';
import { buildOpsModel } from './lib/ops-view-model.js?v=202611091159';
import { periodDaysOf } from './lib/ops-metrics.js?v=202611091159';
import { addDaysStr, planSettingsOf } from './lib/plan-week.js?v=202611091159';
import { buildBudget, buildYearBudget, costSettingsOf, costBaseOf, suggestRegularBase, salaryBasisLabor, partTimerCostOf, SALARY_HOURS } from './lib/plan-budget.js?v=202611091159';
import { saveCostAndSettings } from './ops-plan-store.js?v=202611091159';
import { esc, n0, n1, card, kpi, fmtDay, ok } from './ui-ops-plan-parts.js?v=202611091159';
import { higherOpenThan } from './modal-above.js?v=202611091159';

const $ = (id) => document.getElementById(id);
export const isAdminNow = () => !!(State.appState && State.appState.currentUserRole === 'admin');
const won = (v) => (ok(v) ? `${n0(v)}원` : '—');
const pct1 = (r) => (ok(r) ? `${n1(r * 100)}%` : '—');

// 관리자 운영 리포트 모델(최근 8주, 금액 포함) — 이력 길이·설정이 같으면 다시 만들지 않는다
let mCache = null;
function costModel(today) {
    const cfg = State.appConfig || {};
    const all = State.allHistoryData || [];
    if (mCache && mCache.today === today && mCache.all === all && mCache.len === all.length && mCache.cfg === cfg) return mCache;
    const view = aliasHistoryView(all, cfg) || [];
    const days = view.filter(d => d && typeof d.id === 'string' && d.id >= addDaysStr(today, -56) && d.id < today);
    const model = days.length ? buildOpsModel({ days, allDays: view, ownerDays: false, cfg, today, canCost: true }) : null;
    // 평소 인건비 = 예측과 같은 '월급 기준'(재직 정규 월급 × 56일 비례 + 알바 기록 비용) — 기록 시간 × 시급과 섞지 않는다
    const salaryLabor = days.length ? salaryBasisLabor({ monthlyBases: wagesOf(addDaysStr(today, -1)).bases, calendarDays: 56, partTimerCost: partTimerCostOf(days) }) : null;
    const base = costBaseOf(model, { salaryLabor });
    const laborRatio = base && base.laborRatio != null ? base.laborRatio * 100 : null;
    // 지난달 실제 · 이번 달 지금까지 부족 인원(채용 판단 — 다음 달 예측과 합쳐 3달)
    const ym = (off) => { const d = new Date(`${today}T00:00:00`); d.setDate(1); d.setMonth(d.getMonth() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
    const pastShortFte = [-1, 0].map(off => {
        const ds = periodDaysOf('month', ym(off), view).filter(d => d.id < today);
        const m = ds.length ? buildOpsModel({ days: ds, allDays: view, ownerDays: false, cfg, today, canCost: false }) : null;
        const g = m && m.staffing ? m.staffing.gap : null;
        return g == null ? 0 : Math.max(0, -g);
    });
    // 최근 12개월 월급 기준 인건비(연간 Y7 — 인건비 증가율)
    const days12 = view.filter(d => d && typeof d.id === 'string' && d.id >= addDaysStr(today, -365) && d.id < today);
    const salaryLabor12 = days12.length ? salaryBasisLabor({ monthlyBases: wagesOf(addDaysStr(today, -1)).bases, calendarDays: 365, partTimerCost: partTimerCostOf(days12) }) : null;
    mCache = { today, all, len: all.length, cfg, model, base, laborRatio, pastShortFte, salaryLabor12 };
    return mCache;
}

/** 기간 재직 정직원 월 기본급(숫자만)·평균 시급 — 이름은 여기서만 쓰고 버린다 */
function wagesOf(from) {
    const cfg = State.appConfig || {};
    const mw = cfg.memberWages || {};
    const names = [...getRegularMembersForCount(cfg, from)];
    const bases = names.map(n => Number(mw[n]) || 0).filter(v => v > 0);
    const avgHourly = bases.length ? bases.reduce((a, b) => a + b, 0) / bases.length / SALARY_HOURS : null;
    return { bases, avgHourly, suggest: suggestRegularBase(mw, names) };
}

/** 예산 모델 — 관리자가 아니면 { locked:true } (금액 숫자를 만들지 않는다) */
export function computeBudget(horizon, plan, { today, cfgPlan, costDoc }) {
    if (!isAdminNow()) return { locked: true };
    const cm = costModel(today);
    const w = wagesOf(plan.meta.from);
    const qf = horizon === 'month' ? (Number(plan.meta.trendFactor) || 1) * (Number(plan.meta.season && plan.meta.season.ratio) || 1) : 1;
    const b = buildBudget({
        canMoney: true, horizon, plan, cost: costSettingsOf(costDoc), settings: planSettingsOf(cfgPlan),
        monthlyBases: w.bases, avgHourly: w.avgHourly, base: cm.base, qtyFactor: qf, pastShortFte: cm.pastShortFte, today
    });
    b.baseLaborRatio = cm.laborRatio;
    b.suggestRegular = w.suggest;
    return b;
}

/** 연간 예산(관리자만) — 아니면 locked */
export function computeYearBudget(plan, { today, costDoc }) {
    if (!isAdminNow()) return { locked: true };
    const cm = costModel(today);
    const w = wagesOf(today);
    const b = buildYearBudget({ canMoney: true, plan, monthlyBases: w.bases, avgHourly: w.avgHourly, cost: costSettingsOf(costDoc), base: cm.base, salaryLabor12: cm.salaryLabor12 });
    b.baseLaborRatio = cm.laborRatio;
    b.suggestRegular = w.suggest;
    return b;
}

/** 연간 비용·예산(관리자만) — 달별 인건비·매출·인건비율 */
export function yearBudgetHtml(b) {
    if (!b || b.locked) return '';
    const miss = b.missing.length ? `<p class="opv-notes">비어 있는 값: ${b.missing.map(esc).join(' · ')} — 시급은 [비용·설정]·관리자 설정, 매출은 경영 지표에서.</p>` : '';
    const rows = b.months.map(m => `<tr><td>${esc(m.month)}</td><td class="r">${won(m.labor)}</td><td class="r">${won(m.revenue)}</td><td class="r">${pct1(m.ratio)}</td></tr>`).join('');
    const acts = b.actions.length ? `<ul class="opv-diag opp-gap">${b.actions.map(a => `<li><span class="opv-dot is-warn"></span><span>${esc(a.title)} <span class="opv-note">${esc(a.rule)}</span></span></li>`).join('')}</ul>` : '';
    return `<div id="ops-plan-budget">${card('비용·예산(연간)', `${miss}<div class="opv-kpis">
            ${kpi('인건비(연간 어림)', ok(b.labor.total) ? n0(b.labor.total) : '—', '원', `정규 ${won(b.labor.regular)} · 부족 메우기 ${won(b.labor.temp)}`)}
            ${kpi('매출(연간 어림)', ok(b.revenue) ? n0(b.revenue) : '—', '원')}
            ${kpi('인건비율', ok(b.ratio) ? n1(b.ratio * 100) : '—', '%', `최근 8주 ${ok(b.baseLaborRatio) ? n1(b.baseLaborRatio) + '%' : '—'}`)}
            ${kpi('인건비 증가율', ok(b.laborGrowth) ? n1(b.laborGrowth * 100) : '—', '%', '내년 ÷ 최근 12개월(월급 기준)')}
        </div>
        <div class="opv-table-wrap opp-gap"><table class="opv-table"><thead><tr><th>달</th><th class="r">인건비</th><th class="r">매출</th><th class="r">인건비율</th></tr></thead><tbody>${rows}</tbody></table></div>
        ${acts}<p class="opv-note">관리자만 보이는 칸입니다. 부족 메우기 = 부족 시간 × 알바 시급(없으면 연장 시급). 확정하면 관리자 전용 예산 문서에만 저장됩니다.</p>`,
    '<button type="button" id="ops-plan-cost-open" class="opv-btn opp-noprint">비용·설정</button>')}</div>`;
}

// ── 그리기(관리자만 부른다) ───────────────────────────────────────
export function budgetHtml(b, { horizon }) {
    if (!b || b.locked) return '';
    const L = b.labor;
    const setMiss = b.missing.filter(m => m !== '매출(경영 지표)' && m !== '정직원 시급표');
    const miss = [
        setMiss.length ? `비어 있는 값: ${setMiss.map(esc).join(' · ')} — [비용·설정]에서 넣으면 계산됩니다.` : '',
        b.missing.includes('정직원 시급표') ? '정직원 시급표가 없어 연장 비용을 낼 수 없습니다 — 관리자 설정의 급여를 확인하세요.' : '',
        b.missing.includes('매출(경영 지표)') ? '최근 8주 매출이 없어 인건비율을 낼 수 없습니다 — 경영 지표에 매출을 입력하면 계산됩니다.' : ''
    ].filter(Boolean).map(t => `<p class="opv-notes">${t}</p>`).join('');
    const means = b.means.map((m, i) => `<tr${i === 0 ? ' style="font-weight:700"' : ''}><td>${esc(m.label)}</td><td class="r">${m.perHour == null ? '—' : won(m.perHour)}</td>
        <td class="r">${m.cost == null ? '—' : won(m.cost)}</td><td class="r">${n0(m.leadDays)}일</td><td class="opv-note opp-wrap">${esc(m.note)}</td></tr>`).join('');
    const scen = b.scenarios.map(s => `<tr><td>${esc(s.label)}${s.warn ? ` <span class="opv-chip is-warn" title="${esc(s.warn)}">한도</span>` : ''}</td>
        <td class="r">${ok(s.fillRate) ? `${Math.round(s.fillRate * 100)}%` : '—'}</td><td class="r">${n1(s.need)}</td><td class="r">${won(s.labor)}</td>
        <td class="r">${pct1(s.ratio)}</td><td class="r">${won(s.unitCost)}</td></tr>`).join('');
    const H = b.hire;
    const hire = horizon !== 'month' ? '' : !H ? '' : `<div class="opv-sub-title opp-gap">채용 역산</div>
        <p class="opv-note">부족 인원(명, 일평균) 지난달 실제 → 이번 달 지금까지 → 다음 달 예측: ${H.months.map(v => n1(v)).join(' → ')} · 기준 3달 연속 0.8명 이상 · 신뢰도 ${H.confidenceOk ? '충분' : '부족(보통 이상일 때만 제안)'}</p>
        ${H.suggest ? `<p class="opv-diag"><span class="opv-chip ${H.late ? 'is-risk' : 'is-warn'}">정규 1명 채용 검토</span> 채용 시작 역산일 ${fmtDay(H.startBy)}(채용 + 교육 ${H.weeks}주)${H.late ? ' — <b class="opv-down">이미 지났습니다(채용 늦음)</b>' : ''}</p>` : '<p class="opv-note">지금은 채용 제안 조건이 아닙니다.</p>'}`;
    const acts = b.actions.length ? `<div class="opv-sub-title opp-gap">비용 과제</div><ul class="opv-diag">${b.actions.map(a => `<li><span class="opv-dot is-warn"></span><span>${esc(a.title)} <span class="opv-note">${esc(a.rule)}</span></span></li>`).join('')}</ul>` : '';
    const risks = b.risks.length ? `<ul class="opv-diag">${b.risks.map(r => `<li><span class="opv-dot is-risk"></span><span><b>${esc(r.title)}</b> — ${esc(r.text)}</span></li>`).join('')}</ul>` : '';
    return `<div id="ops-plan-budget">${card('비용·예산', `${miss}
        <div class="opv-kpis">
            ${kpi('인건비(예측)', ok(L.total) ? n0(L.total) : '—', '원', `정규 ${won(L.regular)} · 연장 ${won(L.overtime)} · 알바 ${won(L.temp)}`)}
            ${kpi('매출(예측)', ok(b.revenue) ? n0(b.revenue) : '—', '원', '경영 지표 최근 8주 하루 평균 × 업무일 × 물량 배율')}
            ${kpi('인건비율', ok(b.ratio) ? n1(b.ratio * 100) : '—', '%', `최근 8주 ${ok(b.baseLaborRatio) ? n1(b.baseLaborRatio) + '%' : '—'}`)}
            ${kpi('건당 원가', ok(b.unitCost) ? n0(b.unitCost) : '—', '원', `평소 ${won(b.unitCostBase)}${ok(b.unitCostTarget) ? ` · 목표 ${won(b.unitCostTarget)}` : ''}`)}
        </div>
        <div class="opv-sub-title opp-gap">부족 메우기 수단 비교 <span class="opv-note">같은 부족 시간을 메울 때 · 싼 순</span></div>
        <div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>수단</th><th class="r">시간당</th><th class="r">이번 부족 전체</th><th class="r">준비 기간</th><th>근거</th></tr></thead><tbody>${means}</tbody></table></div>
        ${hire}${risks}
        <div class="opv-sub-title opp-gap">시나리오</div>
        <div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>경우</th><th class="r" title="공급 ÷ 필요(메우기 전)">인원 충족률</th><th class="r">메울 시간(h)</th><th class="r">인건비</th><th class="r">인건비율</th><th class="r">건당 원가</th></tr></thead><tbody>${scen}</tbody></table></div>
        ${acts}
        <p class="opv-note">관리자만 보이는 칸입니다. 확정하면 금액은 관리자 전용 문서(예산)에만 저장되고 계획 확정본에는 들어가지 않습니다.</p>`,
    '<button type="button" id="ops-plan-cost-open" class="opv-btn opp-noprint">비용·설정</button>')}</div>`;
}

// ── 비용·설정 겹침 창 ──────────────────────────────────────────────
let st = null;   // { cost, settings, suggest, onSaved, returnFocus }
const MONEY_F = [
    ['tempHourly', '알바 시급(원)'], ['regularMonthlyBase', '정규 1인 월비용(원)'], ['unitCostTarget', '건당 원가 목표(원)'],
    ['overtimePremium', '연장 할증(배)'], ['hireLeadWeeks', '채용 기간(주)'], ['trainWeeksDefault', '교육 기간 기본(주)']
];
const PLAN_F = [['overtimeDailyMax', '1인 하루 연장 상한(시간)'], ['overtimeWeeklyMax', '1인 주 연장 상한(시간)'], ['tempLeadDays', '알바 준비 기간(일)'], ['stdHours', '알바 1인일 시간']];

function formHtml() {
    const c = st.cost, s = st.settings;
    const inp = (grp, k, label, val, ph = '') => `<label class="opp-field"><span class="opv-note">${esc(label)}</span>
        <input type="number" step="any" min="0" class="opp-inp" data-grp="${grp}" data-k="${k}" value="${val == null ? '' : esc(String(val))}" placeholder="${esc(ph)}"></label>`;
    return `<p class="opv-note">금액 칸은 관리자 전용 문서(adminPrivate)에만 저장됩니다. 연장 기준은 운영 계획 모든 화면(주간·월간)의 메우기 계산에 쓰입니다.</p>
        <div class="opv-sub-title">비용(관리자만)</div>
        <div class="opp-fields">${MONEY_F.map(([k, l]) => inp('cost', k, l, c[k], k === 'regularMonthlyBase' && st.suggest ? `제안 ${st.suggest}` : (k === 'overtimePremium' ? '1.5' : ''))).join('')}</div>
        <div class="opv-sub-title opp-gap">연장·알바 기준(금액 아님)</div>
        <div class="opp-fields">${PLAN_F.map(([k, l]) => inp('plan', k, l, s[k])).join('')}</div>
        <p class="opv-note">법정 기준: 주 12시간 연장 한도, 할증 50%(근로기준법 제53·56조) — 회사 규정이 다르면 여기서 바꾸세요, 앱은 법적 판단을 하지 않습니다.</p>
        <div class="opp-head"><button type="button" id="ops-plan-cost-save" class="ops-make-btn">저장</button></div>`;
}
const isOpen = () => !!($('ops-plan-cost') && !$('ops-plan-cost').classList.contains('hidden'));
function onKey(e) {
    if (e.key !== 'Escape' || !isOpen()) return;
    const host = $('history-modal');
    if (host && higherOpenThan(host)) return;
    e.stopPropagation(); e.preventDefault();
    closeCostEditor();
}

/** 비용·설정 창 열기(관리자만) */
export function openCostEditor({ costDoc, settings, suggest, onSaved }) {
    const box = $('ops-plan-cost');
    if (!box || !isAdminNow()) return;
    st = { cost: costSettingsOf(costDoc), settings: planSettingsOf({ opsPlan: settings || {} }), suggest, onSaved, returnFocus: document.activeElement };
    $('ops-plan-cost-body').innerHTML = formHtml();
    box.classList.remove('hidden');
    const under = $('ops-plan-panel');
    if (under) under.inert = true;
    document.addEventListener('keydown', onKey, true);
    if (!box.dataset.bound) {
        box.dataset.bound = '1';
        box.addEventListener('click', (e) => {
            if (e.target.closest('#ops-plan-cost-close')) { closeCostEditor(); return; }
            const sb = e.target.closest('#ops-plan-cost-save');
            if (sb) save(sb);
        });
    }
    $('ops-plan-cost-close')?.focus();
}
export function closeCostEditor() {
    const box = $('ops-plan-cost');
    if (!box || box.classList.contains('hidden')) return;
    box.classList.add('hidden');
    const under = $('ops-plan-panel');
    if (under) under.inert = false;
    document.removeEventListener('keydown', onKey, true);
    const f = st && st.returnFocus;
    st = null;
    if (f && document.contains(f) && typeof f.focus === 'function') f.focus();
}

async function save(btn) {
    if (!st || !isAdminNow()) return;
    const cost = {}, plan = {};
    document.querySelectorAll('#ops-plan-cost .opp-inp').forEach(inp => {
        const k = inp.dataset.k;
        if (inp.value !== '') (inp.dataset.grp === 'cost' ? cost : plan)[k] = Number(inp.value);
    });
    const clean = costSettingsOf(cost);
    const body = {};
    Object.keys(clean).forEach(k => { if (clean[k] != null && k !== 'trainWeeksByTask') body[k] = clean[k]; });   // 업무별 교육 기간은 채용 역산에 아직 안 써서 저장하지 않는다
    btn.disabled = true;
    try {
        await saveCostAndSettings(body, { ...st.settings, ...plan });   // 한 번에(writeBatch)
        showToast('비용·설정을 저장했습니다.');
        const cb = st.onSaved;
        closeCostEditor();
        if (cb) cb();
    } catch (err) {
        console.error('운영 계획 비용·설정 저장 실패:', err && err.code);
        showToast('비용·설정을 저장하지 못했습니다(권한 또는 연결).');
        btn.disabled = false;
    }
}
