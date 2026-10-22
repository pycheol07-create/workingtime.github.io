// === js/lib/manual-access.js ===
// 매뉴얼(manual.html) — 첨부 파일 검사·열람 권한 계산. 2026-10-22
//   · 첨부: 실행 파일·스크립트·압축 파일을 막고 크기를 제한한다. 확장자 허용 목록 + 브라우저 MIME 검사.
//     올릴 때는 확장자로 정한 contentType 을 붙인다 — storage.rules 의 manuals/ 허용 목록과 같은 값이어야 한다.
//   · 열람: '지정 인원만' 은 이름(allowedMembers) 으로 고르지만 규칙은 이름을 모른다 →
//     이메일 목록(allowedEmails, 소문자)과 isPublic 을 같이 저장한다. firestore.rules manuals 읽기와 같은 판정.
// 순수 모듈(DOM/Firebase 의존 없음).

export const ATTACH_MAX_BYTES = 20 * 1024 * 1024;   // 첨부 파일당 20MB (storage.rules 와 같은 값)
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;    // 본문 이미지 10MB (storage.rules 와 같은 값)

// 본문 이미지 — 확장자 → 올릴 때 붙일 contentType. svg 는 스크립트를 담을 수 있어 뺀다.
const IMAGE_TYPES = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
};
// 브라우저가 알려 주는 이미지 MIME → 확장자(붙여넣기 이미지는 이름이 없거나 image.png 로 온다)
const IMAGE_EXT_BY_MIME = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
};

// 첨부 — 문서·엑셀·PDF·한글·이미지. 압축 파일(zip·rar·7z)은 실행 파일을 숨겨 들여올 수 있어 뺀다.
// 매크로가 들어가는 형식(xlsm·docm·pptm)도 뺀다.
const ATTACH_TYPES = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    hwp: 'application/x-hwp',
    hwpx: 'application/hwp+zip',
    txt: 'text/plain',
    ...IMAGE_TYPES,
};

/** manual.html 첨부 input 의 accept 값과 같은 목록(점 포함) */
export const ATTACH_ACCEPT = Object.keys(ATTACH_TYPES).map(e => '.' + e).join(', ');

// 확장자가 맞아도 브라우저가 이렇게 알려 주면 막는다(실행·스크립트·HTML·SVG·압축)
const BLOCKED_MIME = /(msdownload|msdos|ms-installer|x-msi|dosexec|executable|x-bat|x-sh\b|shellscript|javascript|ecmascript|vbscript|powershell|java-archive|android\.package|x-ms-shortcut|\bhta\b|text\/html|xhtml|svg|zip|rar|7z|x-tar|gzip)/i;

const extOf = (name) => {
    const s = String(name || '');
    const i = s.lastIndexOf('.');
    return i > 0 && i < s.length - 1 ? s.slice(i + 1).toLowerCase() : '';
};

const mb = (n) => Math.round(n / 1024 / 1024);

/**
 * 첨부 파일 검사.
 * @param {{name:string, size:number, type?:string}} file
 * @returns {{ok:true, ext:string, contentType:string} | {ok:false, reason:string}}
 */
export function checkAttachment(file) {
    if (!file) return { ok: false, reason: '파일이 없습니다.' };
    const ext = extOf(file.name);
    const type = String(file.type || '').toLowerCase();
    if (!ext || !Object.prototype.hasOwnProperty.call(ATTACH_TYPES, ext)) {
        return { ok: false, reason: `첨부할 수 없는 파일 형식입니다${ext ? ` (.${ext})` : ''}.\n문서·엑셀·PDF·한글·이미지 파일만 올릴 수 있습니다.\n(실행 파일·압축 파일은 보안상 올릴 수 없습니다)` };
    }
    // hwpx 는 속이 zip 이라 브라우저가 zip 으로 알려 주기도 한다 — 그 세 가지만 봐준다
    const hwpxZip = ext === 'hwpx' && /^application\/(hwp\+zip|zip|x-zip-compressed)$/.test(type);
    if (type && BLOCKED_MIME.test(type) && !hwpxZip) {
        return { ok: false, reason: '파일 확장자와 실제 형식이 맞지 않아 올릴 수 없습니다.\n(실행 파일·압축 파일은 보안상 올릴 수 없습니다)' };
    }
    if (IMAGE_TYPES[ext] && type && !type.startsWith('image/')) {
        return { ok: false, reason: '이미지 확장자인데 이미지 파일이 아닙니다. 다른 파일을 골라 주세요.' };
    }
    if (!(file.size > 0)) return { ok: false, reason: '빈 파일은 올릴 수 없습니다.' };
    if (file.size > ATTACH_MAX_BYTES) {
        return { ok: false, reason: `파일이 너무 큽니다 (${mb(file.size)}MB). 첨부는 파일당 ${mb(ATTACH_MAX_BYTES)}MB 까지입니다.` };
    }
    return { ok: true, ext, contentType: ATTACH_TYPES[ext] };
}

/**
 * 본문 이미지(붙여넣기·끌어놓기·이미지 버튼) 검사.
 * @param {{name?:string, size:number, type?:string}} file
 * @returns {{ok:true, ext:string, contentType:string} | {ok:false, reason:string}}
 */
export function checkInlineImage(file) {
    if (!file) return { ok: false, reason: '파일이 없습니다.' };
    const type = String(file.type || '').toLowerCase();
    let ext = IMAGE_EXT_BY_MIME[type] || '';
    if (!ext && !type) {
        const e = extOf(file.name);
        if (IMAGE_TYPES[e]) ext = e;
    }
    if (!ext) {
        return { ok: false, reason: '본문에는 PNG·JPG·GIF·WEBP·BMP 이미지만 넣을 수 있습니다.' };
    }
    if (!(file.size > 0)) return { ok: false, reason: '빈 이미지는 넣을 수 없습니다.' };
    if (file.size > IMAGE_MAX_BYTES) {
        return { ok: false, reason: `이미지가 너무 큽니다 (${mb(file.size)}MB). 본문 이미지는 ${mb(IMAGE_MAX_BYTES)}MB 까지입니다.` };
    }
    return { ok: true, ext, contentType: IMAGE_TYPES[ext] };
}

/**
 * 열람 지정 이름 목록 → 규칙이 보는 필드.
 *   이름은 memberEmails(이름 → 이메일)로 바꾼다. 이메일을 모르는 이름은 빠진다(그 사람은 못 본다 — 닫히는 쪽).
 *   이름 자리에 이메일이 들어 있으면(이름 없는 계정: manual.js currentUserName 대체값) 그대로 쓴다.
 * @returns {{isPublic:boolean, allowedEmails:string[]}}
 */
export function accessFieldsFor(allowedMembers, memberEmails) {
    const names = Array.isArray(allowedMembers) ? allowedMembers : [];
    if (names.length === 0) return { isPublic: true, allowedEmails: [] };
    const map = memberEmails && typeof memberEmails === 'object' ? memberEmails : {};
    const out = new Set();
    for (const n of names) {
        const raw = Object.prototype.hasOwnProperty.call(map, n) ? map[n] : (String(n).includes('@') ? n : '');
        const e = String(raw || '').trim().toLowerCase();
        if (e) out.add(e);
    }
    return { isPublic: false, allowedEmails: [...out].sort() };
}

/**
 * 관리자 화면에서 채울 필드 — 저장된 isPublic·allowedEmails 가 allowedMembers 로 계산한 값과 다르면 그 값, 같으면 null.
 *   옛 매뉴얼(필드 없음)·이메일이 바뀐 직원을 맞춘다.
 */
export function accessBackfillFor(item, memberEmails) {
    if (!item) return null;
    const want = accessFieldsFor(item.allowedMembers, memberEmails);
    const have = Array.isArray(item.allowedEmails) ? [...item.allowedEmails].sort() : null;
    const same = item.isPublic === want.isPublic && have !== null
        && have.length === want.allowedEmails.length && have.every((e, i) => e === want.allowedEmails[i]);
    return same ? null : want;
}

/**
 * 관리자 필드 맞춤(트랜잭션 안에서 서버 최신 문서로 계산) — 고칠 키만 담은 patch, 고칠 것이 없으면 null.
 *   isPublic·allowedEmails 를 allowedMembers 로 맞추고, author 에 대문자가 섞여 있으면 소문자로 바꾼다
 *   (직원 화면의 '내가 작성' 목록 쿼리는 원본·소문자 이메일로 묻는다 — 섞인 대소문자는 빠질 수 있다).
 */
export function backfillPatchFor(data, memberEmails) {
    if (!data) return null;
    const patch = { ...(accessBackfillFor(data, memberEmails) || {}) };
    if (typeof data.author === 'string' && data.author !== data.author.toLowerCase()) {
        patch.author = data.author.toLowerCase();
    }
    return Object.keys(patch).length ? patch : null;
}

/**
 * 열람 가능 — firestore.rules manuals 읽기와 같은 판정(+ 옛 문서용 이름 판정).
 *   관리자 · 공개 · 작성자(대소문자 무시) · 지정 이메일 · 지정 이름(옛 문서, 규칙이 막지 않는 동안만 의미 있음)
 * @param {object} item
 * @param {{isAdmin:boolean, email:string, name:string}} me  email 은 소문자
 */
export function canViewManual(item, me) {
    if (!item) return false;
    if (me.isAdmin) return true;
    const email = String(me.email || '').toLowerCase();
    if (email && String(item.author || '').toLowerCase() === email) return true;
    const names = Array.isArray(item.allowedMembers) ? item.allowedMembers : [];
    if (item.isPublic === true) return true;
    if (item.isPublic === undefined && names.length === 0) return true;   // 필드 생기기 전 공개 문서
    if (email && Array.isArray(item.allowedEmails) && item.allowedEmails.includes(email)) return true;
    return !!me.name && names.includes(me.name);
}

/** 여러 쿼리 결과를 합친다 — id 로 중복 제거, createdAt 없는 문서는 뺀다(예전 orderBy('createdAt') 와 같게), 최신순. */
export function mergeManualLists(lists) {
    const byId = new Map();
    for (const list of lists || []) for (const it of list || []) if (it && it.id && !byId.has(it.id)) byId.set(it.id, it);
    const ms = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (typeof t === 'number' ? t : NaN);
    return [...byId.values()]
        .filter(it => it.createdAt != null)
        .sort((a, b) => (ms(b.createdAt) || 0) - (ms(a.createdAt) || 0));
}
