// === js/lib/approval-logic.js ===
// 기안서(approval.html, 2026-11-05) 순수 함수 — 양식 정리·검사, 상태 전이표, 저장할 칸 만들기, 인쇄 축소 단계.
// 설계: architect 확정안(2026-11-05) 2·3·7절. DOM·Firebase 의존 없음(테스트: tests/approval-logic.test.js).
//
// 저장 위치(최상위 컬렉션 — artifacts 밑은 전원 읽기라 금지)
//   ApprovalForms/{formId}  양식(관리자만 씀). 코드 기본값 DEFAULT_FORMS 와 id 로 합친다(저장본 우선).
//   ApprovalDocs/{autoId}   기안서. 본인 + 관리자만 읽는다(firestore.rules).
// ⚠️ build* 가 돌려주는 칸 = firestore.rules ApprovalDocs 의 hasOnly 목록(AUTHOR_KEYS·ADMIN_KEYS·CREATE_KEYS)과 같아야 한다.
//    한쪽만 바꾸면 저장이 규칙에 막힌다. history 는 배열이라 serverTimestamp 를 못 넣는다 → at 은 브라우저 시각(참고용).
//    공식 시각은 submittedAt·authorStamp.at·decision.at(서버 시각, 규칙이 request.time 과 같은지 본다).

export const FIELD_TYPES = ['text', 'textarea', 'date', 'time', 'select'];
export const BOX_ROLES = ['author', 'approver', 'blank'];
export const PREFILLS = ['day', 'tardyTime', 'tardyKind'];   // 근태사유서: 발생일 → 그날 지각 기록(읽기만)을 빈 칸에
export const KEY_RE = /^[a-z0-9_]{1,20}$/;
export const MAX_FIELDS = 20;
export const MAX_BOXES = 3;
export const MAX_OPTIONS = 20;
export const HISTORY_MAX = 30;
export const COMMENT_MAX = 500;
const DEFAULT_MAX = { text: 200, textarea: 2000, date: 10, time: 5, select: 40 };

export const STATUS = { draft: '임시저장', submitted: '결재 대기', approved: '승인', rejected: '반려' };
export const STATUS_ORDER = ['submitted', 'draft', 'rejected', 'approved'];

// 규칙(firestore.rules ApprovalDocs)과 같은 목록
export const CREATE_KEYS = ['v', 'formId', 'form', 'authorEmail', 'authorName', 'status', 'values', 'createdAt', 'updatedAt',
    'submittedAt', 'authorStamp', 'decision', 'approverStamp', 'history'];
export const AUTHOR_KEYS = ['values', 'status', 'updatedAt', 'submittedAt', 'authorStamp', 'history'];
export const ADMIN_KEYS = ['status', 'decision', 'approverStamp', 'updatedAt', 'history'];

const BOXES_DEFAULT = [{ label: '기안', role: 'author' }, { label: '결재', role: 'approver' }];
const fd = (key, label, type, extra = {}) => ({ key, label, type, required: false, ...extra });

export const DEFAULT_FORMS = [
    {
        id: 'attendance', v: 1, title: '근태사유서', order: 1, active: true, intro: '',
        pledge: '위와 같은 사유로 근태 사유서를 제출합니다.',
        fields: [
            fd('day', '발생일', 'date', { required: true, prefill: 'day' }),
            fd('kind', '구분', 'select', { required: true, options: ['지각', '조퇴', '외출', '결근', '기타'], prefill: 'tardyKind' }),
            fd('time', '발생 시각', 'time', { prefill: 'tardyTime' }),
            fd('reason', '사유', 'textarea', { required: true }),
            fd('proof', '증빙', 'text'),
            fd('prevent', '재발 방지', 'textarea')
        ],
        boxes: BOXES_DEFAULT
    },
    {
        id: 'reason', v: 1, title: '사유서', order: 2, active: true, intro: '',
        pledge: '위와 같이 사유서를 제출합니다.',
        fields: [
            fd('title', '제목', 'text', { required: true }),
            fd('day', '발생일', 'date'),
            fd('time', '시각', 'time'),
            fd('task', '관련 업무', 'text'),
            fd('detail', '경위', 'textarea', { required: true }),
            fd('reason', '사유', 'textarea', { required: true }),
            fd('action', '조치 및 대책', 'textarea')
        ],
        boxes: BOXES_DEFAULT
    },
    {
        id: 'discipline', v: 1, title: '시말서', order: 3, active: true, intro: '',
        pledge: '깊이 반성하며 재발하지 않을 것을 서약하고 이 시말서를 제출합니다.',
        fields: [
            fd('day', '발생일', 'date'),
            fd('time', '시각', 'time'),
            fd('task', '관련 업무', 'text'),
            fd('detail', '사건 경위', 'textarea', { required: true }),
            fd('cause', '원인', 'textarea'),
            fd('result', '결과 및 영향', 'textarea'),
            fd('reflect', '반성 및 재발 방지', 'textarea', { required: true })
        ],
        boxes: BOXES_DEFAULT
    }
];

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
export const lower = (e) => String(e || '').trim().toLowerCase();

function normField(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const key = String(raw.key || '').trim();
    if (!KEY_RE.test(key)) return null;
    const type = FIELD_TYPES.includes(raw.type) ? raw.type : 'text';
    const f = { key, label: str(raw.label, 40) || key, type, required: raw.required === true };
    if (type === 'select') {
        const seen = new Set();
        f.options = (Array.isArray(raw.options) ? raw.options : [])
            .map(o => str(o, 40)).filter(o => o && !seen.has(o) && seen.add(o)).slice(0, MAX_OPTIONS);
    }
    const cap = DEFAULT_MAX[type];
    const m = Number(raw.max);
    f.max = Number.isFinite(m) && m > 0 ? Math.min(Math.floor(m), cap) : cap;
    if (PREFILLS.includes(raw.prefill)) f.prefill = raw.prefill;
    return f;
}

/** 저장본·편집본 → 화면이 믿고 쓸 수 있는 양식. 잘못된 칸(키 모양·중복)은 버리고 개수는 자른다. */
export function normalizeForm(raw, id) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const fid = String(id || r.id || '').trim();
    const keys = new Set();
    const fields = (Array.isArray(r.fields) ? r.fields : []).map(normField)
        .filter(f => f && !keys.has(f.key) && keys.add(f.key)).slice(0, MAX_FIELDS);
    let boxes = (Array.isArray(r.boxes) ? r.boxes : []).filter(b => b && typeof b === 'object')
        .map(b => ({ label: str(b.label, 10) || '결재', role: BOX_ROLES.includes(b.role) ? b.role : 'blank' })).slice(0, MAX_BOXES);
    if (!boxes.length) boxes = BOXES_DEFAULT.map(b => ({ ...b }));
    const order = Number(r.order);
    return {
        id: fid, v: 1,
        title: str(r.title, 40) || fid,
        order: Number.isFinite(order) ? order : 99,
        active: r.active !== false,
        intro: str(r.intro, 500),
        pledge: str(r.pledge, 500),
        fields, boxes
    };
}

/** 관리자 양식 편집 검사 — 오류 문장 목록(비면 저장 가능). normalizeForm 전의 편집본을 넣는다. */
export function validateForm(form) {
    const err = [];
    const f = form || {};
    if (!KEY_RE.test(String(f.id || ''))) err.push('양식 id 는 영문 소문자·숫자·_ 1~20자입니다.');
    if (!str(f.title, 100)) err.push('제목을 입력하세요.');
    else if (String(f.title).trim().length > 40) err.push('제목은 40자까지입니다.');
    const fields = Array.isArray(f.fields) ? f.fields : [];
    if (!fields.length) err.push('입력칸이 하나 이상 있어야 합니다.');
    if (fields.length > MAX_FIELDS) err.push(`입력칸은 ${MAX_FIELDS}개까지입니다.`);
    const keys = new Set();
    fields.forEach((x, i) => {
        const n = `${i + 1}번 칸`;
        if (!x || !KEY_RE.test(String(x.key || ''))) err.push(`${n}: 키는 영문 소문자·숫자·_ 1~20자입니다.`);
        else if (keys.has(x.key)) err.push(`${n}: 키 '${x.key}' 가 겹칩니다.`);
        else keys.add(x.key);
        if (!x || !str(x.label, 100)) err.push(`${n}: 이름을 입력하세요.`);
        if (x && !FIELD_TYPES.includes(x.type)) err.push(`${n}: 칸 종류가 올바르지 않습니다.`);
        if (x && x.type === 'select' && !(Array.isArray(x.options) && x.options.some(o => str(o, 40)))) err.push(`${n}: 선택지를 하나 이상 넣으세요.`);
    });
    const boxes = Array.isArray(f.boxes) ? f.boxes : [];
    if (boxes.length < 1 || boxes.length > MAX_BOXES) err.push(`결재란은 1~${MAX_BOXES}칸입니다.`);
    if (boxes.filter(b => b && b.role === 'author').length > 1) err.push('기안자 도장 칸은 하나만 둘 수 있습니다.');
    if (boxes.filter(b => b && b.role === 'approver').length !== 1) err.push('결재자 도장 칸이 정확히 하나 있어야 합니다.');   // 규칙(apFormOk)도 같은 검사
    boxes.forEach((b, i) => { if (!b || !str(b.label, 10)) err.push(`결재란 ${i + 1}: 이름을 입력하세요.`); });
    return err;
}

/** 코드 기본 양식 + 저장본([{id, ...}] 또는 {id: data}) → id 로 합친 목록(저장본 우선), order·제목 순. 끈 양식도 포함. */
export function mergeForms(defaults, saved) {
    const map = new Map();
    (Array.isArray(defaults) ? defaults : []).forEach(d => d && d.id && map.set(d.id, d));
    const list = Array.isArray(saved) ? saved : Object.entries(saved || {}).map(([id, d]) => ({ ...(d || {}), id }));
    list.forEach(s => { if (s && KEY_RE.test(String(s.id || ''))) map.set(s.id, s); });
    return [...map.entries()].map(([id, d]) => normalizeForm(d, id))
        .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title, 'ko'));
}

/** 양식에 있는 칸만, 글자로, 길이 상한까지. 없는 칸은 ''. */
export function cleanValues(form, values) {
    const v = values && typeof values === 'object' ? values : {};
    const out = {};
    ((form && form.fields) || []).forEach(f => {
        const raw = v[f.key] == null ? '' : String(v[f.key]);
        out[f.key] = (f.type === 'textarea' ? raw.replace(/\r\n?/g, '\n').trim() : raw.replace(/\s+/g, ' ').trim()).slice(0, f.max || DEFAULT_MAX[f.type] || 200);
    });
    return out;
}

/** 제출 전 입력 검사 — 오류 문장 목록. (임시저장은 검사하지 않는다) */
export function validateValues(form, values) {
    const err = [];
    const v = values && typeof values === 'object' ? values : {};
    ((form && form.fields) || []).forEach(f => {
        const s = v[f.key] == null ? '' : String(v[f.key]).trim();
        const max = f.max || DEFAULT_MAX[f.type] || 200;
        if (!s) { if (f.required) err.push(`'${f.label}' 을(를) 입력하세요.`); return; }
        if (s.length > max) err.push(`'${f.label}' 이 너무 깁니다(최대 ${max}자).`);
        if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) err.push(`'${f.label}' 날짜 형식이 올바르지 않습니다.`);
        if (f.type === 'time' && !/^\d{2}:\d{2}$/.test(s)) err.push(`'${f.label}' 시각 형식이 올바르지 않습니다.`);
        if (f.type === 'select' && Array.isArray(f.options) && !f.options.includes(s)) err.push(`'${f.label}' 은(는) 목록에서 고르세요.`);
    });
    return err;
}

/** 이 사람이 이 기안서에 할 수 있는 일 — 'edit'·'submit'·'delete'·'withdraw'·'approve'·'reject'·'print'.
 *  전이표(규칙과 같음): 작성자 draft→수정·제출·삭제(삭제는 이력·결재 의견이 없을 때만) / rejected→수정·재제출 / submitted→회수, 관리자 submitted→승인·반려. approved 는 인쇄만. */
export function actionsFor(d, email, isAdmin) {
    if (!d) return [];
    const mine = !!email && lower(d.authorEmail) === lower(email);
    const out = [];
    // 삭제는 한 번도 제출 안 한 임시저장만 — 회수·반려를 거친 문서(이력·결재 의견 있음)는 기록이라 못 지운다(규칙과 같음)
    const fresh = !(Array.isArray(d.history) && d.history.length) && !d.decision;
    if (mine && d.status === 'draft') out.push('edit', 'submit', ...(fresh ? ['delete'] : []));
    if (mine && d.status === 'rejected') out.push('edit', 'submit');
    if (mine && d.status === 'submitted') out.push('withdraw');
    if (isAdmin && d.status === 'submitted') out.push('approve', 'reject');
    if (mine || isAdmin) out.push('print');
    return out;
}

/** 이력에 한 줄 더한다. HISTORY_MAX 를 넘으면 오류(규칙도 막는다). */
export function nextHistory(list, entry) {
    const h = Array.isArray(list) ? list.slice() : [];
    if (h.length >= HISTORY_MAX) throw new Error('처리 이력이 너무 많아 더 진행할 수 없습니다. 새로 작성하세요.');
    h.push(entry);
    return h;
}

const ME = (me) => ({ email: lower(me && me.email), name: str(me && me.name, 40) });
const needName = (m) => { if (!m.name) throw new Error('직원 명단에 이 계정 이름이 없어 도장을 찍을 수 없습니다. 관리자에게 문의하세요.'); };

/** 새 문서 전체. submit=true 면 바로 제출(기안 도장). ts = serverTimestamp(), at = 브라우저 시각(이력용). */
export function buildCreate(form, me, values, { submit = false, ts, at } = {}) {
    const m = ME(me);
    needName(m);
    const f = normalizeForm(form, form && form.id);
    return {
        v: 1, formId: f.id, form: f, authorEmail: m.email, authorName: m.name,
        status: submit ? 'submitted' : 'draft',
        values: cleanValues(f, values),
        createdAt: ts, updatedAt: ts,
        submittedAt: submit ? ts : null,
        authorStamp: submit ? { name: m.name, at: ts } : null,
        decision: null, approverStamp: null,
        history: submit ? [{ act: 'submit', at, by: m.email }] : []
    };
}

/** 임시저장(draft·rejected → draft). 반려 건을 임시저장하면 '임시저장' 으로 돌아간다(반려 의견 decision 은 남는다). 이력은 늘리지 않는다. */
export function buildSave(d, values, { ts } = {}) {
    if (!d || !['draft', 'rejected'].includes(d.status)) throw new Error('지금 상태에서는 고칠 수 없습니다.');
    return { values: cleanValues(d.form, values), status: 'draft', updatedAt: ts, submittedAt: null, authorStamp: null };
}

/** 제출·재제출(draft·rejected → submitted). 예전에 결재(반려)를 받은 문서면 'resubmit'. */
export function buildSubmit(d, me, values, { ts, at } = {}) {
    if (!d || !['draft', 'rejected'].includes(d.status)) throw new Error('지금 상태에서는 제출할 수 없습니다.');
    const m = ME(me);
    needName(m);
    const act = (d.status === 'rejected' || d.decision) ? 'resubmit' : 'submit';
    return {
        values: cleanValues(d.form, values), status: 'submitted', updatedAt: ts, submittedAt: ts,
        authorStamp: { name: m.name, at: ts },
        history: nextHistory(d.history, { act, at, by: m.email })
    };
}

/** 회수(submitted → draft). 내용은 그대로, 기안 도장은 지운다. */
export function buildWithdraw(d, me, { ts, at } = {}) {
    if (!d || d.status !== 'submitted') throw new Error('결재 대기 중인 문서만 회수할 수 있습니다.');
    const m = ME(me);
    return { status: 'draft', updatedAt: ts, submittedAt: null, authorStamp: null, history: nextHistory(d.history, { act: 'withdraw', at, by: m.email }) };
}

/** 승인·반려(submitted → approved|rejected). 반려는 의견 1~500자 필수, 승인 의견은 선택. */
export function buildDecision(d, me, act, comment, { ts, at } = {}) {
    if (!d || d.status !== 'submitted') throw new Error('결재 대기 중인 문서가 아닙니다.');
    if (act !== 'approve' && act !== 'reject') throw new Error('알 수 없는 결재 동작');
    const m = ME(me);
    needName(m);
    const c = String(comment == null ? '' : comment).replace(/\r\n?/g, '\n').trim();
    if (act === 'reject' && !c) throw new Error('반려 의견을 입력하세요.');
    if (c.length > COMMENT_MAX) throw new Error(`의견은 ${COMMENT_MAX}자까지입니다.`);
    return {
        status: act === 'approve' ? 'approved' : 'rejected',
        decision: { by: m.email, byName: m.name, at: ts, comment: c },
        approverStamp: act === 'approve' ? { name: m.name, at: ts } : null,
        updatedAt: ts,
        history: nextHistory(d.history, { act, at, by: m.email })
    };
}

/** 알림 받을 관리자 이름 — memberRoles 가 admin 이고 퇴사(resignedEmails)가 아닌 사람의 memberEmails 이름. except 는 뺀다. */
export function adminNamesOf(cfg, except) {
    const c = cfg || {};
    const roles = c.memberRoles || {}, resigned = c.resignedEmails || {}, emails = c.memberEmails || {};
    const out = [];
    Object.entries(emails).forEach(([name, e]) => {
        const em = lower(e);
        if (!name || !em || name === except) return;
        if (roles[em] === 'admin' && !Object.prototype.hasOwnProperty.call(resigned, em)) out.push(name);
    });
    return [...new Set(out)].sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 그날 문서(daily_data/{날짜} 또는 history/{날짜})의 onLeaveMembers 에서 이 사람의 지각 → { kind:'지각', time:'HH:mm'|'' } | null. 읽기만. */
export function tardyPrefill(dayDoc, memberName) {
    const list = dayDoc && Array.isArray(dayDoc.onLeaveMembers) ? dayDoc.onLeaveMembers : [];
    const e = list.find(x => x && x.member === memberName && x.type === '지각');
    if (!e) return null;
    const t = String(e.startTime || '').trim();
    return { kind: '지각', time: /^\d{2}:\d{2}$/.test(t) ? t : '' };
}

// 인쇄(A4 한 장) — 0 기본 · 1 조금 작게 · 2 더 작게. 줄 수 어림(한 줄 글자 수·쪽 안 줄 수)은 approval-print.css 의 글자 크기에 맞춘 값.
//   2026-11-05 크롬 PDF 로 맞춰 봄(시말서, 한 칸만 채움): fit-0 약 400자 · fit-1 약 800자 · fit-2 약 1400자까지 한 장. 넘치면 over(안내만).
const FIT = [{ cpl: 38, lines: 26 }, { cpl: 43, lines: 32 }, { cpl: 48, lines: 42 }];
const linesOf = (text, cpl) => String(text || '').split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / cpl)), 0);
/** { level: 0|1|2, over: 한 장을 넘을 것 같으면 true } */
export function printFitLevel(form, values) {
    const v = values || {};
    const fields = (form && form.fields) || [];
    for (let level = 0; level < FIT.length; level++) {
        const { cpl, lines } = FIT[level];
        let n = 0;
        fields.forEach(f => { n += f.type === 'textarea' ? Math.max(2, linesOf(v[f.key], cpl)) : linesOf(v[f.key], cpl); });
        n += form && form.intro ? linesOf(form.intro, cpl + 10) : 0;
        n += form && form.pledge ? linesOf(form.pledge, cpl + 10) : 0;
        if (n <= lines) return { level, over: false };
    }
    return { level: FIT.length - 1, over: true };
}

/** 도장 아래 시각 'YYYY.MM.DD HH:mm' (한국시간, ms·Date 둘 다). 값이 없으면 ''. */
export function stampTime(at) {
    const ms = at instanceof Date ? at.getTime() : Number(at);
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const d = new Date(ms + 9 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 목록 정렬: 최근 바뀐 것 먼저. updatedAt 은 ms 로 바꿔 둔 값(_ms)을 본다. */
export const sortDocs = (list) => (Array.isArray(list) ? list.slice() : []).sort((a, b) => (b._ms || 0) - (a._ms || 0));

/** 목록·인쇄 제목 — 양식 제목(+ '제목' 칸이 있으면 그 값). */
export const docTitle = (d) => {
    const t = (d && d.form && d.form.title) || '기안서';
    const sub = d && d.values && d.values.title ? String(d.values.title) : '';
    return sub ? `${t} — ${sub}` : t;
};

/** 새 양식 id — 기존 id 와 안 겹치게 'form_2' 처럼. */
export function newFormId(existingIds, base = 'form') {
    const used = new Set(existingIds || []);
    for (let i = 1; i < 1000; i++) { const id = `${base}_${i}`.slice(0, 20); if (!used.has(id)) return id; }
    return `${base}_${Date.now() % 100000}`.slice(0, 20);
}
