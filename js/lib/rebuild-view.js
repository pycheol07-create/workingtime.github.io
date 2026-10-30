// === js/lib/rebuild-view.js ===
// 로케이션관리 대시보드 머리줄 [지금 재고로 다시 만들기](js/rebuild-bar.js)의 순수 함수 — node --test 대상.
//   버튼 하나가 '채우기 지시서'와 '변경 추천'을 같이 다시 만들게 한다(2026-10-27, 예전엔 카드마다 버튼).
//   사무실 PC 예약작업 채우기요청(채우기.py --요청확인, 5분)이 이지어드민 재고를 한 번 받아 채우기 → 변경 추천 순으로 만든다.
//   요청은 가진 권한 쪽 문서 하나에 쓴다(requestPathOf) — 서버(두 앱의 앱기록.read_request)는 두 문서 중 늦은 쪽을 요청으로 본다.
//   각 쪽 상태는 refill-view.js reqUi · locrec-view.js recReqUi 가 정하고, 여기서는 합치기만 한다.
//   머리줄은 상태 하나(진행 / 대기 / 경고 / 완료 / 안내)만 문구로 보이고, 두 쪽 세부 문구는 툴팁(title)에 둔다(2026-10-27).
//   진행: '다시 만드는 중 · 재고 받는 중 (1/3)' + 경과(tick) — 단계는 채우기 req.stage(서버 요청판정.py STAGES),
//         채우기가 끝났는데 변경 추천만 만드는 중이면 '변경 추천 만드는 중'. 진행 막대는 움직이는 막대(진행률 모름).
//   대기: '대기 중 — 이지어드민 쉬는 시간이라 10:15 이후 처리' — 막대는 회색 정지.
//   완료: 끝난 뒤 DONE_FLASH_MS 동안 '완료 — 채우기 N칸 · 변경 추천 N건 (HH:MM)'.
//   진행·대기·완료는 권한 없는 직원에게도 보인다(2026-10-27). 버튼·경고·안내는 권한이 있는 사람만.

import { STAGES, fmtHM } from './refill-view.js?v=202610301845';

export { STAGES };
export const DONE_FLASH_MS = 60 * 1000;      // 완료 문구를 보여 주는 시간
export const REBUILD_LABEL = '지금 재고로 다시 만들기';
export const PART_LABEL = { refill: '채우기', locrec: '변경 추천' };
export const REFILL_REQUEST = 'refillWork/request';
export const LOCREC_REQUEST = 'locRecWork/request';

/** 요청 문서 두 곳의 requestedAt(ms) 중 늦은 것 — 서버 판정과 같은 '늦은 쪽' */
export function laterMs(...list) {
    return list.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 0);
}

/** 요청을 쓸 문서(앱 경로 아래) — 채우기 권한이 있으면 refillWork, 없으면 locRecWork. 둘 다 없으면 '' */
export function requestPathOf({ canRefill, canLocrec }) {
    if (canRefill) return REFILL_REQUEST;
    if (canLocrec) return LOCREC_REQUEST;
    return '';
}

/** 경과 ms → '2분 10초' · '45초'(음수·없음은 '') */
export function fmtDur(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60), s = sec % 60;
    return m ? `${m}분 ${s}초` : `${s}초`;
}

/** 색인 문서 → 완료 문구에 넣을 숫자. refill = refillLatest.days[오늘].rows(채울 칸), locrec = locRecLatest.days[오늘].n 합(추천 건수) */
export function doneCounts({ refillEntry, locrecEntry } = {}) {
    const num = (v) => (Number.isFinite(v) ? v : null);
    const r = refillEntry && refillEntry.status === 'ok' ? num(refillEntry.rows) : null;
    let l = null;
    if (locrecEntry && locrecEntry.status === 'ok') {
        const n = locrecEntry.n;
        if (Number.isFinite(n)) l = n;
        else if (n && typeof n === 'object') l = ['single', 'swap', 'pair'].reduce((a, k) => a + (Number.isFinite(n[k]) ? n[k] : 0), 0);
    }
    return { refillRows: r, locrecN: l };
}

/**
 * 두 쪽 상태 → 머리줄 { show, btn, enabled, label, note, tick, title, tone('' | accent | warn), kind, bar }
 *   refill / locrec = reqUi · recReqUi 결과(못 읽었으면 null) · canRefill / canLocrec = 권한
 *   nowMs = 지금 · counts = doneCounts 결과(완료 문구)
 *   kind: running | waiting | warn | done | info | ''  ·  bar: run(움직이는 막대) | wait(회색 정지) | done | ''
 *   note = 요약 한 줄(진행이면 단계까지) · tick = 진행 경과('2분 10초', 진행일 때만) · title = 두 쪽 세부 문구(줄바꿈)
 *   진행·대기·완료는 권한과 상관없이 두 쪽(읽은 쪽)을 모두 보고 누구에게나 보인다(2026-10-27 — 누른 사람 화면에만 보이던 것).
 *   버튼(btn)·경고·안내는 권한이 하나라도 있을 때만, 경고·안내·켬은 권한 있는 쪽만 본다.
 *   show = 문구·막대를 그릴지 — 권한이 없으면 진행·대기·완료일 때만 true. 버튼은 show && btn 일 때 보인다.
 *   켬: 권한 있는 쪽 중 하나라도 다시 만들 수 있고, 진행·대기 중이 아닐 때.
 *   우선순위: 진행 > 대기 > 경고(실패·멈춤·PC 꺼짐) > 완료(DONE_FLASH_MS 안) > 안내(첫 문구 — 두 쪽이면 '채우기: …').
 */
export function combinedReqUi({ refill, locrec, canRefill, canLocrec, nowMs = Date.now(), counts = {} }) {
    const label = REBUILD_LABEL;
    const btn = !!(canRefill || canLocrec);
    const out = (o) => ({ show: true, btn, enabled: false, label, note: '', tick: '', title: '', tone: '', kind: '', bar: '', ...o });
    const all = [['refill', refill], ['locrec', locrec]];
    const parts = all.filter(([k]) => (k === 'refill' ? canRefill : canLocrec));      // 권한 있는 쪽
    const both = parts.length > 1;
    const isStatus = (u) => u.phase === 'running' || u.phase === 'waiting';
    const lines = [];
    for (const [k, u] of all) {
        const mine = parts.some(([p]) => p === k);
        if (mine && !u) lines.push(`${PART_LABEL[k]}: 불러오는 중…`);
        else if (u && u.show && u.note && (mine || isStatus(u))) lines.push(`${PART_LABEL[k]}: ${u.note}`);
    }
    const title = lines.join('\n');
    const seen = all.filter(([, u]) => u && u.show);                                   // 상태(진행·대기·완료)는 두 쪽 모두
    const shown = parts.filter(([, u]) => u && u.show);                                // 켬·경고·안내는 권한 있는 쪽만
    const enabled = shown.some(([, u]) => u.enabled);
    const pickSeen = (fn) => seen.find(([, u]) => fn(u));
    const pick = (fn) => shown.find(([, u]) => fn(u));

    // 1) 진행 — 채우기 단계가 있으면 그것(n/3), 변경 추천만 만드는 중이면 그 단계
    const run = pickSeen(u => u.phase === 'running');
    if (run) {
        const [k, u] = run;
        let step = '';
        const i = STAGES.indexOf(u.stage);
        if (k === 'refill' && i >= 0) step = `${u.stage} (${i + 1}/${STAGES.length})`;
        else if (k === 'locrec') step = STAGES[2];
        const tick = u.startedMs ? fmtDur(Math.max(0, nowMs - u.startedMs)) : '';
        return out({ note: ['다시 만드는 중', step].filter(Boolean).join(' · '), tick, title, tone: 'accent', kind: 'running', bar: 'run' });
    }
    // 2) 대기 — 막대는 회색 정지
    const wait = pickSeen(u => u.phase === 'waiting');
    if (wait) return out({ note: wait[1].note, title, kind: 'waiting', bar: 'wait' });
    // 3) 경고 — 실패·멈춤·PC 꺼짐·읽기 실패(권한 있는 쪽만, 권한 있는 사람에게만)
    const warn = pick(u => u.tone === 'warn' && u.note);
    if (warn) return out({ enabled, note: both ? `${PART_LABEL[warn[0]]}: ${warn[1].note}` : warn[1].note, title, tone: 'warn', kind: 'warn' });
    // 4) 완료 — 끝난 뒤 잠깐. 숫자는 읽은 쪽 모두(못 읽은 쪽은 뺀다)
    const doneMs = seen.reduce((m, [, u]) => Math.max(m, u.doneMs || 0), 0);
    if (doneMs && nowMs >= doneMs - 60 * 1000 && nowMs - doneMs < DONE_FLASH_MS) {
        const seg = [];
        if (refill && Number.isFinite(counts.refillRows)) seg.push(`채우기 ${counts.refillRows.toLocaleString('ko-KR')}칸`);
        if (locrec && Number.isFinite(counts.locrecN)) seg.push(`변경 추천 ${counts.locrecN.toLocaleString('ko-KR')}건`);
        return out({ enabled, note: `완료${seg.length ? ' — ' + seg.join(' · ') : ''} (${fmtHM(doneMs)})`, title, tone: 'accent', kind: 'done', bar: 'done' });
    }
    // 권한이 없으면 평소(경고·안내)에는 아무것도 보이지 않는다
    if (!btn) return { ...out({}), show: false };
    // 5) 안내 — 강조(accent) 문구가 먼저, 없으면 첫 문구
    const missing = parts.find(([, u]) => !u);
    const info = pick(u => u.note && u.tone === 'accent') || pick(u => u.note);
    if (info) {
        return out({ enabled, note: both ? `${PART_LABEL[info[0]]}: ${info[1].note}` : info[1].note, title,
                     tone: info[1].tone === 'accent' ? 'accent' : '', kind: 'info' });
    }
    if (missing) return out({ enabled, note: `${PART_LABEL[missing[0]]}: 불러오는 중…`, title, kind: 'info' });
    return out({ enabled, title });
}

/** 확인창 문구 — 다시 만들어질 쪽만 적는다 */
export function confirmText({ refill, locrec, canRefill, canLocrec }) {
    const on = [];
    if (canRefill && refill && refill.enabled) on.push('채우기 지시서');
    if (canLocrec && locrec && locrec.enabled) on.push('변경 추천');
    const list = on.length ? on : ['채우기 지시서', '변경 추천'];
    const what = list.join('와 ') + (list[list.length - 1] === '변경 추천' ? '을' : '를');
    return `사무실 PC 자동화 프로그램이 지금 이지어드민 재고로 ${what} 새로 만듭니다.\n`
        + '처리함/완료 표시는 그대로 남고, 슬랙에는 다시 보내지 않습니다(앱에서만 바뀝니다). 보통 5~10분 걸립니다.\n\n다시 만들까요?';
}
