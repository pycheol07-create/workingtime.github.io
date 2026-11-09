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
// 2026-11-05 추가: 결재자 지정(approverName·approverEmail — 관리자 또는 직책 파트장·부팀장·팀장, 본인 제외), 대신 결재(관리자, decision.proxy),
//   첨부(칸 종류 'file' — Storage approvals/{문서id}/…, 문서에는 attachments 메타만: key·name·size·path·type, 문서당 5개·10MB).
// 2026-11-05 결재선(여러 명 순서대로): approvers [{name, email}] 1~3명 + approverEmails(쿼리용) + step(지금 차례, 0부터)
//   + stamps(단계별 도장 — 맵 {'0': {name, at, proxy, comment}, '1': …}. Firestore 는 배열 안에 serverTimestamp 를 못 넣어 맵으로 둔다).
//   차례인 결재자 또는 관리자(대결)만 그 단계를 승인·반려. 마지막 단계 승인 → approved, 어느 단계든 반려 → rejected.
//   재제출하면 step 0·stamps 비움(이력엔 남음). 회수는 아무도 승인 안 했을 때만.
//   옛 문서(approverName·approverEmail 한 명, approverStamp)는 approversOf·stampsOf 로 1명 결재선처럼 읽는다.
//   옛 문서의 결재는 옛 모양(approverStamp)으로 쓰고, 작성자가 고치거나 다시 내면 새 모양(approvers…)으로 바뀐다.

import { positionOf } from './member-title.js?v=202611091200';

export const FIELD_TYPES = ['text', 'textarea', 'date', 'time', 'select', 'file'];
export const BOX_ROLES = ['author', 'approver', 'blank'];
export const PREFILLS = ['day', 'tardyTime', 'tardyKind'];   // 근태사유서: 발생일 → 그날 지각 기록(읽기만)을 빈 칸에
export const KEY_RE = /^[a-z0-9_]{1,20}$/;
export const MAX_FIELDS = 20;
export const MAX_BOXES = 3;
export const MAX_OPTIONS = 20;
export const HISTORY_MAX = 30;
export const COMMENT_MAX = 500;
const DEFAULT_MAX = { text: 200, textarea: 2000, date: 10, time: 5, select: 40, file: 5 };   // file 은 글자 수가 아니라 파일 개수

export const STATUS = { draft: '임시저장', submitted: '결재 대기', approved: '승인', rejected: '반려' };
export const STATUS_ORDER = ['submitted', 'draft', 'rejected', 'approved'];

// 규칙(firestore.rules ApprovalDocs)과 같은 목록
export const CREATE_KEYS = ['v', 'formId', 'form', 'authorEmail', 'authorName', 'status', 'values', 'createdAt', 'updatedAt',
    'submittedAt', 'authorStamp', 'decision', 'history', 'approvers', 'approverEmails', 'step', 'stamps', 'attachments'];
export const AUTHOR_KEYS = ['values', 'status', 'updatedAt', 'submittedAt', 'authorStamp', 'history', 'approvers', 'approverEmails', 'step', 'stamps', 'attachments'];
export const ADMIN_KEYS = ['status', 'decision', 'step', 'stamps', 'updatedAt', 'history'];   // 차례 결재자·관리자(대결) 같음
export const ADMIN_KEYS_OLD = ['status', 'decision', 'approverStamp', 'updatedAt', 'history'];   // 옛 문서(approvers 없음) 결재

// 결재자 후보 직책(js/lib/member-title.js POSITIONS 중) — 규칙 apCandOk 와 같은 목록
export const APPROVER_POSITIONS = ['파트장', '부팀장', '팀장'];
export const APPROVERS_MAX = 3;   // 결재선 최대 인원 — 규칙 apApproversOk 와 같다

// 첨부 — storage.rules approvals/ 와 같은 값. 확장자로 contentType 을 정한다(브라우저 값은 믿지 않음)
export const ATTACH_MAX = 5;
export const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACH_TYPES = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    hwp: 'application/x-hwp', hwpx: 'application/hwp+zip'
};
export const ATTACH_ACCEPT = Object.keys(ATTACH_TYPES).map(e => '.' + e).join(',');

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
            fd('prevent', '재발 방지', 'textarea'),
            fd('proof', '증빙', 'file')   // 2026-11-05 파일 첨부로(사진·PDF 등)
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
        if (f.type === 'file') return;   // 파일은 attachments 에(값 칸 없음)
        const raw = v[f.key] == null ? '' : String(v[f.key]);
        out[f.key] = (f.type === 'textarea' ? raw.replace(/\r\n?/g, '\n').trim() : raw.replace(/\s+/g, ' ').trim()).slice(0, f.max || DEFAULT_MAX[f.type] || 200);
    });
    return out;
}

/** 제출 전 입력 검사 — 오류 문장 목록. (임시저장은 검사하지 않는다) attachments = 문서 첨부(파일 칸 필수 검사용) */
export function validateValues(form, values, attachments) {
    const err = [];
    const v = values && typeof values === 'object' ? values : {};
    const att = Array.isArray(attachments) ? attachments : [];
    ((form && form.fields) || []).forEach(f => {
        if (f.type === 'file') {
            if (f.required && !att.some(a => a && a.key === f.key)) err.push(`'${f.label}' 파일을 붙이세요.`);
            return;
        }
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

// ── 결재선 읽기(새 문서 approvers·step·stamps / 옛 문서 approverName·approverEmail·approverStamp) ──
/** 결재선 [{name, email}] — 옛 문서는 지정 결재자 한 명(없으면 빈 목록) */
export function approversOf(d) {
    if (!d) return [];
    if (Array.isArray(d.approvers)) return d.approvers.filter(a => a && a.email).map(a => ({ name: String(a.name || ''), email: lower(a.email) }));
    return d.approverEmail ? [{ name: String(d.approverName || ''), email: lower(d.approverEmail) }] : [];
}
/** 지금 차례(0부터). 옛 문서는 승인 전 0, 승인 뒤 1 */
export function stepOf(d) {
    if (!d) return 0;
    if (Number.isInteger(d.step) && d.step >= 0) return d.step;
    return d.approverStamp ? 1 : 0;
}
/** 단계별 도장 [{name, at, proxy, comment}](0차부터 순서대로) — 문서에는 맵 {'0': …, '1': …}. 옛 문서는 approverStamp(+decision.proxy) 하나 */
export function stampsOf(d) {
    if (!d) return [];
    if (Array.isArray(d.stamps)) return d.stamps.filter(Boolean);
    if (d.stamps && typeof d.stamps === 'object') {
        const out = [];
        for (let i = 0; d.stamps[String(i)]; i++) out.push(d.stamps[String(i)]);
        return out;
    }
    return d.approverStamp ? [{ ...d.approverStamp, proxy: !!(d.decision && d.decision.proxy), comment: (d.decision && d.decision.comment) || '' }] : [];
}
/** 지금 차례 결재자 {name, email} | null(결재 대기가 아니거나 결재선 없음) */
export function currentApprover(d) {
    if (!d || d.status !== 'submitted') return null;
    return approversOf(d)[stepOf(d)] || null;
}
/** 결재선에 이 사람이 있나 */
export const inLine = (d, email) => !!email && approversOf(d).some(a => a.email === lower(email));
/** 지금 이 사람 차례인가 */
export const isTurn = (d, email) => { const c = currentApprover(d); return !!c && !!email && c.email === lower(email); };
/** 아무도 승인 안 했나(회수 가능 조건) */
export const noneApproved = (d) => stepOf(d) === 0 && stampsOf(d).length === 0;

/** 이 사람이 이 기안서에 할 수 있는 일 — 'edit'·'submit'·'delete'·'withdraw'·'approve'·'reject'·'print'.
 *  전이표(규칙과 같음): 작성자 draft→수정·제출·삭제(회수·반려를 거친 임시저장도 삭제 가능, 2026-11-05) / rejected→수정·재제출 /
 *  submitted→회수(아무도 승인 안 했을 때만), 차례 결재자·관리자(대결) submitted→승인·반려. approved 는 인쇄만.
 *  결재선에 있는 사람은 제출 뒤(draft 아님) 인쇄·열람. */
export function actionsFor(d, email, isAdmin) {
    if (!d) return [];
    const mine = !!email && lower(d.authorEmail) === lower(email);
    const assigned = inLine(d, email);
    const out = [];
    // 임시저장이면 회수·반려를 거쳤어도 삭제 가능(규칙과 같음, 2026-11-05 사용자 결정)
    if (mine && d.status === 'draft') out.push('edit', 'submit', 'delete');
    if (mine && d.status === 'rejected') out.push('edit', 'submit');
    if (mine && d.status === 'submitted' && noneApproved(d)) out.push('withdraw');
    if (d.status === 'submitted' && currentApprover(d) && (isAdmin || isTurn(d, email))) out.push('approve', 'reject');
    else if (d.status === 'submitted' && !approversOf(d).length && isAdmin) out.push('approve', 'reject');   // 결재자 지정이 없던 첫 판 문서 — 관리자만
    if (mine || isAdmin || (assigned && d.status !== 'draft')) out.push('print');
    return out;
}

/** 작성자 버튼(edit·withdraw·delete)이 안 되는 까닭 — 툴팁용 문장. 되면 ''. */
export function whyNot(d, email, isAdmin, act) {
    if (!d) return '';
    if (actionsFor(d, email, isAdmin).includes(act)) return '';
    const mine = !!email && lower(d.authorEmail) === lower(email);
    if (!mine) return '본인이 쓴 기안서만 고치거나 지울 수 있습니다.';
    const st = d.status;
    if (act === 'edit' && st === 'submitted' && !noneApproved(d)) return '결재가 진행 중이라 고칠 수 없습니다 — 결재자가 반려하면 고칠 수 있습니다.';
    if (act === 'edit') return st === 'submitted' ? '결재 대기 중에는 고칠 수 없습니다 — [회수] 한 뒤 고치세요.' : '승인된 기안서는 고칠 수 없습니다.';
    if (act === 'withdraw') return st === 'draft' ? '아직 제출하지 않은 기안서입니다.'
        : st === 'rejected' ? '반려된 기안서는 회수 없이 바로 [수정] 할 수 있습니다.'
        : st === 'submitted' ? '이미 승인한 결재자가 있어 회수할 수 없습니다 — 결재자가 반려하면 고칠 수 있습니다.' : '승인된 기안서는 회수할 수 없습니다.';
    if (act === 'delete' && st === 'submitted' && !noneApproved(d)) return '결재가 진행 중인 기안서는 지울 수 없습니다.';
    if (act === 'delete') return st === 'submitted' ? '결재 대기 중인 기안서는 지울 수 없습니다 — [회수] 하면 임시저장이 되어 지울 수 있습니다.'
        : st === 'approved' ? '승인된 기안서는 지울 수 없습니다.'
        : '반려된 기안서는 [수정] 해서 임시저장한 뒤 지울 수 있습니다.';
    return '';
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

// 결재선 정리 — [{name, email}] 만, 이름 40자·이메일 소문자, 빈 줄 버림(순서 유지)
export const cleanApprovers = (list) => (Array.isArray(list) ? list : [])
    .map(a => ({ name: str(a && a.name, 40), email: lower(a && a.email) }))
    .filter(a => a.name && a.email);
/** 결재선 검사 — 오류 문장 목록(비면 제출 가능). 1~3명, 본인 아님, 같은 사람 두 번 안 됨. 후보 조건은 화면(approverCandidates)·규칙이 본다. */
export function checkApprovers(list, selfEmail) {
    const ap = cleanApprovers(list);
    const err = [];
    if (!ap.length) err.push('결재자를 고르세요.');
    if (ap.length > APPROVERS_MAX) err.push(`결재자는 ${APPROVERS_MAX}명까지입니다.`);
    if (ap.some(a => a.email === lower(selfEmail))) err.push('본인을 결재자로 지정할 수 없습니다.');
    if (new Set(ap.map(a => a.email)).size !== ap.length) err.push('같은 결재자를 두 번 넣을 수 없습니다.');
    return err;
}
const needApprovers = (ap, m) => { const e = checkApprovers(ap, m.email); if (e.length) throw new Error(e[0]); };
// 문서에 쓰는 결재선 칸(규칙 apApproversOk — approverEmails 는 approvers 의 email 을 같은 순서로)
const LINE = (ap) => ({ approvers: ap, approverEmails: ap.map(a => a.email), step: 0, stamps: {} });
const stampMap = (list) => Object.fromEntries(list.map((x, i) => [String(i), x]));

/** 새 문서 전체. submit=true 면 바로 제출(기안 도장·결재자 필수). ts = serverTimestamp(), at = 브라우저 시각(이력용). approvers = [{name, email}] 순서대로 */
export function buildCreate(form, me, values, { submit = false, ts, at, approvers } = {}) {
    const m = ME(me);
    needName(m);
    const ap = cleanApprovers(approvers);
    if (submit) needApprovers(ap, m);
    else if (ap.length > APPROVERS_MAX) throw new Error(`결재자는 ${APPROVERS_MAX}명까지입니다.`);
    const f = normalizeForm(form, form && form.id);
    return {
        ...LINE(ap), attachments: [],
        v: 1, formId: f.id, form: f, authorEmail: m.email, authorName: m.name,
        status: submit ? 'submitted' : 'draft',
        values: cleanValues(f, values),
        createdAt: ts, updatedAt: ts,
        submittedAt: submit ? ts : null,
        authorStamp: submit ? { name: m.name, at: ts } : null,
        decision: null,
        history: submit ? [{ act: 'submit', at, by: m.email }] : []
    };
}

/** 임시저장(draft·rejected → draft). 반려 건을 임시저장하면 '임시저장' 으로 돌아간다(반려 의견 decision 은 남는다, 단계 도장은 비운다). 이력은 늘리지 않는다.
 *  approvers 를 안 넘기면 지금 결재선 그대로(옛 문서는 새 모양으로 옮겨 쓴다). */
export function buildSave(d, values, { ts, approvers } = {}) {
    if (!d || !['draft', 'rejected'].includes(d.status)) throw new Error('지금 상태에서는 고칠 수 없습니다.');
    const ap = cleanApprovers(approvers === undefined ? approversOf(d) : approvers);
    if (ap.length > APPROVERS_MAX) throw new Error(`결재자는 ${APPROVERS_MAX}명까지입니다.`);
    return { values: cleanValues(d.form, values), status: 'draft', updatedAt: ts, submittedAt: null, authorStamp: null, ...LINE(ap) };
}

/** 제출·재제출(draft·rejected → submitted). 예전에 결재(반려)를 받은 문서면 'resubmit'. 결재는 1차부터 다시(step 0, 도장 비움). */
export function buildSubmit(d, me, values, { ts, at, approvers } = {}) {
    if (!d || !['draft', 'rejected'].includes(d.status)) throw new Error('지금 상태에서는 제출할 수 없습니다.');
    const m = ME(me);
    needName(m);
    const ap = cleanApprovers(approvers === undefined ? approversOf(d) : approvers);
    needApprovers(ap, m);
    const act = (d.status === 'rejected' || d.decision) ? 'resubmit' : 'submit';
    return {
        ...LINE(ap),
        values: cleanValues(d.form, values), status: 'submitted', updatedAt: ts, submittedAt: ts,
        authorStamp: { name: m.name, at: ts },
        history: nextHistory(d.history, { act, at, by: m.email })
    };
}

/** 회수(submitted → draft). 아무도 승인 안 했을 때만. 내용·결재선은 그대로, 기안 도장은 지운다. */
export function buildWithdraw(d, me, { ts, at } = {}) {
    if (!d || d.status !== 'submitted') throw new Error('결재 대기 중인 문서만 회수할 수 있습니다.');
    if (!noneApproved(d)) throw new Error('이미 승인한 결재자가 있어 회수할 수 없습니다.');
    const m = ME(me);
    return { status: 'draft', updatedAt: ts, submittedAt: null, authorStamp: null, history: nextHistory(d.history, { act: 'withdraw', at, by: m.email }) };
}

/** 승인·반려. 반려는 의견 1~500자 필수, 승인 의견은 선택.
 *  새 문서: 지금 단계(step)에 도장 하나 더하고 step+1 — 마지막 단계면 approved, 아니면 submitted 그대로(다음 결재자 차례). 반려는 어느 단계든 rejected.
 *    proxy = 지금 차례 결재자가 아닌 사람(관리자)이 결재 — 인쇄에 '대결'. 도장은 실제 결재한 사람 이름.
 *  옛 문서(approvers 칸 없음): 예전 모양(approverStamp, 지정 결재자가 있는데 내가 아니면 proxy). → { patch, final, next }
 *    final = 결재가 끝남(approved·rejected), next = 다음 차례 결재자 {name, email} | null */
export function buildDecisionStep(d, me, act, comment, { ts, at } = {}) {
    if (!d || d.status !== 'submitted') throw new Error('결재 대기 중인 문서가 아닙니다.');
    if (act !== 'approve' && act !== 'reject') throw new Error('알 수 없는 결재 동작');
    const m = ME(me);
    needName(m);
    const c = String(comment == null ? '' : comment).replace(/\r\n?/g, '\n').trim();
    if (act === 'reject' && !c) throw new Error('반려 의견을 입력하세요.');
    if (c.length > COMMENT_MAX) throw new Error(`의견은 ${COMMENT_MAX}자까지입니다.`);
    const history = nextHistory(d.history, { act, at, by: m.email });
    if (!Array.isArray(d.approvers)) {   // 옛 문서
        return { final: true, next: null, patch: {
            status: act === 'approve' ? 'approved' : 'rejected',
            decision: { by: m.email, byName: m.name, at: ts, comment: c, proxy: !!d.approverEmail && lower(d.approverEmail) !== m.email },
            approverStamp: act === 'approve' ? { name: m.name, at: ts } : null,
            updatedAt: ts, history
        } };
    }
    const line = approversOf(d);
    const step = stepOf(d);
    const cur = line[step];
    if (!cur) throw new Error('결재선이 비었거나 이미 끝났습니다.');
    if (stampsOf(d).length !== step) throw new Error('결재 기록이 맞지 않습니다. 새로고침해 보세요.');
    const proxy = cur.email !== m.email;
    const decision = { by: m.email, byName: m.name, at: ts, comment: c, proxy };
    if (act === 'reject') return { final: true, next: null, patch: { status: 'rejected', decision, updatedAt: ts, history } };
    const last = step + 1 >= line.length;
    return { final: last, next: last ? null : line[step + 1], patch: {
        status: last ? 'approved' : 'submitted',
        step: step + 1,
        stamps: stampMap([...stampsOf(d), { name: m.name, at: ts, proxy, comment: c }]),   // 앞 도장 그대로 + 지금 단계 하나
        decision, updatedAt: ts, history
    } };
}
/** 결재 뒤 알림 — 단계 승인이면 다음 결재자, 최종 승인·반려면 작성자. 본인에게는 안 보낸다. → { to: 이름, kind: 'approver'|'author' } | null */
export function decisionNoti(d, res, myEmail) {
    if (!d || !res) return null;
    const me = lower(myEmail);
    if (!res.final) return res.next && res.next.name && res.next.email !== me ? { to: res.next.name, kind: 'approver' } : null;
    return d.authorName && lower(d.authorEmail) !== me ? { to: d.authorName, kind: 'author' } : null;
}
/** 문서에 쓸 칸만(예전 이름 유지 — buildDecisionStep 의 patch) */
export const buildDecision = (d, me, act, comment, opt) => buildDecisionStep(d, me, act, comment, opt).patch;

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

/** 인쇄 결재란 — 양식 boxes 의 결재자 칸을 결재선 인원만큼 늘린다(1명이면 라벨 그대로, 2명 이상이면 '결재 1'·'결재 2'…).
 *  → [{ label, role, stamp, proxy, who }] — stamp = 그 칸 도장({name, at}) | null, who = 결재선의 그 사람 이름(빈 칸이면 '') */
export function sheetBoxes(boxes, approvers, stamps, authorStamp) {
    const line = Array.isArray(approvers) ? approvers : [];
    const st = Array.isArray(stamps) ? stamps : [];
    const n = Math.max(1, line.length);
    const out = [];
    (Array.isArray(boxes) ? boxes : []).forEach(b => {
        if (b.role === 'author') out.push({ label: b.label, role: 'author', stamp: authorStamp || null, proxy: false, who: '' });
        else if (b.role === 'approver') {
            for (let i = 0; i < n; i++) {
                const s = st[i] || null;
                out.push({ label: n > 1 ? `${b.label} ${i + 1}` : b.label, role: 'approver', stamp: s, proxy: !!(s && s.proxy), who: (line[i] && line[i].name) || '' });
            }
        } else out.push({ label: b.label, role: b.role, stamp: null, proxy: false, who: '' });
    });
    return out;
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

/** 결재자 후보 — 관리자(memberRoles admin) 또는 직책 파트장·부팀장·팀장, 재직, 본인 제외.
 *  이메일 칸에 앞뒤 빈칸이 있으면 규칙(memberEmails[이름].lower() == 결재자 이메일)이 막으므로 뺀다. → [{name, email, label}] */
export function approverCandidates(cfg, selfName, selfEmail) {
    const c = cfg || {};
    const roles = c.memberRoles || {}, resigned = c.resignedEmails || {};
    const me = lower(selfEmail);
    const rank = (r, p) => APPROVER_POSITIONS.indexOf(p) + 1;   // 팀장 3 · 부팀장 2 · 파트장 1 · 관리자(직책 없음) 0
    const out = [];
    Object.entries(c.memberEmails || {}).forEach(([name, raw]) => {
        if (!name || typeof raw !== 'string' || raw !== raw.trim() || name === selfName) return;
        const em = raw.toLowerCase();
        if (!em || em === me || !Object.prototype.hasOwnProperty.call(roles, em) || Object.prototype.hasOwnProperty.call(resigned, em)) return;
        const p = positionOf(c, name);
        const isAdmin = roles[em] === 'admin';
        if (!isAdmin && !APPROVER_POSITIONS.includes(p)) return;
        const label = APPROVER_POSITIONS.includes(p) ? `${name} ${p}` : `${name} (관리자)`;
        out.push({ name, email: em, label, _r: rank(roles[em], p) });
    });
    return out.sort((a, b) => (b._r - a._r) || a.name.localeCompare(b.name, 'ko')).map(({ _r, ...x }) => x);
}

// ── 첨부 ──
const extOf = (name) => { const m = /\.([A-Za-z0-9]{1,6})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
/** 붙일 수 있는가 — {ok, ext, contentType} | {ok:false, reason}. count = 지금 문서의 첨부 수. */
export function checkAttach(file, count = 0) {
    if (!file) return { ok: false, reason: '파일이 없습니다.' };
    if (count >= ATTACH_MAX) return { ok: false, reason: `첨부는 ${ATTACH_MAX}개까지입니다.` };
    const ext = extOf(file.name);
    const contentType = ATTACH_TYPES[ext];
    if (!contentType) return { ok: false, reason: '이미지·PDF·엑셀·워드·한글 파일만 붙일 수 있습니다.' };
    if (!(file.size > 0)) return { ok: false, reason: '빈 파일입니다.' };
    if (file.size > ATTACH_MAX_BYTES) return { ok: false, reason: '파일 하나는 10MB 까지입니다.' };
    return { ok: true, ext, contentType };
}
/** 보여 줄 형식 — 저장 경로 확장자로 ATTACH_TYPES 에서(문서 메타 type 은 믿지 않는다). 표에 없으면 octet-stream(받기만). */
export const attachTypeOf = (path) => ATTACH_TYPES[extOf(path)] || 'application/octet-stream';
/** Storage 경로 — 파일 이름(개인정보가 들어갈 수 있음)은 경로에 넣지 않는다. 규칙과 같은 모양 approvals/{docId}/{이름} */
// 파일 이름 모양 {13자리 시각}_{영숫자 1~8}.{확장자} — storage.rules approvals create·firestore.rules apAttOk 정규식과 같다
export const ATTACH_NAME_RE = /^[0-9]{13}_[a-z0-9]{1,8}\.(png|jpg|jpeg|gif|webp|pdf|xls|xlsx|csv|doc|docx|hwp|hwpx)$/;
export const attachPath = (docId, ext, now = Date.now(), rand = Math.random().toString(36).slice(2, 8) || 'x') =>
    `approvals/${docId}/${String(now).padStart(13, '0').slice(-13)}_${rand}.${ext}`;
/** 문서에 둘 메타 한 줄 */
export const attachMeta = (key, file, path, contentType) => ({ key: String(key), name: String(file.name || '').slice(0, 120), size: Number(file.size) || 0, path, type: contentType });
export const fmtBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round((n || 0) / 1024)) + 'KB');
