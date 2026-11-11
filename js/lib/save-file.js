// === js/lib/save-file.js ===
// 결과 파일 저장 — 폴더를 한 번 고르면 그 폴더에 바로 쓰고(File System Access, 크롬·엣지),
// 못 쓰면(지원 안 함·고르기 취소·권한 거절) 브라우저 다운로드(a.download)로 받는다. 2026-11-10 플랫폼 출고 웹 이식.
//   고른 폴더 핸들은 remember({ get, put, del }) 에 남긴다(플랫폼 출고는 js/lib/ship-file-store.js IndexedDB) — 다음에 다시 안 묻는다.
//   같은 이름 파일은 덮어쓴다(옛 Python 판도 출력 폴더에 같은 이름으로 덮어썼다).
// 권한 요청(requestPermission·showDirectoryPicker)은 사용자 클릭 안에서만 된다 → 무거운 처리 전에 prepare() 를 먼저 부른다.
// window 는 넘겨받을 수 있다(시험). 테스트: tests/save-file.test.js

/**
 * @param {{ win?: object, remember?: { get(k): Promise<any>, put(k, v): Promise<any>, del(k): Promise<any> } | null, key?: string, pickerId?: string }} o
 */
export function createSaver({ win = globalThis.window, remember = null, key = 'outDir', pickerId = 'ggs-ship-out' } = {}) {
    let dir = null;          // FileSystemDirectoryHandle
    let mode = 'unset';      // 'unset' | 'folder' | 'download'
    let restored = false;

    const supportsFolder = () => !!win && typeof win.showDirectoryPicker === 'function' && win.isSecureContext !== false;

    async function restore() {
        if (restored) return;
        restored = true;
        if (!remember || !supportsFolder()) return;
        try {
            const h = await remember.get(key);
            if (h && typeof h.getFileHandle === 'function') { dir = h; mode = 'folder'; }
        } catch (_) { /* 못 읽으면 처음처럼 */ }
    }

    async function permission(h, ask) {
        if (!h || typeof h.queryPermission !== 'function') return 'granted';   // 옛 구현: 권한 함수 없음
        let p = await h.queryPermission({ mode: 'readwrite' });
        if (p === 'prompt' && ask && typeof h.requestPermission === 'function') p = await h.requestPermission({ mode: 'readwrite' });
        return p;
    }

    /** 폴더 고르기(사용자 클릭 안에서). 고르면 true, 취소·지원 안 함이면 false */
    async function chooseFolder() {
        if (!supportsFolder()) { mode = 'download'; return false; }
        try {
            const h = await win.showDirectoryPicker({ id: pickerId, mode: 'readwrite' });
            dir = h; mode = 'folder';
            if (remember) { try { await remember.put(key, h); } catch (_) { /* 기억 못 해도 이번엔 쓴다 */ } }
            return true;
        } catch (e) {
            if (!dir) mode = 'download';   // 취소(AbortError) — 이번 창에서는 다운로드로
            return false;
        }
    }

    /** 무거운 처리 전에(클릭 안에서) — 폴더가 없으면 한 번 묻고, 권한이 '물어봄' 이면 지금 받는다 */
    async function prepare() {
        await restore();
        if (mode === 'unset') { await chooseFolder(); return; }
        if (mode === 'folder' && dir) {
            try {
                const p = await permission(dir, true);
                if (p !== 'granted') mode = 'download';
            } catch (_) { mode = 'download'; }
        }
    }

    function download(name, bytes, mime) {
        const doc = win.document;
        const blob = new win.Blob([bytes], { type: mime || 'application/octet-stream' });
        const url = win.URL.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = url;
        a.download = name;
        a.style.display = 'none';
        doc.body.appendChild(a);
        a.click();
        a.remove();
        win.setTimeout(() => win.URL.revokeObjectURL(url), 60000);
    }

    /** 묻지 않고 바로 저장할 수 있나(클릭 밖 — 끌어다 놓기로 저절로 시작할 때). 폴더를 아직 안 골랐거나 권한을 물어야 하면 false */
    async function ready() {
        await restore();
        if (!supportsFolder() || mode === 'download') return true;
        if (mode !== 'folder' || !dir) return false;
        try { return (await permission(dir, false)) === 'granted'; } catch (_) { return false; }
    }

    /** 저장 → { how: 'folder'|'download', folder: 폴더 이름|'' } */
    async function save(name, bytes, mime) {
        await restore();
        if (mode === 'folder' && dir) {
            try {
                if (await permission(dir, false) === 'granted') {
                    const fh = await dir.getFileHandle(name, { create: true });
                    const w = await fh.createWritable();
                    await w.write(bytes);
                    await w.close();
                    return { how: 'folder', folder: dir.name || '' };
                }
            } catch (_) { /* 폴더에 못 쓰면 다운로드로 */ }
        }
        download(name, bytes, mime);
        return { how: 'download', folder: '' };
    }

    /** 고른 폴더를 잊는다(다음 prepare 때 다시 묻는다) */
    async function forget() {
        dir = null; mode = 'unset';
        if (remember) { try { await remember.del(key); } catch (_) { /* 무시 */ } }
    }

    return {
        supportsFolder, restore, chooseFolder, prepare, ready, save, forget,
        get mode() { return mode; },
        get folderName() { return mode === 'folder' && dir ? (dir.name || '') : ''; },
    };
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const XLS_MIME = 'application/vnd.ms-excel';
export const mimeOf = (name) => (/\.xls$/i.test(String(name)) ? XLS_MIME : XLSX_MIME);
