// === js/lib/customs-fxrt.js ===
// 통합계산기 '관세청 고시환율' 칸 자동 채움 — 순수 함수(브라우저·Firebase 없음). tests/customs-fxrt.test.js 가 본다.
// calculator/index.html 의 모듈이 window.CustomsFxrt 에 붙이고 calculator/app.js(Babel)가 쓴다.
//
// 문서 integrations/customsFxrt 는 앱\고시환율\실행.py 가 매일 2회 쓴다:
//   usd = { rate: 숫자, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }   (날짜는 한국 달력 날짜)
// 우선순위(높은 순)
//   1. 이번 세션(페이지를 연 뒤)에 사람이 칸을 고쳤다 → 그 값 유지 + [고시값으로]
//   2. 문서의 이번 주 값(오늘 KST 가 [start, end] 안) → 자동 채움
//   3. 이 PC 저장값 — 단 자동값이었고 적용기간이 지났으면 비운다(지난주 값으로 대신 채우지 않는다).
//      사람이 넣은 값·출처 기록이 없는 옛 값은 그대로
//   4. 빈칸 → 기존 '고시환율을 입력하세요'
// 출처(origin)는 이 PC 저장값에 같이 둔다: { by: 'auto', start, end } | { by: 'manual' }. 없으면 manual 로 본다.
import { parseNum } from './calc-num.js?v=202610231049';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const LEGACY_DEFAULT = '1350';     // 2026-10-16 전 첫 사용자 기본값(실제 고시값처럼 보이는 가짜 값)
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 지금 한국 날짜 'YYYY-MM-DD' — PC 시간대와 상관없이 +9시간 고정(kst-time.js 와 같은 방식) */
export function kstToday(nowMs) {
    const d = new Date(nowMs + KST_OFFSET_MS);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** 'YYYY-MM-DD' → 'M/D' */
export function shortDate(ymd) {
    if (typeof ymd !== 'string' || !YMD.test(ymd)) return '';
    return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

const period = (start, end) => `${shortDate(start)}~${shortDate(end)}`;

const fmtRate = (v) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(v);

/**
 * 문서 → 이번 주에 쓸 수 있는 USD 고시환율인가.
 * → { usable, rate, start, end, reason }   reason: 'no-doc' | 'invalid' | 'not-this-week' | null
 *   rate 는 유한·양수 숫자만(글자는 invalid). start <= today <= end (YYYY-MM-DD 글자 비교).
 *   지난주 값이면 usable=false 지만 start·end·rate 는 돌려준다(안내 문구용).
 */
export function resolveFxrt(doc, today) {
    if (!doc || typeof doc !== 'object') return { usable: false, rate: null, start: null, end: null, reason: 'no-doc' };
    const u = doc.usd;
    const ok = u && typeof u === 'object'
        && typeof u.rate === 'number' && Number.isFinite(u.rate) && u.rate > 0
        && typeof u.start === 'string' && YMD.test(u.start)
        && typeof u.end === 'string' && YMD.test(u.end)
        && u.start <= u.end;
    if (!ok) return { usable: false, rate: null, start: null, end: null, reason: 'invalid' };
    const inWeek = typeof today === 'string' && u.start <= today && today <= u.end;
    return { usable: inWeek, rate: u.rate, start: u.start, end: u.end, reason: inWeek ? null : 'not-this-week' };
}

const normOrigin = (o) => {
    if (o && o.by === 'auto' && typeof o.start === 'string' && typeof o.end === 'string') return { by: 'auto', start: o.start, end: o.end };
    return { by: 'manual' };
};

/**
 * 페이지를 열 때 — 이 PC 저장값(saved = appExchangeRatesData 객체 | null) → { customs, origin }
 *   저장값 없음 → 빈칸(첫 사용자 — 가짜 기본값을 넣지 않는다)
 *   자동값이었고 오늘이 그 적용기간 밖 → 빈칸 · origin null
 *   그 밖(사람이 넣은 값, 출처 기록 없는 옛 값) → 그대로 · manual
 */
export function initialCustoms(saved, today) {
    if (!saved || typeof saved !== 'object') return { customs: '', origin: null };
    const customs = saved.customs == null ? '' : String(saved.customs);
    // 출처 기록이 없고 값이 옛 첫 사용자 기본값 '1350' 그대로 → 사람이 고친 적 없는 가짜 값이라 첫 사용자처럼 빈칸
    if (saved.customsOrigin == null && customs === LEGACY_DEFAULT) return { customs: '', origin: null };
    const origin = normOrigin(saved.customsOrigin);
    if (origin.by === 'auto' && !(origin.start <= today && today <= origin.end)) return { customs: '', origin: null };
    return { customs, origin };
}

/**
 * 문서 값이 오거나 바뀔 때·날짜를 다시 볼 때 — 사람이 이번 세션에 고쳤으면 그대로, 쓸 수 있는 값이면 채운다.
 * 쓸 수 없으면(지난주 문서·읽기 실패·로그아웃) 지난주 값을 넣지 않고, today 를 주면 칸에 남은 자동값도
 * 그 적용기간이 지났으면 비운다(열어 둔 탭에서 주가 넘어간 경우).
 * 같은 입력에 같은 결과(멱등) — React StrictMode 에서 두 번 불려도 된다. → { customs, origin, changed }
 */
export function applyAuto({ customs, origin, touched }, fx, today) {
    if (touched) return { customs, origin, changed: false };
    if (!fx || !fx.usable) {
        const expired = typeof today === 'string' && origin && origin.by === 'auto'
            && !(origin.start <= today && today <= origin.end);
        return expired ? { customs: '', origin: null, changed: true } : { customs, origin, changed: false };
    }
    const next = String(fx.rate);
    const o = { by: 'auto', start: fx.start, end: fx.end };
    const same = customs === next && origin && origin.by === 'auto' && origin.start === o.start && origin.end === o.end;
    return same ? { customs, origin, changed: false } : { customs: next, origin: o, changed: true };
}

/**
 * 칸 아래 표시줄 — { source: 'auto'|'manual'|'none', label, canReset, notice }
 *   status: customs-fxrt-doc.js 의 상태 'loading' | 'ok' | 'signed-out' | 'error'
 *   notice(노란 안내)는 자동값을 쓸 수 없을 때만.
 */
export function customsView({ customs, origin, touched }, fx, status) {
    const f = fx || { usable: false, reason: 'no-doc' };
    const hasVal = String(customs ?? '').trim() !== '';
    const auto = !touched && origin && origin.by === 'auto' && hasVal;
    const source = auto ? 'auto' : (hasVal ? 'manual' : 'none');
    const canReset = !!f.usable && parseNum(customs) !== f.rate;
    let label = '';
    if (source === 'auto') label = `관세청 고시(수입) · ${period(origin.start, origin.end)} 적용 · 자동`;
    else if (source === 'manual') label = f.usable ? `직접 입력 · 이번 주 고시 ${fmtRate(f.rate)}` : '직접 입력';
    else if (status === 'loading') label = '관세청 고시환율 불러오는 중...';
    else if (f.usable) label = `이번 주 고시 ${fmtRate(f.rate)}`;
    let notice = null;
    if (status === 'signed-out') notice = '로그인하면 관세청 고시환율이 자동으로 채워집니다';
    else if (status === 'error') notice = '고시환율 자동값을 읽지 못했습니다 — 직접 입력하세요';
    else if (status === 'ok' && !f.usable) {
        notice = f.reason === 'not-this-week'
            ? `이번 주 고시환율을 아직 받지 못했습니다${f.start ? `(마지막 적용 ${period(f.start, f.end)})` : ''} — UNI-PASS 에서 확인해 입력하세요`
            : '고시환율 자동값을 읽지 못했습니다 — 직접 입력하세요';
    }
    return { source, label, canReset, notice };
}
