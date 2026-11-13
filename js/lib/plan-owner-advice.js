// === js/lib/plan-owner-advice.js ===
// 운영 계획 v2 D5 — 담당 재배치 추천: 주 담당이 바뀐 뒤 처리 효율(UPH)이 떨어진 업무에 '교체 / 병행 배치 / 교육 후 유지' 3안을 낸다.
//
// ⚠️ 이름 정책(plan-skills.js 와 같음): 결과(buildOwnerAdvice)에는 직원 이름이 들어 있다 — **메모리 전용**, 화면 이름은 data.reports 일 때만.
//   저장·인쇄·과제(OpsPlanItems)·콘솔로 나가는 것은 adviceForOutput 하나를 지난다(이름 없는 문장 + 숫자 + 과제 초안).
//   "배치 참고용 — 인사평가 아님"(PEOPLE_NOTE).
//
// 규칙
//   · 대상 = 수량형 업무(물량이 있는 업무)만 — UPH 로 효율을 본다. 업무 목록·후보 숙련은 plan-skills skillMatrix(최근 90일, 오늘 제외).
//   · 변경 = task-owner ownerByPeriod(주) → detectOwnerChanges(hold 2, 진행 중 주는 활동 2일·60분 이상이면 셈 — liveOk)의 마지막 변경. maxAgeDays(84일) 보다 오래된 변경은 보지 않는다.
//   · 저하 = compareAround 의 업무 UPH 전→후 변화율 ≤ dropPct(−10%, 경계 포함). 표본 충분할 때만:
//     전·후 모두 시간·물량 있는 날 ≥ max(minDays, MIN_COMPARE_DAYS) 이고 compareAround.lowSample 아님.
//   · 후보 = 재직(퇴사일 다음 날부터 제외, isMemberActiveOn)·시스템 계정 아님·available(다음 주 가용, 주면) 안·지금 담당 아님.
//     알바는 plan-skills 처럼 포함하고 partTimer 로 표시만 한다.
//     ① 이전 담당: 변경 전 단독 UPH(없으면 skillMatrix UPH)가 지금 업무 UPH 보다 높으면 1순위.
//     ② 그 밖: skillMatrix 등급 '가능' 이상 · 단독 UPH 가 지금 업무 UPH 보다 높은 사람, UPH 높은 순(최대 maxCandidates).
//   · kind: 후보 자신이 다른 업무의 한 사람 의존(busFactor) 담당이면 pair(그 후보를 빼면 그 업무가 빈다), 아니면 replace.
//     지금 담당이 다른 업무를 혼자 맡는 경우는 교체하면 오히려 그 업무에 집중할 수 있어 replace 그대로 — risk.ownerSoloTasks·reason 에 정보만(2026-11-05 리뷰).
//     후보가 없으면 train(지금 담당 유지 + 교육)만.
//     train 은 언제나 마지막 안으로 붙는다. recommend = options[0].kind.
//   · 기대 절감(시간/주) = 주 물량 ÷ 지금 UPH − 주 물량 ÷ 후보 UPH. 주 물량 = 변경 뒤 물량 ÷ 그 물량이 있던 주 수.
//     pair 는 물량 절반을 후보가 맡는다고 보고 replace 의 절반. train 은 변경 전 UPH 로 돌아왔을 때의 절감(목표).
//   · confidence(표본 일수 = 전·후 중 적은 쪽): ≥ 15일 high · ≥ 8일 mid · 그 밖 low.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-owner-advice.test.js

import {
    ownerByPeriod, detectOwnerChanges, compareAround, taskDays, qtyDaysOf, periodKeyOf, pctChange, MIN_COMPARE_DAYS
} from './task-owner.js?v=202611131345';
import { skillMatrix, busFactor, LEVEL_RANK, PEOPLE_NOTE } from './plan-skills.js?v=202611131345';
import { quarterList } from './plan-automation.js?v=202611131345';
import { isMemberActiveOn } from '../utils.js?v=202611131345';

export const ADVICE_LEVELS = Object.freeze({
    dropPct: -10, hold: 2, maxAgeDays: 84, maxCandidates: 3, highDays: 15, midDays: 8, titleMax: 80
});

const TENTATIVE = '잠정 — 이번 주 기록 기준';   // 진행 중 주로 정해진 변경(task-owner detectOwnerChanges tentative)
const r1 = (v) => Math.round(v * 10) / 10;
const clip = (s, max) => (s.length <= max ? s : s.slice(0, max - 1) + '…');
const toUtc = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000);
const sysSet = (cfg) => new Set((cfg && cfg.systemAccounts || []).map(s => String(typeof s === 'string' ? s : (s && s.name) || '').trim()).filter(Boolean));
const asSet = (v) => (v == null ? null : v instanceof Set ? v : new Set(Array.isArray(v) ? v : []));

/**
 * 담당 재배치 추천.
 * @param {Array} allDays 지금 이름으로 합친 이력(aliasHistoryView 사본)
 * @param {object} cfg appConfig(퇴사일·시스템 계정·팀)
 * @param {object} opts { today(필수), available(Set|Array — 다음 주 가용 이름, 휴가자 제외. 없으면 재직자 전부),
 *                        dropPct=-10, minDays=MIN_COMPARE_DAYS, hold=2, maxAgeDays=84, maxCandidates=3, excludeTasks=[], matrix }
 * @returns {Array<{task, change:{from, to, at, uphBefore, uphAfter, pct, sample}, options:[{kind, candidate, partTimer, reason, candUph,
 *           gainHoursPerWeek, risk:{soloTasks:[업무], otherHoursPerWeek, ownerSoloTasks:[업무]}}], recommend, confidence, text}>}
 *   ⚠️ 이름이 들어 있다(change.from·to·candidate·text) — 메모리 전용. 밖으로는 adviceForOutput.
 */
export function buildOwnerAdvice(allDays, cfg, opts = {}) {
    const L = ADVICE_LEVELS;
    const today = opts.today;
    if (!today) return [];
    const dropPct = Number.isFinite(Number(opts.dropPct)) ? Number(opts.dropPct) : L.dropPct;
    const minDays = Math.max(MIN_COMPARE_DAYS, Number(opts.minDays) || 0);
    const hold = opts.hold || L.hold;
    const maxAge = opts.maxAgeDays != null ? opts.maxAgeDays : L.maxAgeDays;
    const maxCand = opts.maxCandidates || L.maxCandidates;
    const available = asSet(opts.available);
    const sys = sysSet(cfg);
    const eligible = (name) => !!name && !sys.has(name) && isMemberActiveOn(name, today, cfg || {}) && (!available || available.has(name));

    // 오늘 포함 — 변경 판정은 오늘까지 기록으로(업무 담당 변화 화면과 같은 결론). skillMatrix·compareAround 는 각자 오늘을 뺀다.
    const days = (allDays || []).filter(d => d && typeof d.id === 'string' && d.id <= today);
    const matrix = opts.matrix || skillMatrix(days, cfg, { today, excludeTasks: opts.excludeTasks || [] });
    const bus = busFactor(matrix);
    const soloTasksOf = (name, task) => bus.filter(b => b.task !== task && b.who.includes(name)).map(b => b.task);
    const winWeeks = Math.max(1, (daysBetween(matrix.from, matrix.to) + 1) / 7);
    const otherHoursOf = (name, task) => r1(matrix.tasks.reduce((s, t) => s + (t.task !== task && t.people[name] ? t.people[name].hours : 0), 0) / winWeeks);
    const ptSet = new Set((matrix.people || []).filter(p => p.partTimer).map(p => p.name));

    const out = [];
    (matrix.tasks || []).forEach(t => {
        if (!t.isQty) return;
        const task = t.task;
        const list = taskDays(days, task);
        const rows = ownerByPeriod(days, task, { gran: 'week', qtyTask: true });
        const { changes } = detectOwnerChanges(rows, { hold, today, liveOk: true });   // 진행 중 주도 셈(2026-11-10)
        if (!changes.length) return;
        const ch = changes[changes.length - 1];
        if (maxAge != null && daysBetween(ch.date, today) > maxAge) return;
        const prev = changes.length > 1 ? changes[changes.length - 2] : null;
        const cmp = compareAround(days, task, ch, { gran: 'week', qtyTask: true, prevDate: prev ? prev.date : null, list, today });
        const b = cmp.before, a = cmp.after;
        const sample = Math.min(b.qtyDays, a.qtyDays);
        if (cmp.lowSample || sample < minDays) return;                 // 표본 부족 — 판정하지 않는다
        const pct = pctChange(b.uph, a.uph);
        if (pct == null || pct > dropPct + 1e-9) return;                // 저하 아님

        // 주 물량 = 변경 뒤 물량 ÷ 그 물량이 있던 주 수
        const afterQd = qtyDaysOf(list.filter(s => s.date >= a.from && s.date <= a.to));
        const weeks = new Set(afterQd.map(s => periodKeyOf(s.date, 'week'))).size || 1;
        const weeklyQty = afterQd.reduce((s, x) => s + x.qty, 0) / weeks;
        const gainAt = (uph) => (uph > 0 && a.uph > 0 ? Math.max(0, r1(weeklyQty / a.uph - weeklyQty / uph)) : 0);

        const ownerSolo = soloTasksOf(ch.to, task);
        const options = [];
        const seen = new Set([ch.to]);
        const addCand = (name, candUph, isPrev) => {
            seen.add(name);
            const solo = soloTasksOf(name, task);
            const kind = solo.length ? 'pair' : 'replace';
            const full = gainAt(candUph);
            const why = [];
            why.push(isPrev ? `이전 담당 — 변경 전 단독 UPH ${r1(candUph)}` : `숙련 후보 — 단독 UPH ${r1(candUph)}`);
            if (ownerSolo.length) why.push(`지금 담당은 ${ownerSolo.join('·')} 업무를 혼자 맡고 있음 — 교체해도 그 업무 공백 없음(오히려 집중 가능)`);
            if (solo.length) why.push(`후보가 ${solo.join('·')} 업무를 혼자 맡고 있어 병행만`);
            options.push({
                kind, candidate: name, partTimer: ptSet.has(name), reason: why.join(' · '), candUph: r1(candUph),
                gainHoursPerWeek: kind === 'pair' ? r1(full / 2) : full,
                risk: { soloTasks: solo, otherHoursPerWeek: otherHoursOf(name, task), ownerSoloTasks: ownerSolo }
            });
        };
        // ① 이전 담당
        if (ch.from && ch.from !== ch.to && eligible(ch.from)) {
            const mp = t.people[ch.from];
            const u = b.ownerUph != null ? b.ownerUph : (mp && mp.uph != null ? mp.uph : null);
            if (u != null && u > a.uph) addCand(ch.from, u, true);
            else seen.add(ch.from);
        }
        // ② 숙련 후보
        Object.entries(t.people)
            .filter(([n, p]) => !seen.has(n) && eligible(n) && LEVEL_RANK[p.level] >= LEVEL_RANK.able && p.uph != null && p.uph > a.uph)
            .sort((x, y) => y[1].uph - x[1].uph || (x[0] < y[0] ? -1 : 1))
            .slice(0, Math.max(0, maxCand - options.length))
            .forEach(([n, p]) => addCand(n, p.uph, false));
        // ③ 교육 후 유지(언제나 마지막 안)
        options.push({
            kind: 'train', candidate: null, partTimer: false,
            reason: options.length ? '지금 담당을 유지하며 교육 — 변경 전 수준으로 돌아오면 절감'
                : '지금 UPH 보다 빠른 가용 후보가 없음 — 지금 담당을 유지하며 교육',
            candUph: null, gainHoursPerWeek: gainAt(b.uph),
            risk: { soloTasks: [], otherHoursPerWeek: otherHoursOf(ch.to, task), ownerSoloTasks: ownerSolo }
        });

        const confidence = sample >= L.highDays ? 'high' : sample >= L.midDays ? 'mid' : 'low';
        const change = { from: ch.from, to: ch.to, at: ch.date, uphBefore: r1(b.uph), uphAfter: r1(a.uph), pct: r1(pct), sample, tentative: !!ch.tentative };
        out.push({ task, change, options, recommend: options[0].kind, confidence, text: textOf(task, change, options[0]) });
    });
    return out.sort((x, y) => x.change.pct - y.change.pct || (x.task < y.task ? -1 : 1));
}

/** 화면용 문장(이름 포함 — data.reports 일 때만 보여 준다) */
function textOf(task, c, o) {
    const head = `${task}: ${c.at} 주 담당이 ${c.from}에서 ${c.to}(으)로 바뀐 뒤${c.tentative ? `(${TENTATIVE})` : ''} UPH ${c.uphBefore} → ${c.uphAfter}(${c.pct}%, 표본 ${c.sample}일).`;
    let tail;
    if (o.kind === 'replace') tail = ` ${o.candidate}에게 다시 맡기는 것을 제안합니다(UPH ${o.candUph}, 주 약 ${o.gainHoursPerWeek}시간 절감 기대).`;
    else if (o.kind === 'pair') tail = ` ${o.candidate}을(를) 함께 배치하는 것을 제안합니다(UPH ${o.candUph}, 주 약 ${o.gainHoursPerWeek}시간 절감 기대).`;
    else tail = ` ${c.to}이(가) 계속 맡되 교육을 제안합니다(변경 전 수준이면 주 약 ${o.gainHoursPerWeek}시간 절감).`;
    return `${head}${tail} ${PEOPLE_NOTE}.`;
}

/**
 * ⚠️ 밖으로 나가는 길 — 이름을 모두 빼고 업무명·숫자·이름 없는 문장·과제 초안만 남긴다(저장·인쇄·과제).
 * @param advice buildOwnerAdvice 의 결과(배열) 또는 그 한 건
 * @param opts { today } — 과제 초안의 분기·기한(없으면 change.at 기준)
 * @returns [{task, at, uphBefore, uphAfter, pct, sample, recommend, candidateCount, gainHoursPerWeek, confidence, text,
 *            itemDraft:{kind:'initiative', title, role, year, quarter, due, kpi{metric:'taskUph', task, from, target}, src}}]
 */
export function adviceForOutput(advice, { today = null } = {}) {
    const list = Array.isArray(advice) ? advice : (advice ? [advice] : []);
    return list.map(ad => {
        const c = ad.change || {};
        const opts = Array.isArray(ad.options) ? ad.options : [];
        const top = opts[0] || null;
        const candidateCount = opts.filter(o => o && o.candidate).length;
        const gain = top ? r1(Number(top.gainHoursPerWeek) || 0) : 0;
        const task = String(ad.task);
        const q = quarterList(today || c.at || '2000-01-01', 1)[0];
        const tent = c.tentative ? ` (${TENTATIVE})` : '';
        return {
            task, at: c.at || null, tentative: !!c.tentative,
            uphBefore: c.uphBefore != null ? r1(Number(c.uphBefore)) : null,
            uphAfter: c.uphAfter != null ? r1(Number(c.uphAfter)) : null,
            pct: c.pct != null ? r1(Number(c.pct)) : null,
            sample: c.sample | 0,
            recommend: ['replace', 'pair', 'train'].includes(ad.recommend) ? ad.recommend : 'train',
            candidateCount, gainHoursPerWeek: gain,
            confidence: ['high', 'mid', 'low'].includes(ad.confidence) ? ad.confidence : 'low',
            text: `${task} 업무 담당 재배치 검토 — 후보 ${candidateCount}명, 기대 절감 ${gain}시간/주${tent}`,
            itemDraft: {
                kind: 'initiative',
                title: clip(`${task} 업무 담당 재배치 검토(후보 ${candidateCount}명${c.tentative ? ' · 잠정' : ''})`, ADVICE_LEVELS.titleMax),
                role: 'admin',
                year: q.year, quarter: q.key, due: q.end,
                kpi: { metric: 'taskUph', task, from: c.uphAfter != null ? r1(Number(c.uphAfter)) : null, target: c.uphBefore != null ? r1(Number(c.uphBefore)) : null },
                src: { rule: 'ownerAdvice', recommend: ['replace', 'pair', 'train'].includes(ad.recommend) ? ad.recommend : 'train' }
            }
        };
    });
}
