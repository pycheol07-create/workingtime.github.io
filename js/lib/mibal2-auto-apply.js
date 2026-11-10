// === js/lib/mibal2-auto-apply.js ===
// 신규 부족수량관리(live) — [지금 갱신] 끝나면 자동 [스캐너에 반영](2026-11-10 사용자 요구). 순수 함수만(시험 tests/mibal2-auto-apply.test.js).
//   · 자동 반영은 이 PC 에서 직접 누른 [지금 갱신] 요청(pending.manual)이 성공으로 끝났을 때만 — 다른 PC 갱신·07:30 자동 수집·자동 요청은 아님
//   · 확인창이 필요한 경우는 전부 반영하지 않고 이유만 알린다(직원이 [스캐너에 반영]을 직접 누름)
import { RECENT_SCAN_MIN, isoDay } from './mibal2-live.js?v=202611101708';

export const AUTO_TOAST_MS = 8000;   // 자동 반영 결과 토스트(성공·중단 이유) 보이는 시간
export const AUTO_MANUAL_TAIL = '[스캐너에 반영]을 직접 누르세요';

const ms = (v) => (!v ? 0 : typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : (new Date(v).getTime() || 0));

export const AUTO_MAX_WAIT_MS = 15 * 60000;   // js/china-mibal2.js REFRESH_TIMEOUT_MS 와 같다 — 요청 뒤 이보다 늦게 끝나면 자동 반영 안 함
export const AUTO_CLAIM_KEY = 'mibal2_auto_claim';   // localStorage — 한 PC 여러 탭(탭 복제로 대기 요청이 같이 복사됨) 중 하나만
export const AUTO_CLAIM_TTL_MS = 2 * 60000;

/**
 * 갱신 요청 대기(pending)가 이번 mibal2Latest 로 '자동 반영할 완료'가 됐나.
 * pending = { atMs, baseRun, baseNoteAt, manual, baseOk, rid } (manual·baseOk·rid 는 2026-11-10 부터 — 없는 옛 대기는 자동 반영 안 함)
 * 완료 = 요청 뒤 AUTO_MAX_WAIT_MS 안에 lastRunAt 이 바뀌고, 성공(ok !== false)이고, lastOkAt 이 요청 때보다 새것.
 */
export function refreshDoneAuto(pending, latest, nowMs = Date.now()) {
    if (!pending || pending.manual !== true || !latest) return false;
    if (typeof pending.baseOk !== 'number' || typeof pending.rid !== 'string' || !pending.rid) return false;
    if (!(nowMs - Number(pending.atMs || 0) <= AUTO_MAX_WAIT_MS)) return false;
    const runMs = ms(latest.lastRunAt);
    if (!runMs || runMs === pending.baseRun) return false;
    if (latest.ok === false) return false;
    const okMs = ms(latest.lastOkAt);
    return !!okMs && okMs > pending.baseOk;
}

/**
 * 자동 반영을 멈출 이유(첫 번째 하나) | ''. 알려 준 칸만 본다(undefined = 아직 모름 → 보지 않음).
 * f = { frozen, busy, pendingFix, parseError, datesChanged, dates, okMs, now(ms), batch, recentScanMin, mismatch('block'|'warn'|''), scanCodes, codes,
 *       unknownMibal, noLocation }
 */
export function autoStopReason(f) {
    if (f.frozen) return '비상 전환 중이라 이 화면은 조회 전용입니다';
    if (f.busy) return '진행 중인 다른 작업이 있습니다';
    if (f.pendingFix) return `저장 안 한 입고확인 ${f.pendingFix}건이 있습니다 — 먼저 [저장]하거나 [취소]하세요`;
    if (f.parseError) return `수집 자료를 읽는 데 문제가 있습니다(${f.parseError})`;
    if (f.datesChanged) return '다른 PC 에서 출고일을 바꿔 이 화면의 출고일을 맞췄습니다 — 화면을 확인하세요';
    if (f.dates !== undefined && !(f.dates || []).length) return '출고일이 선택되지 않았습니다';
    if (f.okMs !== undefined) {
        if (!f.okMs) return '수집 자료가 없습니다';
        if (isoDay(new Date(f.okMs)) !== isoDay(new Date(f.now || Date.now()))) return '수집 자료가 오늘 것이 아닙니다';
    }
    if (f.batch) return '이미 작업 중이라 자동 반영하지 않았습니다(이중 차감 위험)';
    if (typeof f.recentScanMin === 'number' && f.recentScanMin < RECENT_SCAN_MIN) return `${f.recentScanMin}분 전에 스캐너 입고가 있었습니다(스캔·전송 중일 수 있음)`;
    if (f.mismatch === 'block') return '스캔이 다른 출고일 패킹 것으로 보여 막혔습니다(출고일 불일치)';
    if (f.mismatch === 'warn') return '선택한 출고일 밖 스캔이 있습니다(출고일 불일치 경고)';
    if (f.scanCodes) return `앱 스캔 입고 ${f.scanCodes}개 상품이 남아 있습니다 — 이전 작업 스캔이면 먼저 [작업 마감]`;
    if (f.codes !== undefined && !f.codes) return '선택한 출고일에 도착이 있는 상품이 없습니다';
    if (f.unknownMibal) return `비축재고를 몰라 피킹 배정을 계산 못 한 상품이 ${f.unknownMibal}개 있습니다`;
    if (f.noLocation) return `로케이션관리에 없어 스캐너 위치가 빈칸이 되는 상품이 ${f.noLocation}개 있습니다`;
    return '';
}

/**
 * 한 PC 여러 탭 중 이 탭이 자동 반영을 맡아도 되나 — cur = localStorage AUTO_CLAIM_KEY 의 값(없으면 null).
 * 같은 요청(rid)을 다른 탭이 TTL 안에 잡았으면 false. 다른 요청·만료·이 탭이 잡은 것이면 true.
 */
export function claimOk(cur, rid, tab, nowMs = Date.now(), ttl = AUTO_CLAIM_TTL_MS) {
    if (!rid || !tab) return false;
    if (!cur || typeof cur !== 'object') return true;
    if (cur.rid !== rid) return true;
    if (cur.tab === tab) return true;
    return !(nowMs - Number(cur.at || 0) <= ttl);
}
/** 잡은 뒤 다시 읽었을 때 이 탭 것인가(동시에 잡은 탭끼리는 나중에 쓴 쪽만 남는다) */
export const claimMine = (cur, rid, tab) => !!cur && cur.rid === rid && cur.tab === tab;

/** 서버에서 다시 읽은 settings 에 진행 중인 작업 표시가 있나 — 마감된 표시(lastClosedId 와 같은 id, 또는 이 화면이 이미 마감됐다고 본 closedId)는 아님 */
export const serverBatchOpen = (s, closedId) => !!(s && s.batch && Array.isArray(s.batch.ships)
    && !(s.batch.id && (s.lastClosedId === s.batch.id || (closedId && closedId === s.batch.id))));

/** 자동 반영을 하지 않았을 때 토스트 문구 */
export const autoStopText = (reason) => `⚠️ 자동 반영 안 함 — ${reason}\n${AUTO_MANUAL_TAIL}`;
