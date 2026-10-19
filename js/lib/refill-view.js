// === js/lib/refill-view.js ===
// 로케이션관리 대시보드 '채우기 지시서' 카드(js/refill-card.js)의 순수 함수 — import 없음(node --test 대상).
// 문서 모양은 업무자동화\앱\채우기자동화\앱기록.py 머리말(설계: 채우기앱연동_설계.md 2절).
//   integrations/refillLatest      { days: {YYYYMMDD: {status, rev, source, basedAt, rows, fillQty, checks, reason}}, schedule, req }
//   integrations/refillDay_YYYYMMDD { rowsJson, file:{name, b64, bytes, sha}, fileOmitted, slack, source, basedAt, requestedBy }
//   refillWork/YYYYMMDD            { checks: {상품코드: {done, by, at}} }       ← 직원이 쓴다
//   refillWork/request             { requestedAt, by, day }                    ← 직원이 쓴다(덮어쓰기)
// 날짜 키는 한국시간(KST) — toISOString 은 UTC 라 09시 전에 하루 밀린다(location.js toDateStr 주석 사례).

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEKDAYS = '월화수목금토일';                 // 0=월 … 6=일 (프로그램 settings.days 와 같은 번호)
export const DEFAULT_SCHEDULE = { enabled: true, days: [0, 1, 2, 3, 4], skipHolidays: true };
export const REQ_OPEN_H = 7, REQ_CLOSE_H = 19;          // 다시 만들기 받는 시간(프로그램 REQ_OPEN·REQ_CLOSE 와 같게)
export const REGULAR_DONE_H = 9;                         // 정기 지시서(08:20)가 이 시각까지 없으면 '확인 중'
export const PENDING_MAX_MS = 15 * 60 * 1000;            // 요청이 이만큼 처리 안 되면 'PC 가 꺼져 있을 수 있음'
export const DEFAULT_REQ_MAX = 6, DEFAULT_COOLDOWN_MIN = 15;
export const COLS = ['피킹로케이션', '비축위치', '채울수량', '비축재고', '상품코드'];

const p2 = (n) => String(n).padStart(2, '0');

/** Firestore Timestamp·Date·숫자(ms)·ISO 문자열 → ms. 못 읽으면 0. */
export function tsMs(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (v instanceof Date) return v.getTime() || 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
    return 0;
}

/** ms → 한국시간 조각 {y, m, d, hh, mm, wd(0=월)} */
export function kstParts(ms) {
    const d = new Date(tsMs(ms) + KST_OFFSET_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
             hh: d.getUTCHours(), mm: d.getUTCMinutes(), wd: (d.getUTCDay() + 6) % 7 };
}

/** ms(또는 Date) → 'YYYYMMDD'(KST) */
export function dayKey(ms) {
    const k = kstParts(ms);
    return `${k.y}${p2(k.m)}${p2(k.d)}`;
}

/** 'YYYYMMDD' → 그날 KST 00:00 의 ms */
export function keyMs(key) {
    const s = String(key || '');
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) - KST_OFFSET_MS;
}

/** 오늘 키부터 거꾸로 n 일(오늘 포함, 최신 먼저) */
export function lastDays(todayKey, n = 7) {
    const base = keyMs(todayKey);
    return Array.from({ length: n }, (_, i) => dayKey(base - i * DAY_MS + 12 * 60 * 60 * 1000));
}

/** 'YYYYMMDD' → '10/19(월)' */
export function dayLabel(key) {
    const k = kstParts(keyMs(key));
    return `${p2(k.m)}/${p2(k.d)}(${WEEKDAYS[k.wd]})`;
}

/** ms → 'HH:MM'(KST). 없으면 '' */
export function fmtHM(v) {
    const ms = tsMs(v);
    if (!ms) return '';
    const k = kstParts(ms);
    return `${p2(k.hh)}:${p2(k.mm)}`;
}

/** 지시서 문서 → { rows, checks, error }. 행 = {loc, reserve, qty, stock, code}. rowsJson 이 깨지면 빈 표 + error */
export function parseDay(doc) {
    const empty = (error) => ({ rows: [], checks: [], error });
    if (!doc || typeof doc.rowsJson !== 'string') return empty(doc ? '표 자료가 없습니다' : '');
    let d;
    try { d = JSON.parse(doc.rowsJson); } catch (e) { return empty('표 자료가 깨졌습니다'); }
    if (!d || typeof d !== 'object') return empty('표 자료가 깨졌습니다');
    const cols = Array.isArray(d.cols) ? d.cols : COLS;
    const at = (name) => cols.indexOf(name);
    const idx = { loc: at('피킹로케이션'), reserve: at('비축위치'), qty: at('채울수량'), stock: at('비축재고'), code: at('상품코드') };
    if (idx.code < 0) return empty('표 자료에 상품코드 열이 없습니다');
    const conv = (arr) => (Array.isArray(arr) ? arr : []).filter(Array.isArray).map(r => ({
        loc: r[idx.loc] ?? '', reserve: r[idx.reserve] ?? '', qty: idx.qty >= 0 ? (r[idx.qty] ?? null) : null,
        stock: idx.stock >= 0 ? (r[idx.stock] ?? null) : null, code: String(r[idx.code] ?? '')
    })).filter(r => r.code);
    return { rows: conv(d.rows), checks: conv(d.checks), error: '' };
}

/** 진행률 — 지금 표에 있는 코드만 센다(다시 만들어 사라진 코드의 체크는 빠진다) */
export function progress(rows, checkMap) {
    const m = checkMap || {};
    const total = (rows || []).length;
    const done = (rows || []).filter(r => m[r.code] && m[r.code].done === true).length;
    return { done, total, pct: total ? Math.round(done * 100 / total) : 0 };
}

function normSchedule(s) {
    if (!s || typeof s !== 'object') return DEFAULT_SCHEDULE;
    const days = Array.isArray(s.days) ? s.days.filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : null;
    return {
        enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
        days: days && days.length ? days : DEFAULT_SCHEDULE.days,
        skipHolidays: typeof s.skipHolidays === 'boolean' ? s.skipHolidays : true
    };
}

/** 그날 지시서를 만드는 날인가 → {run, reason}. holidayName(y, m, d) = utils.js getHolidayName */
export function runDay(key, schedule, holidayName) {
    const s = normSchedule(schedule);
    const k = kstParts(keyMs(key) + 12 * 60 * 60 * 1000);
    if (!s.enabled) return { run: false, reason: '설정에서 꺼짐' };
    if (!s.days.includes(k.wd)) return { run: false, reason: `${WEEKDAYS[k.wd]}요일` };
    if (s.skipHolidays && typeof holidayName === 'function') {
        const name = holidayName(k.y, k.m, k.d);
        if (name) return { run: false, reason: name };
    }
    return { run: true, reason: '' };
}

/** 카드 상태 → {status: ok|rest|pending|missing|fail, text}. meta = refillLatest 문서 값 */
export function dayStatus({ meta, key, todayKey, nowMs, holidayName }) {
    const e = meta && meta.days && meta.days[key];
    const isToday = key === todayKey;
    const when = isToday ? '오늘은' : '그날은';
    if (e && e.status === 'ok') return { status: 'ok', text: '' };
    if (e && e.status === 'rest') return { status: 'rest', text: `${when} 지시서 없음(휴일${e.reason ? ': ' + e.reason : ''})` };
    if (e && e.status === 'fail') {
        return { status: 'fail', text: isToday ? '지시서 생성 실패 — 담당자 확인 중' : '그날 지시서 생성 실패' };
    }
    const rd = runDay(key, meta && meta.schedule, holidayName);
    if (!rd.run) return { status: 'rest', text: `${when} 지시서 없음(휴일: ${rd.reason})` };
    if (!isToday) return { status: 'missing', text: '그날 지시서 없음' };
    if (kstParts(nowMs).hh < REGULAR_DONE_H) return { status: 'pending', text: '08:20에 만들어집니다' };
    return { status: 'missing', text: '아직 지시서가 없습니다 — 담당자 확인 중' };
}

/** [지금 기준으로 다시 만들기] 버튼 상태 → {show, enabled, label, note, tone}
 *  req = refillLatest.req, requestMs = refillWork/request 의 requestedAt(ms, 없으면 0) */
export function reqUi({ req, requestMs, nowMs, isToday, isRunDay, todayKey }) {
    const label = '지금 기준으로 다시 만들기';
    if (!isToday) return { show: false, enabled: false, label, note: '', tone: '' };
    if (!isRunDay) return { show: true, enabled: false, label, note: '쉬는 날에는 다시 만들지 않습니다', tone: '' };
    const r = req || {};
    const lastMs = tsMs(r.lastReqAt), atMs = tsMs(r.at);
    const sameDay = r.day === todayKey;
    const max = Number.isInteger(r.max) ? r.max : DEFAULT_REQ_MAX;
    const cool = (Number.isInteger(r.cooldownMin) ? r.cooldownMin : DEFAULT_COOLDOWN_MIN) * 60 * 1000;
    // 1) 처리 중 — 15분 넘게 그대로면 PC 가 꺼졌을 수 있다(다음 요청 허용)
    if (r.state === 'running' && sameDay) {
        if (nowMs - atMs < PENDING_MAX_MS) return { show: true, enabled: false, label, note: '다시 만드는 중… (보통 3~8분)', tone: 'accent' };
    }
    // 2) 아직 처리되지 않은 요청
    const pending = requestMs > 0 && requestMs > lastMs;
    if (pending && nowMs - requestMs < PENDING_MAX_MS) {
        return { show: true, enabled: false, label, note: '요청함 — 처리 대기 중 (이 PC 프로그램이 5분마다 확인)', tone: 'accent' };
    }
    const k = kstParts(nowMs);
    if (k.hh < REQ_OPEN_H || k.hh >= REQ_CLOSE_H) {
        return { show: true, enabled: false, label, note: '07~19시에만 다시 만들 수 있습니다', tone: '' };
    }
    if (sameDay && Number.isInteger(r.count) && r.count >= max) {
        return { show: true, enabled: false, label, note: `오늘 다시 만들기 한도(${max}회)를 다 썼습니다`, tone: '' };
    }
    const started = sameDay ? tsMs(r.startedAt) : 0;
    if (started && nowMs - started < cool && r.state !== 'failed') {
        return { show: true, enabled: false, label, note: `${fmtHM(started + cool)} 이후 다시 만들 수 있습니다(${cool / 60000}분 간격)`, tone: '' };
    }
    if (pending) return { show: true, enabled: true, label, note: '요청이 15분 넘게 처리되지 않았습니다 — PC 가 꺼져 있을 수 있습니다', tone: 'warn' };
    if (r.state === 'running' && sameDay) {
        return { show: true, enabled: true, label, note: '다시 만들기가 15분 넘게 끝나지 않았습니다 — PC 가 꺼져 있을 수 있습니다', tone: 'warn' };
    }
    if (sameDay && (r.state === 'rejected' || r.state === 'failed') && r.note && nowMs - atMs < 60 * 60 * 1000) {
        return { show: true, enabled: true, label, note: `지난 요청이 처리되지 않았습니다: ${r.note}`, tone: 'warn' };
    }
    return { show: true, enabled: true, label, note: '', tone: '' };
}

/** 숫자 → '1,234'. 숫자로 못 읽으면 '-' (카드 본문 num() 과 같은 표기) */
export function fmtCount(v) {
    return Number.isFinite(+v) ? Number(v).toLocaleString('ko-KR') : '-';
}

/**
 * 접힌 띠 한 줄 요약(js/refill-card.js) → { msg, tone, items:[{label, value}], prog:{done,total,pct}|null, warns:[] }
 *   st = dayStatus 결과 · entry = refillLatest.days[key] · parsed = parseDay 결과(아직 못 읽었으면 null)
 *   checkMap = refillWork checks · extraWarns = 카드가 따로 아는 경고(문서 못 읽음·다시 만들기 경고 등)
 *   지시서가 없는 날(휴일·실패·대기)은 msg 한 줄(tone 'warn' = 실패·없음). 경고 문구는 띠에선 배지 하나, 펼치면 본문에.
 */
export function refillStrip({ st, entry, parsed, checkMap, extraWarns }) {
    const warns = (Array.isArray(extraWarns) ? extraWarns : []).filter(w => w && String(w).trim()).map(w => String(w).trim());
    if (!st || st.status !== 'ok') {
        const bad = !!st && (st.status === 'fail' || st.status === 'missing');
        return { msg: st ? String(st.text || '') : '', tone: bad ? 'warn' : '', items: [], prog: null, warns };
    }
    const e = entry || {};
    if (parsed && parsed.error) warns.unshift(parsed.error);
    return {
        msg: '', tone: '',
        items: [
            { label: '기준', value: fmtHM(e.basedAt) || '-' },
            { label: '채울 칸', value: fmtCount(e.rows) },
            { label: '확인필요', value: fmtCount(e.checks) }
        ],
        prog: parsed ? progress(parsed.rows, checkMap) : null,
        warns
    };
}

/** base64 → Uint8Array (원본 엑셀 바이트 그대로) */
export function b64ToBytes(b64) {
    const bin = atob(String(b64 || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** 받을 파일 이름 */
export function fileNameOf(doc, key) {
    const n = doc && doc.file && typeof doc.file.name === 'string' ? doc.file.name.trim() : '';
    return /^[^\\/:*?"<>|]+\.xlsx$/.test(n) ? n : `채우기지시서_${key}.xlsx`;
}

/**
 * 대시보드 '채우기' 업무 카드의 진행률 한 조각(js/refill-dash.js) → { text, tone, open, note }
 *   st = dayStatus 결과(아직 못 읽었으면 null) · parsed = 오늘 parseDay 결과(아직 못 읽었으면 null) · checkMap = refillWork checks
 *   open = 지시서 창을 열 수 있는가 · note = 열 수 없을 때 안내 문구(휴일·없음·실패·대기)
 */
export function dashProgress({ st, parsed, checkMap, err }) {
    if (!st) {
        if (err) return { text: '읽기 실패', tone: 'warn', open: false, note: `채우기 지시서 상태를 읽지 못했습니다(${err}).` };
        return { text: '불러오는 중…', tone: '', open: false, note: '지시서를 불러오는 중입니다. 잠시 뒤 다시 눌러 주세요.' };
    }
    if (st.status !== 'ok') {
        const short = { rest: '오늘 휴일', pending: '08:20 생성', missing: '지시서 없음', fail: '생성 실패' }[st.status] || '지시서 없음';
        const tone = st.status === 'fail' || st.status === 'missing' ? 'warn' : '';
        return { text: short, tone, open: false, note: String(st.text || short) };
    }
    if (!parsed) return { text: err ? '읽기 실패' : '불러오는 중…', tone: err ? 'warn' : '', open: true, note: '' };
    const p = progress(parsed.rows, checkMap);
    return { text: `${p.done}/${p.total}`, tone: p.total && p.done >= p.total ? 'ok' : '', open: true, note: '' };
}
