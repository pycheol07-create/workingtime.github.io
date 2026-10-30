// === js/ship-auto-sync.js ===
// 처리량 자동 입력(앱\처리량자동입력)이 오늘 아침에 넣은 값 — 대시보드 '오늘 업무 처리량' 카드가 진행률에서 뺄 때 쓴다(2026-10-30).
//   아침 자동 입력값(직진·에이블리 = 앞 근무일 전송 수량, 중국제작 = 오늘 도착 입고, 국내배송 = 계획 예상값)은
//   '오늘 처리할 양'이지 '처리한 양'이 아니다. 그대로 실적으로 보면 아침부터 100% 가 된다.
//   저녁 창(17:20~17:40)이 쓴 값은 실제값이라 진행률에 넣는다 — 그래서 phase '아침' 만 고른다.
//   ⚠️ 저녁 확인값이 아침값과 같으면 스크립트가 다시 쓰지 않아 phase 가 '아침'으로 남는다(직진·에이블리·중국제작은 대개 같다).
//      그래서 저녁 창이 끝난 뒤(AUTO_UNTIL_MIN 이후)에는 아침 기록도 무시한다. 일이 끝난 업무는 화면 쪽(paceRowView)이 따로 본다.
// 문서: integrations/shipTransmit.applied[YYYY-MM-DD][업무 id] = { name, value, phase, action, … }(자동화 스크립트만 쓴다, 직원 읽기)
// 이름·값만 읽는다. 구독은 한 번, 로그아웃 때 unsubscribeShipAuto 로 푼다(js/app.js).
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as State from './state.js?v=202610301725';
import { getTodayDateString } from './utils.js?v=202610301725';
import { canonicalTaskName } from './lib/task-ids.js?v=202610301725';

const AUTO_UNTIL_MIN = 17 * 60 + 40;   // 처리량자동입력 저녁 창 끝(설정.json windows.저녁) — 이 뒤엔 칸 값을 실적으로 본다

let unsub = null;
let applied = {};            // { 'YYYY-MM-DD': { 업무id: { name, value, phase } } }
const listeners = new Set();

export function subscribeShipAuto(onChange) {
    if (onChange) listeners.add(onChange);
    if (unsub || !State.db) return;
    try {
        unsub = onSnapshot(doc(State.db, 'artifacts', 'team-work-logger-v2', 'integrations', 'shipTransmit'), (snap) => {
            const a = snap.exists() ? (snap.data() || {}).applied : null;
            applied = a && typeof a === 'object' ? a : {};
            listeners.forEach(fn => { try { fn(); } catch (e) {} });
        }, (e) => {
            // 리스너가 끊겼다(권한·네트워크) — 다음에 그릴 때 다시 구독하게 비운다
            console.warn('[처리량 카드] 자동 입력 기록 구독 실패:', e && e.code);
            unsub = null;
            applied = {};
        });
    } catch (e) {
        console.warn('[처리량 카드] 자동 입력 기록 구독을 시작하지 못했습니다:', e && e.code);
        unsub = null;
    }
}

export function unsubscribeShipAuto() {
    if (unsub) { try { unsub(); } catch (e) {} }
    unsub = null;
    applied = {};
}

/** 오늘 아침 자동 입력값 — { 지금 업무명: 값 }. 저녁 창이 끝났거나 없거나 못 읽었으면 {} (= 칸 값을 그대로 실적으로 본다) */
export function morningAutoToday(now = new Date()) {
    if (now.getHours() * 60 + now.getMinutes() >= AUTO_UNTIL_MIN) return {};
    const day = applied[getTodayDateString()];
    const out = {};
    if (!day || typeof day !== 'object') return out;
    Object.values(day).forEach(e => {
        if (e && e.phase === '아침' && e.name && Number.isFinite(Number(e.value))) {
            out[canonicalTaskName(String(e.name), State.appConfig)] = Number(e.value);
        }
    });
    return out;
}
