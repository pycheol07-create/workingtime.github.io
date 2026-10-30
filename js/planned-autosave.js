// === js/planned-autosave.js ===
// 데이터관리 > 예정 물량 — ① 입력창 자동 저장 ② 화면에 있는 동안 plannedData 실시간 구독.
//
// ① 자동 저장 (history-list-controller.js openPlannedQuantityModal 이 연다)
//   칸을 고치면 약 1초 뒤 **바뀐 칸만** plannedData/{날짜} 에 merge 로 쓴다([저장]을 안 눌러도 된다).
//   0 은 0 으로 저장(그 날 그 업무 0 확정), 빈칸은 그 업무 키를 지운다(자동 추정값으로 돌아감 — lib/planned-fields.js).
//   입력값은 칸을 칠 때 메모리에 담아 둔다 — 창이 닫히거나 다른 날짜 창으로 다시 그려져도 남은 저장을 보낼 수 있게.
//   창 닫기(×·Esc·[닫기])·화면 이동(onBeforeLeaveSave)·탭 숨김 때 남은 저장을 바로 보낸다.
//   실패하면 입력값은 그대로 두고 '저장 실패 — 다시 시도' 를 보인다(창이 이미 닫혔으면 데이터관리 화면일 때만 다시 연다).
//   시간 초과는 실패와 나눈다 — Firestore 가 오프라인 대기열에 담아 연결되면 보내므로 창을 다시 열지 않고 안내만 한다.
//   ⚠️ 창 안에 role=dialog·data-act 를 붙이지 않는다 — 업무마감봇·업무예상알림이 자기 확인창으로 읽는다.
// ② 실시간 구독 — 데이터관리 화면에 있는 동안만. 다른 화면의 10분 캐시(fetchPlannedData)는 그대로다.

import * as State from './state.js?v=202610301315';
import { getTodayDateString, getCurrentTime, showToast } from './utils.js?v=202610301315';
import { putPlannedLocal } from './history-data-manager.js?v=202610301315';
import { plannedFieldOp, plannedMergePayload, applyPlannedOps, normPlanned } from './lib/planned-fields.js?v=202610301315';
import { onBeforeLeaveSave } from './app-shell-bridge.js?v=202610301315';
import {
    doc, setDoc, deleteField, collection, query, where, documentId, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DEBOUNCE_MS = 1000;
const WRITE_TIMEOUT_MS = 10000;   // 오프라인이면 setDoc 이 끝나지 않는다 — 10초면 실패로 보이고 다시 시도하게 한다

const plannedDocRef = (dateStr) => doc(State.db, 'artifacts', 'team-work-logger-v2', 'plannedData', dateStr);

/** 바뀐 칸만 merge 로 쓴다. 문서가 없으면 만든다. */
const writePlannedFields = (dateStr, ops) => {
    const payload = {
        ...plannedMergePayload(ops, deleteField()),
        updatedAt: getCurrentTime(),
        updatedBy: State.appState?.currentUser || 'unknown'
    };
    const write = setDoc(plannedDocRef(dateStr), payload, { merge: true });
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), WRITE_TIMEOUT_MS);
    });
    return Promise.race([write, timeout]).finally(() => clearTimeout(timer));
};

// ---------------------------------------------------------------- ① 자동 저장

let session = null;
let modalObserver = null;

const isPlannedContext = (dateStr) => {
    const c = State.context.quantityModalContext || {};
    return c.mode === 'planned' && c.dateKey === dateStr;
};

const quantityModal = () => document.getElementById('quantity-modal');

class PlannedAutosave {
    constructor({ dateStr, container, statusEl, initial, skipTasks, onSaved }) {
        this.dateStr = dateStr;
        this.container = container;
        this.statusEl = statusEl;
        this.onSaved = onSaved;
        this.skip = new Set(skipTasks || []);
        this.lastSaved = {};                       // 업무 → 마지막 저장값(0 이상). 키 없음 = null
        Object.entries(initial || {}).forEach(([k, v]) => { this.lastSaved[k] = normPlanned(v); });
        this.pending = new Map();                  // 업무 → { raw, bad, ver }
        this.ver = 0;
        this.timer = null;
        this.inflight = null;
        this.savedAt = null;
        this.onInput = this.onInput.bind(this);
        if (container) container.addEventListener('input', this.onInput);
    }

    detach() {
        if (this.container) this.container.removeEventListener('input', this.onInput);
        this.container = null;
    }

    onInput(e) {
        const input = e.target;
        if (!input || input.type !== 'number' || !input.dataset || !input.dataset.task) return;
        if (input.readOnly || this.skip.has(input.dataset.task)) return;   // 전송값 칸(읽기 전용)은 저장하지 않는다
        if (!isPlannedContext(this.dateStr)) return;                        // 같은 창을 다른 모드가 쓰는 중
        this.pending.set(input.dataset.task, {
            raw: input.value,
            bad: !!(input.validity && input.validity.badInput),
            ver: ++this.ver
        });
        this.schedule();
    }

    schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; this.flush(false); }, DEBOUNCE_MS);
    }

    markInvalid(task, on) {
        const input = this.container && isPlannedContext(this.dateStr) && document.getElementById(`modal-quantity-${task}`);
        if (!input) return;
        input.classList.toggle('border-red-500', on);
        if (on) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
    }

    setStatus(kind, extra = '') {
        const el = this.statusEl;
        // 창이 다른 모드(처리량 수정 등)·다른 날짜로 바뀐 뒤 끝난 저장은 상태 줄을 건드리지 않는다
        if (!el || session !== this || !isPlannedContext(this.dateStr)) return;
        el.classList.remove('hidden', 'text-gray-500', 'text-red-600', 'text-emerald-700');
        if (kind === 'error' || kind === 'timeout') {
            el.classList.add('text-red-600');
            el.innerHTML = (kind === 'timeout' ? '저장 지연(연결되면 자동 전송) — ' : '저장 실패 — ')
                + '<button type="button" class="planned-autosave-retry underline font-bold">다시 시도</button>';
            el.querySelector('.planned-autosave-retry')?.addEventListener('click', () => this.flush());
            return;
        }
        if (kind === 'invalid') {
            el.classList.add('text-red-600');
            el.textContent = `0 이상 정수만 저장됩니다: ${extra}`;
            return;
        }
        el.classList.add(kind === 'saved' ? 'text-emerald-700' : 'text-gray-500');
        el.textContent = kind === 'saving' ? '저장 중…'
            : kind === 'saved' ? `저장됨 ${this.savedAt || ''}`.trim()
            : '고치면 자동으로 저장됩니다';
    }

    /** 남은 저장을 바로 보낸다 → 'ok' | 'invalid' | 'error' | 'timeout'.
     *  drain: 저장 중에 또 고친 칸까지 이어서 보낸다(닫기·이동). 1초 타이머는 false — 새로 고친 칸은 자기 타이머가 있다. */
    async flush(drain = true) {
        clearTimeout(this.timer);
        this.timer = null;
        while (this.inflight) { try { await this.inflight; } catch (_) { } }   // 저장은 한 번에 하나만
        if (this.pending.size === 0) return 'ok';   // 실패·숫자 오류면 그 칸이 pending 에 남아 있다
        this.inflight = this.save().finally(() => { this.inflight = null; });
        const r = await this.inflight;
        // 저장 중에 또 고친 칸이 있으면 이어서 보낸다(숫자 오류·실패면 멈춘다)
        if (drain && r === 'ok' && this.pending.size) return this.flush(true);
        return r;
    }

    async save() {
        const ops = [];
        const sentVer = {};
        const badTasks = [];
        this.pending.forEach((p, task) => {
            const op = plannedFieldOp(p.raw, p.bad, this.lastSaved[task]);
            if (!op.ok) { badTasks.push(task); this.markInvalid(task, true); return; }
            this.markInvalid(task, false);
            if (!op.changed) { this.pending.delete(task); return; }
            ops.push({ task, value: op.value });
            sentVer[task] = p.ver;
        });
        if (ops.length === 0) {
            if (badTasks.length) { this.setStatus('invalid', badTasks.join(', ')); return 'invalid'; }
            this.setStatus(this.savedAt ? 'saved' : 'idle');
            return 'ok';
        }
        this.setStatus('saving');
        try {
            await writePlannedFields(this.dateStr, ops);
        } catch (e) {
            console.error('예정 물량 자동 저장 실패:', e && (e.code || e.message));
            const kind = e && e.code === 'timeout' ? 'timeout' : 'error';
            this.setStatus(kind);
            return kind;
        }
        ops.forEach(o => {
            this.lastSaved[o.task] = o.value;   // null = 키 지움
            const p = this.pending.get(o.task);
            if (p && p.ver === sentVer[o.task]) this.pending.delete(o.task);   // 저장 중에 또 고친 칸은 남긴다
        });
        const rec = (State.plannedData || []).find(d => d.id === this.dateStr);
        putPlannedLocal(this.dateStr, applyPlannedOps(rec, this.dateStr, ops));
        this.savedAt = getCurrentTime();
        try { this.onSaved && this.onSaved(); } catch (e) { console.warn('예정 물량 목록 갱신 실패:', e); }
        if (badTasks.length) { this.setStatus('invalid', badTasks.join(', ')); return 'invalid'; }
        this.setStatus('saved');
        return 'ok';
    }
}

// 창이 어떤 길로 닫히든(×·Esc·[닫기]) 남은 저장을 보낸다.
//   저장 실패 → 데이터관리 화면(#history-modal)이 보일 때만 입력값이 남은 그 창을 다시 연다(상태 줄에 [다시 시도]).
//   시간 초과 → 안내만(Firestore 오프라인 대기열이 연결되면 보낸다).
//   숫자 오류 → 알리기만 한다(그 칸은 저장 안 됨). 다시 열면 닫을 길이 없어 보이므로 가두지 않는다.
const watchModalClose = () => {
    const modal = quantityModal();
    if (modalObserver || !modal || typeof MutationObserver !== 'function') return;
    modalObserver = new MutationObserver(() => {
        const s = session;
        if (!s || !modal.classList.contains('hidden')) return;
        if (s.pending.size === 0 && !s.inflight) return;
        s.flush().then(r => {
            if (r === 'ok') return;
            if (r === 'invalid') {
                showToast(`예정 물량 일부를 저장하지 않았습니다(0 이상 정수만): ${s.dateStr}`, true);
                return;
            }
            if (r === 'timeout') {
                showToast(`${s.dateStr} 예정 물량 저장이 늦어지고 있습니다 — 연결되면 자동으로 보냅니다.`, true);
                return;
            }
            showToast(`${s.dateStr} 예정 물량을 저장하지 못했습니다 — 창을 다시 열어 확인해 주세요.`, true);
            const hm = document.getElementById('history-modal');
            if (!hm || hm.classList.contains('hidden')) return;
            if (session !== s || !isPlannedContext(s.dateStr) || !modal.classList.contains('hidden')) return;
            modal.classList.remove('hidden');   // 입력값이 남은 창을 다시 보여 준다(상태 줄에 [다시 시도])
        });
    });
    modalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
};

/** 예정 물량 창을 열 때 — 입력칸을 그린 뒤 부른다. 앞 창에 남은 저장이 있으면 먼저 보낸다. */
export const startPlannedAutosave = (opts) => {
    if (session) { const old = session; old.detach(); old.flush(); }
    session = new PlannedAutosave(opts);
    session.setStatus('idle');
    watchModalClose();
    return session;
};

/** 남은 저장을 바로 보낸다 → 'ok' | 'invalid' | 'error' | 'timeout'. 창이 없으면 'ok'. */
export const flushPlannedAutosave = () => (session ? session.flush() : Promise.resolve('ok'));

// 화면 이동·탭 숨김·닫기 — 남은 저장만(없으면 바로 끝난다)
onBeforeLeaveSave(() => (session ? session.flush() : undefined));
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && session) session.flush();
    });
}
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { if (session) session.flush(); });
}

// ---------------------------------------------------------------- ② 실시간 구독

let unsubLive = null;
let liveOnChange = null;

/** 데이터관리 화면에 들어올 때 — 오늘 이후 plannedData 를 구독해 로컬 사본·10분 캐시를 갱신하고 onChange 를 부른다. */
export const startPlannedLive = (onChange) => {
    liveOnChange = onChange || liveOnChange;
    if (unsubLive || !State.db || !State.auth || !State.auth.currentUser) return;
    const today = getTodayDateString();
    const q = query(collection(State.db, 'artifacts', 'team-work-logger-v2', 'plannedData'), where(documentId(), '>=', today));
    unsubLive = onSnapshot(q, (snap) => {
        const changes = snap.docChanges();
        if (!changes.length) return;
        // 서버 문서 전체로 바꾼다 — forecastSnapshot·plannedTimeTasks 등 다른 칸도 문서에 있는 그대로 남는다
        changes.forEach(ch => {
            if (ch.type === 'removed') putPlannedLocal(ch.doc.id, null);
            else putPlannedLocal(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
        });
        try { liveOnChange && liveOnChange(); } catch (e) { console.warn('예정 물량 목록 갱신 실패:', e); }
    }, (err) => {
        console.warn('예정 물량 구독 실패:', err && err.code);
        unsubLive = null;
    });
};

/** 데이터관리 화면을 떠날 때. */
export const stopPlannedLive = () => {
    if (unsubLive) { try { unsubLive(); } catch (_) { } }
    unsubLive = null;
};

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => stopPlannedLive());
    // 뒤로가기로 돌아온 화면(bfcache)이면 다시 구독한다 — 데이터관리 본체가 보일 때만
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted || !liveOnChange) return;
        const hm = document.getElementById('history-modal');
        if (hm && !hm.classList.contains('hidden')) startPlannedLive();
    });
}
