// === js/busy-banner.js ===
// '갱신 중·업로드 중' 띠 — 다른 사람(또는 자동화)이 이지어드민 자료를 새로 읽거나 재고 파일을 올리는 중이면
// 내 화면에도 같이 보여 준다(2026-10-20 사용자 요구). 판정은 js/lib/busy-view.js(순수), 모양은 css/busy-banner.css.
//
//   mountBusyBanner({ db, el, sources, onState })   경로마다 onSnapshot 1개 + 30초마다 다시 판정. 해제 함수를 돌려준다.
//       sources: [{ path, kind:'lease'|'upload'|'mibalRequest', myRunId?:()=>string, latest?:()=>doc|null }]
//       extra:   () => [항목]   페이지가 이미 구독 중인 자료로 만든 항목(예: mibal2Latest '방금 갱신됨')
//       onState: (views) => {}  { [kind]: 판정 } — 버튼 잠금 등 페이지 쪽 반영용
//       돌려준 함수에 .refresh() — 페이지가 extra 자료를 바꿨을 때 다시 그린다
//   createUploadStatus({ db, path, kind, getName })  업로드하는 쪽이 계약 B 문서를 쓴다
//       begin(kind) → {ok,runId}|{busy}(트랜잭션 — 남이 진행 중이면 안 씀) · end(ok) · checkOthers() → 남의 진행 중 판정|null · confirmIfUploading(작업명) → true|false
//
// ⚠️ Firebase 를 새로 초기화하지 않는다 — 페이지의 db 를 받는다.
// ⚠️ 쓰기는 best-effort — 실패해도 업로드를 막지 않는다(console.warn 만).
// ⚠️ 띠는 role="status" — role="dialog"·data-act 는 쓰지 않는다(업무마감봇·업무예상알림 선택자). index.html 에는 넣지 않는다.
// ⚠️ 띠·문서에 이메일을 넣지 않는다. 이름은 memberNameFor 결과만(busy-view.js cleanBy 가 '@' 섞인 값을 버린다).
import { doc, onSnapshot, getDocFromServer, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { leaseView, uploadView, mibalRequestView, bannerText, bannerKey, cleanBy, fmtHM, BY_MAX } from './lib/busy-view.js?v=202610291113';

const RECHECK_MS = 30 * 1000;
const BEAT_MS = 60 * 1000;

const dataOf = (snap) => (snap && snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : null);

/** 띠 붙이기. el 이 없으면 아무것도 안 하고 빈 해제 함수를 돌려준다. */
export function mountBusyBanner({ db, el, sources = [], extra = null, onState = null } = {}) {
    const noop = () => {};
    noop.refresh = noop;
    if (!db || !el) return noop;
    el.classList.add('busy-banner');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="busy-banner-text"></span><button type="button" class="busy-banner-x" aria-label="띠 닫기" title="닫기(상태가 바뀌면 다시 보입니다)">×</button>';
    const textEl = el.querySelector('.busy-banner-text');
    let hiddenKey = null;      // × 로 숨긴 때의 상태 서명 — 바뀌면 다시 보인다
    let lastKey = '';
    el.querySelector('.busy-banner-x').addEventListener('click', (e) => {
        e.stopPropagation();
        hiddenKey = lastKey;
        el.hidden = true;
    });

    const docs = sources.map(() => null);
    const render = () => {
        const now = Date.now();
        const views = {};
        const items = [];
        sources.forEach((s, i) => {
            const d = docs[i];
            let v = null;
            if (s.kind === 'lease') v = leaseView(d, now);
            else if (s.kind === 'upload') v = uploadView(d, now, typeof s.myRunId === 'function' ? s.myRunId() : '');
            else if (s.kind === 'mibalRequest') v = mibalRequestView(d && d.requestedAt, typeof s.latest === 'function' ? s.latest() : null, now);
            views[s.kind] = v;
            if (v) items.push(v);
        });
        if (typeof extra === 'function') {
            try { for (const it of (extra(now) || [])) if (it) items.push(it); } catch (e) { console.warn('[띠] extra 오류:', e); }
        }
        const text = bannerText(items);
        lastKey = bannerKey(items);
        if (!text) { el.hidden = true; textEl.textContent = ''; hiddenKey = null; }
        else {
            textEl.textContent = text;
            el.classList.toggle('busy-banner-done', !items.some(it => it.active && !it.mine));
            if (hiddenKey !== null && hiddenKey !== lastKey) hiddenKey = null;
            el.hidden = hiddenKey !== null;
        }
        if (typeof onState === 'function') { try { onState(views); } catch (e) { console.warn('[띠] onState 오류:', e); } }
    };

    const unsubs = sources.map((s, i) => onSnapshot(doc(db, s.path), (snap) => { docs[i] = dataOf(snap); render(); },
        (err) => { console.warn('[띠] 구독 실패:', s.kind, err && err.code); docs[i] = null; render(); }));
    const timer = setInterval(render, RECHECK_MS);
    render();
    const stop = () => { clearInterval(timer); unsubs.forEach(u => { try { u(); } catch (e) { /* 무시 */ } }); el.hidden = true; };
    stop.refresh = render;
    return stop;
}

/** 12자 hex */
function newRunId() {
    const b = new Uint8Array(6);
    (globalThis.crypto || window.crypto).getRandomValues(b);
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** 업로드 진행 표시(계약 B) — 업로드하는 브라우저가 쓴다. */
export function createUploadStatus({ db, path, kind = '', getName = null } = {}) {
    const ref = db && path ? doc(db, path) : null;
    let timer = null;
    const api = {
        runId: '',          // 마지막으로 시작한 내 runId(끝난 뒤에도 남긴다 — 내 '방금 끝남'을 띠에서 빼는 데 쓴다)
        running: false,
        /**
         * 시작 표시(트랜잭션) → { ok:true, runId } | { busy: 남의 진행 중 판정 }.
         * 남의 running 이 아직 유효하면 쓰지 않고 busy 를 돌려준다 — 두 사람이 확인창을 동시에 눌러도 한쪽만 통과.
         * 내 마지막 runId 의 running(내 업로드가 실패해 남은 것)은 막지 않는다(checkOthers 와 같은 기준).
         * opts.force — 남이 진행 중이어도 쓴다(확인창에서 이미 '계속'을 고른 경우).
         * 기록 자체가 실패하면(오프라인·권한) 막지 않는다 — { ok:true, runId, error }.
         */
        async begin(k = kind, { force = false } = {}) {
            if (!ref) return { ok: true, runId: '' };
            api.stopBeat();
            const prevId = api.runId;
            const myId = newRunId();
            let by = '';
            try { by = cleanBy(typeof getName === 'function' ? (getName() || '') : '').slice(0, BY_MAX); } catch (e) { by = ''; }
            let busy = null, error = '';
            try {
                busy = await runTransaction(db, async (tx) => {
                    const s = await tx.get(ref);
                    if (!force) {
                        const v = uploadView(dataOf(s), Date.now(), prevId);
                        if (v && v.active && !v.mine) return v;
                    }
                    tx.set(ref, { schema: 1, state: 'running', kind: k || kind, by, runId: myId,
                                  since: serverTimestamp(), beatAt: serverTimestamp(), endAt: null });
                    return null;
                });
            } catch (e) {
                error = (e && e.code) || 'error';
                console.warn('[업로드 표시] 시작 기록 실패:', error);
            }
            if (busy) return { busy };
            api.runId = myId;
            api.running = true;
            timer = setInterval(() => { api._mineUpdate(myId, { beatAt: serverTimestamp() }, '신호'); }, BEAT_MS);
            return error ? { ok: true, runId: myId, error } : { ok: true, runId: myId };
        },
        /** 끝 표시 — done/failed. 문서가 이미 다른 사람 것이면 건드리지 않는다. */
        end(ok) {
            api.stopBeat();
            if (!ref || !api.running) return Promise.resolve();
            api.running = false;
            return api._mineUpdate(api.runId, { state: ok ? 'done' : 'failed', endAt: serverTimestamp(), beatAt: serverTimestamp() }, '끝 기록');
        },
        stopBeat() { if (timer) { clearInterval(timer); timer = null; } },
        /** 문서 runId 가 내 것일 때만 고친다(트랜잭션) */
        _mineUpdate(myId, patch, what) {
            return runTransaction(db, async (tx) => {
                const s = await tx.get(ref);
                if (!s.exists() || s.data().runId !== myId) return;
                tx.update(ref, patch);
            }).catch(e => console.warn(`[업로드 표시] ${what} 실패:`, e && e.code));
        },
        /** 남이 지금 올리는 중이면 그 판정, 아니면 null(못 읽어도 null — 막지 않는다) */
        async checkOthers() {
            if (!ref) return null;
            try {
                // 마지막 내 runId 는 늘 넘긴다 — 내 업로드가 실패해 running 이 남아도 내가 막히지 않게
                const v = uploadView(dataOf(await getDocFromServer(ref)), Date.now(), api.runId);
                return v && v.active && !v.mine ? v : null;
            } catch (e) {
                console.warn('[업로드 표시] 확인 실패:', e && e.code);
                return null;
            }
        },
        /** 남이 올리는 중이면 확인창(기본 취소). 아니면 true. */
        async confirmIfUploading(jobName) {
            const v = await api.checkOthers();
            if (!v) return true;
            const by = cleanBy(v.by);
            return confirm(`${by ? `${by}님이` : '다른 사람이'} ${fmtHM(v.sinceMs)}부터 ${v.label}입니다(마지막 신호 ${fmtHM(v.beatMs)}).\n`
                + `끝나기 전에 「${jobName || '이 작업'}」 작업을 하면 올리는 중인 자료와 섞일 수 있습니다.\n\n그래도 계속할까요?`);
        }
    };
    return api;
}
