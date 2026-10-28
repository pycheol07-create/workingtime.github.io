// === js/lib/refill-view.js ===
// 로케이션관리 대시보드 '채우기 지시서' 카드(js/refill-card.js)의 순수 함수 — import 없음(node --test 대상).
// 문서 모양은 업무자동화\앱\채우기자동화\앱기록.py 머리말(설계: 채우기앱연동_설계.md 2절).
//   integrations/refillLatest      { days: {YYYYMMDD: {status, rev, source, basedAt, rows, fillQty, checks, fixed, added, reason}}, schedule, req }
//   integrations/refillDay_YYYYMMDD { rowsJson, file:{name, b64, bytes, sha}, fileOmitted, slack, source, basedAt, requestedBy }
//                                    rowsJson cols 끝 '고정'(1 = 오늘 완료라 이전 판 값 그대로 둔 줄) · '추가'('HH:MM' = 다시 만든 판에 처음 들어온 시각)
//                                    — 2026-10-28 서버 채우기자동화\고정.py. 옛 5열 판은 두 칸이 없다(fixed false · added '')
//   refillWork/YYYYMMDD            { checks: {상품코드: {done, by, at}} }       ← 직원이 쓴다
//   refillWork/request             { requestedAt, by, day }                    ← 직원이 쓴다(덮어쓰기) — 머리줄 [지금 재고로 다시 만들기]
//                                                                                (js/rebuild-bar.js). 변경 추천 권한만 있으면 locRecWork/request 에.
//                                                                                서버는 두 문서 중 늦은 쪽을 요청으로 본다
//   refillLatest.req               { state: running|done|failed|rejected|waiting, note, day, count, autoCount, lastReqAt, startedAt, at,
//                                    source: request|auto, autoStockAt(ms), dataAt(ms), max, cooldownMin, autoMax,
//                                    waitUntil(ms, waiting 의 처리 예정 시각), stage·stageAt(running 단계 — STAGES), lastRun(done|failed) }
//                                    ← 서버 요청판정.py. waiting 의 note 는 '대기 중 — ' 뒤에 그대로 보인다
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
export const COLS = ['피킹로케이션', '비축위치', '채울수량', '비축재고', '상품코드', '고정', '추가'];
// 다시 만들기 실행 단계(req.stage) — 서버 채우기자동화\요청판정.py STAGES 와 같은 글자(시험이 고정)
export const STAGES = ['재고 받는 중', '채우기 지시서 만드는 중', '변경 추천 만드는 중'];
// 이지어드민 쉬는 시간 — 서버 로케이션추천\설정.json ezStock.quiet · 요청판정.py QUIET_DEFAULT 와 같은 값(시험이 고정).
// 서버가 대기 상태를 아직 안 썼을 때 화면이 예정 시각을 계산하는 데만 쓴다(판정은 서버)
export const QUIET = [['07:20', '07:50'], ['08:10', '08:50'], ['09:25', '09:40'], ['09:55', '10:15'], ['17:15', '17:45']];
export const FETCH_SPAN_MIN = 10;                        // 재고 받기 한 번의 한도(분) — 요청판정.py FETCH_SPAN_SEC
export const AUTO_SETTLE_MIN = 3;                        // 재고를 올린 뒤 이만큼 기다린다 — 요청판정.py AUTO_SETTLE_MIN

const p2 = (n) => String(n).padStart(2, '0');
const hmMin = (s) => { const [h, m] = String(s).split(':'); return (+h) * 60 + (+m); };

/** nowMs 부터 spanMin 동안 쉬는 시간대에 안 걸리는 가장 이른 시각(ms). 지금 안 걸리면 0.
 *  끝 시각은 포함하지 않고, 이어진 쉬는 시간대는 끝까지 넘긴다 — 서버 요청판정.quiet_resume 과 같은 규칙 */
export function quietResume(nowMs, quiet = QUIET, spanMin = FETCH_SPAN_MIN) {
    const now = tsMs(nowMs);
    if (!now) return 0;
    const day0 = keyMs(dayKey(now));                      // 그날 KST 00:00
    const hits = (curMin) => (quiet || []).filter(([a, b]) => (spanMin > 0
        ? curMin < hmMin(b) && curMin + spanMin > hmMin(a)
        : hmMin(a) <= curMin && curMin < hmMin(b))).map(([, b]) => hmMin(b));
    let cur = (now - day0) / 60000;
    let moved = false;
    for (let i = 0; i <= (quiet || []).length; i++) {
        const h = hits(cur);
        if (!h.length) break;
        cur = Math.max(...h);
        moved = true;
    }
    return moved ? day0 + cur * 60000 : 0;
}

/** 대기 사유 문구 — 서버(요청판정.py wait_quiet·wait_settle)와 같은 모양 */
export const waitQuietNote = (ms) => `이지어드민 쉬는 시간이라 ${fmtHM(ms)} 이후 처리`;
export const waitSettleNote = (ms) => `재고를 올린 직후라 ${fmtHM(ms)} 이후 처리`;

/**
 * 지금 '대기 중' 인가 → { note, until(ms, 모르면 0), from: 'server' | 'screen' } 또는 null
 *   r = 색인 req · pending = 처리 안 된 요청이 있음 · autoPending = 처리 안 된 재고 업로드가 있음(자동 대상)
 *   cooling = 간격(15분) 안 — 서버는 이때 대기가 아니라 '간격'으로 미루거나 거절하므로 화면도 대기로 계산하지 않는다
 *   reqOk = 요청이 한도 안(넘으면 서버가 바로 거절 — 대기로 계산하지 않는다)
 *   1) 서버가 쓴 waiting(같은 날 · 그 대상(요청/자동)이 아직 남아 있음 · 예정 시각 전, 예정 시각이 없으면 쓴 지 1시간 안)
 *      예정 시각이 지난 대기는 무시한다(지난 사유가 남지 않게 — 그 뒤는 아래 규칙·간격 문구로)
 *   2) 서버 상태가 아직 없으면 화면이 계산 — 쉬는 시간(재고 받기 10분이 걸려도) · 자동은 올린 직후 3분
 */
export function waitInfo({ r, sameDay, nowMs, pending, autoPending, dataMs = 0, cooling = false, reqOk = true }) {
    const q = r || {};
    if (q.state === 'waiting' && sameDay && q.note) {
        const forReq = q.source !== 'auto';
        if (forReq ? pending : (autoPending && !pending)) {
            const until = tsMs(q.waitUntil);
            const fresh = until ? nowMs < until : nowMs - tsMs(q.at) < REQ_NOTE_MS;
            if (fresh) return { note: String(q.note), until, from: 'server' };
        }
    }
    const k = kstParts(nowMs);
    const hm = k.hh * 60 + k.mm;
    if (hm < REQ_OPEN_MIN || hm >= REQ_CLOSE_H * 60) return null;
    const reqWait = pending && reqOk && !cooling;
    if (!reqWait && !(autoPending && !pending && !cooling)) return null;
    const qr = quietResume(nowMs);
    if (qr) return { note: waitQuietNote(qr), until: qr, from: 'screen' };
    const settle = tsMs(dataMs) + AUTO_SETTLE_MIN * 60 * 1000;
    if (!pending && autoPending && nowMs < settle) return { note: waitSettleNote(settle), until: settle, from: 'screen' };
    return null;
}

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

/** 지시서 문서 → { rows, checks, error }. 행 = {loc, reserve, qty, stock, code, fixed, added}. rowsJson 이 깨지면 빈 표 + error
 *  fixed = 오늘 완료라 이전 판 값을 그대로 둔 줄(고정) · added = 다시 만든 판에 처음 들어온 시각 'HH:MM'(없으면 '') */
export function parseDay(doc) {
    const empty = (error) => ({ rows: [], checks: [], error });
    if (!doc || typeof doc.rowsJson !== 'string') return empty(doc ? '표 자료가 없습니다' : '');
    let d;
    try { d = JSON.parse(doc.rowsJson); } catch (e) { return empty('표 자료가 깨졌습니다'); }
    if (!d || typeof d !== 'object') return empty('표 자료가 깨졌습니다');
    const cols = Array.isArray(d.cols) ? d.cols : COLS;
    const at = (name) => cols.indexOf(name);
    const idx = { loc: at('피킹로케이션'), reserve: at('비축위치'), qty: at('채울수량'), stock: at('비축재고'), code: at('상품코드'),
                  fixed: at('고정'), added: at('추가') };
    if (idx.code < 0) return empty('표 자료에 상품코드 열이 없습니다');
    const conv = (arr) => (Array.isArray(arr) ? arr : []).filter(Array.isArray).map(r => ({
        loc: r[idx.loc] ?? '', reserve: r[idx.reserve] ?? '', qty: idx.qty >= 0 ? (r[idx.qty] ?? null) : null,
        stock: idx.stock >= 0 ? (r[idx.stock] ?? null) : null, code: String(r[idx.code] ?? ''),
        fixed: idx.fixed >= 0 ? !!r[idx.fixed] : false,
        added: idx.added >= 0 && typeof r[idx.added] === 'string' ? r[idx.added] : ''
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
 *  하루 max · cooldownMin 간격(직전 실패면 면제). 자동(재고 업로드)은 하루 autoMax.
 *  머리줄 진행 띠(js/lib/rebuild-view.js combinedReqUi)용으로 더 돌려준다:
 *    phase = running | waiting | pending | stale | failed | rejected | ''  · stage(서버 단계 글자) · startedMs(시작 시각)
 *    waitUntil(대기 예정 시각 ms, 모르면 0) · doneMs(같은 날 req.doneAt — 실제 다시 만들기가 끝난 서버 시각, 완료 잠깐 표시용, 없으면 0) */
export function reqUi({ req, requestMs, nowMs, isToday, isRunDay, todayKey, board = true, lastDataMs = 0, basedAtMs = 0 }) {
    const label = REBUILD_LABEL;
    const r = req || {};
    const sameDay = r.day === todayKey;
    const atMs = tsMs(r.at);
    const doneMs = sameDay ? tsMs(r.doneAt) : 0;          // 실제 다시 만들기 완료 시각(서버) — 없으면 완료 표시 안 함
    const res = (enabled, note = '', tone = '', extra = {}) => ({ show: true, enabled, label, note, tone, phase: '', doneMs, ...extra });
    if (!isToday) return { show: false, enabled: false, label, note: '', tone: '', phase: '', doneMs: 0 };
    if (!isRunDay) return res(false, '쉬는 날에는 다시 만들지 않습니다');
    if (!board) return res(false, '08:20 정기 지시서 뒤에 다시 만들 수 있습니다');
    const lastMs = tsMs(r.lastReqAt);
    const intOr = (v, d) => (Number.isInteger(v) ? v : d);
    const max = intOr(r.max, DEFAULT_REQ_MAX), autoMax = intOr(r.autoMax, DEFAULT_AUTO_MAX);
    const cool = intOr(r.cooldownMin, DEFAULT_COOLDOWN_MIN) * 60 * 1000;
    const autoN = sameDay ? intOr(r.autoCount, 0) : 0;
    const dataMs = tsMs(lastDataMs);
    const autoPending = dataMs > 0 && dataMs > Math.max(tsMs(basedAtMs), tsMs(r.dataAt), tsMs(r.autoStockAt)) && autoN < autoMax;
    const withAuto = (o) => (autoPending && o.tone !== 'warn'
        ? { ...o, note: AUTO_NOTE + (o.note ? ` · ${o.note}` : ''), tone: o.tone || 'accent', phase: o.phase || 'pending' } : o);
    // 1) 처리 중 — 예약작업 한도(25분) 넘게 그대로면 PC 가 꺼졌을 수 있다(다음 요청 허용)
    if (r.state === 'running' && sameDay && nowMs - atMs < REQ_RUNNING_MS) {
        return res(false, r.source === 'auto' ? '재고 자료가 새로 올라와 자동으로 다시 만드는 중… (보통 3~8분)' : '다시 만드는 중… (보통 3~8분)', 'accent',
            { phase: 'running', stage: typeof r.stage === 'string' ? r.stage : '', startedMs: tsMs(r.startedAt) || atMs });
    }
    // 2) 대기 — 서버가 남긴 사유(쉬는 시간·올리는 중·올린 직후·이지어드민 잠금 …), 서버 상태가 아직 없으면 화면이 계산(쉬는 시간·올린 직후)
    const pending = requestMs > 0 && requestMs > lastMs;
    const started = sameDay ? tsMs(r.startedAt) : 0;
    const failedLast = r.state === 'failed' || r.lastRun === 'failed';
    const cooling = !!started && nowMs - started < cool && !failedLast;
    const w = waitInfo({ r, sameDay, nowMs, pending, autoPending, dataMs, cooling,
                         reqOk: !(sameDay && intOr(r.count, 0) >= max) });
    if (w) return res(false, `대기 중 — ${w.note}`, '', { phase: 'waiting', waitUntil: w.until });
    if (pending && nowMs - requestMs < PENDING_MAX_MS) {
        return res(false, '요청함 — 처리 대기 중 (이 PC 프로그램이 5분마다 확인)', 'accent', { phase: 'pending' });
    }
    const k = kstParts(nowMs);
    const hm = k.hh * 60 + k.mm;
    const recentNote = sameDay && (r.state === 'rejected' || r.state === 'failed') && r.note && nowMs - atMs < REQ_NOTE_MS;
    const lastNote = () => res(true, r.state === 'failed' ? `다시 만들지 못했습니다: ${r.note}` : `지난 요청이 처리되지 않았습니다: ${r.note}`,
        'warn', { phase: r.state });
    if (hm < REQ_OPEN_MIN || hm >= REQ_CLOSE_MIN) {
        return recentNote ? { ...lastNote(), enabled: false } : res(false, `${REQ_HOURS_TEXT}에만 다시 만들 수 있습니다`);
    }
    if (sameDay && intOr(r.count, 0) >= max) return withAuto(res(false, `오늘 다시 만들기 한도(${max}회)를 다 썼습니다`));
    if (cooling) {
        return withAuto(res(false, `${fmtHM(started + cool)} 이후 다시 만들 수 있습니다(${cool / 60000}분 간격)`));
    }
    if (pending) return res(true, '요청이 15분 넘게 처리되지 않았습니다 — PC 가 꺼져 있을 수 있습니다', 'warn', { phase: 'stale' });
    if (r.state === 'running' && sameDay) {
        return res(true, '다시 만들기가 25분 넘게 끝나지 않았습니다 — PC 가 꺼져 있을 수 있습니다', 'warn', { phase: 'stale' });
    }
    if (recentNote) return lastNote();
    return withAuto(res(true));
}

/** 표 창 행 안내 — 오늘 완료로 고정한 줄(r.fixed)이 지금도 완료 체크(done)일 때만. 체크를 풀면 안내도 없앤다 */
export const FIXED_NOTE = '완료 — 처음 수량 그대로';
export const fixedNote = (r, done) => (r && r.fixed && done === true ? FIXED_NOTE : '');

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
