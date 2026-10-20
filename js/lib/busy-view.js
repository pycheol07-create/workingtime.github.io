// === js/lib/busy-view.js ===
// '갱신 중·업로드 중' 띠(js/busy-banner.js)의 순수 판정 — Firebase import 없음(node --test 대상: tests/busy-view.test.js).
// 설계: 잠금_띠_설계.md 계약 A·B (2026-10-20). 띠에는 이메일을 넣지 않는다 — 이름(memberNameFor 결과)만, '@' 가 섞이면 버린다.
//
//   계약 A  integrations/ezadminLease   { holder:'mibal'|'refill'|'', job, runId, since, until, last:{holder,job,endAt,ms,calls,ok}, obs }
//           미발수집(Apps Script)·채우기(Python)가 쓰고 브라우저는 읽기만. until 은 잡은 쪽 시계 기준이라 60초 여유를 둔다.
//   계약 B  locationStock/uploadStatus · uploadStatus/stockLog
//           { schema:1, state:'running'|'done'|'failed', kind, by, runId, since, beatAt(60초마다), endAt }
//           진행 중 = running && beatAt 3분 안 && since 30분 안. '방금 끝남' = endAt 2분 안.
//   미발 갱신 요청 mibal2/refreshRequest { requestedAt } — 대기 판정은 china-mibal2.js checkPending·location.js syncIncomingData 와 같은 규칙.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MIN = 60 * 1000;
export const LEASE_GRACE_MS = 60 * 1000;        // until + 60초까지는 잡혀 있는 것으로 본다(시계 차이 여유)
export const DONE_SHOW_MS = 2 * MIN;            // '방금 끝남'을 보여 주는 시간
export const BEAT_STALE_MS = 3 * MIN;           // 신호(beatAt)가 이만큼 끊기면 끝난 것
export const UPLOAD_MAX_MS = 30 * MIN;          // 시작한 지 이만큼 지나면 끝난 것(탭이 멈춘 채 남은 경우)
export const REQUEST_PENDING_MS = 15 * MIN;     // 갱신 요청이 이 안에 처리 안 되면 대기 표시를 내린다
export const BY_MAX = 20;

// 잠금 주인별 문구 · 보통 걸리는 시간(분)
export const LEASE_LABEL = {
    mibal: { label: '미발·입고예정 자료 새로 읽는 중', done: '미발·입고예정 자료 새로 읽기 끝남', lo: 4, hi: 6 },
    refill: { label: '채우기 지시서 만드는 중', done: '채우기 지시서 만들기 끝남', lo: 3, hi: 8 }
};
const LEASE_OTHER = { label: '이지어드민 자료 읽는 중', done: '이지어드민 자료 읽기 끝남', lo: 0, hi: 0 };

export const UPLOAD_LABEL = {
    daily: { label: '오늘 재고 올리는 중', done: '오늘 재고 올리기 끝남', failed: '오늘 재고 올리기 실패' },
    permanent: { label: '도면(동/위치) 올리는 중', done: '도면(동/위치) 올리기 끝남', failed: '도면(동/위치) 올리기 실패' },
    stockLog: { label: '미발재고로그 올리는 중', done: '미발재고로그 올리기 끝남', failed: '미발재고로그 올리기 실패' }
};
const UPLOAD_OTHER = { label: '자료 올리는 중', done: '자료 올리기 끝남', failed: '자료 올리기 실패' };

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

/** ms → 'HH:MM'(KST, PC 시간대와 무관). 없으면 '' */
export function fmtHM(v) {
    const ms = tsMs(v);
    if (!ms) return '';
    const d = new Date(ms + KST_OFFSET_MS);
    return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** 띠에 넣을 이름 — 문자열만, 20자, '@' 가 있으면(이메일일 수 있음) 버린다. */
export function cleanBy(v) {
    if (typeof v !== 'string') return '';
    const s = v.trim().slice(0, BY_MAX);
    return s.includes('@') ? '' : s;
}

/** 남은 시간 문구 — 보통 lo~hi 분 걸리는 일을 since 부터 하고 있을 때 */
export function etaText(lo, hi, sinceMs, nowMs) {
    if (!hi) return '';
    if (!sinceMs || sinceMs > nowMs) return `보통 ${lo}~${hi}분`;
    const el = Math.floor((nowMs - sinceMs) / MIN);
    if (el < lo) return `약 ${lo - el}~${hi - el}분 남음`;
    if (el < hi) return `곧 끝남(약 ${hi - el}분 안)`;
    return '예상보다 오래 걸리는 중';
}

/**
 * 계약 A 잠금 문서 → null | {active, kind, job, label, sinceMs, untilMs, eta} | {done, kind, label, atMs, ok}
 * 만료 = until + 60초. 비어 있으면(holder '') last.endAt 이 2분 안일 때만 '방금 끝남'.
 */
export function leaseView(lease, nowMs) {
    if (!lease || typeof lease !== 'object') return null;
    const holder = typeof lease.holder === 'string' ? lease.holder.trim() : '';
    const untilMs = tsMs(lease.until);
    if (holder && untilMs && nowMs < untilMs + LEASE_GRACE_MS) {
        const t = LEASE_LABEL[holder] || LEASE_OTHER;
        const sinceMs = tsMs(lease.since);
        return { active: true, kind: LEASE_LABEL[holder] ? holder : 'other', job: typeof lease.job === 'string' ? lease.job : '',
                 label: t.label, sinceMs, untilMs, eta: etaText(t.lo, t.hi, sinceMs, nowMs) };
    }
    const last = lease.last && typeof lease.last === 'object' ? lease.last : null;
    const endMs = last ? tsMs(last.endAt) : 0;
    if (endMs && nowMs - endMs < DONE_SHOW_MS && endMs - nowMs < LEASE_GRACE_MS) {
        const lh = typeof last.holder === 'string' ? last.holder : '';
        const t = LEASE_LABEL[lh] || LEASE_OTHER;
        return { done: true, kind: LEASE_LABEL[lh] ? lh : 'other', label: t.done, atMs: endMs, ok: last.ok !== false };
    }
    return null;
}

/**
 * 계약 B 업로드 상태 → null | {active, kind, label, by, runId, sinceMs, beatMs, mine} | {done, kind, label, by, atMs, ok, mine}
 * myRunId 가 문서 runId 와 같으면 mine:true(내 업로드 — 띠에는 안 그린다).
 */
export function uploadView(st, nowMs, myRunId) {
    if (!st || typeof st !== 'object') return null;
    const kind = typeof st.kind === 'string' ? st.kind : '';
    const t = UPLOAD_LABEL[kind] || UPLOAD_OTHER;
    const runId = typeof st.runId === 'string' ? st.runId : '';
    const mine = !!(myRunId && runId && runId === myRunId);
    const by = cleanBy(st.by);
    const sinceMs = tsMs(st.since), beatMs = tsMs(st.beatAt);
    if (st.state === 'running' && sinceMs && beatMs
        && nowMs - beatMs < BEAT_STALE_MS && nowMs - sinceMs < UPLOAD_MAX_MS) {
        return { active: true, kind, label: t.label, by, runId, sinceMs, beatMs, mine };
    }
    const endMs = tsMs(st.endAt);
    if ((st.state === 'done' || st.state === 'failed') && endMs && nowMs - endMs < DONE_SHOW_MS && endMs - nowMs < LEASE_GRACE_MS) {
        const ok = st.state === 'done';
        return { done: true, kind, label: ok ? t.done : t.failed, by, atMs: endMs, ok, mine };
    }
    return null;
}

/**
 * 미발 갱신 요청이 아직 처리 대기 중인가 → null | {active, kind:'mibalRequest', label, sinceMs}
 * 요청 > 마지막 실행 && 요청 > 거절 메모 시각 && 요청 뒤 15분 안 (china-mibal2.js checkPending · location.js syncIncomingData 와 같은 규칙)
 */
export function mibalRequestView(reqAtMs, latest, nowMs) {
    const req = tsMs(reqAtMs);
    if (!req) return null;
    const runAt = latest ? tsMs(latest.lastRunAt) : 0;
    const noteAt = latest ? tsMs(latest.noteAt) : 0;
    if (req > runAt && req > noteAt && nowMs - req < REQUEST_PENDING_MS) {
        return { active: true, kind: 'mibalRequest', label: '미발·입고예정 새로 읽기 요청 대기 중', sinceMs: req };
    }
    return null;
}

// 미발수집 요청확인이 쉬는 시간(설계 A-14 QUIETS 와 같게) — 요청은 버리지 않고 끝난 뒤 처리한다. dow: 0=일 … 6=토(KST)
export const COLLECTOR_QUIETS = [
    { from: '09:55', to: '10:10', why: 'GIP 수집' },
    { from: '08:14', to: '08:22', dow: [1, 2, 3, 4, 5], why: '채우기 정기' }
];

/** 지금(KST)이 수집기 쉬는 시간이면 {from, to, why}, 아니면 null. 화면은 막지 않고 안내만 한다. */
export function collectorQuiet(nowMs, quiets = COLLECTOR_QUIETS) {
    const ms = tsMs(nowMs);
    if (!ms) return null;
    const d = new Date(ms + KST_OFFSET_MS);
    const hm = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
    const dow = d.getUTCDay();
    for (const q of quiets) {
        if (q.dow && !q.dow.includes(dow)) continue;
        if (hm >= q.from && hm < q.to) return { from: q.from, to: q.to, why: q.why };
    }
    return null;
}

/** mibal2Latest → '방금 갱신됨'(lastRunAt 2분 안) | null */
export function latestDoneView(latest, nowMs) {
    const runAt = latest ? tsMs(latest.lastRunAt) : 0;
    if (!runAt || nowMs - runAt >= DONE_SHOW_MS || runAt - nowMs >= LEASE_GRACE_MS) return null;
    const ok = latest.ok !== false;
    return { done: true, kind: 'mibal', label: ok ? '미발·입고예정 자료 갱신됨' : '미발·입고예정 자료 갱신 실패', atMs: runAt, ok };
}

/** 한 항목 → 문구 */
function itemText(it) {
    if (it.active) {
        if (it.kind === 'mibalRequest') return `${it.label}${it.sinceMs ? ` (${fmtHM(it.sinceMs)} 요청)` : ''}`;
        const by = cleanBy(it.by);
        const who = by ? `${by}님 ` : '';
        const extra = [it.sinceMs ? `${fmtHM(it.sinceMs)}부터` : '', it.eta || ''].filter(Boolean).join(' · ');
        return `${who}${it.label}${extra ? ` (${extra})` : ''}`;
    }
    const by = cleanBy(it.by);
    return `${by ? `${by}님 ` : ''}${it.label}${it.atMs ? ` ${fmtHM(it.atMs)}` : ''}`;
}

/**
 * 띠 한 줄. 내 것(mine)·빈 항목은 뺀다. 진행 중이 하나라도 있으면 진행 중만 보인다('방금 끝남'은 진행 중이 없을 때만).
 * 아무것도 없으면 ''.
 */
export function bannerText(items) {
    const list = (Array.isArray(items) ? items : []).filter(it => it && !it.mine && (it.active || it.done));
    if (!list.length) return '';
    const act = list.filter(it => it.active);
    // 잠금(mibal)이 잡혀 있으면 '요청 대기'는 같은 일이라 뺀다
    const shown = act.length
        ? act.filter(it => !(it.kind === 'mibalRequest' && act.some(o => o.kind === 'mibal')))
        : list;
    // 같은 문구가 두 번 나오지 않게(잠금 '방금 끝남'과 mibal2Latest '갱신됨' 등)
    const seen = new Set();
    const parts = [];
    for (const it of shown) {
        const s = itemText(it);
        if (seen.has(it.kind + '|' + (it.active ? 'a' : 'd'))) continue;
        seen.add(it.kind + '|' + (it.active ? 'a' : 'd'));
        parts.push(s);
    }
    return (act.length ? '⏳ ' : '✓ ') + parts.join(' · ');
}

/** 상태 서명 — 바뀌었는지 비교용(× 로 숨긴 띠를 상태가 바뀌면 다시 보인다). 시각은 넣지 않는다. */
export function bannerKey(items) {
    return (Array.isArray(items) ? items : []).filter(it => it && !it.mine && (it.active || it.done))
        .map(it => `${it.kind}:${it.active ? 'a' : 'd'}:${it.runId || ''}:${it.sinceMs || it.atMs || 0}`).sort().join('|');
}

const UPLOAD_WHAT = { daily: '오늘 재고를', permanent: '도면(동/위치)을', stockLog: '미발재고로그를' };

/** 업로드 막기 안내문 — "○○님이 hh:mm부터 오늘 재고를 올리는 중입니다(마지막 신호 hh:mm). 끝난 뒤 다시 올려 주세요." */
export function uploadBlockText(v) {
    const what = UPLOAD_WHAT[v && v.kind] || '자료를';
    const by = cleanBy(v && v.by);
    return `${by ? `${by}님이` : '다른 사람이'} ${fmtHM(v && v.sinceMs)}부터 ${what} 올리는 중입니다(마지막 신호 ${fmtHM(v && v.beatMs)}). 끝난 뒤 다시 올려 주세요.`;
}
