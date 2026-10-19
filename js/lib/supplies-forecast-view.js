// === js/lib/supplies-forecast-view.js ===
// 비품 사용량 예측 — 화면 표시 규칙(배지·문구·D-n·발주 상태 덮어쓰기·예측 오래됨). 계산은 하지 않는다.
//
// 왜 따로: 예측 계산은 서버(앱\비품재고연동\발주알림.py · 예측규칙.py)에서만 한다(같은 식을 JS 에 복제하지 않는다).
//          화면은 그 결과(integrations/suppliesForecast)와 사람이 누른 발주 상태(persistent_data/suppliesOrders)를
//          합쳐 보여 주기만 한다. 그 '합치는 규칙'을 여기 모아 node 테스트로 묶는다(tests/supplies-forecast-view.test.js).
//
// 문서 모양(서버가 씀)
//   suppliesForecast { generatedAt, today, basisDate, items: { <itemId>: { status, level, method, driver, corr,
//                      corrBasis, perDriver, perWorkday, windowWorkdays, confidence, stock, stockAt, safety{used,
//                      source, suggested}, leadTime{workdays, calDays, source}, depleteDate, reorderDate, workdaysLeft,
//                      recommendQty, bundle, appOnlyOutLogs, notes[] } }, zabPacks{days, need} }
//   suppliesOrders   { orders: { <itemId>: { status 'ordered'|'received'|'cancelled', orderedDate, orderedAt, qty,
//                      expectedDate, receivedDate? } }, log: [...] }
//
// 순수 모듈(import 0).

export const STATUS_INFO = {
    ok:           { label: '정상',        tone: 'ok' },
    watch:        { label: '주의',        tone: 'warn' },
    order:        { label: '발주 필요',   tone: 'danger' },
    ordered:      { label: '발주함',      tone: 'info' },
    received:     { label: '입고됨',      tone: 'ok' },
    insufficient: { label: '이력 부족',   tone: 'muted' },
    multicode:    { label: '코드 여러 개', tone: 'muted' },
    error:        { label: '확인 필요',   tone: 'muted' },
    nocode:       { label: '-',           tone: 'none' },
    pending:      { label: '예측 전',     tone: 'muted' }
};

export const TONE_CLASS = {
    ok: 'bg-emerald-100 text-emerald-700',
    warn: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-600',
    info: 'bg-indigo-100 text-indigo-700',
    muted: 'bg-slate-100 text-slate-500',
    none: ''
};

export const NOCODE_HINT = '이지어드민 코드를 등록하면 다음 날 아침부터 예측됩니다';

export const DRIVER_LABEL = { domestic: '국내배송', zab: '직진·에이블리', zabPacks: '직진·에이블리 봉' };

// 기준 물량 선택(관리자) — item.forecastDriver 값
export const DRIVER_OPTIONS = [
    ['auto', '자동'],
    ['domestic', '국내배송'],
    ['zab', '직진·에이블리(수량)'],
    ['zabPacks', '직진·에이블리(봉 건수)'],
    ['none', '없음(주 평균)']
];

const WEEK = '일월화수목금토';
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LT_DAYS = { day: 1, week: 7, month: 30 };   // js/supplies.js LEADTIME_DAYS 와 같다
const DEFAULT_LEAD_DAYS = 7;                        // 발주알림설정.json 기본리드타임_일 과 같다
const STALE_MS = 2 * 24 * 60 * 60 * 1000;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const hasCode = (item) => String(item?.ezCode ?? '').trim() !== '';

/** 'YYYY-MM-DD' → UTC Date(시간대와 무관하게 날짜만). 아니면 null. */
function parseYmd(s) {
    const m = YMD_RE.exec(String(s || '').slice(0, 10));
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
}
const ymdOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** '2026-11-14' → '11/14(토)'. 못 읽으면 '-'. */
export function mdw(ymd) {
    const d = parseYmd(ymd);
    return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]})` : '-';
}

/** 천 단위 쉼표 정수. */
export const fmtInt = (v) => Math.round(num(v)).toLocaleString('en-US');

/** 숫자 칸 입력값 → 0 이상의 숫자 또는 null(빈 값·숫자 아님·음수). '20,000' 같은 쉼표는 허용. */
export function parseQty(v) {
    const s = String(v == null ? '' : v).replace(/[,\s]/g, '');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 화면 상태 키. 사람이 누른 발주(orders)가 서버 status 보다 앞선다 — 서버는 다음 날 아침에야 반영하므로.
 *  - ezCode 없음 → 'nocode'
 *  - orders 가 ordered → 'ordered'
 *  - 예측 문서에 이 비품이 없음 → 'pending'
 *  - 서버는 ordered 인데 그 뒤 사람이 취소·입고 확인 → 서버 계산 level(그대로 쓰면 '발주함'이 남는다)
 *  - 오늘 사람이 [입고 확인] → 'received' */
export function effectiveStatus(item, fc, order) {
    if (!hasCode(item) && !(order && order.status === 'ordered')) return 'nocode';
    if (order && order.status === 'ordered') return 'ordered';
    if (!fc || !STATUS_INFO[fc.status]) return hasCode(item) ? 'pending' : 'nocode';
    if (order && order.status === 'received' && String(order.receivedDate || '') >= String(fc.today || '9999')) return 'received';
    if (fc.status === 'ordered') return STATUS_INFO[fc.level] && fc.level !== 'ordered' ? fc.level : 'ok';
    return fc.status;
}

/** 배지 {label, cls, title}. */
export function statusBadge(key) {
    const info = STATUS_INFO[key] || STATUS_INFO.pending;
    const title = key === 'nocode' ? NOCODE_HINT
        : key === 'pending' ? '매일 08:30 사용량 예측 뒤 표시됩니다'
        : key === 'ordered' ? '발주함 — 입고될 때까지 발주 알림을 멈춥니다' : '';
    return { label: info.label, cls: TONE_CLASS[info.tone] || '', title };
}

/** 소진 예상 '11/14(금) · D-19'(D-n = 남은 업무일). 없으면 '-'. */
export function depleteText(fc) {
    if (!fc || !fc.depleteDate) return '-';
    const n = fc.workdaysLeft;
    return `${mdw(fc.depleteDate)}${n != null && Number.isFinite(Number(n)) ? ` · D-${Number(n)}` : ''}`;
}

/** 정렬·필터용 남은 업무일 — 없으면 큰 수(맨 뒤로). */
export const depleteSortValue = (fc) => (fc && fc.depleteDate && fc.workdaysLeft != null ? num(fc.workdaysLeft) : 99999);

/** 권장 발주 '20,000장'. 0·없음이면 '-'. */
export function recommendText(fc, unit) {
    const q = num(fc && fc.recommendQty);
    return q > 0 ? `${fmtInt(q)}${unit || '개'}` : '-';
}

/** generatedAt 이 now 보다 2일 넘게 이르면 true(예약작업이 멈춘 것). 시각을 못 읽어도 true. */
export function isStale(generatedAt, now = Date.now()) {
    const t = Date.parse(String(generatedAt || ''));
    if (!Number.isFinite(t)) return true;
    return num(now) - t > STALE_MS;
}

function smallNum(v) {
    const n = num(v);
    if (n >= 100) return fmtInt(n);
    if (n >= 10) return String(Math.round(n * 10) / 10);
    return String(Math.round(n * 100) / 100);
}

/** driver 1단위당 '국내배송 1건당 0.82장' · '직진·에이블리 100개당 4.9장' · '직진·에이블리 1봉당 1.5장'. ratio 아니면 ''. */
export function perDriverText(fc, unit) {
    if (!fc || fc.method !== 'ratio' || fc.perDriver == null) return '';
    const u = unit || '개';
    if (fc.driver === 'zab') return `${DRIVER_LABEL.zab} 100개당 ${smallNum(num(fc.perDriver) * 100)}${u}`;
    if (fc.driver === 'zabPacks') return `${DRIVER_LABEL.zab} 1봉당 ${smallNum(fc.perDriver)}${u}`;
    return `${DRIVER_LABEL.domestic} 1건당 ${smallNum(fc.perDriver)}${u}`;
}

/** 예측 근거 한 줄. */
export function basisText(fc, unit) {
    if (!fc || !fc.method) return '';
    const u = unit || '개';
    const per = `업무일당 약 ${fmtInt(fc.perWorkday)}${u}`;
    if (fc.method === 'ratio') {
        const r = fc.corr && fc.corr[fc.driver];
        const how = fc.driverSource === 'manual' ? '지정' : '자동';
        return `${DRIVER_LABEL[fc.driver] || fc.driver} 비례(${how}) — ${perDriverText(fc, u)}`
            + ` (r ${r == null ? '-' : Number(r).toFixed(2)}, 최근 ${num(fc.windowWorkdays)}업무일) · ${per}`;
    }
    return `주 평균 — ${per}${fc.bundle ? ' (묶음 출고)' : ''} · 최근 ${num(fc.windowWorkdays)}업무일`;
}

/** 리드타임 문구 {text, warn}. */
export function leadTimeText(fc) {
    const lt = fc && fc.leadTime;
    if (!lt) return { text: '-', warn: false };
    if (lt.source === 'default') return { text: `리드타임 미등록 — ${num(lt.calDays)}일 가정(${num(lt.workdays)}업무일)`, warn: true };
    return { text: `${num(lt.calDays)}일(${num(lt.workdays)}업무일)`, warn: false };
}

/** 발주일 + 리드타임(달력 일). item 의 leadTimeDays·leadTimeUnit, 없으면 7일. → 'YYYY-MM-DD' */
export function expectedDateFor(orderedDate, item) {
    const d = parseYmd(orderedDate);
    if (!d) return '';
    const n = num(item && item.leadTimeDays);
    const unit = LT_DAYS[item && item.leadTimeUnit] ? item.leadTimeUnit : 'day';
    const days = n > 0 ? Math.ceil(n * LT_DAYS[unit]) : DEFAULT_LEAD_DAYS;
    d.setUTCDate(d.getUTCDate() + days);
    return ymdOf(d);
}

/** 발주 중 한 줄 '발주함 10/20 · 20,000장 · 입고 예정 10/27'. */
export function orderSummaryText(order, unit) {
    if (!order || order.status !== 'ordered') return '';
    const q = num(order.qty);
    return `발주함 ${mdw(order.orderedDate).replace(/\(.\)$/, '')}`
        + (q > 0 ? ` · ${fmtInt(q)}${unit || '개'}` : '')
        + (order.expectedDate ? ` · 입고 예정 ${mdw(order.expectedDate).replace(/\(.\)$/, '')}` : '');
}

/** 앱에서만 넣은 사용 경고(appOnlyOutLogs > 0). */
export function appOnlyWarning(n) {
    const k = num(n);
    if (k <= 0) return '';
    return `앱에서만 입력한 사용 ${k}건은 예측에 들어가지 않고 저녁 19:30 이지어드민 값으로 덮입니다 — 이지어드민에 출고로 입력해 주세요.`;
}

/** 봉 건수 기록 진행 '봉 건수 기록 쌓는 중 (n/20일)'. 다 쌓였으면 ''. */
export function packsProgressText(forecastDoc) {
    const z = forecastDoc && forecastDoc.zabPacks;
    if (!z) return '';
    const need = num(z.need) || 20;
    const days = num(z.days);
    return days < need ? `봉 건수 기록 쌓는 중 (${days}/${need}일)` : '';
}

/** 안전재고 제안이 지금 값과 다르면 제안값, 아니면 null. */
export function safetySuggestion(fc, item) {
    const s = fc && fc.safety;
    if (!s || !(num(s.suggested) > 0)) return null;
    return num(s.suggested) !== num(item && item.safetyStock) ? num(s.suggested) : null;
}
