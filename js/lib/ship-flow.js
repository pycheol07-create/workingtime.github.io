// === js/lib/ship-flow.js ===
// 플랫폼 출고 화면의 흐름 표시줄(#sp-flow)·다음 할 일(#sp-next) — 2026-11-12. 순수 모듈(화면은 js/ship.js).
//   ① 출고요청 → ② 이지어드민에 재고출고용 올리기(웹 밖) → ③ 출고전표 → ④ 완료
//   상태: done(끝남) · now(지금) · todo(아직) · unknown(모름 — 새로고침 뒤 2단계면 ①② 를 이 화면이 알 수 없다)
// 테스트: tests/ship-flow.test.js

export const FLOW_STEPS = Object.freeze([
    { id: 'request', label: '출고요청' },
    { id: 'upload', label: '이지어드민에 재고출고용 올리기', outside: true },
    { id: 'admin', label: '출고전표' },
    { id: 'done', label: '완료' },
]);
export const FLOW_MARK = ['①', '②', '③', '④'];
const NAME = { zikjin: '직진배송', ably: '에이블리' };
const OUT = { zikjin: '출고리스트·피킹지시서', ably: '대량입고·피킹지시서' };

/**
 * @param {object} p
 * @param {'zikjin'|'ably'} p.tab
 * @param {1|2} p.step           지금 고른 단계
 * @param {string|null} p.step1Result  이번에(새로고침 전) 이 탭 1단계를 마쳤으면 그 결과 파일 이름, 아니면 null
 * @param {boolean} p.step2Done  이번에 이 탭 2단계를 마쳤고 그 뒤 칸이 바뀌지 않았나
 * @param {boolean} p.step1Done  지금 1단계 칸 그대로 1단계를 마쳤나(1단계 화면에 머물러 있을 때)
 * @param {string[]} p.missing   지금 단계에 아직 없는 필수 파일 제목
 * @param {boolean} p.hasAdmin   2단계 출고전표 칸이 찼나
 * @returns {{ steps: Array<{id, label, mark, state, outside?}>, next: string }}
 */
export function flowState({ tab, step, step1Result = null, step2Done = false, step1Done = false, missing = [], hasAdmin = false } = {}) {
    const nm = NAME[tab] || '';
    let st, next;
    if (step === 2 && step2Done) {
        st = [step1Result ? 'done' : 'unknown', step1Result ? 'done' : 'unknown', 'done', 'done'];
        next = `끝났습니다 — 아래 결과 카드에서 파일을 확인하세요. 다음 묶음은 새 ${nm} 출고요청을 놓으면 됩니다.`;
    } else if (step === 1) {
        if (step1Done && step1Result) {
            st = ['done', 'now', 'todo', 'todo'];
            next = uploadText(step1Result);
        } else {
            st = ['now', 'todo', 'todo', 'todo'];
            next = missing.length
                ? `${nm} 출고요청 파일을 놓으세요 — 1단계(이지어드민 업로드용 재고출고용)를 바로 만듭니다.`
                : '[만들기]를 누르면 1단계 재고출고용 파일을 만듭니다.';
        }
    } else if (step1Result && !hasAdmin) {
        st = ['done', 'now', 'todo', 'todo'];
        next = uploadText(step1Result);
    } else {
        const s12 = step1Result ? 'done' : 'unknown';
        st = [s12, s12, 'now', 'todo'];
        if (!hasAdmin) next = `이지어드민에서 받은 ${nm} 출고전표를 놓으세요.`;
        else if (missing.length) next = `더 넣을 파일: ${missing.join(', ')}`;
        else next = `[만들기]를 누르면 2단계(${OUT[tab] || ''})를 만듭니다.`;
    }
    return {
        steps: FLOW_STEPS.map((s, i) => ({ ...s, mark: FLOW_MARK[i], state: st[i] })),
        next,
    };
}

function uploadText(name) {
    return `1단계 결과 파일 '${name}'을 이지어드민에 올린 뒤, 받은 출고전표를 여기에 놓으세요.`;
}

// ── 칸 정리(#sp-fold) ─────────────────────────────────────────
export const TEMPLATE_OLD_DAYS = 30;   // 원본을 넣은 지 이만큼 지나면 노란 안내

/** ISO 시각 → 한국 날짜로 며칠 전(0 = 오늘). 못 읽으면 null */
export function daysAgo(iso, now = new Date()) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return null;
    const day = (t) => Math.floor((t + 9 * 3600000) / 86400000);
    return Math.max(0, day(now.getTime()) - day(ms));
}

/**
 * 모든 칸이 찼거나 기본값이면 접는다(하나라도 비면 펼침).
 * @param {Array<{title: string, file: boolean, isDefault?: boolean, ageDays?: number|null}>} slots
 * @returns {{ fold: boolean, text: string }}  text 예: '✓ 출고전표 · ✓ 원본(이 PC 기억, 3일 전) · ✓ 출고요청'
 */
export function foldState(slots) {
    const list = slots || [];
    const fold = list.length > 0 && list.every(s => s.file || s.isDefault);
    const text = list.map(s => {
        if (!s.file && s.isDefault) return `✓ ${s.title}(앱 기본)`;
        if (!s.file) return `· ${s.title} 없음`;
        if (s.ageDays !== null && s.ageDays !== undefined) return `✓ ${s.title}(이 PC 기억, ${s.ageDays === 0 ? '오늘' : `${s.ageDays}일 전`})`;
        return `✓ ${s.title}`;
    }).join(' · ');
    return { fold, text };
}
