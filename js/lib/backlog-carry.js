// === js/lib/backlog-carry.js ===
// 설명: 🛌 '쉬는 동안 쌓인 물량(밀림)' 규칙만 떼어낸 순수 모듈.
//
//  왜 따로 빼는가
//    업무 예상의 국내배송 자동값은 요일평균(dowAvg)에서 온다. 요일평균은 '월요일은 원래 크다'는
//    형태로 **주말 밀림을 이미 품고 있지만**, 공휴일은 전혀 모른다. 연휴 다음 첫 근무일을
//    평범한 화요일로 예측한다. 그 차이만 보정하는 규칙이 이 파일이다.
//
//  이중계산을 피하는 핵심
//    평범한 월요일에는 **아무것도 하지 않는다**(factor = 1.0). 요일평균이 이미 그 2일치를
//    담고 있기 때문이다. 그 요일이 '보통 갖는 휴일 간격'(baseline)을 **초과한 날수**에만 배수를 건다.
//
//  import 0개 — DOM·State·Firebase 를 쓰지 않는다. 달력(isOff)은 밖에서 주입받는다.

/** 요일별 '보통 갖는 직전 휴일 수'. 요일평균에 이미 들어 있는 몫이다.
 *  일=1(토만 쉼), 월=2(토·일), 화~토=0. 0=일요일 … 6=토요일 */
export const BASELINE_OFF_DAYS = { 0: 1, 1: 2, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

export const MAX_EXCESS_OFF_DAYS = 4;    // 아무리 긴 연휴여도 4일치까지만 센다
export const MAX_BACKLOG_FACTOR = 2.0;   // 어떤 경우에도 평소의 2배를 넘기지 않는다
export const CARRY_MIN = 0.05;           // 배운 값의 하한 (음수·0 방지)
export const CARRY_MAX = 0.6;            // 배운 값의 상한
export const DEFAULT_CARRY = 0.30;       // 표본 부족 시 기본값 — 쉬는 날 하루당 +30%
export const MIN_MONDAY_SAMPLES = 8;     // 월요일 표본이 이보다 적으면 못 배운다 (90일 창이면 보통 13개)
export const MIN_MIDWEEK_SAMPLES = 8;    // 화~금 표본 기준

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' → UTC Date. 형식이 아니면 null (로컬 시간대 영향을 받지 않게 UTC 로 센다) */
const parseYmd = (dateStr) => {
    const m = DATE_RE.exec(String(dateStr || ''));
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return isNaN(d.getTime()) ? null : d;
};
const toYmd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const shift = (dateStr, n) => {
    const d = parseYmd(dateStr);
    if (!d) return null;
    d.setUTCDate(d.getUTCDate() + n);
    return toYmd(d);
};
/** 요일 (0=일) */
export const dowOf = (dateStr) => {
    const d = parseYmd(dateStr);
    return d ? d.getUTCDay() : null;
};

/** 대상일 **직전의 연속 휴일 수**.
 *  평범한 화요일 → 0, 평범한 월요일 → 2, 추석 연휴(목~일) 다음 월요일 → 4.
 *  @param {string} dateStr  'YYYY-MM-DD'
 *  @param {(d:string)=>boolean} isOff  쉬는 날 판정(주말·공휴일)
 *  @param {number} maxLookback  달력이 통째로 휴일인 병적 입력에서 멈추는 한계
 */
export function offDaysBefore(dateStr, isOff, maxLookback = 10) {
    if (!parseYmd(dateStr) || typeof isOff !== 'function') return 0;
    let n = 0;
    let cur = shift(dateStr, -1);
    while (cur && n < maxLookback && isOff(cur)) { n++; cur = shift(cur, -1); }
    return n;
}

/** 요일 기준선을 뺀 **초과 휴일 수**. 평범한 월요일은 0 이 되어야 한다(이중계산 방지의 전부). */
export function excessOffDays(dateStr, isOff, { cap = MAX_EXCESS_OFF_DAYS } = {}) {
    const dow = dowOf(dateStr);
    if (dow == null) return 0;
    // 대상일 자체가 쉬는 날이면 밀림을 논할 자리가 아니다
    if (typeof isOff === 'function' && isOff(dateStr)) return 0;
    const gap = offDaysBefore(dateStr, isOff);
    const base = BASELINE_OFF_DAYS[dow] || 0;
    return Math.max(0, Math.min(cap, gap - base));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 중앙값 — 표본이 10여 개뿐이라 평균보다 한두 날의 폭증에 덜 흔들린다 */
const median = (arr) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** 🎓 '쉬는 날 하루당 얼마나 밀리는가'를 과거 실적에서 배운다.
 *
 *  어떻게
 *    월요일(쉬는 날 2일 뒤) 물량 ÷ 화~금(쉬는 날 0일 뒤) 물량 = 2일치 밀림의 배수.
 *    거기서 1을 빼고 2로 나누면 '하루당' 비율이 나온다.
 *    공휴일 다음날을 직접 세는 방법은 표본이 1년에 9건뿐이라 쓸 수 없다 —
 *    월요일은 90일 창에 13개쯤 되고, 같은 현상(쉬었다가 나온 날)이다.
 *
 *  ⚠️ 연휴 다음 월요일처럼 **초과 휴일이 낀 날은 양쪽 표본에서 뺀다.**
 *     그 날을 넣으면 배우려는 값이 기준선 쪽으로 섞여 들어간다.
 *
 *  @param {Array<{date:string, value:number}>} samples  과거 실적(물량 0 인 날은 알아서 빠진다)
 *  @param {(d:string)=>boolean} isOff
 *  @returns {{carry:number, source:'learned'|'fallback'|'no-signal', monDays:number, midDays:number, ratio:number|null}}
 *    - learned   : 월요일이 화~금보다 뚜렷이 커서 비율을 구했다
 *    - no-signal : 비교는 했는데 밀리는 경향이 없다 → carry 0 (보정하지 않는다)
 *    - fallback  : 비교할 표본 자체가 모자라다 → 기본값
 */
export function learnCarryPerOffDay(samples, isOff, { fallback = DEFAULT_CARRY } = {}) {
    const mon = [], mid = [];
    (Array.isArray(samples) ? samples : []).forEach(s => {
        const v = Number(s?.value);
        if (!Number.isFinite(v) || v <= 0) return;          // 0 인 날은 쉰 날이거나 미입력이다
        const dow = dowOf(s?.date);
        if (dow == null) return;
        if (dow !== 1 && !(dow >= 2 && dow <= 5)) return;   // 월 / 화~금 만 본다
        // 쉬는 날인데 실적이 남은 날(출근한 대체공휴일 등)은 뺀다 — 물량이 작아 중앙값을 끌어내린다
        if (typeof isOff === 'function' && isOff(s.date)) return;
        if (excessOffDays(s.date, isOff) > 0) return;       // 연휴가 낀 날은 기준을 오염시킨다
        (dow === 1 ? mon : mid).push(v);
    });

    const bad = { carry: clamp(fallback, CARRY_MIN, CARRY_MAX), source: 'fallback',
                  monDays: mon.length, midDays: mid.length, ratio: null };
    if (mon.length < MIN_MONDAY_SAMPLES || mid.length < MIN_MIDWEEK_SAMPLES) return bad;

    const mMon = median(mon), mMid = median(mid);
    if (!(mMid > 0) || !(mMon > 0)) return bad;

    const ratio = mMon / mMid;
    // 🚦 월요일이 화~금보다 **의미 있게** 크지 않다 = 이 팀 데이터에는 '쉬었다 나온 날 밀림'이 없다.
    //    보정을 끈다(carry 0 → factor 1). 지금과 달라지는 것이 없으니 가장 안전한 쪽이다.
    //
    //    ⚠️ 경계를 ratio > 1 로 잡으면 안 된다. ratio 1.0001 이면 (ratio-1)/2 ≈ 0 인데
    //       아래 clamp 의 하한(CARRY_MIN)에 걸려 0.05 로 **튀어오른다** —
    //       '사실상 없음'이 '하루당 5%'로 둔갑한다. 하한을 그대로 진입 지점으로 삼으면
    //       clamp 가 값을 왜곡하지 않는다(= 배운 값이 0.05 미만이면 아예 안 쓴다).
    if (ratio < 1 + 2 * CARRY_MIN) return { carry: 0, source: 'no-signal',
                                            monDays: mon.length, midDays: mid.length, ratio };
    // 월요일이 2일 쉰 뒤라는 전제 — (배수 - 1) ÷ 2 = 하루당
    return { carry: clamp((ratio - 1) / 2, CARRY_MIN, CARRY_MAX), source: 'learned',
             monDays: mon.length, midDays: mid.length, ratio };
}

/** 대상일에 곱할 밀림 배수.
 *  @returns {{factor:number, excess:number, gap:number, carry:number}}  평소와 같은 날이면 factor = 1 */
export function backlogFactor(dateStr, isOff, carry, { max = MAX_BACKLOG_FACTOR, cap = MAX_EXCESS_OFF_DAYS } = {}) {
    const c = Number(carry);
    const excess = excessOffDays(dateStr, isOff, { cap });
    const gap = offDaysBefore(dateStr, isOff);
    if (!(excess > 0) || !Number.isFinite(c) || c <= 0) return { factor: 1, excess: 0, gap, carry: Number.isFinite(c) ? c : 0 };
    return { factor: Math.min(max, 1 + c * excess), excess, gap, carry: c };
}

/** 🗣 물류팀이 읽을 근거 한 줄. 보정이 없으면 빈 문자열. */
export function carryReason(info, { holidayName = '', dow = null, baseValue = null, finalValue = null } = {}) {
    if (!info || !(info.factor > 1)) return '';
    const names = ['일', '월', '화', '수', '목', '금', '토'];
    const dowName = (dow != null && dow >= 0 && dow <= 6) ? names[dow] : '';
    const base = BASELINE_OFF_DAYS[dow] || 0;
    const pct = Math.round(info.carry * 100);
    const head = holidayName
        ? `${holidayName}(으)로 ${info.gap}일 쉰 뒤 첫 근무일입니다`
        : `${info.gap}일 쉰 뒤 첫 근무일입니다`;
    const cmp = base > 0
        ? `평소 ${dowName}요일(${base}일 쉼)보다 ${info.excess}일 더 쉬어서`
        : `평소 ${dowName ? dowName + '요일은 ' : ''}쉬는 날 없이 이어지는데 ${info.excess}일 쉬어서`;
    const amount = (baseValue > 0 && finalValue > 0)
        ? `평소의 ${info.factor.toFixed(2)}배(${Math.round(baseValue).toLocaleString()} → ${Math.round(finalValue).toLocaleString()}개)로 잡았습니다`
        : `평소의 ${info.factor.toFixed(2)}배로 잡았습니다`;
    return `${head} · ${cmp}, 쉬는 날 하루당 ${pct}%씩 더해 ${amount}`;
}

/** 배운 값인지 기본값인지 한 줄로 덧붙인다 */
export function carrySourceNote(learned) {
    if (!learned) return '';
    if (learned.source === 'no-signal') {
        return `최근 실적에서는 월요일(${learned.monDays}일)이 화~금(${learned.midDays}일)보다 크지 않아,`
             + ' 쉬었다 나온 날 밀리는 경향이 보이지 않습니다 — 보정하지 않습니다';
    }
    return learned.source === 'learned'
        ? `${Math.round(learned.carry * 100)}%는 최근 실적의 월요일 ${learned.monDays}일 / 화~금 ${learned.midDays}일을 비교해 구한 값입니다`
        : `비교할 월요일 실적이 모자라 기본값(쉬는 날 하루당 ${Math.round(learned.carry * 100)}%)을 썼습니다`;
}
