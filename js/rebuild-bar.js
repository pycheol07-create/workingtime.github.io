// === js/rebuild-bar.js ===
// 로케이션관리 대시보드 머리줄 [지금 재고로 다시 만들기] — 채우기 지시서·변경 추천을 한 번에 다시 만들게 요청한다(2026-10-27).
//   예전 카드별 버튼(채우기 카드 · 변경 추천 카드 · 변경 추천 표 창) 세 개를 이 버튼 하나로 합쳤다. 카드에는 상태 문구만 남는다.
//   처리는 사무실 PC 예약작업 채우기요청(채우기자동화\채우기.py --요청확인, 5분): 이지어드민 재고를 한 번 받아 채우기 → 변경 추천.
//   요청은 가진 권한 쪽 문서 하나에 쓴다 — 채우기 권한(location.refill)이 있으면 refillWork/request, 없으면 locRecWork/request
//   (firestore.rules: refillWork = location.refill · locRecWork = location.locrec). 서버는 두 문서 중 늦은 쪽을 요청으로 본다.
//   버튼은 두 권한 중 하나라도 있으면 보이고, 권한 있는 쪽 중 하나라도 다시 만들 수 있으면 켜진다(js/lib/rebuild-view.js).
// 구독은 가볍게 — 색인 문서(refillLatest · locRecLatest, 권한 있는 쪽만) · 요청 문서 2개 · Locations/INFO_CONFIG.
//   카드 store(refill-store·locrec-store)는 쓰지 않는다(그날 지시서·추천 문서까지 읽게 되므로).
// ⚠️ Firebase 를 여기서 초기화하지 않는다 — location.js 가 만든 db·auth 를 받아 쓴다.
// ⚠️ 요청에 남기는 이름은 getMemberName()(= memberNameFor, 직원 이름)만. 없으면 '이름 없음' — 이메일은 쓰지 않는다.
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getHolidayName } from './utils.js?v=202610270959';
import { tsMs, dayKey, runDay, reqUi } from './lib/refill-view.js?v=202610270959';
import { recReqUi } from './lib/locrec-view.js?v=202610270959';
import { combinedReqUi, confirmText, requestPathOf, laterMs, REFILL_REQUEST, LOCREC_REQUEST } from './lib/rebuild-view.js?v=202610270959';

const APP = 'artifacts/team-work-logger-v2';
const REFILL_LATEST = `${APP}/integrations/refillLatest`;
const LOCREC_LATEST = `${APP}/integrations/locRecLatest`;
const INFO_PATH = 'Locations/INFO_CONFIG';
const NO_NAME = '이름 없음';
const READ_ERR = Object.freeze({ readErr: true });       // 색인 문서를 못 읽음(권한·통신)
const holidayName = (y, m, d) => getHolidayName(y, m, d);

let mounted = null;

/** 한 탭에 한 번. → { setPerms({canRefill, canLocrec}), render() }. 버튼·문구 요소가 없으면 null */
export function initRebuildBar({ db, auth, getMemberName }) {
    if (mounted) return mounted;
    const btn = document.getElementById('rebuild-btn');
    const noteEl = document.getElementById('rebuild-note');
    if (!btn || !db || !auth) return null;

    const S = { signedIn: false, perms: { canRefill: false, canLocrec: false },
                refill: null, locrec: null, refillReq: null, locrecReq: null, lastDataMs: 0 };
    let unsubs = [], snapKey = '', busy = false;

    const nameOf = () => {
        try { const n = getMemberName && getMemberName(); return (typeof n === 'string' && n.trim()) ? n.trim().slice(0, 20) : NO_NAME; }
        catch (e) { return NO_NAME; }
    };

    function stopSnaps() {
        unsubs.forEach(u => { try { u(); } catch (e) { /* 무시 */ } });
        unsubs = [];
        snapKey = '';
        S.refill = null; S.locrec = null; S.refillReq = null; S.locrecReq = null; S.lastDataMs = 0;
    }

    function watch(path, onData, onErr) {
        unsubs.push(onSnapshot(doc(db, path), snap => { onData(snap); render(); },
            () => { onErr(); render(); }));
    }

    // 로그인·권한이 바뀔 때만 다시 구독한다
    function syncSnaps() {
        const { canRefill, canLocrec } = S.perms;
        const key = S.signedIn && (canRefill || canLocrec) ? `${canRefill ? 'r' : ''}${canLocrec ? 'l' : ''}` : '';
        if (key === snapKey) return;
        stopSnaps();
        if (!key) return;
        snapKey = key;
        if (canRefill) watch(REFILL_LATEST, s => { S.refill = s.exists() ? (s.data() || {}) : {}; }, () => { S.refill = READ_ERR; });
        if (canLocrec) watch(LOCREC_LATEST, s => { S.locrec = s.exists() ? (s.data() || {}) : {}; }, () => { S.locrec = READ_ERR; });
        const reqOf = (s) => (s.exists() ? (s.data({ serverTimestamps: 'estimate' }) || {}) : null);
        watch(`${APP}/${REFILL_REQUEST}`, s => { S.refillReq = reqOf(s); }, () => { S.refillReq = null; });
        watch(`${APP}/${LOCREC_REQUEST}`, s => { S.locrecReq = reqOf(s); }, () => { S.locrecReq = null; });
        watch(INFO_PATH, s => { S.lastDataMs = s.exists() ? tsMs((s.data() || {}).lastDataUpdate) : 0; }, () => { S.lastDataMs = 0; });
    }

    /** 두 쪽 상태(못 읽었으면 null)와 합친 버튼 상태 */
    function state() {
        const today = dayKey(Date.now()), now = Date.now();
        const requestMs = laterMs(tsMs(S.refillReq && S.refillReq.requestedAt), tsMs(S.locrecReq && S.locrecReq.requestedAt));
        let refill = null, locrec = null;
        const errUi = { show: true, enabled: false, label: '', note: '상태를 읽지 못했습니다 — 새로고침해 보세요', tone: 'warn' };
        if (S.refill === READ_ERR) refill = errUi;
        else if (S.refill) {
            const e = (S.refill.days && S.refill.days[today]) || null;
            refill = reqUi({ req: S.refill.req, requestMs, nowMs: now, isToday: true, todayKey: today,
                             isRunDay: runDay(today, S.refill.schedule, holidayName).run,
                             board: !!(e && e.status === 'ok'), lastDataMs: S.lastDataMs, basedAtMs: e && e.basedAt });
        }
        if (S.locrec === READ_ERR) locrec = errUi;
        else if (S.locrec) {
            locrec = recReqUi({ req: S.locrec.req, requestMs, nowMs: now, isToday: true,
                                entry: (S.locrec.days && S.locrec.days[today]) || null, lastDataMs: S.lastDataMs,
                                stockDataMs: S.locrec.stockDataAt, todayKey: today });
        }
        const args = { refill, locrec, ...S.perms };
        return { args, ui: combinedReqUi(args), today };
    }

    let lastKey = '';
    function render() {
        const { ui } = S.signedIn ? state() : { ui: { show: false, enabled: false, label: '', note: '', tone: '' } };
        const k = `${ui.show}|${ui.enabled && !busy}|${ui.label}|${ui.note}|${ui.tone}`;
        if (k === lastKey) return;                 // 같으면 다시 그리지 않는다(누르던 포커스가 1분마다 풀리지 않게)
        lastKey = k;
        btn.hidden = !ui.show;
        btn.disabled = !ui.enabled || busy;
        if (ui.label) btn.textContent = ui.label;
        btn.title = '사무실 PC 프로그램이 지금 이지어드민 재고로 채우기 지시서와 변경 추천을 새로 만듭니다(앱에만, 슬랙 없음)';
        if (noteEl) {
            noteEl.hidden = !(ui.show && ui.note);
            noteEl.textContent = ui.note || '';
            noteEl.title = ui.note || '';   // 한 줄로 잘려 보일 때 전체 문구
            noteEl.classList.toggle('is-warn', ui.tone === 'warn');
            noteEl.classList.toggle('is-accent', ui.tone === 'accent');
        }
    }

    btn.addEventListener('click', async () => {
        if (busy || !S.signedIn) return;
        const { args, ui, today } = state();
        const path = requestPathOf(S.perms);
        if (!ui.enabled || !path) { render(); return; }
        if (!confirm(confirmText(args))) return;
        busy = true; render();
        try {
            await setDoc(doc(db, `${APP}/${path}`), { requestedAt: serverTimestamp(), by: nameOf(), day: today });
        } catch (e) {
            alert(`요청하지 못했습니다(${(e && e.code) || '오류'}).`);
        } finally {
            busy = false; lastKey = ''; render();
        }
    });

    auth.onAuthStateChanged(user => {
        S.signedIn = !!user;
        syncSnaps();
        lastKey = ''; render();
    });
    // 시간에 따라 바뀌는 문구(처리 대기 15분·간격 끝·18:50 마감·자정)를 1분마다
    setInterval(() => { if (S.signedIn) render(); }, 60 * 1000);

    function setPerms({ canRefill, canLocrec }) {
        S.perms = { canRefill: !!canRefill, canLocrec: !!canLocrec };
        syncSnaps();
        lastKey = ''; render();
    }

    render();
    mounted = { setPerms, render };
    return mounted;
}
