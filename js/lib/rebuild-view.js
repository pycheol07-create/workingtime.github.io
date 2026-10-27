// === js/lib/rebuild-view.js ===
// 로케이션관리 대시보드 머리줄 [지금 재고로 다시 만들기](js/rebuild-bar.js)의 순수 함수 — node --test 대상.
//   버튼 하나가 '채우기 지시서'와 '변경 추천'을 같이 다시 만들게 한다(2026-10-27, 예전엔 카드마다 버튼).
//   사무실 PC 예약작업 채우기요청(채우기.py --요청확인, 5분)이 이지어드민 재고를 한 번 받아 채우기 → 변경 추천 순으로 만든다.
//   요청은 가진 권한 쪽 문서 하나에 쓴다(requestPathOf) — 서버(두 앱의 앱기록.read_request)는 두 문서 중 늦은 쪽을 요청으로 본다.
//   각 쪽 상태는 refill-view.js reqUi · locrec-view.js recReqUi 가 정하고, 여기서는 합치기만 한다.

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

/**
 * 두 쪽 상태 → 머리줄 버튼 { show, enabled, label, note, tone('' | accent | warn) }
 *   refill / locrec = reqUi · recReqUi 결과(못 읽었으면 null) · canRefill / canLocrec = 권한
 *   보임: 권한이 하나라도 있으면. 켬: 권한 있는 쪽 중 하나라도 다시 만들 수 있으면.
 *   문구: 권한 있는 쪽 중 문구가 있는 것만 '채우기: … · 변경 추천: …'. 못 읽은 쪽은 '불러오는 중…'.
 *   tone: 하나라도 warn 이면 warn, 아니면 accent 가 있으면 accent.
 */
export function combinedReqUi({ refill, locrec, canRefill, canLocrec }) {
    const label = REBUILD_LABEL;
    if (!canRefill && !canLocrec) return { show: false, enabled: false, label, note: '', tone: '' };
    const parts = [];
    if (canRefill) parts.push(['refill', refill]);
    if (canLocrec) parts.push(['locrec', locrec]);
    const enabled = parts.some(([, u]) => !!(u && u.show && u.enabled));
    const notes = [];
    let warn = false, accent = false;
    for (const [k, u] of parts) {
        if (!u) { notes.push(`${PART_LABEL[k]}: 불러오는 중…`); continue; }
        if (!u.show) continue;
        if (u.tone === 'warn') warn = true;
        else if (u.tone === 'accent') accent = true;
        if (u.note) notes.push(`${PART_LABEL[k]}: ${u.note}`);
    }
    return { show: true, enabled, label, note: notes.join(' · '), tone: warn ? 'warn' : (accent ? 'accent' : '') };
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
