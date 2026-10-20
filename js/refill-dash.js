// === js/refill-dash.js ===
// 대시보드(index.html) '채우기' 업무 카드의 [지시서] 버튼·진행률 + 업무 시작 때 지시서 창 열기.
//   데이터·표 창은 로케이션관리와 같은 js/refill-store.js · js/refill-table.js(처음 필요할 때 동적 import).
//   권한: 기능 location.refill(js/lib/feature-catalog.js). 로케이션관리 메뉴 권한이 없어도 이 기능만 있으면 쓴다.
// 💰 구독은 '채우기' 카드가 화면에 있을 때만 켠다(syncRefillDash). 그날 지시서 문서(엑셀 base64 포함)는 store 가 rev 가 바뀔 때만 1회 읽는다.
// 카드는 30초마다 innerHTML 로 다시 그려진다 — 그릴 때는 refillProgressText() 로 마지막 값을 넣고, store 가 바뀌면 [data-refill-progress] 글자만 고친다.
// ⚠️ Firebase 를 새로 만들지 않는다 — index 의 State.db · State.auth 를 넘긴다. 체크에 남는 이름은 memberNameFor(직원 이름)만.
// ⚠️ 페이지를 열 때 저절로 창을 열지 않는다(업무마감봇 화면 보호). 창에는 role="dialog" · data-act 를 쓰지 않는다(refill-table.js).
import * as State from './state.js?v=202610201213';
import { showToast, getHolidayName } from './utils.js?v=202610201213';
import { can } from './lib/perm.js?v=202610201213';
import { REFILL_TASK } from './lib/feature-catalog.js?v=202610201213';
import { dayKey, dayStatus, dashProgress } from './lib/refill-view.js?v=202610201213';
import { memberNameFor } from './app-shell-data.js?v=202610201213';

export const isRefillTask = (task) => task === REFILL_TASK;
export const refillAllowed = () => can(State.appState.perm, 'location.refill');

let mods = null;        // { store, table } — 처음 필요할 때 만든다
let loading = null;
let active = false;     // 지금 구독 중인가(카드가 화면에 있음)
let last = dashProgress({ st: null });

const PROG_SEL = '[data-refill-progress]';

function compute(S, store) {
    if (!S || !S.signedIn || S.meta == null) return dashProgress({ st: null, err: S && S.metaErr });
    const today = dayKey(Date.now());
    const st = dayStatus({ meta: S.meta, key: today, todayKey: today, nowMs: Date.now(), holidayName: getHolidayName });
    const d = store.currentDay();
    return dashProgress({ st, parsed: d && d.key === today ? d.parsed : null, checkMap: S.work.checks, err: S.dayErr });
}

function paint() {
    document.querySelectorAll(PROG_SEL).forEach(el => {
        if (el.textContent !== last.text) el.textContent = last.text;
        el.dataset.tone = last.tone || '';
    });
}

async function load() {
    if (mods) return mods;
    if (!loading) {
        loading = Promise.all([import('./refill-store.js?v=202610201213'), import('./refill-table.js?v=202610201213')]).then(([s, t]) => {
            const store = s.getRefillStore({
                db: State.db, auth: State.auth, watchRequest: false,
                getMemberName: () => memberNameFor(State.appConfig && State.appConfig.memberEmails,
                    State.auth && State.auth.currentUser && State.auth.currentUser.email)
            });
            const table = t.mountRefillTable({ store });
            store.on(S => { last = compute(S, store); paint(); });
            mods = { store, table };
            return mods;
        }).catch(e => { loading = null; throw e; });
    }
    return loading;
}

/** 카드를 그릴 때 진행률 칸에 넣을 글자(마지막 값) */
export const refillProgressText = () => last.text;
export const refillProgressTone = () => last.tone || '';

/** 보드를 그린 뒤 부른다. present = 화면에 '채우기' 카드가 있고 권한이 있음 → 구독 켜기, 아니면 끄기 */
export function syncRefillDash(present) {
    const want = !!present && refillAllowed() && !!State.db && !!State.auth;
    if (want === active) { if (want) paint(); return; }
    active = want;
    if (want) {
        load().then(m => { if (active) { m.store.start(); paint(); } })
            .catch(e => { active = false; console.warn('[refill] 모듈을 불러오지 못했습니다', e); });
    } else if (mods) {
        mods.table.close();
        mods.store.stop();
        last = dashProgress({ st: null });
    }
}

/** 지시서가 읽힐 때까지(최대 ms) 기다린다 */
function waitMeta(store, ms) {
    const S = store.get();
    if (S.meta != null || S.metaErr) return Promise.resolve();
    return new Promise(res => {
        let off = null;
        const done = () => { clearTimeout(t); if (off) off(); res(); };
        const t = setTimeout(done, ms);
        off = store.on(s => { if (s.meta != null || s.metaErr) done(); });
    });
}

/** [지시서] 버튼 · 업무 시작 때. 오늘 지시서가 없거나 휴일이면 안내만 한다 */
export async function openRefillFromDash() {
    if (!refillAllowed()) return;
    let m;
    try { m = await load(); }
    catch (e) { showToast('채우기 지시서를 열지 못했습니다. 새로고침해 주세요.', true); return; }
    active = true; m.store.start();     // 여러 번 불러도 한 번만 구독. 카드 없이 불려도 동작하게 — 다음 보드 그리기(syncRefillDash)에서 정리된다
    await waitMeta(m.store, 6000);
    const S = m.store.get();
    if (S.metaErr) { showToast(`채우기 지시서 상태를 읽지 못했습니다(${S.metaErr}).`, true); return; }
    last = compute(S, m.store); paint();
    if (!last.open) { showToast(last.note || '오늘 채우기 지시서가 없습니다.'); return; }
    m.table.open();
}
