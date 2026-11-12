// === js/lib/plan-roadmap.js ===
// 운영 계획 확장-3 — 개선 로드맵(손실 원인 → 과제 → 분기 배치) + 효과 측정(마일스톤 전후 14일).
//   원인: 운영 리포트 모델(buildOpsModel) costs.loss 의 시간(가용·성과·품질 — 금액 아님) + 업무별 손실(tasks.lossMinutes) + 기록 품질(notes).
//   과제 = { key, cause, title, role, difficulty, quarter, due, targetEffectHours, kpi:{name, task?, from, to, lowerBetter}, status }
//     key 는 기간과 무관하게 같은 과제면 같다(roadmap:원인:대상) — 마일스톤 planTaskKey 로 '실행됨'을 잇는다.
//   분기 배치: 효과 인시(한 달 어림 × 회복 비율) ÷ 난이도(템플릿 1~3) 큰 순, 분기당 최대 3개, 넘치면 '대기'.
//   효과 측정 effectOf: 마일스톤 날짜 앞 14일 / 뒤 14일(그날 포함) KPI. 어느 쪽이든 운영일 < 5(task-owner MIN_COMPARE_DAYS)면 '판단 보류'.
//   금액·직원 이름 없음(업무명·원인만).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-year.test.js

import { taskDays, uphOf, MIN_COMPARE_DAYS, addDays } from './task-owner.js?v=202611121504';
import { periodMetrics } from './ops-metrics.js?v=202611121504';

export const ROADMAP_LEVELS = Object.freeze({ perQuarter: 3, window: 14, minDays: MIN_COMPARE_DAYS, topTasks: 3 });
/** 회복 비율 — 손실 시간 중 과제로 줄일 수 있다고 보는 몫(어림, 템플릿 고정) */
export const RECOVER = Object.freeze({ availability: 0.3, performance: 0.5, quality: 0.3, data: 1 });
export const CAUSE_LABEL = Object.freeze({ availability: '가용 손실', performance: '성과 손실', quality: '품질 손실', data: '기록 품질' });
/** 마일스톤 종류(js/ui-history-milestones.js TYPE_LABELS 키) */
export const CAUSE_MS_TYPE = Object.freeze({ availability: 'process', performance: 'process', quality: 'process', data: 'policy' });
const NOTE_TITLE = { missingQty: '처리량 빠짐없이 넣기', stdHours: '퇴근 기록 빠짐없이 남기기', estimated: '출근 기록 빠짐없이 남기기', capped: "업무 '종료' 누르기(12시간 넘는 기록 줄이기)" };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;

/** 분기 목록 — from(YYYY-MM-DD)이 속한 분기부터 n개 [{label, start, end}] */
export function quartersFrom(from, n = 4) {
    const y0 = Number(from.slice(0, 4)), q0 = Math.floor((Number(from.slice(5, 7)) - 1) / 3);
    return Array.from({ length: n }, (_, i) => {
        const q = (q0 + i) % 4, y = y0 + Math.floor((q0 + i) / 4);
        const sm = q * 3 + 1, em = sm + 2;
        const end = new Date(y, em, 0).getDate();
        return { label: `${y} ${q + 1}분기`, start: `${y}-${String(sm).padStart(2, '0')}-01`, end: `${y}-${String(em).padStart(2, '0')}-${String(end).padStart(2, '0')}` };
    });
}

/**
 * 로드맵 과제 만들기.
 * @param {object} model 최근 4주 운영 리포트 모델(canCost 무관 — 시간만 쓴다)
 * @param {object} opts  { from(계획 시작일), quarters=4 }
 */
export function buildRoadmap(model, { from, quarters = 4 } = {}) {
    if (!model || !model.meta || model.meta.empty) return { quarters: quartersFrom(from, quarters), items: [] };
    const L = ROADMAP_LEVELS;
    const loss = (model.costs && model.costs.loss) || {};
    const P = model.productivity || {};
    const opDays = num(model.meta.operatingDays) || 1;
    const perMonth = 21 / opDays;   // 최근 운영일 → 한 달(업무일 21일) 어림
    const items = [];
    const add = (o) => items.push({ ...o, targetEffectHours: r1(Math.max(0, o.effect)), status: 'todo' });

    (model.tasks || []).filter(t => t.isQty && t.lossMinutes > 0 && t.stdUph > 0)
        .sort((a, b) => b.lossMinutes - a.lossMinutes).slice(0, L.topTasks).forEach(t => add({
            key: `roadmap:performance:${t.task}`, cause: 'performance', difficulty: 2, role: '팀장',
            title: `${t.task} 처리 속도 개선(평상시보다 느림)`,
            effect: t.lossMinutes / 60 * perMonth * RECOVER.performance,
            kpi: { name: 'UPH', task: t.task, from: t.uph != null ? r1(t.uph) : null, to: r1(t.stdUph), lowerBetter: false }
        }));
    const av = loss.availability ? num(loss.availability.minutes) : 0;
    if (av > 0) add({
        key: 'roadmap:availability:all', cause: 'availability', difficulty: 1, role: '관리자',
        title: '기록 없는 재실 시간 줄이기(대기·업무 기록 누락)',
        effect: av / 60 * perMonth * RECOVER.availability,
        kpi: { name: '가동률(%)', from: P.utilization != null ? r1(P.utilization) : null, to: P.utilization != null ? r1(Math.min(100, P.utilization + 5)) : null, lowerBetter: false }
    });
    const qu = loss.quality ? num(loss.quality.minutes) : 0;
    if (qu > 0) add({
        key: 'roadmap:quality:all', cause: 'quality', difficulty: 2, role: '팀장',
        title: '오류·재작업 줄이기(품질 업무 시간)',
        effect: qu / 60 * perMonth * RECOVER.quality,
        kpi: { name: '품질 업무 시간(하루, 시간)', from: r1(qu / 60 / opDays), to: r1(qu / 60 / opDays * 0.8), lowerBetter: true }
    });
    (model.notes || []).filter(n => NOTE_TITLE[n.code] && num(n.n) > 0).forEach(n => add({
        key: `roadmap:data:${n.code}`, cause: 'data', difficulty: 1, role: '각 파트 담당',
        title: `기록 품질: ${NOTE_TITLE[n.code]}`,
        effect: num(n.n) * 0.5 * perMonth,
        kpi: { name: n.code === 'capped' ? '해당 기록 수' : '해당 일수', code: n.code, from: num(n.n), to: 0, lowerBetter: true }
    }));

    const qs = quartersFrom(from, quarters);
    const sorted = items.slice().sort((a, b) => (b.targetEffectHours / b.difficulty) - (a.targetEffectHours / a.difficulty) || (a.key < b.key ? -1 : 1));
    sorted.forEach((it, i) => {
        const qi = Math.floor(i / L.perQuarter);
        const q = qs[qi];
        it.quarter = q ? q.label : null;
        it.due = q ? q.end : null;
        delete it.effect;
    });
    return { quarters: qs, items: sorted };
}

/** 하루 문서 목록의 KPI 값 — kpi.name 에 따라 */
function kpiValue(kpi, days, cfg) {
    if (!days.length) return null;
    if (kpi.name === 'UPH') return uphOf(taskDays(days, kpi.task), kpi.task);
    if (kpi.code === 'stdHours' || kpi.code === 'estimated') {
        // 퇴근 기록 없음·출근 추정 일수 — 운영 리포트 모델과 같은 계산(ops-metrics staffing)
        const st = periodMetrics(days, cfg || {}).staffing;
        return kpi.code === 'stdHours' ? st.stdHourDays : st.estimatedDays;
    }
    if (kpi.code && kpi.code !== 'capped' && kpi.code !== 'missingQty') return null;   // 모르는 기록 지표 — 판단 보류
    if (kpi.code) {
        const q = new Set((cfg && cfg.quantityTaskTypes) || []);
        let n = 0;
        days.forEach(d => {
            const recs = Array.isArray(d.workRecords) ? d.workRecords : [];
            if (kpi.code === 'capped') n += recs.filter(r => num(r && r.duration) > 720).length;
            else if (kpi.code === 'missingQty') n += recs.some(r => r && q.has(r.task) && num(r.duration) > 0 && !(num(d.taskQuantities && d.taskQuantities[r.task]) > 0)) ? 1 : 0;
        });
        return n;
    }
    const m = periodMetrics(days, cfg || {});
    if (kpi.name.startsWith('가동률')) return m.utilizationRate;
    if (kpi.name.startsWith('품질')) return m.staffing.dayCount > 0 ? m.qualityLossMinutes / 60 / m.staffing.dayCount : null;
    return null;
}

/**
 * 효과 측정 — 마일스톤 날짜 앞 window 일 / 뒤 window 일(그날 포함) KPI.
 * @returns {{ status:'ok'|'hold', before, after, pct, better }} — 어느 쪽이든 운영일 < minDays 면 hold
 */
export function effectOf(milestone, allDays, kpi, { cfg = null, window = ROADMAP_LEVELS.window, minDays = ROADMAP_LEVELS.minDays, today = null } = {}) {
    const d0 = milestone && milestone.date;
    if (!d0 || !kpi) return { status: 'hold', reason: 'noDate' };
    const op = (d) => d && typeof d.id === 'string' && ((Array.isArray(d.workRecords) && d.workRecords.length) || Object.keys(d.taskQuantities || {}).length);
    const list = (allDays || []).filter(op).filter(d => !today || d.id < today);
    const before = list.filter(d => d.id >= addDays(d0, -window) && d.id < d0);
    const after = list.filter(d => d.id >= d0 && d.id < addDays(d0, window));
    if (before.length < minDays || after.length < minDays) return { status: 'hold', reason: 'sample', beforeDays: before.length, afterDays: after.length };
    const b = kpiValue(kpi, before, cfg), a = kpiValue(kpi, after, cfg);
    if (b == null || a == null) return { status: 'hold', reason: 'kpi' };
    const pct = b !== 0 ? ((a - b) / Math.abs(b)) * 100 : (a === 0 ? 0 : null);
    // 변화 없음(0%)은 좋아짐·나빠짐 어느 쪽도 아니다(null — 화면은 회색)
    const better = pct == null || pct === 0 ? null : (kpi.lowerBetter ? pct < 0 : pct > 0);
    return { status: 'ok', before: r1(b), after: r1(a), pct: pct == null ? null : r1(pct), better };
}

/** 마일스톤(planTaskKey)과 과제 잇기 — 실행됨·효과. milestones 는 { date, planTaskKey } 만 쓴다(이름 칸 안 봄). */
export function attachMilestones(items, milestones, allDays, opts = {}) {
    const byKey = new Map();
    (milestones || []).forEach(m => {
        if (!m || !m.planTaskKey || !m.date) return;
        const p = byKey.get(m.planTaskKey);
        if (!p || m.date > p.date) byKey.set(m.planTaskKey, { date: m.date, planTaskKey: m.planTaskKey });
    });
    return (items || []).map(it => {
        const m = byKey.get(it.key);
        if (!m) return it;
        return { ...it, status: 'running', startedAt: m.date, effect: effectOf(m, allDays, it.kpi, opts) };
    });
}
