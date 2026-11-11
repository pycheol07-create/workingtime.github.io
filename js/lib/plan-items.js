// === js/lib/plan-items.js ===
// 운영 계획 v2 D4 — 실행 관리 과제(OpsPlanItems/{itemId}) 모양·상태 규칙·기한 초과·역할 → 사람(브라우저 메모리에서만).
//   과제 = { v, version, year, quarter, kind, parent, title≤80, role, due, status, progress 0~100, checklist[≤10]{t≤60, ok},
//           kpi{metric, task?, from, target}, src{rule, roadmapKey?, catalogKey?, recommend?, key?}, msId?, createdAt/By, updatedAt/By }
//   ⚠️ 이름·금액 없음 — 역할만 저장(admin | lead | group:<팀 그룹 이름>). 사람은 기한 초과 알림을 보낼 때 브라우저에서만 찾는다.
//   상태: todo(할 일) → doing(진행) → done(끝) · hold(보류) · drop(그만 — 지우는 대신). done 이면 진행 100, todo 로 되돌리면 0 아래로 내리지 않음.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-items.test.js

import { isMemberActiveOn } from '../utils.js?v=202611120855';

export const ITEM_KINDS = Object.freeze(['objective', 'initiative', 'milestone', 'data', 'auto']);
export const ITEM_STATUS = Object.freeze(['todo', 'doing', 'done', 'hold', 'drop']);
export const STATUS_LABEL = Object.freeze({ todo: '할 일', doing: '진행', done: '끝', hold: '보류', drop: '그만' });
export const ITEM_LIMITS = Object.freeze({ title: 80, checklist: 10, checkText: 60, note: 200, notifyPerDay: 5 });
export const LOG_FIELDS = Object.freeze(['status', 'progress', 'checklist', 'title', 'due', 'role', 'create']);
const SRC_KEYS = ['rule', 'roadmapKey', 'catalogKey', 'recommend', 'key'];
const KPI_KEYS = ['metric', 'task', 'from', 'target'];

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 화면 문구 역할('관리자'·'팀장'·'각 파트 담당' 등) → 저장 역할 */
export function normalizeRole(role) {
    const r = String(role || '').trim();
    if (r === 'admin' || r === 'lead' || /^group:.{1,30}$/.test(r)) return r;
    if (r.includes('관리자')) return 'admin';
    return 'lead';   // 팀장·각 파트 담당·그 밖 = 팀장이 나눔
}
export const roleLabel = (role) => (role === 'admin' ? '관리자' : role === 'lead' ? '팀장' : String(role || '').startsWith('group:') ? `${role.slice(6)} 파트` : '—');

/** 분기 key 'YYYY-Qn' — 기한(또는 오늘)에서 */
export const quarterKeyOf = (ymd) => (isDate(ymd) ? `${ymd.slice(0, 4)}-Q${Math.floor((Number(ymd.slice(5, 7)) - 1) / 3) + 1}` : null);

/**
 * 과제 초안(이름 없는 itemDraft — plan-automation·plan-data-gaps·plan-owner-advice·로드맵·분기 핵심 과제) → 저장 본문(생성 시각·사람은 저장소가 붙인다).
 * 모르는 칸은 버린다. title 은 80자, checklist 는 10개·60자.
 */
export function itemFromDraft(d, { today = null, parent = null } = {}) {
    const due = isDate(d && d.due) ? d.due : null;
    const quarter = /^\d{4}-Q[1-4]$/.test(String(d && d.quarter)) ? d.quarter : quarterKeyOf(due || today);
    const kpi = {};
    if (d && d.kpi && typeof d.kpi === 'object') KPI_KEYS.forEach(k => {
        const v = d.kpi[k];
        if (v == null) return;
        kpi[k] = (k === 'metric' || k === 'task') ? str(v, 40) : fin(v);
    });
    const src = {};
    if (d && d.src && typeof d.src === 'object') SRC_KEYS.forEach(k => { if (d.src[k] != null) src[k] = str(d.src[k], 80); });
    return {
        v: 1, version: 1,
        year: Number((quarter || String(today || '')).slice(0, 4)) || null,
        quarter: quarter || null,
        kind: ITEM_KINDS.includes(d && d.kind) ? d.kind : 'initiative',
        parent: parent ? str(parent, 60) : null,
        title: str(d && d.title, ITEM_LIMITS.title) || '(제목 없음)',
        role: normalizeRole(d && d.role),
        due,
        status: 'todo', progress: 0,
        checklist: cleanChecklist(d && d.checklist),
        kpi, src
    };
}

export function cleanChecklist(list) {
    return (Array.isArray(list) ? list : []).slice(0, ITEM_LIMITS.checklist)
        .map(c => ({ t: str(c && c.t, ITEM_LIMITS.checkText), ok: !!(c && c.ok) })).filter(c => c.t);
}

/**
 * 상태·진행 바꾸기 규칙 — 바뀐 칸만 돌려준다(저장소가 version + 1 · 로그).
 * done → 진행 100, done 에서 다른 상태로 → 진행 그대로(사람이 고침), 진행 100 이 되면 done, 진행 > 0 인데 todo 면 doing.
 * 체크 한 칸은 change.check = { idx, ok } — 지금(서버에서 읽은) 체크리스트에 그 칸만 바꾼다(다른 사람이 고친 칸을 덮지 않게).
 * @returns {object|null} patch(바뀐 것 없으면 null)
 */
export function applyChange(item, change) {
    const cur = item || {};
    let status = change.status != null ? change.status : cur.status;
    let progress = change.progress != null ? Math.round(Math.min(100, Math.max(0, Number(change.progress) || 0))) : cur.progress;
    if (!ITEM_STATUS.includes(status)) status = cur.status;
    if (change.status === 'done') progress = 100;
    else if (change.progress != null && progress >= 100 && status !== 'drop' && status !== 'hold') status = 'done';
    else if (change.progress != null && progress > 0 && status === 'todo') status = 'doing';
    const patch = {};
    if (status !== cur.status) patch.status = status;
    if (progress !== cur.progress) patch.progress = progress;
    if (change.check && Number.isInteger(change.check.idx)) {
        const cl = (cur.checklist || []).map(c => ({ ...c }));
        const c = cl[change.check.idx];
        if (c && c.ok !== !!change.check.ok) { c.ok = !!change.check.ok; patch.checklist = cl; }
    } else if (change.checklist) {
        const cl = cleanChecklist(change.checklist);
        if (JSON.stringify(cl) !== JSON.stringify(cur.checklist || [])) patch.checklist = cl;
    }
    return Object.keys(patch).length ? patch : null;
}

/** 변경 이력 줄(로그) — { field, from, to } 들. 값은 짧은 글자로(체크리스트는 'n/m', 한 칸 체크면 'k번 안 함 → k번 함') */
export function logEntriesOf(item, patch, change = null) {
    const short = (k, v) => (k === 'checklist' ? `${(v || []).filter(c => c.ok).length}/${(v || []).length}` : String(v == null ? '' : v).slice(0, 40));
    const one = change && change.check && Number.isInteger(change.check.idx) ? change.check : null;
    return Object.keys(patch || {}).filter(k => LOG_FIELDS.includes(k)).map(k => (k === 'checklist' && one
        ? { field: k, from: `${one.idx + 1}번 ${one.ok ? '안 함' : '함'}`, to: `${one.idx + 1}번 ${one.ok ? '함' : '안 함'}` }
        : { field: k, from: short(k, item && item[k]), to: short(k, patch[k]) }));
}

/** 기한 초과 — 기한이 오늘보다 앞이고 끝·그만이 아님 */
export const isOverdue = (item, today) => !!(item && isDate(item.due) && item.due < today && item.status !== 'done' && item.status !== 'drop');

/**
 * 역할 → 사람 이름(브라우저 메모리에서만 — 알림 대상). 퇴사자 제외.
 *   admin = memberRoles 가 admin 인 이메일의 이름(memberEmails 역참조), lead = 직책 팀장·부팀장(memberPositions),
 *   group:<이름> = 그 팀 그룹 사람. 아무도 없으면 관리자.
 */
export function peopleOfRole(role, cfg, today) {
    const c = cfg || {};
    const active = (n) => !!n && isMemberActiveOn(n, today, c);
    const emails = c.memberEmails || {};
    const admins = Object.entries(emails).filter(([, e]) => e && (c.memberRoles || {})[String(e).toLowerCase()] === 'admin').map(([n]) => n).filter(active);
    let out = [];
    if (role === 'admin') out = admins;
    else if (role === 'lead') out = Object.entries(c.memberPositions || {}).filter(([, p]) => p === '팀장' || p === '부팀장').map(([n]) => n).filter(active);
    else if (String(role || '').startsWith('group:')) {
        const g = (c.teamGroups || []).find(x => x && x.name === role.slice(6));
        out = ((g && g.members) || []).filter(active);
    }
    return [...new Set(out.length ? out : admins)];
}

/**
 * 기한 초과 알림 고르기 — 하루 1번(오늘 이미 보냈으면 없음), 과제당 1번(보낸 과제 key 목록), 하루 최대 5건(사람 수 기준).
 * @param items 과제 [{id, ...}]  @param sent { day, ids:[] } (localStorage 에서 읽은 것)
 * @returns {{ targets:[이름], itemIds:[id], day }} — 메모리 전용(이름). 알림 문구는 내용·이름 없이 고정.
 */
export function pickOverdueNotices(items, { today, cfg, sent = null, max = ITEM_LIMITS.notifyPerDay } = {}) {
    if (sent && sent.day === today) return { targets: [], itemIds: [], day: today };
    const done = new Set((sent && sent.ids) || []);
    const due = (items || []).filter(it => it && it.id && isOverdue(it, today) && !done.has(it.id));
    const targets = new Set();
    const ids = [];
    due.forEach(it => {
        if (targets.size >= max) return;
        const before = targets.size;
        peopleOfRole(it.role, cfg, today).forEach(n => { if (targets.size < max) targets.add(n); });
        if (targets.size > before || peopleOfRole(it.role, cfg, today).every(n => targets.has(n))) ids.push(it.id);
    });
    return { targets: [...targets], itemIds: ids, day: today };
}
export const OVERDUE_MESSAGE = '기한 지난 운영 과제가 있습니다';
