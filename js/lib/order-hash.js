// === js/lib/order-hash.js ===
// 페어 추천 주문 업로드 — 처리한 주문(ProcessedOrders) 문서 ID 를 주문번호 원문 대신 해시로. 2026-10-14 보안점검
//
//   orderKey(주문번호) = SHA-256( ORDER_KEY_PREFIX + trim(주문번호) ) 의 소문자 hex 64자.
//   주문번호 원문은 Firestore·콘솔·화면 어디에도 남기지 않는다 — 같은 주문인지 비교만 한다.
// ⚠️ 접두어·정규화는 앱\보안점검\주문번호_해시이전.py 와 같아야 한다(테스트로 교차 확인). 바꾸면 이미 쌓인 해시와 안 맞는다.
// 순수 모듈 — 브라우저·Node(18+) 모두 globalThis.crypto.subtle 사용.

export const ORDER_KEY_PREFIX = 'ggsing-pair-v1:';

/** 주문번호 정규화 — 앞뒤 공백만 뗀다(업로드 그룹화와 같은 기준) */
export const normOrderNo = (v) => String(v ?? '').trim();

/** 해시 ID 모양(소문자 hex 64자)인가 — 원문 ID 문서와 구분할 때 */
export const isOrderKey = (id) => /^[0-9a-f]{64}$/.test(String(id ?? ''));

/** 주문번호 → 해시 ID */
export async function orderKey(orderNo) {
    const data = new TextEncoder().encode(ORDER_KEY_PREFIX + normOrderNo(orderNo));
    const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 여러 주문번호 → Map(원문 → 해시 ID). 원문은 메모리에서만 쓴다 */
export async function orderKeyMap(orderNos) {
    const list = [...new Set((orderNos || []).map(normOrderNo).filter(Boolean))];
    const keys = await Promise.all(list.map(orderKey));
    return new Map(list.map((o, i) => [o, keys[i]]));
}
