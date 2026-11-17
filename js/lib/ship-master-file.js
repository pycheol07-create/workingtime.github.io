// === js/lib/ship-master-file.js ===
// 직진배송 원본(직진배송출고ver.5 — 시즌·공장상품명) 파일 위치 기억(2026-11-17 사용자 결정: 위치를 기억하고 매번 최신본을 읽는다).
//   File System Access(크롬·엣지) showOpenFilePicker 로 한 번 고르면 파일 핸들을 remember(js/lib/ship-file-store.js IndexedDB)에 둔다.
//   만들 때마다 그 핸들로 권한을 확인하고(물어봄이면 사용자 클릭 안에서만 requestPermission — permit) getFile() 로 지금 내용을 읽는다(read).
//   화면은 클릭 권한 시간 안에 permit → 저장 폴더 권한 → read 순으로 부른다(js/ship.js run).
//   permit·read·state 때마다 저장소의 핸들을 다시 읽는다 — 다른 탭에서 [바꾸기] 한 원본을 따른다.
//   파일 내용(바이트)은 저장하지 않는다 — 핸들·이름·마지막으로 읽은 시각만. 지원 안 함·거절·옮김/지움이면 state 로 알리고,
//   화면은 그때 파일을 놓아(드롭·선택) 이번만 쓰게 한다(기억 안 함 — js/ship.js).
// window 는 넘겨받을 수 있다(시험). 테스트: tests/ship-master-file.test.js

export const KEY_MASTER = 'zikjinMasterHandle';
export const MASTER_PICKER_ID = 'ggs-ship-master';

// state: 'unsupported'(이 브라우저는 위치 기억 못 함) · 'none'(아직 안 고름) · 'ok'(읽을 수 있음) · 'prompt'(클릭으로 허용 필요)
//        'denied'(거절) · 'gone'(파일을 못 찾음 — 옮기거나 지움) · 'error'(그 밖에 못 읽음)
export const MASTER_STATE_TEXT = Object.freeze({
    unsupported: '이 브라우저는 파일 위치를 기억하지 못함',
    none: '원본 파일을 아직 고르지 않음',
    ok: '읽을 수 있음',
    prompt: '이 브라우저에서 읽기 허용이 필요함',
    denied: '읽기를 허용하지 않음',
    gone: '파일을 찾지 못함(옮기거나 지움)',
    error: '파일을 읽지 못함',
});

const PICK_TYPES = [{
    description: '직진배송출고리스트 원본(엑셀)',
    accept: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
        'application/vnd.ms-excel': ['.xls'],
    },
}];

/** 파일 읽기 오류 → state */
export function stateOfError(e) {
    const n = e && e.name;
    if (n === 'NotFoundError') return 'gone';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'denied';
    return 'error';
}

/**
 * @param {{ win?: object, remember?: { get(k), put(k, v), del(k) } | null, key?: string, now?: () => Date }} o
 */
export function createMasterFile({ win = globalThis.window, remember = null, key = KEY_MASTER, now = () => new Date() } = {}) {
    let rec = null;          // { handle: FileSystemFileHandle, name, pickedAt, readAt }
    let restored = false;
    let last = null;         // 마지막 읽기 실패 state('gone'|'error'|'denied') — 다시 고르거나 읽으면 지움

    const supported = () => !!win && typeof win.showOpenFilePicker === 'function' && win.isSecureContext !== false;
    let detached = false;    // 저장소에 쓰지 못함 — 이 창의 것을 쓰고 저장소를 다시 읽지 않는다(옛 기억으로 되돌아가지 않게)
    const save = async () => {
        if (!remember || !rec) return;
        try { await remember.put(key, rec); detached = false; } catch (_) { detached = true; /* 기억 못 해도 이번 창에서는 쓴다 */ }
    };

    const valid = (r) => !!(r && r.handle && typeof r.handle.getFile === 'function');
    async function restore() {
        if (restored) return;
        restored = true;
        await sync();
    }
    /** 저장소의 기억을 다시 읽는다(다른 탭이 바꿨거나 지웠으면 따름). 저장소가 없거나 못 읽으면 지금 것 그대로 */
    async function sync() {
        if (!remember || !supported() || detached) return;
        let r;
        try { r = await remember.get(key); } catch (_) { return; }
        if (!valid(r)) { if (r === null || r === undefined) { rec = null; last = null; } return; }
        if (!rec || r.pickedAt !== rec.pickedAt) last = null;   // 다른 원본으로 바뀜 — 지난 읽기 실패는 잊음
        rec = r;
    }

    async function permission(ask) {
        const h = rec.handle;
        if (typeof h.queryPermission !== 'function') return 'granted';   // 옛 구현: 권한 함수 없음
        let p = await h.queryPermission({ mode: 'read' });
        if (p === 'prompt' && ask && typeof h.requestPermission === 'function') {
            try { p = await h.requestPermission({ mode: 'read' }); } catch (_) { p = 'prompt'; }   // 클릭 밖이면 브라우저가 거절(SecurityError)
        }
        return p;
    }

    /** 지금 상태(파일은 읽지 않음 — 권한만 본다) */
    async function state() {
        await restore();
        await sync();
        if (!supported()) return 'unsupported';
        if (!rec) return 'none';
        if (last) return last;
        try {
            const p = await permission(false);
            return p === 'granted' ? 'ok' : (p === 'denied' ? 'denied' : 'prompt');
        } catch (_) { return 'error'; }
    }

    /** 원본 고르기(사용자 클릭 안에서). 고르면 true, 취소·지원 안 함이면 false */
    async function choose() {
        if (!supported()) return false;
        let h;
        try {
            const r = await win.showOpenFilePicker({ id: MASTER_PICKER_ID, startIn: 'desktop', multiple: false, types: PICK_TYPES, excludeAcceptAllOption: false });
            h = r && r[0];
        } catch (_) {
            return false;   // 취소(AbortError) — 지금 기억은 그대로
        }
        if (!h || typeof h.getFile !== 'function') return false;
        rec = { handle: h, name: String(h.name || ''), pickedAt: now().toISOString(), readAt: '' };
        last = null;
        await save();
        return true;
    }

    /**
     * 권한만 확인·요청(내용은 읽지 않음) — ask: '물어봄'이면 지금 묻기(사용자 클릭 안에서만 됨).
     * @returns {Promise<'ok'|'prompt'|'denied'|'none'|'unsupported'|'gone'|'error'>}
     */
    async function permit({ ask = false } = {}) {
        await restore();
        await sync();
        if (!supported()) return 'unsupported';
        if (!rec) return 'none';
        try {
            const p = await permission(ask);
            return p === 'granted' ? 'ok' : (p === 'denied' ? 'denied' : 'prompt');
        } catch (e) { return stateOfError(e); }
    }

    /**
     * 지금 내용 읽기 — 권한을 먼저 본다(permit, ask 는 그대로 넘김).
     * @returns {Promise<{ ok: true, name, bytes: Uint8Array, size, lastModified } | { ok: false, state }>}
     */
    async function read({ ask = false } = {}) {
        const st = await permit({ ask });
        if (st !== 'ok') return { ok: false, state: st };
        try {
            const file = await rec.handle.getFile();
            const bytes = new Uint8Array(await file.arrayBuffer());
            last = null;
            rec = { ...rec, name: String(file.name || rec.name), readAt: now().toISOString() };
            await save();
            return { ok: true, name: rec.name, bytes, size: bytes.byteLength, lastModified: Number(file.lastModified) || 0 };
        } catch (e) {
            last = stateOfError(e);
            return { ok: false, state: last };
        }
    }

    /** 기억을 지운다(다음에 다시 고른다) */
    async function forget() {
        rec = null; last = null;
        if (remember) { try { await remember.del(key); } catch (_) { /* 무시 */ } }
    }

    return {
        supported, restore, state, permit, choose, read, forget,
        get remembered() { return !!rec; },
        get name() { return rec ? rec.name : ''; },
        get readAt() { return rec ? (rec.readAt || '') : ''; },
    };
}
