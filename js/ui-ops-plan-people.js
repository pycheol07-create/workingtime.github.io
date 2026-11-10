// === js/ui-ops-plan-people.js ===
// 📋 운영 계획 확장-1 — 주간 계획서 '사람·배치' 섹션: ① 업무별 숙련 현황(모든 권한, 인원 수) ② 사람×업무 숙련 매트릭스 + 교육 후보(data.reports, 이름)
//   ③ 날짜별 배치 초안(data.reports: 업무별 이름 / 아니면 업무별 인원 수·미충족 인시).
//   숫자는 js/lib/plan-skills.js · plan-assign.js. 근태(휴무)는 업무 예상과 같은 계산으로 읽기만(staffNamesOf).
// ⚠️ 이름 정책: 이름은 메모리·화면(data.reports)에서만. 저장·인쇄·콘솔에는 redactForOutput 을 지난 수만.
//   이름이 든 칸은 class="opp-names" — 인쇄 사본에서는 이 섹션을 통째로 수만 다시 그린다(peoplePrintHtml).
//   콘솔에 이름·사람 섹션 객체를 찍지 않는다. ⚠️ role=dialog·data-act 금지.

import * as State from './state.js?v=202611101708';
import { aliasHistoryView } from './lib/task-alias-view.js?v=202611101708';
import { taskNameOf, TASK } from './lib/task-ids.js?v=202611101708';
import { skillMatrix, levelCounts, busFactor, trainCandidates, redactForOutput, LEVEL_LABEL, LEVEL_RANK, PEOPLE_NOTE } from './lib/plan-skills.js?v=202611101708';
import { draftAssignment, sumAssignCounts } from './lib/plan-assign.js?v=202611101708';
import { staffNamesOf } from './ui-history-prediction.js?v=202611101708';
import { buildOwnerAdvice, adviceForOutput } from './lib/plan-owner-advice.js?v=202611101708';
import { nextWeekRange, offDayOf } from './lib/plan-week.js?v=202611101708';
import { esc, n1, fmtDay, card } from './ui-ops-plan-parts.js?v=202611101708';

// 숙련도 매트릭스 캐시 — 이력 길이·설정·오늘이 같으면 다시 계산하지 않는다
let mCache = null;
function matrixFor(today) {
    const cfg = State.appConfig || {};
    const all = State.allHistoryData || [];
    if (mCache && mCache.today === today && mCache.all === all && mCache.len === all.length && mCache.cfg === cfg) return mCache.matrix;
    const view = aliasHistoryView(all, cfg) || [];
    const matrix = skillMatrix(view, cfg, { today, excludeTasks: [taskNameOf(TASK.admin, cfg)] });
    mCache = { today, all, len: all.length, cfg, matrix };
    return matrix;
}

/**
 * 사람 섹션 계산(메모리 — 이름 있음). range = 다음 주, outlookRows = 업무 예상 행(taskHours·netDailyHours).
 * @returns { matrix, levels, bus:[{task, capable, who, leaveDays, candidates}], drafts:{date: draft}, admin:{date:n}, workdays:[date] }
 */
export function computePeople(today, range, outlookRows) {
    const matrix = matrixFor(today);
    const rows = new Map((outlookRows || []).filter(r => r && r.date && !r.failed).map(r => [r.date, r]));
    const workdays = (range.dates || []).filter(d => rows.has(d));
    const staff = {};
    workdays.forEach(d => { staff[d] = staffNamesOf(d); });
    const leaveDaysOf = (name) => workdays.filter(d => staff[d] && staff[d].onLeave.includes(name)).length;
    const bus = busFactor(matrix, { leaveDaysOf }).map(b => ({ ...b, candidates: trainCandidates(matrix, b.task, { cfg: State.appConfig || {} }) }));
    const drafts = {}, admin = {};
    workdays.forEach(d => {
        const s = staff[d];
        if (!s) return;
        const r = rows.get(d);
        drafts[d] = { date: d, ...draftAssignment(r.taskHours || {}, matrix, s.available, { hoursPerPerson: r.netDailyHours || 8 }) };
        admin[d] = s.adminWorkers || 0;
    });
    // 담당 재배치 추천(v2 D5) — 이름은 메모리에서만. 후보는 다음 주 가용인 사람(휴무 제외)
    let advice = [];
    try {
        const cfg = State.appConfig || {};
        const available = nextWeekAvailable(today);   // 업무 상세(ui-ops-view)와 같은 기준
        advice = buildOwnerAdvice(aliasHistoryView(State.allHistoryData || [], cfg) || [], cfg,
            { today, available: available.size ? available : null, excludeTasks: [taskNameOf(TASK.admin, cfg)], matrix });
    } catch (e) { console.warn('담당 재배치 추천 계산 실패:', e && e.message); }
    return { matrix, levels: levelCounts(matrix), bus, drafts, admin, workdays, advice, today };
}

/** 담당 재배치 추천 — canNames(data.reports)면 이름 있는 문장, 아니면 adviceForOutput(이름 없음) 문장만 */
function adviceHtml(people, canNames, makeBtn) {
    const list = people.advice || [];
    if (!list.length) return '<p class="opv-note">담당이 바뀐 뒤 처리 효율이 10% 넘게 떨어진 업무가 없습니다(표본 충분한 것만).</p>';
    const red = adviceForOutput(list, { today: people.today });
    const conf = { high: '높음', mid: '보통', low: '낮음' };
    const items = list.map((ad, i) => {
        const r = red[i];
        const text = canNames ? `<span class="opp-names">${esc(ad.text)}</span>` : esc(r.text);
        return `<li><span class="opv-dot is-warn"></span><span>${text} <span class="opv-note">(UPH ${n1(r.uphBefore)} → ${n1(r.uphAfter)} · 신뢰도 ${conf[r.confidence] || r.confidence})</span>
            ${makeBtn ? makeBtn(`advice:${r.task}:${r.itemDraft.quarter}`, r.itemDraft) : ''}</span></li>`;
    }).join('');
    return `<ul class="opv-diag">${items}</ul>`;
}

/** 다음 주(월~일) 업무일에 한 번이라도 출근 가능한 재직자 이름(휴무 뺀 사람 — 업무 예상과 같은 계산). 담당 재배치 후보 기준(주간 계획서·업무 상세 공통). 메모리 전용 */
export function nextWeekAvailable(today) {
    const set = new Set();
    nextWeekRange(today).dates.forEach(d => {
        const o = offDayOf(d);
        if (o.weekend || o.holiday) return;
        const s = staffNamesOf(d);
        if (s) s.available.forEach(n => set.add(n));
    });
    return set;
}

/** 저장(확정본 assignCounts)용 — 날짜별 초안을 redactForOutput 으로 수만 남긴 뒤 합친다. */
export function assignCountsOf(people) {
    if (!people) return null;
    const list = Object.values(people.drafts || {}).map(d => redactForOutput({ assign: d }).assign);
    return sumAssignCounts(list);
}
/** 과제·리스크 입력용 한 사람 의존(수만) */
export const busForPlan = (people) => (people ? redactForOutput({ bus: people.bus }).bus : []);
/** 인쇄 검사에서 지울 글자(업무명·고정 문구) — 이름과 같은 글자가 업무명에 있어도 막히지 않게 */
export const ignoreWordsOf = (people) => [...((people && people.matrix && people.matrix.tasks) || []).map(t => t.task), PEOPLE_NOTE, '사람·배치(인원 수)'];
/** 인쇄 안전장치에 쓸 이름 목록(메모리) */
export function namesOf(people) {
    const s = new Set(((people && people.matrix && people.matrix.people) || []).map(p => p.name));
    ((State.appConfig && State.appConfig.teamGroups) || []).forEach(g => (g.members || []).forEach(m => m && s.add(m)));
    return [...s];
}

// ── 그리기 ────────────────────────────────────────────────────────
const LV_CLS = { skilled: 'opp-lv-3', able: 'opp-lv-2', exp: 'opp-lv-1', none: 'opp-lv-0' };

/** ① 업무별 숙련 현황(인원 수만) — 화면·인쇄 공용. red = redactForOutput 결과 */
function levelsTable(red) {
    const busBy = new Map(red.bus.map(b => [b.task, b]));
    if (!red.levels.length) return '<p class="opv-note">최근 8주 업무 기록이 없어 숙련 현황을 낼 수 없습니다.</p>';
    const rows = red.levels.map(l => {
        const b = busBy.get(l.task);
        const warn = b ? `<span class="opv-chip is-risk">한 사람 의존 — 가능 이상 ${b.capable}명${b.leaveDays ? ` · 그 사람 휴무 ${b.leaveDays}일` : ''} · 교육 후보 ${b.candidateCount}명</span>` : '';
        return `<tr><td>${esc(l.task)}</td><td class="r">${l.skilled}</td><td class="r">${l.able}</td><td class="r">${l.exp}</td><td>${warn}</td></tr>`;
    }).join('');
    return `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>업무</th><th class="r">숙련</th><th class="r">가능</th><th class="r">경험</th><th>경고</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
}

/** ③ 배치 초안 표 — names = data.reports 일 때만 이름 칸 */
function assignTable(draft, red, { names = false, admin = 0 } = {}) {
    if (!draft || !red) return '<p class="opv-note">이 날은 배치 초안을 만들지 못했습니다(근태·예상 행 없음).</p>';
    const tasks = Object.keys(red.counts).sort((a, b) => (red.counts[b].h + (red.unmet[b] || 0)) - (red.counts[a].h + (red.unmet[a] || 0)));
    if (!tasks.length) return '<p class="opv-note">이 날 예상 작업이 없습니다.</p>';
    const rows = tasks.map(t => {
        const c = red.counts[t], u = red.unmet[t] || 0;
        const who = names ? `<td class="opp-names opp-wrap">${(draft.byTask[t] || []).map(esc).join(', ') || '—'}</td>` : '';
        return `<tr class="${u > 0 ? 'is-short' : ''}"><td>${esc(t)}</td><td class="r">${n1(c.h + u)}</td><td class="r">${c.n}명</td><td class="r">${n1(c.h)}</td>
            <td class="r">${u > 0 ? `<b class="opv-down">${n1(u)}</b>` : '—'}</td>${who}</tr>`;
    }).join('');
    return `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>업무</th><th class="r">필요(인시)</th><th class="r">배치</th><th class="r">배치 시간</th><th class="r" title="경험 있는 사람이 모자라 못 채운 시간">미충족</th>${names ? '<th>배치 초안(이름)</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody></table></div>
        <p class="opv-note">남는 시간 ${n1(red.idleHours)}인시 · 순서: 필요 시간 큰 업무부터, 숙련 &gt; 가능 &gt; 경험 순으로 1인 하루 시간까지${admin ? ` · 관리자 개별업무 ${admin}명은 빼지 않았습니다(누구인지 정하지 않음)` : ''}</p>`;
}

/** ② 사람×업무 매트릭스 + 교육 후보(이름 — data.reports 만, 인쇄 안 함) */
function matrixHtml(people) {
    const M = people.matrix;
    if (!M.people.length) return '';
    const tasks = M.tasks.map(t => t.task);
    const total = (n) => M.tasks.reduce((s, t) => s + ((t.people[n] && t.people[n].hours) || 0), 0);
    const ppl = M.people.slice().sort((a, b) => total(b.name) - total(a.name) || (a.name < b.name ? -1 : 1));
    const head = `<tr><th>사람</th>${tasks.map(t => `<th class="opp-mx-h" title="${esc(t)}">${esc(t)}</th>`).join('')}</tr>`;
    const body = ppl.map(p => `<tr><td>${esc(p.name)}${p.partTimer ? ' <span class="opv-note">(알바)</span>' : ''}</td>${M.tasks.map(t => {
        const c = t.people[p.name];
        if (!c) return '<td class="opp-lv-0"></td>';
        const tip = `${c.hours}시간 · ${c.days}일${c.uph != null ? ` · 단독 UPH ${c.uph}` : ''}`;
        return `<td class="${LV_CLS[c.level]}" title="${esc(tip)}">${LEVEL_LABEL[c.level]}</td>`;
    }).join('')}</tr>`).join('');
    const train = people.bus.length ? `<ul class="opv-diag">${people.bus.map(b => `<li><span class="opv-dot is-warn"></span><span><b>${esc(b.task)}</b> — 가능 이상: ${b.who.map(esc).join(', ') || '없음'} · 교육 후보: ${b.candidates.length ? b.candidates.map(c => `${esc(c.name)}${c.source === 'exp' ? ` (${n1(c.hours)}시간)` : ' (같은 팀)'}`).join(', ') : '없음'}</span></li>`).join('')}</ul>` : '<p class="opv-note">한 사람 의존 업무가 없습니다.</p>';
    return `<div class="opp-names opp-noprint">
        <div class="opv-sub-title opp-gap">사람 × 업무 숙련 <span class="opv-note">(리포트 권한 — 인쇄·저장하지 않음)</span></div>
        <div class="opv-table-wrap"><table class="opv-table opp-mx"><thead>${head}</thead><tbody>${body}</tbody></table></div>
        <p class="opv-note">숙련 = 가능 + 단독 UPH 가 팀 중앙값의 90% 이상(시간형 업무는 경험 시간 상위) · 가능 = 최근 90일 8시간·3일 이상 · 경험 = 기록 있음</p>
        <div class="opv-sub-title opp-gap">교육 후보</div>${train}
    </div>`;
}

/** 화면용 섹션 — canNames(data.reports) 일 때만 이름 칸·매트릭스. selDate = 배치 초안 날짜 */
export function peopleHtml(people, { canNames = false, selDate = null, makeBtn = null } = {}) {
    if (!people) return '';
    const red = redactForOutput({ levels: people.levels, bus: people.bus });
    const date = selDate && people.drafts[selDate] ? selDate : people.workdays.find(d => people.drafts[d]) || null;
    const draft = date ? people.drafts[date] : null;
    const dRed = draft ? redactForOutput({ assign: draft }).assign : null;
    const opts = people.workdays.map(d => `<option value="${d}"${d === date ? ' selected' : ''}>${fmtDay(d)}</option>`).join('');
    return `<div id="ops-plan-people">${card('사람·배치', `
        <p class="opv-notes">${esc(PEOPLE_NOTE)} · 최근 90일 업무 기록 기준(${fmtDay(people.matrix.from)} ~ ${fmtDay(people.matrix.to)}) · 퇴사자 제외</p>
        <div class="opv-sub-title opp-gap">업무별 숙련 현황</div>${levelsTable(red)}
        ${canNames ? matrixHtml(people) : '<p class="opv-note opp-gap">사람별 숙련·교육 후보·배치 이름은 리포트 권한이 있어야 보입니다.</p>'}
        <div class="opv-sub-title opp-gap">배치 초안 <label class="opv-note opp-noprint">날짜 <select id="ops-plan-assign-date" class="opp-inp opp-sel">${opts}</select></label></div>
        ${assignTable(draft, dRed, { names: canNames, admin: date ? people.admin[date] : 0 })}
        <div class="opv-sub-title opp-gap">담당 재배치 추천 <span class="opv-note">${esc(PEOPLE_NOTE)}</span></div>${adviceHtml(people, canNames, makeBtn)}`, '업무 예상과 같은 시간·근태(휴무) 기준')}</div>`;
}

/** 인쇄용 — redactForOutput 을 지난 수만(이름 칸 없음). 날짜별 배치는 인원 수·미충족만. */
export function peoplePrintHtml(people) {
    if (!people) return '';
    const red = redactForOutput({ levels: people.levels, bus: people.bus });
    const days = people.workdays.filter(d => people.drafts[d]).map(d => {
        const a = redactForOutput({ assign: people.drafts[d] }).assign;
        const tasks = Object.keys(a.counts);
        return `<tr><td>${fmtDay(d)}</td><td class="opp-wrap">${tasks.map(t => `${esc(t)} ${a.counts[t].n}명`).join(' · ') || '—'}</td>
            <td class="opp-wrap">${Object.entries(a.unmet).map(([t, h]) => `${esc(t)} ${n1(h)}h`).join(' · ') || '—'}</td></tr>`;
    }).join('');
    return card('사람·배치(인원 수)', `<p class="opv-note">${esc(PEOPLE_NOTE)} · 이름은 인쇄하지 않습니다.</p>
        ${levelsTable(red)}
        <div class="opv-sub-title opp-gap">담당 재배치 추천(이름 없음)</div>${(people.advice || []).length ? `<ul class="opv-diag">${adviceForOutput(people.advice, { today: people.today }).map(r => `<li>${esc(r.text)}</li>`).join('')}</ul>` : '<p class="opv-note">없음</p>'}
        <div class="opv-sub-title opp-gap">날짜별 배치 초안(인원 수)</div>
        <div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>날짜</th><th>업무별 배치 인원</th><th>미충족</th></tr></thead><tbody>${days}</tbody></table></div>`);
}

export { LEVEL_RANK };
