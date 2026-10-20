// === js/lib/supplies-stock-check.js ===
// 비품관리 재고 패널 [재고 반영] 전 검사 — 순수 함수(DOM/Firebase 없음). js/supplies.js saveStock 이 쓴다.
// tests/supplies-stock-check.test.js 가 본다.
//
// 예전엔 수량 칸을 Number(v) || 0 으로 읽어, 실사(맞춤)에서 칸을 비워 두면 재고가 0 으로 저장됐다.
// 지금: 빈칸·숫자 아님은 오류(실사 포함), 실사로 0 을 맞추거나 크게 바뀌면 확인을 받는다.
// 입고·사용의 '0 이하 막기'와 '재고가 0보다 작아질 수 없음'은 supplies.js 가 그대로 한다.

/**
 * op: 'in'(입고) | 'out'(사용) | 'set'(실사), raw: 수량 칸 글자, before: 지금 재고(숫자)
 * 돌려주는 값: { error } — 저장 막음 / { confirm } — 확인창 문구 / {} — 그냥 저장
 */
export function checkStockAdjust({ op, raw, before } = {}) {
    const s = String(raw == null ? '' : raw).trim();
    const qty = Number(s);
    if (s === '' || !Number.isFinite(qty)) return { error: '수량을 입력해주세요.' };

    const prev = Number(before) || 0;
    const after = op === 'in' ? prev + qty : (op === 'out' ? prev - qty : qty);
    if (op === 'set' && after === 0 && prev > 0) {
        return { confirm: `재고를 0으로 맞춥니다(현재 ${prev}).\n계속할까요?` };
    }
    const diff = after - prev;
    // 큰 변화 확인은 실사(덮어쓰기)만 — 입고·사용은 한 번에 많이 들어오고 나가는 게 보통이다(2026-10-20)
    if (op === 'set' && prev > 0 && Math.abs(diff) >= prev * 0.5 && Math.abs(diff) >= 10) {
        return { confirm: `현재 ${prev} → ${after} (${diff > 0 ? '+' : '-'}${Math.abs(diff)})\n계속할까요?` };
    }
    return {};
}
