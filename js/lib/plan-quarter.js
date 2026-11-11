// === js/lib/plan-quarter.js ===
// 운영 계획 v2 D2 — 분기 계획서(다음 분기). 연간 계획·목표·로드맵·자동화·데이터 관리를 한 분기로 모은다.
//   목표(objectives): 목표 연결 문서(OpsPlan/goals_YYYY kpis.{metric}.qN) > 목표(OpsPlan/targets year) > 없음. 지금 값은 최근 8주 평소.
//   핵심 과제(initiatives) 3~5: 연간 과제(Y — 그 분기 달), 개선 로드맵(그 분기), 자동화 로드맵(그 분기 key), 데이터 관리(startBy 가 그 분기) — 앞에서부터 5개.
//   월별 인력(staffing[3]): 연간 계획 달(필요·공급·차이) + 성수기 채용 시작일(Y1 기한). 연간 계획 해가 아니면 null.
//   주별 볼 숫자(kpiWeekly): 처리량·UPH·충족률·OEE·기록률 — 주간 회의에서 본다.
//   금액·이름 없음. 확정 문서 OpsPlan/quarter_YYYY-Qn(plan-compare confirmDocOf horizon 'quarter').
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-season.test.js

import { quarterList } from './plan-automation.js?v=202611111506';

export const QUARTER_METRICS = Object.freeze([
    { metric: 'qtyPerDay', label: '처리량(하루)', unit: '개' },
    { metric: 'uph', label: 'UPH', unit: '개/시' },
    { metric: 'oee', label: 'OEE', unit: '%' },
    { metric: 'fillRate', label: '인원 충족률', unit: '%' },
    { metric: 'effPct', label: '효율', unit: '%' }
]);
export const KPI_WEEKLY = Object.freeze([
    { metric: 'qtyPerDay', label: '처리량(하루 평균)' }, { metric: 'uph', label: 'UPH' }, { metric: 'fillRate', label: '인원 충족률' },
    { metric: 'oee', label: 'OEE' }, { metric: 'recordRate', label: '기록률(처리량·출퇴근)' }
]);
const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** 오늘 기준 다음 분기 { key:'YYYY-Qn', label, year, q, start, end, months[3] } */
export function nextQuarterOf(today) {
    const q = quarterList(String(today).slice(0, 10), 2)[1];
    const sm = Number(q.start.slice(5, 7));
    return { ...q, q: Number(q.key.slice(-1)), months: [0, 1, 2].map(i => `${q.year}-${String(sm + i).padStart(2, '0')}`) };
}

/**
 * @param {object} p
 * @param {string} p.today
 * @param {object} [p.quarter]   nextQuarterOf 결과(없으면 다음 분기)
 * @param {object} [p.goals]     OpsPlan/goals_YYYY { kpis: { metric: { year, q1..q4 } } }
 * @param {object} [p.targets]   OpsPlan/targets(year·overrides)
 * @param {object} [p.current]   지금 값 { metric: 값 } (최근 8주 평소)
 * @param {object} [p.yearPlan]  buildYearPlan 결과(그 해면 달·Y 과제)
 * @param {Array}  [p.roadmap]   plan-roadmap items(quarter = '2027 1분기' 모양 label)
 * @param {Array}  [p.automation] plan-automation items(quarter = 'YYYY-Qn' key)
 * @param {Array}  [p.dataGaps]  plan-data-gaps items(startBy YYYY-MM-DD)
 */
export function buildQuarterPlan(p = {}) {
    const Q = p.quarter || nextQuarterOf(p.today);
    const qn = `q${Q.q}`;
    const g = (p.goals && p.goals.kpis) || {};
    const ty = (p.targets && p.targets.year) || {};
    const objectives = QUARTER_METRICS.map(m => {
        const gq = g[m.metric] ? fin(g[m.metric][qn]) : null;
        const gy = g[m.metric] ? fin(g[m.metric].year) : null;
        const t = gq != null ? gq : gy != null ? gy : fin(ty[m.metric]);
        return { ...m, target: t, source: gq != null ? 'goals' : gy != null ? 'goalsYear' : t != null ? 'targets' : 'none', current: fin(p.current && p.current[m.metric]) };
    });

    const inQ = (d) => !!d && d >= Q.start && d <= Q.end;
    const init = [];
    const add = (o) => { if (init.length < 5 && !init.some(x => x.key === o.key)) init.push(o); };
    const yp = p.yearPlan && p.yearPlan.meta && Number(p.yearPlan.meta.key) === Q.year ? p.yearPlan : null;
    (yp ? yp.actions : []).filter(a => a.target && Q.months.includes(a.target)).forEach(a => add({ key: a.key, kind: 'year', title: a.title, role: a.role, due: a.due || Q.end }));
    (p.roadmap || []).filter(r => r.quarter === Q.label).forEach(r => add({ key: r.key, kind: 'roadmap', title: r.title, role: r.role, due: r.due || Q.end }));
    (p.automation || []).filter(a => a.quarter === Q.key).forEach(a => add({ key: `auto:${a.key}`, kind: 'auto', title: a.title, role: a.role === 'admin' ? '관리자' : '팀장', due: a.due || Q.end }));
    (p.dataGaps || []).filter(d => inQ(d.startBy) || (d.startBy && d.startBy < Q.start)).forEach(d => add({ key: `data:${d.key}`, kind: 'data', title: d.what, role: d.role === 'admin' ? '관리자' : d.role === 'lead' ? '팀장' : '각 파트 담당', due: Q.end }));

    const hireOf = (ym) => {
        const a = yp ? yp.actions.find(x => x.rule === 'Y1' && x.target === ym) : null;
        return a ? a.due : null;
    };
    const staffing = Q.months.map(ym => {
        const m = yp ? yp.months.find(x => x.month === ym) : null;
        return m && m.reqFTE != null
            ? { month: ym, reqFTE: m.reqFTE, supplyFTE: m.supplyFTE, gap: m.gap, index: m.index, hireStartBy: hireOf(ym) }
            : { month: ym, reqFTE: null, supplyFTE: null, gap: null, index: null, hireStartBy: null };
    });
    return {
        meta: { horizon: 'quarter', key: Q.key, label: Q.label, year: Q.year, q: Q.q, from: Q.start, to: Q.end, months: Q.months, today: p.today,
            staffingFromYear: !!yp && !yp.meta.insufficient },
        objectives, initiatives: init, staffing,
        kpiWeekly: KPI_WEEKLY.map(k => ({ ...k })),
        summary: [
            `${Q.label}(${Q.start} ~ ${Q.end}) — 목표 ${objectives.filter(o => o.target != null).length}개 · 핵심 과제 ${init.length}개.`,
            yp && !yp.meta.insufficient ? `월별 필요 인원 ${staffing.map(s => s.reqFTE == null ? '—' : s.reqFTE).join(' · ')}명(연간 어림).`
                : yp ? '월별 인력은 1년치 기록(운영일 240일)이 쌓이면 채워집니다.' : '월별 인력 — 그 해 연간 어림이 없습니다.'
        ]
    };
}
