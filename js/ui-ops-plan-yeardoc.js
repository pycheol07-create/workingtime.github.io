// === js/ui-ops-plan-yeardoc.js ===
// 📋 운영 계획 v2 D2 — 연간 계획서(문서형, 12장). 인쇄는 표지·목차·장마다 새 쪽(css .opp-chapter).
//   장마다 계산된 내용 + 사람이 쓰는 문장(OpsPlan/yearDoc_YYYY — 관리자 저장, 저장 전 이름 검사 plan-yeardoc cleanYearDocSections).
//   화면에 '거래처는 코드로만, 직원 이름은 쓰지 않기' 안내. 9장 예산은 관리자만(비관리자는 '관리자만' 한 줄).
//   [과제로 만들기](자동화·데이터 관리 — 관리자, D4)는 c.makeBtn(key, 이름 없는 초안). 4장에 목표 연결 편집(관리자)·실적 줄, 11장에 그 해 과제 목록.
//   금액은 9장(관리자)만, 이름 없음. ⚠️ role=dialog·data-act 금지.

import { esc, n0, n1, card, fmtDay, ok } from './ui-ops-plan-parts.js?v=202611091406';
import { YEARDOC_SECTIONS } from './lib/plan-yeardoc.js?v=202611091406';
import { AUTO_STATUS_LABEL } from './lib/plan-auto-catalog.js?v=202611091406';
import { SEASON_BUNDLES } from './lib/plan-season-catalog.js?v=202611091406';

const H = (min) => (ok(min) ? n1(min / 60) : '—');
const SRC_CLS = { measured: 'opp-src-m', gip: 'opp-src-g', assumed: 'opp-src-a' };

function chapter(sec, idx, body, doc, isAdmin) {
    // 9장(예산)은 문장을 받지도 그리지도 않는다(계산 표만, 관리자만)
    const text = !sec.noText && doc && doc.sections ? doc.sections[sec.id] || '' : '';
    const textHtml = text ? `<div class="opp-doc-text">${esc(text).replace(/\n/g, '<br>')}</div>` : '';
    const edit = isAdmin && !sec.noText ? `<label class="opp-field opp-noprint opp-gap"><span class="opv-note">이 장에 덧붙일 문장(1,000자까지 — 거래처는 코드로만, 직원 이름은 쓰지 않기)</span>
        <textarea class="opp-inp opp-ta" data-yd-sec="${sec.id}" maxlength="1000" rows="3">${esc(text)}</textarea></label>` : '';
    return `<section id="ops-yd-${sec.id}" class="opp-chapter">${card(`${idx + 1}. ${sec.title}`, `${body}${textHtml}${edit}`)}</section>`;
}

/** 표지·목차 */
function coverHtml(c) {
    const p = c.yearPlan;
    return `<div class="opp-print-only opp-cover">
        <div class="opp-cover-title">${esc(p.meta.key)}년 연간 운영 계획서</div>
        <div class="opp-cover-sub">물류팀 · ${fmtDay(c.today)} 작성 · 신뢰도 ${esc(p.meta.confidence.label)} · 1년치 기록 기준·참고용</div>
    </div>
    <div class="opp-toc">${card('목차', `<ol class="opp-toc-list">${YEARDOC_SECTIONS.map((s, i) => `<li><a href="#ops-yd-${s.id}">${i + 1}. ${esc(s.title)}</a></li>`).join('')}</ol>`)}</div>`;
}

function lookbackHtml(monthlies) {
    const list = (monthlies || []).slice().sort((a, b) => (a.ym < b.ym ? -1 : 1)).slice(-12);
    if (!list.length) return '<p class="opv-note">월 요약이 아직 없습니다 — 관리자가 운영 계획을 열면 끝난 달부터 만들어집니다.</p>';
    return `<div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>달</th><th class="r">운영일</th><th class="r">처리량</th><th class="r">하루 처리량</th><th class="r">UPH</th><th class="r">출근 평균</th><th class="r">휴무 인·일</th></tr></thead>
        <tbody>${list.map(m => `<tr><td>${esc(m.ym)}</td><td class="r">${n0(m.opDays)}</td><td class="r">${n0(m.qty)}</td><td class="r">${m.qtyDays || m.opDays ? n0(m.qty / (m.qtyDays || m.opDays)) : '—'}</td>
        <td class="r">${ok(m.uph) ? n1(m.uph) : '—'}</td><td class="r">${ok(m.headAvg) ? n1(m.headAvg) : '—'}</td><td class="r">${n0(m.leaveDays)}</td></tr>`).join('')}</tbody></table></div>`;
}

function seasonHtml(cal, frcs, yearKey) {
    const head = `<tr><th>묶음</th>${Array.from({ length: 12 }, (_, i) => `<th class="r">${i + 1}월</th>`).join('')}</tr>`;
    const rows = cal.rows.map(r => `<tr><td>${esc(r.label)}</td>${r.cells.map(c => `<td class="r opp-heat ${SRC_CLS[c.source] || ''}" style="--h:${Math.max(0, Math.min(1, (c.index - 0.4) / 1.2))}" title="${esc(c.label)}${c.band ? ` ±${c.band}` : ''}">${n1(c.index)}</td>`).join('')}</tr>`).join('');
    const frame = `<tr><td class="opv-note">시즌</td>${cal.frame.map(f => `<td class="opv-note opp-wrap">${esc(f.join(' · '))}</td>`).join('')}</tr>`;
    const fr = SEASON_BUNDLES.filter(b => frcs[b.key]).map(b => {
        const f = frcs[b.key];
        return `<tr><td>${esc(b.label)}</td>${Array.from({ length: 12 }, (_, i) => `<td class="r">${H(f.months[`${yearKey}-${String(i + 1).padStart(2, '0')}`])}</td>`).join('')}</tr>`;
    }).join('');
    return `<div class="opv-table-wrap"><table class="opv-table opp-season"><thead>${head}</thead><tbody>${rows}${frame}</tbody></table></div>
        <p class="opv-note">지수 = 그 달 하루 평균 ÷ 연 평균. <span class="opp-src-m">실측</span>(월 요약 12달) · <span class="opp-src-g">GIP</span>(${esc(cal.source)}, 주문·반품, 관측 1~2회, ±${cal.band}) · <span class="opp-src-a">가정</span>(직진·입고 반복성 약함, 그 밖 1).</p>
        ${fr ? `<div class="opv-sub-title opp-gap">묶음별 하루 업무 시간 어림(시간) — 지수 × 최근 3개월 기준선</div>
        <div class="opv-table-wrap"><table class="opv-table"><thead>${head}</thead><tbody>${fr}</tbody></table></div>` : '<p class="opv-note">최근 끝난 3개월 월 요약이 있어야 업무 시간 어림을 냅니다.</p>'}`;
}

function goalsHtml(goals, targets, actuals, isAdmin) {
    const M = [['qtyPerDay', '처리량(하루)'], ['uph', 'UPH'], ['oee', 'OEE(%)'], ['fillRate', '인원 충족률(%)'], ['effPct', '효율(%)']];
    const k = (goals && goals.kpis) || null;
    const ty = (targets && targets.year) || {};
    const cols = ['year', 'q1', 'q2', 'q3', 'q4'];
    const rows = M.map(([m, l]) => {
        const tgt = `<tr><td>${l}</td>${cols.map(c => {
            const v = k && k[m] ? k[m][c] : (c === 'year' ? ty[m] : null);
            return `<td class="r">${ok(v) ? n1(v) : '—'}</td>`;
        }).join('')}</tr>`;
        const a = actuals && actuals[m];
        const act = a && Object.keys(a).length ? `<tr class="opp-actual"><td class="opv-note">실적(운영일 가중)</td>${cols.map(c => `<td class="r opv-note">${ok(a[c]) ? n1(a[c]) : '—'}</td>`).join('')}</tr>` : '';
        return tgt + act;
    }).join('');
    return `<div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>지표</th><th class="r">연</th><th class="r">1분기</th><th class="r">2분기</th><th class="r">3분기</th><th class="r">4분기</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="opv-note">${k ? `목표 연결(${goals.mode === 'manual' ? '직접 입력' : '자동 나눔'})` : '목표 연결이 아직 없어 운영 목표(연)만 보입니다'} — 처리량(하루)은 월 지수로 나누고, 비율 지표는 같은 값. 실적은 월 요약(운영일 가중).
        ${isAdmin ? '<button type="button" id="ops-goals-open" class="opv-btn opp-noprint">목표 연결 편집</button>' : ''}</p>`;
}

function staffHtml(p) {
    if (p.meta.insufficient) return '<p class="opv-note">1년치 기록 부족 — 달별 인력은 기록이 쌓이면 나옵니다.</p>';
    const hire = (ym) => { const a = p.actions.find(x => x.rule === 'Y1' && x.target === ym); return a ? fmtDay(a.due) : ''; };
    return `<div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>달</th><th class="r">필요</th><th class="r">공급</th><th class="r">차이</th><th>채용·교육 시작</th></tr></thead>
        <tbody>${p.months.map(m => `<tr class="${m.gap < -0.5 ? 'is-short' : ''}"><td>${m.m}월</td><td class="r">${n1(m.reqFTE)}</td><td class="r">${n1(m.supplyFTE)}</td>
        <td class="r">${m.gap > 0 ? '+' : ''}${n1(m.gap)}</td><td>${hire(m.month)}</td></tr>`).join('')}</tbody></table></div>`;
}

function autoHtml(auto, makeBtn) {
    if (!auto || !auto.items.length) return '<p class="opv-note">자동화 후보가 없습니다.</p>';
    return `<div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>분기</th><th>과제</th><th>지금</th><th class="r">월 기록(시간)</th><th class="r">절감 어림(시간/월)</th><th>먼저 할 것</th><th></th></tr></thead>
        <tbody>${auto.items.map(a => `<tr><td>${a.quarterLabel ? esc(a.quarterLabel) : '<span class="opv-note">대기</span>'}</td><td class="opp-wrap">${esc(a.title)}</td>
        <td>${esc(AUTO_STATUS_LABEL[a.status] || a.status)}${a.existing ? ` <span class="opv-note">(${esc(a.existing)})</span>` : ''}</td>
        <td class="r">${H(a.monthlyMin)}</td><td class="r">${H(a.saveMin)}</td>
        <td class="opp-wrap opv-note">${a.prereq.filter(x => !x.met).map(x => esc(x.text)).join(' · ') || '—'}</td>
        <td>${makeBtn ? makeBtn(`auto:${a.key}:${a.year || ''}`, a.itemDraft) : ''}</td></tr>`).join('')}</tbody></table></div>
        <p class="opv-note">월 기록 = 월 요약 최근 3개월 평균. 절감 = 월 기록 × 줄일 수 있는 몫 × (1 − 이미 자동화된 몫) — 어림(가정). 분기마다 2개.</p>`;
}

function gapsHtml(g, makeBtn) {
    if (!g || (!g.items.length && !g.ok.length)) return '<p class="opv-note">월 요약이 쌓이면 기록 빈칸을 점검합니다.</p>';
    const auto = { 가능: 'is-ok', 부분: 'is-warn', 불가: 'is-risk' };
    return `${g.items.length ? `<div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>할 일</th><th>담당</th><th>시작</th><th>자동화</th><th class="r">지금</th><th class="r">목표</th><th></th></tr></thead>
        <tbody>${g.items.map(d => `<tr><td class="opp-wrap">${esc(d.what)}</td><td>${esc(d.role === 'admin' ? '관리자' : d.role === 'lead' ? '팀장' : d.role)}</td>
        <td>${d.startBy ? fmtDay(d.startBy) : '—'}</td><td><span class="opv-chip ${auto[d.auto.level] || ''}" title="${esc(d.auto.how || '')}">${esc(d.auto.level)}</span></td>
        <td class="r">${d.now == null ? '모름' : n1(d.now)}</td><td class="r">${d.target == null ? '—' : n1(d.target)}</td>
        <td>${makeBtn ? makeBtn(`data:${d.key}:${(d.itemDraft && d.itemDraft.quarter) || ''}`, d.itemDraft) : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="opv-note">빈칸 과제가 없습니다.</p>'}
        ${g.ok.length ? `<p class="opv-note">점검했고 문제없음: ${g.ok.length}개</p>` : ''}`;
}

function scheduleHtml(items) {
    const qs = ['1분기', '2분기', '3분기', '4분기'];
    if (!items.length) return '<p class="opv-note">분기에 배치된 과제가 없습니다.</p>';
    return `<div class="opv-table-wrap"><table class="opv-table opp-gantt"><thead><tr><th>과제</th><th>종류</th>${qs.map(q => `<th class="r">${q}</th>`).join('')}</tr></thead>
        <tbody>${items.map(it => `<tr><td class="opp-wrap">${esc(it.title)}</td><td class="opv-note">${esc(it.kind)}</td>${[1, 2, 3, 4].map(n => `<td class="r ${it.q === n ? 'opp-gantt-on' : ''}">${it.q === n ? '●' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const RHYTHM = [
    ['매주 월요일', '주간 계획서·과제 진행 갱신(운영 계획 › 주간)'], ['매월 첫 주', '월간 계획서 확정·지난달 계획 대비 실적'],
    ['분기 첫 주', '분기 계획서 확정·핵심 과제 점검'], ['분기 끝', '개선 로드맵 효과(마일스톤 전후 14일) 확인'],
    ['연 1회(11~12월)', '연간 계획서 작성·목표 연결·예산(관리자)']
];

/**
 * 연간 계획서 전체. c = { today, yearPlan, monthlies, season, forecasts, goals, targets, roadmapHtml, automation, dataGaps,
 *   budgetHtml(관리자 아니면 ''), actionsHtml, risks?, yearDoc, isAdmin, scheduleItems }
 */
export function yearDocHtml(c) {
    const p = c.yearPlan;
    const S = YEARDOC_SECTIONS;
    const bodies = [
        lookbackHtml(c.monthlies),
        seasonHtml(c.season, c.forecasts, p.meta.key),
        c.yearBodyHtml,
        goalsHtml(c.goals, c.targets, c.actuals, c.isAdmin),
        staffHtml(p),
        c.roadmapHtml,
        autoHtml(c.automation, c.makeBtn),
        gapsHtml(c.dataGaps, c.makeBtn),
        c.isAdmin ? (c.budgetHtml || '<p class="opv-note">예산을 계산할 값이 없습니다.</p>') : '<p class="opv-note">관리자만 보이는 장입니다.</p>',
        c.actionsHtml,
        scheduleHtml(c.scheduleItems || []) + (c.itemsHtml || ''),
        `<ul class="opv-diag">${RHYTHM.map(([w, t]) => `<li><span class="opv-dot"></span><span><b>${esc(w)}</b> ${esc(t)}</span></li>`).join('')}</ul>`
    ];
    const save = c.isAdmin ? `<p class="opv-note opp-noprint">장마다 문장을 덧붙일 수 있습니다(관리자). 저장 전에 직원 이름이 들어 있는지 검사합니다 — 거래처는 코드로만 적어 주세요.
        <button type="button" id="ops-yd-save" class="opv-btn">문장 저장</button></p>` : '';
    return `<div id="ops-plan-yeardoc">${coverHtml(c)}${save}${S.map((s, i) => chapter(s, i, bodies[i], c.yearDoc, c.isAdmin)).join('')}</div>`;
}

/** 화면의 장별 입력 → { s01: '…' } */
export function readYearDocInputs(root) {
    const out = {};
    (root || document).querySelectorAll('textarea[data-yd-sec]').forEach(t => { out[t.dataset.ydSec] = t.value; });
    return out;
}
