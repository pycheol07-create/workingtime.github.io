// === js/lib/calc.js ===
// 순수 계산 함수 모음 (DOM/Firebase 의존 없음) — 브라우저 앱과 node 테스트가 함께 사용.
// 여기 있는 함수는 부수효과 없이 입력→출력만 하므로 단위 테스트로 회귀를 막는다.

// 금액 문자열 → 숫자 (","·"$"·"₩"·"원"·공백 제거). 빈칸/"-"/"#" 포함은 null.
export function parseAmount(v) {
    if (typeof v === 'number') return v;
    let s = String(v == null ? '' : v).trim();
    if (!s || s === '-' || s.includes('#')) return null;
    const n = Number(s.replace(/[,\s$₩원]/g, ''));
    return isNaN(n) ? null : n;
}

// 날짜 문자열이 [from, to] 범위에 드는지 (YYYY-MM-DD)
export function inDateRange(dStr, from, to) {
    const d = String(dStr == null ? '' : dStr).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
}

// period('gran:offset' 또는 'custom')을 실제 날짜 범위 {from,to}로 변환.
// gran = day/week/month/year, offset = -1(전)/0(현)/1(후). 주는 월~일 기준.
export function resolvePeriodRange(period, today, customRange) {
    if (period === 'custom') {
        return { from: (customRange && customRange.from) || '', to: (customRange && customRange.to) || '' };
    }
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const [gran, offStr] = String(period).split(':');
    const off = parseInt(offStr, 10) || 0;
    const base = new Date(today + 'T00:00:00');
    if (gran === 'day') {
        const d = new Date(base); d.setDate(base.getDate() + off);
        return { from: fmt(d), to: fmt(d) };
    }
    if (gran === 'week') {
        const dow = (base.getDay() + 6) % 7; // 월=0
        const mon = new Date(base); mon.setDate(base.getDate() - dow + off * 7);
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        return { from: fmt(mon), to: fmt(sun) };
    }
    if (gran === 'month') {
        const first = new Date(base.getFullYear(), base.getMonth() + off, 1);
        const last = new Date(base.getFullYear(), base.getMonth() + off + 1, 0);
        return { from: fmt(first), to: fmt(last) };
    }
    if (gran === 'year') {
        const y = base.getFullYear() + off;
        return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    return { from: '', to: '' };
}

// 업무 진행 시간(분) = (종료-시작) - 휴식합. HH:MM 문자열, pauses=[{start,end}].
export function calcWorkMinutes(startHHMM, endHHMM, pauses) {
    if (!startHHMM || !endHHMM) return 0;
    const toMin = (hhmm) => {
        const [h, m] = String(hhmm).split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };
    let total = toMin(endHHMM) - toMin(startHHMM);
    if (total < 0) total = 0;
    (pauses || []).forEach(p => {
        if (!p || !p.start) return;
        const pe = p.end || endHHMM;
        const dur = toMin(pe) - toMin(p.start);
        if (dur > 0) total -= dur;
    });
    return Math.max(0, total);
}

// 주말 근무 적정(공평) 횟수 계산.
//  - 정원 미설정 날짜는 defaultCap(기본 3) 적용
//  - 하루 1명은 관리자 고정 → 팀원 몫 = Σ max(0, 정원-1)
//  - 1인당 적정 = round(팀원 몫 합계 / 참여 가능 팀원 수)
// dates: 운영(미마감) 주말 날짜 배열, capacityOf(dateStr)->number|undefined
export function weekendFairness(dates, capacityOf, eligibleCount, defaultCap = 3) {
    let openDays = 0, totalCapacity = 0, teamSlots = 0;
    (dates || []).forEach(dateStr => {
        openDays++;
        const set = Number(capacityOf ? capacityOf(dateStr) : 0) || 0;
        const cap = set > 0 ? set : defaultCap;
        totalCapacity += cap;
        teamSlots += Math.max(0, cap - 1);
    });
    const adminSlots = totalCapacity - teamSlots;
    const avg = eligibleCount > 0 ? teamSlots / eligibleCount : 0;
    const recommended = Math.round(avg);
    return { openDays, totalCapacity, teamSlots, adminSlots, avg, recommended };
}
