// === js/locrec-dash.js ===
// 대시보드(index.html) '로케이션 동선관리' 업무 카드의 [변경추천] 버튼 → 로케이션 변경 추천 표 창.
//   데이터·표 창은 로케이션관리와 같은 js/locrec-store.js · js/locrec-table.js(처음 누를 때 동적 import).
//   권한: 기능 location.locrec(js/lib/feature-catalog.js). 로케이션관리 메뉴 권한이 없어도 이 기능만 있으면 쓴다.
// 💰 구독은 창이 열려 있는 동안만 — 열 때 store.start(), 닫을 때 store.stop(). 대시보드에 상시 구독을 두지 않는다(채우기와 다름).
// ⚠️ 업무를 시작해도 창을 저절로 열지 않는다(사용자 요청) — 버튼으로만 연다. listeners-main-board 의 시작 위임에 넣지 않는다.
// ⚠️ Firebase 를 새로 만들지 않는다 — index 의 State.db · State.auth 를 넘긴다. 표시에 남는 이름은 memberNameFor(직원 이름)만.
// ⚠️ 창에는 role="dialog" · data-act 를 쓰지 않는다(업무마감봇 화면 보호 — js/locrec-table.js).
import * as State from './state.js?v=202610261142';
import { showToast } from './utils.js?v=202610261142';
import { can } from './lib/perm.js?v=202610261142';
import { LOCREC_TASK } from './lib/feature-catalog.js?v=202610261142';
import { memberNameFor } from './app-shell-data.js?v=202610261142';

export const isLocRecTask = (task) => task === LOCREC_TASK;
export const locRecAllowed = () => can(State.appState.perm, 'location.locrec');

let mods = null;        // { store, table } — 처음 누를 때 만든다
let loading = null;

async function load() {
    if (mods) return mods;
    if (!loading) {
        loading = Promise.all([import('./locrec-store.js?v=202610261142'), import('./locrec-table.js?v=202610261142')]).then(([s, t]) => {
            const store = s.getLocRecStore({
                db: State.db, auth: State.auth,
                getMemberName: () => memberNameFor(State.appConfig && State.appConfig.memberEmails,
                    State.auth && State.auth.currentUser && State.auth.currentUser.email)
            });
            const table = t.mountLocRecTable({ store });
            table.onClose(() => store.stop());      // 닫으면 구독 해제
            mods = { store, table };
            return mods;
        }).catch(e => { loading = null; throw e; });
    }
    return loading;
}

/** 보드를 그린 뒤 부른다. present = 화면에 '로케이션 동선관리' 카드가 있고 권한이 있음. 없어졌는데 창이 열려 있으면 닫는다(구독도 해제) */
export function syncLocRecDash(present) {
    if (!mods) return;
    if (!(present && locRecAllowed()) && mods.table.isOpen()) mods.table.close();
}

/** [변경추천] 버튼. 열 때만 문서를 구독한다 */
export async function openLocRecFromDash() {
    if (!locRecAllowed() || !State.db || !State.auth) return;
    let m;
    try { m = await load(); }
    catch (e) { console.warn('[locrec] 모듈을 불러오지 못했습니다', e); showToast('변경 추천을 열지 못했습니다. 새로고침해 주세요.', true); return; }
    m.store.start();        // 여러 번 불러도 한 번만 구독
    m.table.open();
}
