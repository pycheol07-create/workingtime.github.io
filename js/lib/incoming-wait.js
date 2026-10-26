// === js/lib/incoming-wait.js ===
// 로케이션관리 입고 대기 [시트 동기화](js/location.js syncIncomingData)의 순수 판정 — Firebase import 없음(node --test 대상: tests/incoming-wait.test.js).
//
//   요청  mibal2/incomingRequest  { requestedAt(서버 시각) } — 누를 때마다 새로 쓴다(같이 기다리기·바로 반영 없음, 2026-10-26 리뷰)
//   결과  integrations/incomingSheet { updatedAt, sheetReadAtMs(숫자, 시트 읽기를 '시작'한 때), ok, reqHandledAt, reqNote,
//         reqForMs(숫자, 그 reqNote·처리가 어느 요청 requestedAt 의 것인지 — 수집기 2026-10-26 재리뷰 이후) }
//         수집기: 업무자동화\앱\미발계산기2\미발수집_apps_script.gs (incomingWrite_·sheetReqDecide_)
//         수집기는 마지막 requestedAt 하나만 보므로, 처리 전에 여러 번 눌러도 한 번 읽기로 합쳐진다.
//
//   새 자료 판정은 sheetReadAtMs ≥ 내 요청 시각(서버). updatedAt 이 요청 뒤라도 시트 읽기를 요청 전에 시작했으면
//   (전체 수집이 4~6분 도는 사이 직원이 시트를 고친 경우) 방금 고친 내용이 빠졌을 수 있어 새 자료로 보지 않는다.
//   수집기 서버 판정(요청 뒤에 읽기 시작한 실행이 있으면 처리됨)도 같은 기준이다.
//   요청 시각은 쓴 requestedAt 을 다시 읽어 얻은 서버 시각이다(두 번 읽어도 못 얻을 때만 브라우저 시각 − 1분, requestServerMs).

const MIN = 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * MIN;
export const INCOMING_WAIT_MAX_MS = 10 * MIN;      // 새로 읽기를 기다리는 최대 시간(전체 수집이 돌고 있으면 그 뒤라 넉넉히)
export const REQ_CLIENT_MARGIN_MS = 1 * MIN;       // 요청 서버 시각을 못 읽었을 때 브라우저 시각에서 뺄 여유
export const SHEET_REQ_DAILY_MAX = 20;             // 수집기 하루 한도(gs SHEET_REQ_DAILY_MAX 와 같게 — 안내 문구용)

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** 수집기 자료가 몇 시 시트 기준인가(ms) — sheetReadAtMs, 없으면(수집기 새 코드 전) updatedAt. col = {at, sheetReadAtMs} */
export function incomingReadAt(col) {
    if (!col) return 0;
    return num(col.sheetReadAtMs) || num(col.at);
}

/**
 * 내 요청 시각(서버) — 쓴 뒤 다시 읽은 requestedAt. 못 얻었으면 브라우저 시각 − 1분.
 * 대체값의 한계(주석으로 남김): 브라우저 시계가 서버보다 1분 넘게 늦으면, 요청 직전에 읽기 시작한 자료를 새 자료로 볼 수 있다.
 * 그래서 화면은 다시 읽기를 두 번 시도한 뒤에만 이 값을 쓴다(쓰기 성공 + 두 번 다 읽기 실패는 드물다).
 * 반대로 더 늦은 값(브라우저 + 여유)을 쓰면 브라우저 시계가 빠른 PC 에서 요청을 채운 읽기를 못 알아보고 늘 시간초과가 된다.
 */
export function requestServerMs(readBackMs, clientNowMs) {
    return num(readBackMs) || (clientNowMs - REQ_CLIENT_MARGIN_MS);
}

/**
 * 기다리는 중 incomingSheet 스냅샷 판정 → 'wait' | 'done' | 'saveFailed' | 'rejected'
 *   d = { updatedAt(ms), sheetReadAtMs, ok, reqHandledAt(ms), reqNote, reqForMs }
 *   w = { reqMs(내 요청 서버 시각), baseAt(기다리기 전 updatedAt), baseHandledAt(기다리기 전 reqHandledAt) }
 *   · sheetReadAtMs 가 있으면 그것이 reqMs 이상일 때만 새 자료(조건이 안 맞는 갱신은 무시하고 계속 기다림)
 *   · sheetReadAtMs 칸이 아예 없으면 수집기가 아직 옛 코드 — 예전처럼 updatedAt 이 바뀌면 새 자료(Apps Script 붙여넣기 전까지만)
 *   · 새 자료가 아니고, 요청 뒤에 처리 표시(reqHandledAt)가 바뀌었는데 reqNote 가 있으면 거절·실패
 *     단 reqForMs(처리한 요청 시각)가 있으면 그것이 reqMs 이상일 때만 — reqHandledAt 은 '처리한 때' 라 내가 누르기 전에 시작한
 *     남의 요청 처리가 내 요청 뒤에 실패해도 내 거절로 보일 수 있다. reqForMs 칸이 없으면(수집기 옛 코드) reqHandledAt 으로 본다.
 */
export function judgeIncomingSnap(d, w) {
    if (!d) return 'wait';
    // 내 요청 시각은 SDK toMillis() 라 소수(µs) 가 붙고, 수집기 쪽 값(sheetReadAtMs·reqForMs)은 ms 정수로 잘린다 — 같은 쪽(floor)으로 맞춘다
    const reqMs = Math.floor(num(w.reqMs));
    const read = num(d.sheetReadAtMs);
    const isNew = read ? read >= reqMs : (typeof d.sheetReadAtMs !== 'number' && num(d.updatedAt) > num(w.baseAt));
    if (isNew) return d.ok === false ? 'saveFailed' : 'done';
    const handled = num(d.reqHandledAt);
    const mine = typeof d.reqForMs === 'number' ? num(d.reqForMs) >= reqMs : handled >= reqMs;
    if (d.reqNote && handled > num(w.baseHandledAt) && mine) return 'rejected';
    return 'wait';
}

/**
 * 진행 중 표시 — [시트 동기화]를 기다리는 동안(요청 전 읽기부터 반영 끝까지) 다시 누르지 못하게.
 * begin() 이 false 면 이미 진행 중. end() 는 여러 번 불려도 된다.
 * seq = 지금(마지막) begin 의 번호. 기다림은 시작할 때 seq 를 기억해 endIf(seq) 로 자기 차례일 때만 내린다
 * (늦게 끝난 옛 기다림이 그 뒤 새로 세운 진행 중 표시를 내리지 않게).
 */
export function createRunGuard() {
    let busy = false, seq = 0;
    return {
        begin() { if (busy) return false; busy = true; seq++; return true; },
        end() { busy = false; },
        endIf(s) { if (s === seq) busy = false; },
        get busy() { return busy; },
        get seq() { return seq; }
    };
}

/**
 * 진행 중 표시를 세우고 run 을 돌린다. begin 은 첫 await 전에 한다(빨리 두 번 눌러도 run 은 하나).
 *   이미 진행 중이면 onBusy() 결과를 돌려준다.
 *   run 이 true 를 돌려주면 '기다리기에 넘김' — 표시는 넘겨받은 쪽(기다림의 finish)이 end() 한다.
 *   그 밖(다른 값·예외)은 여기서 end() 한다(예외는 그대로 던진다).
 */
export async function guardedRun(guard, run, onBusy) {
    if (!guard.begin()) return onBusy ? onBusy() : undefined;
    let handedOff = false;
    try { handedOff = (await run()) === true; }
    finally { if (!handedOff) guard.end(); }
    return handedOff;
}

/** 첫 호출만 fn 을 부른다(두 번째부터는 아무것도 안 하고 undefined). 기다림을 끝내는 finish 를 한 번만 돌게. */
export function once(fn) {
    let called = false;
    return (...args) => {
        if (called) return undefined;
        called = true;
        return fn(...args);
    };
}

/**
 * 기다림 시간초과 안내. 목록은 바꾸지 않는다(요청 뒤에 읽은 자료가 아니므로).
 * 수집기는 월~토 07~19시(KST)에만 요청을 본다 — 남은 요청은 그다음 시간에 처리된다. nowMs 는 브라우저 시각(문구용).
 */
export function waitTimeoutText(waitMin, nowMs) {
    const k = new Date(nowMs + KST_OFFSET_MS);
    const dow = k.getUTCDay(), h = k.getUTCHours();   // 0=일
    const head = `${waitMin}분 안에 시트를 새로 읽지 못해 목록은 그대로 두었습니다.`;
    let when = '';
    if (dow === 0) when = '내일(월) 07시';
    else if (h >= 19) when = dow === 6 ? '월요일 07시' : '내일 07시';
    else if (h < 7) when = '오늘 07시';
    if (!when) return `${head} 잠시 뒤 다시 눌러 보세요.`;
    return `${head}\n지금은 수집기가 쉬는 시간이라 요청은 ${when} 이후에 처리됩니다 — 그 뒤 다시 누르면 반영됩니다.`;
}
