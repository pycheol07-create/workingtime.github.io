// === js/lib/plan-week.js ===
// 운영 계획 MVP-1(주간 계획서, 2026-11-05) — 다음 주 날짜·하루 수요/공급·부족 메우기(선처리 → 연장 → 알바).
//   수요·공급 숫자는 업무 예상 엔진(js/ui-history-prediction.js getStaffingOutlook)이 낸 행을 그대로 받는다 —
//   인력 탭 '앞으로 인원 수급' 표와 같은 계산(필요·가용·과부족이 같아야 한다). 여기서는 그 행을 주간 표로 맞추고 메우기만 셈한다.
//   시간·인원만 다룬다(금액 없음 — 알바 시급 등은 단계 4). 직원 이름은 받지도 내보내지도 않는다(휴무는 '수'만).
//   연장 기준: 근로기준법 — 주 연장 12시간(제53조), 할증 50%(제56조). 하루 상한은 법에 없어 설정값(기본 4시간).
//     앱은 법적 판단을 하지 않는다(화면 고정 문구). 할증은 시간 계산에 넣지 않는다(금액 단계에서).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-week.test.js

import { getHolidayName } from '../utils.js?v=202611101659';
import { TASK } from './task-ids.js?v=202611101659';

/** 기본 설정 — 설정 화면은 다음 단계(MVP-2). cfg.opsPlan 에 같은 이름 칸이 있으면 그 값(읽기만). */
export const PLAN_DEFAULTS = Object.freeze({
    overtimeDailyMax: 4,      // 1인 하루 연장 상한(시간) — 법정 상한 없음, 회사 설정
    overtimeWeeklyMax: 12,    // 1인 주 연장 상한(시간) — 근로기준법 제53조(주 52시간 = 40 + 12)
    overtimePremium: 1.5,     // 연장 할증(참고 표시만) — 근로기준법 제56조
    tempLeadDays: 3,          // 알바 요청 → 투입까지 걸리는 날
    stdHours: 8,              // 알바 1인일 표준 근무시간
    // 선처리 가능 업무(사용자 결정 2026-11-05) — 업무 id. 이름은 taskNameOf 로.
    prepTaskIds: Object.freeze([TASK.fill, TASK.directPrep, TASK.localprod, TASK.china])
});

/** 법정 연장 고정 문구(사용자 결정) */
export const OVERTIME_LAW_NOTE = '법정 기준: 주 12시간 연장 한도, 할증 50%(근로기준법 제53·56조) — 회사 규정이 다르면 설정에서 바꾸세요, 앱은 법적 판단을 하지 않습니다';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** 'YYYY-MM-DD' + n 일 */
export function addDaysStr(s, n) {
    const d = parse(s);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return ymd(d);
}

/** 요일 글자(일~토) */
export const dowOf = (s) => { const d = parse(s); return d ? DOW[d.getDay()] : ''; };

/** 설정 읽기 — cfg.opsPlan 의 숫자 칸이 0 이상이면 그 값, 아니면 기본값. prepTaskIds 는 배열일 때만. */
export function planSettingsOf(cfg) {
    const o = (cfg && cfg.opsPlan && typeof cfg.opsPlan === 'object') ? cfg.opsPlan : {};
    const out = { ...PLAN_DEFAULTS };
    for (const k of ['overtimeDailyMax', 'overtimeWeeklyMax', 'overtimePremium', 'tempLeadDays', 'stdHours']) {
        const v = Number(o[k]);
        if (o[k] != null && Number.isFinite(v) && v >= 0) out[k] = v;
    }
    if (Array.isArray(o.prepTaskIds) && o.prepTaskIds.length) out.prepTaskIds = o.prepTaskIds.slice();
    else out.prepTaskIds = PLAN_DEFAULTS.prepTaskIds.slice();
    if (!(out.stdHours > 0)) out.stdHours = PLAN_DEFAULTS.stdHours;
    return out;
}

/**
 * 다음 주 = 오늘이 어느 요일이든 '다음 월요일 ~ 그 일요일'(사용자 결정). 월요일 오늘 → 7일 뒤 월요일, 일요일 오늘 → 내일(월).
 * @returns {{from, to, dates: string[7]}}
 */
export function nextWeekRange(todayStr) {
    const d = parse(todayStr);
    if (!d) return { from: null, to: null, dates: [] };
    const toMon = ((8 - d.getDay()) % 7) || 7;    // 월(1)→7, 화→6, …, 일(0)→1
    const from = addDaysStr(todayStr, toMon);
    const dates = Array.from({ length: 7 }, (_, i) => addDaysStr(from, i));
    return { from, to: dates[6], dates };
}

/** 쉬는 날 판정(업무 예상과 같은 규칙: 주말 + 앱 공휴일표). holidayNameOf(date) → 이름 | '' 로 바꿔 시험할 수 있다. */
export function offDayOf(dateStr, holidayNameOf = null) {
    const d = parse(dateStr);
    if (!d) return { weekend: false, holiday: false, holidayName: '' };
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const nm = typeof holidayNameOf === 'function'
        ? (holidayNameOf(dateStr) || '')
        : (getHolidayName(d.getFullYear(), d.getMonth() + 1, d.getDate()) || '');
    return { weekend, holiday: !!nm, holidayName: nm };
}

/**
 * 하루 행 한 벌 — 업무 예상 행(outlook row) → 주간 표 행. 쉬는 날이면 수요·공급 0.
 *   outlook row: { date, requiredFTE(반올림), rawRequiredFTE, available, gap, totalHours, needHours, netDailyHours,
 *                  onLeave(수), rosterCount, hasPlanned, taskHours{업무: 사람 시간} }
 *   gap 은 업무 예상 그대로(가용 − 반올림 필요) — 인력 탭 표와 같다. 부족 시간(shortHours)은 반올림 전 필요로 센다.
 * prepNames: 선처리 가능 업무 이름(지금 이름) — 그날 그 업무들의 사람 시간 합 = 선처리 후보(prepHours).
 */
export function dayRowOf(dateStr, row, { holidayNameOf = null, prepNames = [] } = {}) {
    const off = offDayOf(dateStr, holidayNameOf);
    const base = {
        date: dateStr, dow: dowOf(dateStr), weekend: off.weekend, holiday: off.holiday, holidayName: off.holidayName,
        workday: false, hasRow: false, failed: false, hasPlanned: false,
        demandHours: 0, reqFTE: 0, reqFTERounded: 0, supplyFTE: 0, fillRate: null, gap: 0,
        leaveCount: 0, rosterCount: 0, hoursPerPerson: 0, shortHours: 0, spareHours: 0, prepHours: 0,
        recommend: 0, spareFTE: 0, rawReq: 0
    };
    if (off.weekend || off.holiday) return base;
    base.workday = true;
    if (!row || row.date !== dateStr) return base;   // 업무 예상 행이 없는 업무일(계산 범위 밖) — 숫자 없음
    const hpp = num(row.netDailyHours) > 0 ? num(row.netDailyHours) : 8;
    const raw = row.rawRequiredFTE != null ? num(row.rawRequiredFTE) : num(row.requiredFTE);
    const supply = Math.max(0, Math.round(num(row.available)));
    const gap = row.gap != null ? num(row.gap) : supply - Math.round(raw);
    const short = gap < 0 ? Math.max(0, raw - supply) * hpp : 0;
    const spare = gap >= 0 ? Math.max(0, supply - raw) * hpp : 0;
    const prepSet = new Set(prepNames || []);
    let prep = 0;
    Object.entries(row.taskHours || {}).forEach(([k, v]) => { if (prepSet.has(k)) prep += Math.max(0, num(v)); });
    const recommend = Math.min(supply, Math.ceil(raw - 1e-9));
    return {
        ...base,
        hasRow: true, failed: !!row.failed, hasPlanned: !!row.hasPlanned,
        demandHours: r1(num(row.totalHours)),
        reqFTE: r1(raw), reqFTERounded: Math.round(raw),
        supplyFTE: supply,
        fillRate: raw > 0 ? Math.min(1, supply / raw) : 1,
        gap,
        leaveCount: Math.max(0, Math.round(num(row.onLeave))),
        rosterCount: Math.max(0, Math.round(num(row.rosterCount))),
        hoursPerPerson: hpp,
        shortHours: r1(short), spareHours: r1(spare), prepHours: r1(prep),
        recommend: Math.max(0, recommend), rawReq: raw,
        spareFTE: Math.max(0, supply - Math.max(0, recommend))
    };
}

/** 다음 주 7일 행 — outlookRows 는 업무 예상 행(업무일만). */
export function weekDaysOf(range, outlookRows, opts = {}) {
    const byDate = new Map((outlookRows || []).filter(r => r && r.date).map(r => [r.date, r]));
    return (range && range.dates ? range.dates : []).map(d => dayRowOf(d, byDate.get(d), opts));
}

/**
 * 부족 메우기 — 순서: ① 선처리(그날 선처리 가능 업무 시간 중, 바로 앞 업무일의 남는 시간 안에서)
 *   ② 연장(1인 하루 ≤ overtimeDailyMax, 1인 주 ≤ overtimeWeeklyMax — 그날 출근 인원에 고르게 나눈다고 본다)
 *   ③ 알바(인일 = ceil(남은 시간 / 표준 근무시간)). 시간·인원만(금액 없음).
 * @param {Array} days  dayRowOf 행(날짜 순). shortHours·spareHours·prepHours·supplyFTE·workday 를 본다
 * @returns {{ days: [{date, need, prep, overtime, overtimePerPerson, temp, tempPeople, left, spareLeft}], totals, leadDays }}
 *   spareLeft = 그날 남는 시간 중 다음 날 선처리에 쓰고 남은 시간 — 여유·교육·정리 인원은 이 값으로 센다(같은 여유를 두 번 쓰지 않게)
 */
export function fillMix(days, opts = {}) {
    const s = { ...PLAN_DEFAULTS, ...opts };
    const list = Array.isArray(days) ? days : [];
    const spareLeft = list.map(d => (d && d.workday ? Math.max(0, num(d.spareHours)) : 0));
    let otUsedPerPerson = 0;     // 1인 주 연장 누계(고르게 나눈다고 본 값)
    const out = list.map((d, i) => {
        const need = d && d.workday ? Math.max(0, num(d.shortHours)) : 0;
        let left = need;
        // ① 선처리 — 바로 앞 업무일(같은 주 안)의 남는 시간에서 당겨 한다
        let prep = 0;
        if (left > 0) {
            let j = i - 1;
            while (j >= 0 && !(list[j] && list[j].workday)) j--;
            if (j >= 0) {
                prep = Math.min(left, Math.max(0, num(d.prepHours)), spareLeft[j]);
                spareLeft[j] -= prep;
                left -= prep;
            }
        }
        // ② 연장
        let overtime = 0, perPerson = 0;
        const supply = d && d.workday ? Math.max(0, num(d.supplyFTE)) : 0;
        if (left > 0 && supply > 0) {
            const room = Math.max(0, Math.min(num(s.overtimeDailyMax), num(s.overtimeWeeklyMax) - otUsedPerPerson));
            overtime = Math.min(left, room * supply);
            perPerson = overtime / supply;
            otUsedPerPerson += perPerson;
            left -= overtime;
        }
        // ③ 알바
        const std = num(s.stdHours) > 0 ? num(s.stdHours) : 8;
        const temp = left > 1e-9 ? left : 0;
        const tempPeople = temp > 0 ? Math.ceil(temp / std - 1e-9) : 0;
        return {
            date: d ? d.date : null, need: r1(need), prep: r1(prep), overtime: r1(overtime),
            overtimePerPerson: r1(perPerson), temp: r1(temp), tempPeople, left: 0
        };
    });
    out.forEach((x, i) => { x.spareLeft = r1(Math.max(0, spareLeft[i])); });
    const sum = (k) => r1(out.reduce((t, x) => t + x[k], 0));
    return {
        days: out,
        totals: {
            need: sum('need'), prep: sum('prep'), overtime: sum('overtime'), temp: sum('temp'),
            tempPeople: out.reduce((t, x) => t + x.tempPeople, 0),
            overtimePerPersonWeek: r1(otUsedPerPerson)
        },
        leadDays: { prep: 0, overtime: 0, temp: num(s.tempLeadDays) }
    };
}

/** 연속 부족 구간(업무일 기준, 쉬는 날은 건너뛰고 잇는다) — 길이 ≥ minLen 만. [{from, to, dates[]}] */
export function shortRuns(days, minLen = 2) {
    const runs = [];
    let cur = null;
    (days || []).forEach(d => {
        if (!d || !d.workday) return;
        if (d.gap < 0) { if (!cur) { cur = [d.date]; runs.push(cur); } else cur.push(d.date); }
        else cur = null;
    });
    return runs.filter(r => r.length >= minLen).map(r => ({ from: r[0], to: r[r.length - 1], dates: r }));
}

/** 신뢰도 — 업무일 중 예정 물량을 넣은 날 비율. ≥60% 높음 · ≥30% 보통 · 그 아래 낮음. */
export function confidenceOf(days) {
    const wd = (days || []).filter(d => d && d.workday && d.hasRow);
    const planned = wd.filter(d => d.hasPlanned).length;
    const ratio = wd.length ? planned / wd.length : 0;
    const level = !wd.length ? 'low' : ratio >= 0.6 ? 'high' : ratio >= 0.3 ? 'mid' : 'low';
    return { level, label: { high: '높음', mid: '보통', low: '낮음' }[level], planned, workdays: wd.length, ratio };
}
