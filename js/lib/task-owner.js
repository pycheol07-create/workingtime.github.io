// === js/lib/task-owner.js ===
// 데이터 관리 「업무 담당 변화」 계산 — 업무 하나의 기간(주·월)별 주 인원, 주 인원이 바뀐 지점, 그 전후 지표 비교(2026-11-05).
// 화면은 js/ui-history-task-owner.js. 입력은 이력(State.allHistoryData)을 aliasHistoryView 로 지금 이름으로 바꾼 사본이다
// — 업무 이름을 바꾼 뒤에도 옛 기록이 같은 업무로 합쳐진다. 직원은 기록의 member 이름 그대로(이름이 바뀐 직원은 다른 사람).
// ※ 순수 모듈(DOM·Firebase 없음). 읽기만 한다. 테스트: tests/task-owner.test.js
//
// 규칙(설계 확정안)
//   · 주 인원 = 기간 안 그 업무 투입시간 비중 1위. 1위 < minShare(40%) 이거나 1·2위 차 ≤ tieGap(5%p) → '여럿'(mixed).
//     기간 총 투입 < minMinutes(60분) 또는 진행 일수 < minDays(2) → '표본 부족'(thin).
//   · 변경 = 새 사람이 hold 기간 연속 1위(여럿·표본 부족 기간은 건너뛰고 잇는다). 시점 = 새 사람 첫 기간 시작일.
//     화면·리포트·계획은 언제나 주 단위로 판정하고(진행 중 주도 liveOk 로 셈) 월 화면은 mapOwnerChanges 로 맞춘다(2026-11-10).
//   · 기록 1건은 CAP_MINUTES(720분)까지만 센다 — '종료'를 안 누른 기록이 하루 끝까지 잡혀 비중·속도를 부풀린다.
import { taskUph } from '../task-throughput.js?v=202611101708';

export const CAP_MINUTES = 720;
export const SOLO_SHARE = 0.8;      // 본인 UPH: 그날 그 업무 시간의 80% 이상을 맡은 날(단독일)만
export const MIN_SOLO_DAYS = 3;     // 단독일이 이보다 적으면 본인 UPH 를 내지 않는다
export const MIN_COMPARE_DAYS = 5;  // 전·후 어느 쪽이든 진행 일수가 이보다 적으면 '표본 적음'
const UPH_OPTS = { mode: 'dailyMedian', minMinutes: 10, minSamples: 3 };

// ── 날짜 (UTC 로 계산 — 시간대·서머타임 영향 없음) ─────────────────────
const pad = (n) => String(n).padStart(2, '0');
const toUtc = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const addDays = (s, n) => fromUtc(toUtc(s) + n * 86400000);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 날짜 → 기간 키. 주 = 그 주 월요일 날짜('YYYY-MM-DD', 해가 바뀌는 주도 월요일 하나로), 월 = 'YYYY-MM'. */
export function periodKeyOf(date, gran = 'week') {
    if (gran === 'month') return String(date).slice(0, 7);
    const t = toUtc(date);
    const dow = (new Date(t).getUTCDay() + 6) % 7;   // 월=0 … 일=6
    return fromUtc(t - dow * 86400000);
}

/** 기간 키 → { start, end } (둘 다 포함) */
export function periodRange(key, gran = 'week') {
    if (gran === 'month') {
        const [y, m] = key.split('-').map(Number);
        return { start: `${key}-01`, end: fromUtc(Date.UTC(y, m, 0)) };
    }
    return { start: key, end: addDays(key, 6) };
}

/** 기간 키를 n 칸 옮긴다(음수면 앞으로). */
export function shiftPeriod(key, n, gran = 'week') {
    if (gran === 'month') {
        const [y, m] = key.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1 + n, 1));
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    }
    return addDays(key, n * 7);
}

// ── 하루치 ─────────────────────────────────────────────────────────
const asArray = (v) => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);

/** 그날 알바 이름 집합(day.partTimers 의 name). 배열·맵 둘 다 받는다. */
export const partTimerNamesOf = (day) => new Set(asArray(day && day.partTimers).map(p => p && p.name).filter(Boolean));

/** 하루치에서 업무 하나만 — { date, minutes, qty, records, capped, byMember{이름:분}, partTimers:Set } (분은 기록당 상한 적용) */
export function dayTaskStats(day, task) {
    const out = { date: day && day.id, minutes: 0, qty: 0, records: 0, capped: 0, byMember: {}, partTimers: null };
    (Array.isArray(day && day.workRecords) ? day.workRecords : []).forEach(r => {
        if (!r || r.task !== task) return;
        const raw = Number(r.duration) || 0;
        if (raw <= 0) return;
        const m = Math.min(raw, CAP_MINUTES);
        if (raw > CAP_MINUTES) out.capped++;
        out.minutes += m;
        out.records++;
        const who = r.member || '';
        if (who) out.byMember[who] = (out.byMember[who] || 0) + m;
    });
    const q = Number(day && day.taskQuantities && day.taskQuantities[task]) || 0;
    if (q > 0) out.qty = q;
    return out;
}

/** 이력 → 업무 하나의 하루치 목록(날짜순, 그 업무 시간이나 물량이 있는 날만) */
export function taskDays(days, task) {
    const out = [];
    (Array.isArray(days) ? days : []).forEach(day => {
        if (!day || !isDate(day.id)) return;
        const s = dayTaskStats(day, task);
        if (s.minutes <= 0 && s.qty <= 0) return;
        s.partTimers = partTimerNamesOf(day);
        out.push(s);
    });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 하루치 목록 → taskUph 가 먹는 모양(상한 적용한 기록 1건 + 물량) */
const toUphDays = (list, task) => list.map(s => ({
    id: s.date,
    workRecords: s.minutes > 0 ? [{ task, duration: s.minutes }] : [],
    taskQuantities: s.qty > 0 ? { [task]: s.qty } : {}
}));

/** 시간·물량이 둘 다 있는 날만 — 수량형 지표(UPH·처리량·개당 시간)는 이 날들로만 센다.
 *  (물량을 아직 안 넣은 날·진행 중인 날의 시간이 분모에만 들어가면 속도가 낮게 나온다) */
export const qtyDaysOf = (list) => list.filter(s => s.minutes > 0 && s.qty > 0);

/** 하루치 목록의 UPH(일별 가운데값, 표본 3일 미만이면 합계). 시간·물량 둘 다 있는 날만 본다. 없으면 null. */
export function uphOf(list0, task) {
    const list = qtyDaysOf(list0);
    const mins = list.reduce((a, s) => a + s.minutes, 0);
    const qty = list.reduce((a, s) => a + s.qty, 0);
    if (mins <= 0 || qty <= 0) return null;
    const v = taskUph(toUphDays(list, task), { ...UPH_OPTS, tasks: new Set([task]) })[task];
    return v > 0 ? v : null;
}

/** 이력에 기록(시간)이 있는 업무 목록 — 투입시간 많은 순. exclude 의 이름은 뺀다(관리자 개별업무 등). */
export function taskListOf(days, { exclude = [] } = {}) {
    const ex = new Set(exclude.filter(Boolean));
    const mins = {};
    (Array.isArray(days) ? days : []).forEach(day => {
        (Array.isArray(day && day.workRecords) ? day.workRecords : []).forEach(r => {
            if (!r || !r.task || ex.has(r.task)) return;
            const m = Math.min(Number(r.duration) || 0, CAP_MINUTES);
            if (m > 0) mins[r.task] = (mins[r.task] || 0) + m;
        });
    });
    return Object.entries(mins).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([t]) => t);
}

// ── 기간별 주 인원 ───────────────────────────────────────────────────
/**
 * 기간별 주 인원.
 * @returns 기간 키 순 [{ key, start, end, days, minutes, qty, records, capped, headcount, avgMinutesPerDay,
 *            ranking:[{name, minutes, share, partTimer}], status:'owner'|'mixed'|'thin',
 *            owner, ownerShare, ownerPartTimer, second:{name, share, partTimer}|null, uph }]
 *   uph 는 qtyTask 일 때만(아니면 null). share 는 0~1.
 */
export function ownerByPeriod(days, task, {
    gran = 'week', minShare = 0.4, tieGap = 0.05, minMinutes = 60, minDays = 2, qtyTask = false, partTimerOf = null
} = {}) {
    const groups = new Map();
    taskDays(days, task).forEach(s => {
        const key = periodKeyOf(s.date, gran);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
    });
    const isPt = partTimerOf || ((s, name) => s.partTimers && s.partTimers.has(name));
    const rows = [];
    [...groups.keys()].sort().forEach(key => {
        const list = groups.get(key);
        const by = {}, pt = new Set(), people = new Set();
        let minutes = 0, qty = 0, records = 0, capped = 0, active = 0;
        list.forEach(s => {
            minutes += s.minutes; qty += s.qty; records += s.records; capped += s.capped;
            if (s.minutes > 0) active++;
            Object.entries(s.byMember).forEach(([n, m]) => {
                by[n] = (by[n] || 0) + m;
                people.add(n);
                if (isPt(s, n)) pt.add(n);
            });
        });
        const ranking = Object.entries(by)
            .map(([name, m]) => ({ name, minutes: m, share: minutes > 0 ? m / minutes : 0, partTimer: pt.has(name) }))
            .sort((a, b) => b.minutes - a.minutes || (a.name < b.name ? -1 : 1));
        const top = ranking[0] || null, sec = ranking[1] || null;
        let status;
        if (minutes < minMinutes || active < minDays || !top) status = 'thin';
        else if (top.share < minShare || (sec && top.share - sec.share <= tieGap + 1e-9)) status = 'mixed';
        else status = 'owner';
        const { start, end } = periodRange(key, gran);
        const firstRec = list.find(s => s.minutes > 0) || list[0];
        rows.push({
            key, start, end, firstDate: firstRec ? firstRec.date : start, days: active, minutes, qty, records, capped,
            headcount: people.size,
            avgMinutesPerDay: active > 0 ? minutes / active : 0,
            ranking, status,
            owner: status === 'owner' ? top.name : null,
            ownerShare: top ? top.share : 0,
            ownerPartTimer: !!(top && top.partTimer),
            top: top ? { name: top.name, share: top.share, partTimer: top.partTimer } : null,
            second: sec ? { name: sec.name, share: sec.share, partTimer: sec.partTimer } : null,
            uph: qtyTask ? uphOf(list, task) : null
        });
    });
    return rows;
}

// ── 변경 감지 ────────────────────────────────────────────────────────
/**
 * 주 인원 변경 지점. '여럿'·'표본 부족' 기간은 앞 주 인원을 잇는다(건너뜀).
 * 새 사람이 hold 기간 연속(건너뛴 기간 제외) 1위여야 변경 — A→B(1기간)→A 는 잡음, A→여럿→A 는 변경 아님.
 * today 를 주면 진행 중 기간(끝 날짜 ≥ today)도 건너뛴다 — 며칠치로 1위가 오락가락해 변경이 생겼다 사라지지 않게.
 * liveOk 를 켜면 진행 중 기간도 지금까지 자료로 센다 — 단 status 'owner'(활동 2일 이상·60분 이상, 여럿 아님)일 때만
 *   (2026-11-10 사용자 결정. 업무 담당 변화 화면·운영 리포트·월간 계획·담당 재배치 추천은 켜서 부른다. 기본은 꺼짐 = 예전과 같음).
 *   진행 중 기간 덕분에 확정된 변경(확정한 마지막 기간이 오늘을 포함)에는 tentative: true 가 붙는다 — 이번 주 기록이 더 쌓이면
 *   사라질 수 있다('잠정'). liveOk 가 꺼져 있으면 이 칸은 생기지 않는다(예전 모양 그대로).
 * @returns { initial: 처음 주 인원|null, changes: [{ key, date, from, to, rowIndex, tentative? }] } (date = 새 사람 첫 기간 시작일)
 */
export function detectOwnerChanges(rows, { hold = 2, today = null, liveOk = false } = {}) {
    const h = Math.max(1, Math.floor(Number(hold) || 1));
    let current = null, initial = null, cand = null, count = 0, candIdx = -1;
    const changes = [];
    (rows || []).forEach((row, i) => {
        if (!row || row.status !== 'owner') return;   // 여럿·표본 부족(진행 중 기간 포함)은 건너뜀
        if (today && row.end >= today && !liveOk) return;   // 진행 중 기간
        const who = row.owner;
        if (current === null) { current = initial = who; return; }
        if (who === current) { cand = null; count = 0; return; }
        if (who === cand) count++;
        else { cand = who; count = 1; candIdx = i; }
        if (count >= h) {
            const first = rows[candIdx];
            const ch = { key: first.key, date: first.start, from: current, to: cand, rowIndex: candIdx };
            if (today && row.end >= today) ch.tentative = true;   // liveOk 일 때만 여기 온다
            changes.push(ch);
            current = cand; cand = null; count = 0;
        }
    });
    return { initial, changes };
}

/** 각 기간의 '이어 온 주 인원'(변경 반영) — 표·차트용. rows 와 같은 길이. */
export function ownerLine(rows, { initial, changes }) {
    let cur = initial || null, ci = 0;
    const firstIdx = (rows || []).findIndex(r => r && r.status === 'owner');
    return (rows || []).map((r, i) => {
        while (ci < changes.length && changes[ci].rowIndex <= i) cur = changes[ci++].to;
        return (firstIdx >= 0 && i >= firstIdx) ? cur : null;
    });
}

/**
 * 주 단위 판정 결과를 다른 단위(월 등) 표시 행에 맞춘다 — 바뀜 판정은 언제나 주 단위, 화면 단위는 보여 주기만(2026-11-10).
 *   주의 위치 = 그 주의 실제 첫 기록 날짜(firstDate) — 두 달에 걸친 주(예: 9/28~10/4 에 기록이 10/1 부터)는 기록이 있는 달에 둔다.
 *   line[i]   = 표시 행 i 의 끝 날짜까지 반영된 주 담당(첫 기록이 그 날짜까지인 마지막 주의 ownerLine 값).
 *   changes   = 주 단위 변경을 그 주가 놓인 표시 행으로 옮긴 것 { ...변경, key: 표시 행 키, weekKey, rowIndex: 표시 행 번호 }.
 * @param rows 표시 행(ownerByPeriod 결과, 아무 단위)  @param weekRows 주 단위 행  @param det detectOwnerChanges(weekRows) 결과
 * @returns { initial, changes, line }
 */
export function mapOwnerChanges(rows, weekRows, det) {
    const wl = ownerLine(weekRows, det);
    const wr = weekRows || [];
    const at = (w) => (w && w.firstDate) || (w && w.start);
    const line = (rows || []).map(r => {
        let v = null;
        for (let j = 0; j < wr.length && at(wr[j]) <= r.end; j++) v = wl[j];
        return v;
    });
    const changes = [];
    (det.changes || []).forEach(c => {
        const d = at(wr[c.rowIndex]) || c.date;
        let idx = (rows || []).findIndex(r => r.start <= d && d <= r.end);
        if (idx < 0) idx = (rows || []).findIndex(r => r.end >= d);   // 그 칸이 없으면 다음 칸
        if (idx < 0) return;
        changes.push({ ...c, weekKey: c.key, key: rows[idx].key, rowIndex: idx });
    });
    return { initial: det.initial, changes, line };
}

// ── 전후 비교 ────────────────────────────────────────────────────────
/** 날짜 범위 [from, to] 의 지표. owner 가 있으면 그 사람의 단독일 UPH 도.
 *  days·하루 투입시간·인원·건당 시간 = 시간이 있는 날. 수량형 지표·qtyDays = 시간·물량 둘 다 있는 날(qtyDaysOf).
 *  lowSample 은 수량형이면 qtyDays, 아니면 days 로 본다. */
export function windowMetrics(list, task, { from, to, qtyTask = false, owner = null, soloShare = SOLO_SHARE } = {}) {
    const inWin = list.filter(s => s.date >= from && s.date <= to);
    const act = inWin.filter(s => s.minutes > 0);
    const n = act.length;
    const minutes = act.reduce((a, s) => a + s.minutes, 0);
    const qty = inWin.reduce((a, s) => a + s.qty, 0);
    const records = act.reduce((a, s) => a + s.records, 0);
    const heads = act.reduce((a, s) => a + Object.keys(s.byMember).length, 0);
    const capped = inWin.reduce((a, s) => a + s.capped, 0);
    const qd = qtyTask ? qtyDaysOf(act) : [];
    const out = {
        from, to, days: n, qtyDays: qd.length, minutes, qty, records, capped,
        lowSample: (qtyTask ? qd.length : n) < MIN_COMPARE_DAYS,
        avgMinutesPerDay: n > 0 ? minutes / n : null,
        avgHeadcount: n > 0 ? heads / n : null,
        uph: null, avgQtyPerDay: null, minPerUnit: null, ownerUph: null, soloDays: 0,
        minPerRecord: null
    };
    if (qtyTask) {
        const qMin = qd.reduce((a, s) => a + s.minutes, 0);
        const qQty = qd.reduce((a, s) => a + s.qty, 0);
        out.uph = uphOf(qd, task);
        out.avgQtyPerDay = qd.length > 0 ? qQty / qd.length : null;
        out.minPerUnit = qQty > 0 && qMin > 0 ? qMin / qQty : null;
        if (owner) {
            const solo = qd.filter(s => (s.byMember[owner] || 0) >= soloShare * s.minutes);
            out.soloDays = solo.length;
            out.ownerUph = solo.length >= MIN_SOLO_DAYS ? uphOf(solo, task) : null;
        }
    } else {
        out.minPerRecord = records > 0 ? minutes / records : null;
    }
    return out;
}

/**
 * 변경 하나의 전후 비교 — 전 n 기간 vs 후 n 기간(변경 기간부터). 다음 변경 전날에서 자르고, 앞 변경 날 이전으로는 가지 않는다.
 * @param change { key, date, from, to }   @param opts { gran, n, qtyTask, nextDate, prevDate, soloShare, today }
 *   today 를 주면 그날(진행 중)과 그 뒤는 뺀다(taskUph skipDate 와 같은 뜻).
 * @returns { before, after, lowSample }  (before 의 본인 UPH 는 from, after 는 to)
 */
export function compareAround(days, task, change, {
    gran = 'week', n = null, qtyTask = false, nextDate = null, prevDate = null, soloShare = SOLO_SHARE, list = null, today = null
} = {}) {
    const k = Math.max(1, Math.floor(Number(n) || (gran === 'month' ? 2 : 4)));
    const all = list || taskDays(days, task);
    const tl = today ? all.filter(s => s.date < today) : all;
    let bFrom = periodRange(shiftPeriod(change.key, -k, gran), gran).start;
    if (prevDate && bFrom < prevDate) bFrom = prevDate;
    const bTo = addDays(change.date, -1);
    let aTo = periodRange(shiftPeriod(change.key, k - 1, gran), gran).end;
    if (nextDate && aTo >= nextDate) aTo = addDays(nextDate, -1);
    // 기록이 있는 범위 밖(미래·12개월 이전)은 표시에 넣지 않는다
    if (tl.length) {
        if (bFrom < tl[0].date) bFrom = tl[0].date;
        const last = tl[tl.length - 1].date;
        if (aTo > last && last >= change.date) aTo = last;
    }
    const before = windowMetrics(tl, task, { from: bFrom, to: bTo, qtyTask, owner: change.from, soloShare });
    const after = windowMetrics(tl, task, { from: change.date, to: aTo, qtyTask, owner: change.to, soloShare });
    return { before, after, lowSample: before.lowSample || after.lowSample };
}

/** 주 비교 칸 수 — 화면 단위가 월이면 n개월 ≈ 4n주. */
export const compareWeeksOf = (gran, n) => Math.max(1, Math.floor(Number(n) || (gran === 'month' ? 2 : 4))) * (gran === 'month' ? 4 : 1);

/**
 * 화면용 전후 비교 — 판정이 주 단위이므로 비교도 변경 날짜(주 시작) 기준 주 단위(월 화면은 n개월 → 4n주, 2026-11-10).
 * change 는 mapOwnerChanges 결과(weekKey 가 있으면 그 주로)도, 주 변경 그대로도 된다. 나머지 opts 는 compareAround 와 같다.
 */
export function compareAroundView(days, task, change, { gran = 'week', n = null, ...rest } = {}) {
    const key = change.weekKey || periodKeyOf(change.date, 'week');
    return compareAround(days, task, { ...change, key }, { ...rest, gran: 'week', n: compareWeeksOf(gran, n) });
}

/** 변화율(%) — 앞이 0·없음이면 null */
export const pctChange = (b, a) => (b == null || a == null || !(b > 0)) ? null : ((a - b) / b) * 100;
