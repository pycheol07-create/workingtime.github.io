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
 * @param {boolean} [p.auto]     통합 화면(2026-11-12) — 다음 할 일을 '위 상자에 놓기' 말투로(칸 이름·탭 이름 대신). 기존 방식(개별 선택)은 false
 * @param {boolean} [p.needTemp] 직진 출고리스트 양식 준비 중이라 2단계에 원본(임시)이 필요하고 아직 안 넣었나(통합 안내용)
 * @returns {{ steps: Array<{id, label, mark, state, outside?}>, next: string }}
 */
export function flowState({ tab, step, step1Result = null, step2Done = false, step1Done = false, missing = [], hasAdmin = false, auto = false, needTemp = false } = {}) {
    const st = flowStates({ tab, step, step1Result, step2Done, step1Done, hasAdmin });
    const next = auto ? autoNext({ tab, step, step1Result, step2Done, step1Done, missing, hasAdmin, needTemp })
        : legacyNext({ tab, step, step1Result, step2Done, step1Done, missing, hasAdmin });
    return {
        steps: FLOW_STEPS.map((s, i) => ({ ...s, mark: FLOW_MARK[i], state: st[i] })),
        next,
    };
}

function flowStates({ step, step1Result, step2Done, step1Done, hasAdmin }) {
    if (step === 2 && step2Done) return [step1Result ? 'done' : 'unknown', step1Result ? 'done' : 'unknown', 'done', 'done'];
    if (step === 1) return step1Done && step1Result ? ['done', 'now', 'todo', 'todo'] : ['now', 'todo', 'todo', 'todo'];
    if (step1Result && !hasAdmin) return ['done', 'now', 'todo', 'todo'];
    const s12 = step1Result ? 'done' : 'unknown';
    return [s12, s12, 'now', 'todo'];
}

/** 통합 화면 다음 할 일 — 파일은 늘 위 상자에 놓는다(칸·탭은 숨김). 출고요청을 기다리는 처음 화면은 큰 상자가 말하므로 빈 글 */
export const AUTO_TEMP_ASK = '직진배송 출고리스트 양식 준비 중 — 직진배송출고리스트 원본 파일도 같이 놓아 주세요(이 PC 안에서만 쓰고 저장하지 않음).';
const TEMP_ASK = AUTO_TEMP_ASK;
function autoNext({ tab, step, step1Result, step2Done, step1Done, missing, hasAdmin, needTemp }) {
    if (step === 2 && step2Done) return '끝났습니다 — 아래 결과 카드에서 파일을 확인하세요. 다음 묶음은 새 출고요청을 위 상자에 놓으면 됩니다.';
    if (step === 1) {
        if (step1Done && step1Result) return `1단계 결과 파일 '${step1Result}'을 이지어드민에 올린 뒤, 받은 출고전표를 위 상자에 놓으세요.${needTemp ? ` ${TEMP_ASK}` : ''}`;
        return missing.length ? '' : '[만들기]를 누르면 1단계 재고출고용 파일을 만듭니다.';
    }
    if (step1Result && !hasAdmin) return `1단계 결과 파일 '${step1Result}'을 이지어드민에 올린 뒤, 받은 출고전표를 위 상자에 놓으세요.${needTemp ? ` ${TEMP_ASK}` : ''}`;
    if (!hasAdmin) return `이지어드민에서 받은 출고전표를 위 상자에 놓으세요.${needTemp ? ` ${TEMP_ASK}` : ''}`;
    if (needTemp) return TEMP_ASK;
    if (missing.length) return `더 넣을 파일: ${missing.join(', ')} — 위 상자에 같이 놓아 주세요.`;
    return `[만들기]를 누르면 2단계(${OUT[tab] || ''})를 만듭니다.`;
}

/** 기존 방식(개별 선택) 다음 할 일 — 고른 쪽 칸에 넣는 말투(2026-11-12 까지와 같음) */
function legacyNext({ tab, step, step1Result, step2Done, step1Done, missing, hasAdmin }) {
    const nm = NAME[tab] || '';
    let next;
    if (step === 2 && step2Done) {
        next = `끝났습니다 — 아래 결과 카드에서 파일을 확인하세요. 다음 묶음은 새 ${nm} 출고요청을 놓으면 됩니다.`;
    } else if (step === 1) {
        if (step1Done && step1Result) next = uploadText(step1Result);
        else {
            next = missing.length
                ? `${nm} 출고요청 파일을 놓으세요 — 1단계(이지어드민 업로드용 재고출고용)를 바로 만듭니다.`
                : '[만들기]를 누르면 1단계 재고출고용 파일을 만듭니다.';
        }
    } else if (step1Result && !hasAdmin) {
        next = uploadText(step1Result);
    } else if (!hasAdmin) next = `이지어드민에서 받은 ${nm} 출고전표를 놓으세요.`;
    else if (missing.length) next = `더 넣을 파일: ${missing.join(', ')}`;
    else next = `[만들기]를 누르면 2단계(${OUT[tab] || ''})를 만듭니다.`;
    return next;
}

function uploadText(name) {
    return `1단계 결과 파일 '${name}'을 이지어드민에 올린 뒤, 받은 출고전표를 여기에 놓으세요.`;
}

// ── 화면 방식 — 2026-11-12 사용자 요청 ────────────────────
//   auto   = 통합(자동 인식, 늘 이것으로 연다): 파일을 놓으면 직진·에이블리와 단계를 알아보고(ship-assign.routeFiles) 탭·단계를 옮기고 저절로 [만들기]
//   zikjin = 개별 선택 직진배송 · ably = 개별 선택 에이블리 (머리줄 [개별 선택]으로 고를 때만 — 2026.11.12c 합치기 전 c018fd1 과 같은 동작):
//            고른 쪽의 1·2단계 칸만 보이고, 파일을 놓으면 지금 단계 칸에만 넣는다(탭·단계를 안 옮기고 저절로 시작 안 함).
//            다른 쪽 파일은 경고만(ship-assign.assignFiles 의 screen 안내).
//   만들기·저장·전송·봉 수·오늘 묶음 합산·[묶음 빼기]는 두 방식이 같은 코드(js/ship.js run·transmit)를 쓴다 — 방식은 화면만 바꾼다.
//   방식은 기억하지 않는다(2026-11-12 사용자 요청 '기본 통합창만'). 예전에 기억해 둔 값(localStorage MODE_STORE_KEY)은 화면을 열 때 지운다.
export const SHIP_MODES = Object.freeze(['auto', 'zikjin', 'ably']);
export const MODE_LABEL = Object.freeze({ auto: '통합', zikjin: '직진배송', ably: '에이블리' });
export const MODE_STORE_KEY = 'ggsShipMode';   // 옛 기억 자리 — 읽지 않고 지우기만

/** 값 → 방식(모르는 값·없음 → 'auto') */
export const loadMode = (raw) => (SHIP_MODES.includes(raw) ? raw : 'auto');

/**
 * 방식 → 화면 모양
 * @returns {{ mode, auto: boolean, tab: 'zikjin'|'ably'|null, showIntake: boolean, showTabs: boolean, autoRoute: boolean, autoRun: boolean }}
 *   tab: 기존 방식이면 고정 탭, 통합이면 null(지금 탭 그대로)
 */
export function modeView(mode) {
    const m = loadMode(mode);
    const auto = m === 'auto';
    return { mode: m, auto, tab: auto ? null : m, showIntake: auto, showTabs: auto, autoRoute: auto, autoRun: auto };
}

/** 방식을 바꿀 때 탭 — 기존 방식이면 그 탭, 통합이면 지금 탭 그대로 */
export const tabForMode = (mode, curTab) => modeView(mode).tab || (curTab === 'ably' ? 'ably' : 'zikjin');

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
