// === js/lib/refill-view.js ===
// 로케이션관리 대시보드 '채우기 지시서' 카드(js/refill-card.js)의 순수 함수 — import 없음(node --test 대상).
// 문서 모양은 업무자동화\앱\채우기자동화\앱기록.py 머리말(설계: 채우기앱연동_설계.md 2절).
//   integrations/refillLatest      { days: {YYYYMMDD: {status, rev, source, basedAt, rows, fillQty, checks, reason}}, schedule, req }
//   integrations/refillDay_YYYYMMDD { rowsJson, file:{name, b64, bytes, sha}, fileOmitted, slack, source, basedAt, requestedBy }
//   refillWork/YYYYMMDD            { checks: {상품코드: {done, by, at}} }       ← 직원이 쓴다
//   refillWork/request             { requestedAt, by, day }                    ← 직원이 쓴다(덮어쓰기) — 머리줄 [지금 재고로 다시 만들기]
//                                                                                (js/rebuild-bar.js). 변경 추천 권한만 있으면 locRecWork/request 에.
//                                                                                서버는 두 문서 중 늦은 쪽을 요청으로 본다
//   refillLatest.req               { state: running|done|failed|rejected|waiting, note, day, count, autoCount, lastReqAt, startedAt, at,
//                                    source: request|auto, autoStockAt(ms), dataAt(ms), max, cooldownMin, autoMax }  ← 서버 요청판정.py
// 날짜 키는 한국시간(KST) — toISOString 은 UTC 라 09시 전에 하루 밀린다(location.js toDateStr 주석 사례).

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEKDAYS = '월화수목금토일';                 // 0=월 … 6=일 (프로그램 settings.days 와 같은 번호)
export const DEFAULT_SCHEDULE = { enabled: true, days: [0, 1, 2, 3, 4], skipHolidays: true };
export const REQ_OPEN_H = 7, REQ_CLOSE_H = 19;          // 프로그램 확인이 도는 시간(채우기요청 07:00~19:00)
// 요청 받는 시각 07:00~18:50(요청 시각 기준) — 서버 채우기자동화\요청판정.py REQ_OPEN_MIN·REQ_CLOSE_MIN, 변경 추천 locrec-view.js 와 같게
export const REQ_OPEN_MIN = 7 * 60, REQ_CLOSE_MIN = 18 * 60 + 50;
export const REQ_HOURS_TEXT = '07:00~18:50';
export const REGULAR_DONE_H = 9;                         // 정기 지시서(08:20)가 이 시각까지 없으면 '확인 중'
export const PENDING_MAX_MS = 15 * 60 * 1000;            // 요청이 이만큼 처리 안 되면 'PC 가 꺼져 있을 수 있음'
export const REQ_RUNNING_MS = 25 * 60 * 1000;            // 다시 만드는 중이 이만큼 그대로면 멈춘 것(예약작업 채우기요청 한도 25분)
export const REQ_NOTE_MS = 60 * 60 * 1000;               // 거절·실패·대기 사유를 보여 주는 시간
export const DEFAULT_REQ_MAX = 6, DEFAULT_COOLDOWN_MIN = 15, DEFAULT_AUTO_MAX = 3;
export const REBUILD_LABEL = '지금 재고로 다시 만들기';
export const AUTO_NOTE = '재고 자료가 새로 올라왔습니다 — 몇 분 안에 자동으로 다시 만듭니다';
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

/** [지금 재고로 다시 만들기] 상태 → {show, enabled, label, note, tone('' | accent | warn)}
 *  버튼은 대시보드 머리줄 하나(js/rebuild-bar.js — 채우기·변경 추천을 합쳐 combinedReqUi). 채우기 카드는 note 만 보여 준다.
 *  req = refillLatest.req · requestMs = 요청 문서 두 곳(refillWork/request·locRecWork/request) 중 늦은 requestedAt(ms, 없으면 0)
 *  board = 오늘 정기 지시서(08:20)가 있는가(days[오늘].status 'ok') · lastDataMs = INFO_CONFIG.lastDataUpdate(재고 엑셀 올린 시각)
 *  basedAtMs = 오늘 판의 basedAt. 서버 규칙(채우기자동화\요청판정.decide)과 같게: 오늘 · 근무일 · 정기 판 뒤 · 07:00~18:50 ·
 *  하루 max · cooldownMin 간격(직전 실패면 면제). 자동(재고 업로드)은 하루 autoMax. */
export function reqUi({ req, requestMs, nowMs, isToday, isRunDay, todayKey, board = true, lastDataMs = 0, basedAtMs = 0 }) {
    const label = REBUILD_LABEL;
    const res = (enabled, note = '', tone = '') => ({ show: true, enabled, label, note, tone });
    if (!isToday) return { show: false, enabled: false, label, note: '', tone: '' };
    if (!isRunDay) return res(false, '쉬는 날에는 다시 만들지 않습니다');
    if (!board) return res(false, '08:20 정기 지시서 뒤에 다시 만들 수 있습니다');
    const r = req || {};
    const lastMs = tsMs(r.lastReqAt), atMs = tsMs(r.at);
    const sameDay = r.day === todayKey;
    const intOr = (v, d) => (Number.isInteger(v) ? v : d);
    const max = intOr(r.max, DEFAULT_REQ_MAX), autoMax = intOr(r.autoMax, DEFAULT_AUTO_MAX);
    const cool = intOr(r.cooldownMin, DEFAULT_COOLDOWN_MIN) * 60 * 1000;
    const autoN = sameDay ? intOr(r.autoCount, 0) : 0;
    const dataMs = tsMs(lastDataMs);
    const autoPending = dataMs > 0 && dataMs > Math.max(tsMs(basedAtMs), tsMs(r.dataAt), tsMs(r.autoStockAt)) && autoN < autoMax;
    const withAuto = (o) => (autoPending && o.tone !== 'warn' ? { ...o, note: AUTO_NOTE + (o.note ? ` · ${o.note}` : ''), tone: o.tone || 'accent' } : o);
    // 1) 처리 중 — 예약작업 한도(25분) 넘게 그대로면 PC 가 꺼졌을 수 있다(다음 요청 허용)
    if (r.state === 'running' && sameDay && nowMs - atMs < REQ_RUNNING_MS) {
        return res(false, r.source === 'auto' ? '재고 자료가 새로 올라와 자동으로 다시 만드는 중… (보통 3~8분)' : '다시 만드는 중… (보통 3~8분)', 'accent');
    }
    // 2) 아직 처리되지 않은 요청 — 서버가 '대기'(이지어드민 쉬는 시간·재고 올리는 중)로 남겼으면 그 사유
    const pending = requestMs > 0 && requestMs > lastMs;
    if (pending && r.state === 'waiting' && sameDay && r.note && nowMs - atMs < REQ_NOTE_MS) {
        return res(false, `요청함 — ${r.note}`, 'accent');
    }
    if (pending && nowMs - requestMs < PENDING_MAX_MS) {
        return res(false, '요청함 — 처리 대기 중 (이 PC 프로그램이 5분마다 확인)', 'accent');
    }
    const k = kstParts(nowMs);
    const hm = k.hh * 60 + k.mm;
    const recentNote = sameDay && (r.state === 'rejected' || r.state === 'failed') && r.note && nowMs - atMs < REQ_NOTE_MS;
    const lastNote = () => (r.state === 'failed' ? `다시 만들지 못했습니다: ${r.note}` : `지난 요청이 처리되지 않았습니다: ${r.note}`);
    if (hm < REQ_OPEN_MIN || hm >= REQ_CLOSE_MIN) {
        return recentNote ? res(false, lastNote(), 'warn') : res(false, `${REQ_HOURS_TEXT}에만 다시 만들 수 있습니다`);
    }
    if (sameDay && intOr(r.count, 0) >= max) return withAuto(res(false, `오늘 다시 만들기 한도(${max}회)를 다 썼습니다`));
    const started = sameDay ? tsMs(r.startedAt) : 0;
    if (started && nowMs - started < cool && r.state !== 'failed') {
        return withAuto(res(false, `${fmtHM(started + cool)} 이후 다시 만들 수 있습니다(${cool / 60000}분 간격)`));
    }
    if (pending) return res(true, '요청이 15분 넘게 처리되지 않았습니다 — PC 가 꺼져 있을 수 있습니다', 'warn');
    if (r.state === 'running' && sameDay) {
        return res(true, '다시 만들기가 25분 넘게 끝나지 않았습니다 — PC 가 꺼져 있을 수 있습니다', 'warn');
    }
    if (recentNote) return res(true, lastNote(), 'warn');
    return withAuto(res(true));
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
