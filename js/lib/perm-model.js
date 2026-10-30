// === js/lib/perm-model.js ===
// 관리자 '권한 관리' 화면의 메모리 모델 — 화면은 이 모델만 고치고, 저장 때 이 모델에서 권한 칸을 만든다(권한 개편, 2026-10-19).
// 왜: mainConfig 는 통째 덮어쓰기라, 권한 칸을 DOM 에서 긁다가 화면이 덜 그려지면 전원 권한이 비워진다(설계 3.3 R-a).
//     모델이 없으면 저장을 막고(admin.js), 모델이 있으면 저장 전에 '손대지 않은 사람의 기능 집합이 그대로인지' 검사한다.
// ※ 순수 모듈(DOM 없음). 이메일 키는 소문자. 테스트: tests/perm.test.js

import { ALL_FEATURE_IDS, PRESET_ROLES, DEFAULT_ROLE_ID, isFeatureId, FEATURE_BY_ID } from './feature-catalog.js?v=202610301725';
import { resolve, combine, roleFeatures, overridesOf, bestRole, diffFromRole, menuNamesFor, sameSet, normEmail, featureForMenuItem } from './perm.js?v=202610301725';

const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const grantable = (id) => isFeatureId(id) && FEATURE_BY_ID[id].grantable;
const uniq = (a) => Array.from(new Set(a));

export const ROLE_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
// 옛 권한에서 자동 배정할 때 고르지 않는 역할(시스템 계정 전용)
export const AUTO_EXCLUDE_ROLES = ['bot'];

/** 저장된 역할 정의를 안전한 모양으로. 모르는 기능·관리자 전용은 버린다. */
export const sanitizeRoles = (roles) => {
    const out = {};
    if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return out;
    for (const [id, r] of Object.entries(roles)) {
        if (!ROLE_ID_RE.test(id) || !r || typeof r !== 'object' || Array.isArray(r)) continue;
        out[id] = {
            name: String(r.name || id).slice(0, 40),
            order: Number(r.order) || 0,
            features: uniq((Array.isArray(r.features) ? r.features : []).filter(grantable))
        };
    }
    return out;
};

const presetCopy = () => sanitizeRoles(JSON.parse(JSON.stringify(PRESET_ROLES)));

/** 모델 만들기. people = 화면 목록과 같은 범위 [{ email, kind:'member'|'system' }] (퇴사자 제외).
 *  옛 형식만 있는 사람(source legacy·none)은 예외가 가장 적은 역할을 골라 자동 배정한다(auto=true) — 기능 집합은 그대로다. */
export const createPermModel = (cfg, people) => {
    const c = cfg || {};
    const saved = sanitizeRoles(c.permRoles);
    const hasRoles = Object.keys(saved).length > 0;
    const roles = hasRoles ? saved : presetCopy();
    const defaultRole = own(roles, c.permDefaultRole) ? c.permDefaultRole
        : (own(roles, DEFAULT_ROLE_ID) ? DEFAULT_ROLE_ID : (Object.keys(roles)[0] || ''));
    const m = {
        roles, defaultRole,
        enforce: c.permEnforce === 'block' ? 'block' : 'warn',
        baseRev: Number(c.permRev) || 0,
        rolesFromPreset: !hasRoles,
        persons: {}, order: [],
        touched: new Set(), touchedRoles: new Set(), settingsTouched: false
    };
    for (const p of (Array.isArray(people) ? people : [])) {
        const e = normEmail(p && p.email);
        if (!e || m.persons[e]) continue;
        const r = resolve(c, e);
        let roleId = null, allow = [], deny = [], auto = false;
        if (r.source === 'role' || (r.isAdmin && own(c.permAssign, e))) {
            roleId = typeof (c.permAssign || {})[e] === 'string' ? c.permAssign[e] : '';
            const ov = overridesOf(c, e);
            allow = ov.allow; deny = ov.deny.filter(grantable);
        } else if (!r.isAdmin) {
            const b = bestRole(roles, r.set, { exclude: AUTO_EXCLUDE_ROLES });
            roleId = b.roleId; allow = b.allow; deny = b.deny; auto = true;
        }
        m.persons[e] = { email: e, kind: p.kind === 'system' ? 'system' : 'member', admin: r.isAdmin,
                         roleId, allow, deny, auto, origAdmin: r.isAdmin, origSet: r.set };
        m.order.push(e);
    }
    return m;
};

export const autoAssignedCount = (m) => m.order.filter(e => m.persons[e].auto && !m.persons[e].admin).length;

/** 이 사람의 지금(저장 전) 기능 집합. */
export const effectiveSet = (m, email) => {
    const p = m && m.persons[normEmail(email)];
    if (!p) return new Set();
    if (p.admin) return new Set(ALL_FEATURE_IDS);
    return combine(roleFeatures(m.roles, p.roleId || ''), p.allow, p.deny);
};

/** 미리보기·메뉴 계산용 resolve 모양. */
export const resolvedOf = (m, email) => {
    const p = m && m.persons[normEmail(email)];
    return { isAdmin: !!(p && p.admin), resigned: false, source: p ? (p.admin ? 'admin' : 'role') : 'none',
             roleId: p ? p.roleId : null, set: effectiveSet(m, email) };
};

const touch = (m, e) => { m.touched.add(e); const p = m.persons[e]; if (p) p.auto = false; };

export const setAdmin = (m, email, on) => {
    const e = normEmail(email), p = m.persons[e];
    if (!p) return;
    p.admin = !!on;
    // 관리자에서 내리면 역할 없음에서 시작한다(권한이 저절로 늘지 않게) — 관리자가 역할을 고른다
    if (!p.admin && p.roleId == null) { p.roleId = ''; p.allow = []; p.deny = []; }
    touch(m, e);
};

/** 역할 바꾸기 — 예외는 비운다. */
export const setRole = (m, email, roleId) => {
    const e = normEmail(email), p = m.persons[e];
    if (!p || p.admin) return;
    p.roleId = String(roleId || '');
    p.allow = []; p.deny = [];
    touch(m, e);
};

/** 기능 하나 켜기/끄기 — 결과 집합에서 역할과의 차이를 다시 계산해 예외로 둔다. */
export const setFeature = (m, email, id, on) => {
    const e = normEmail(email), p = m.persons[e];
    if (!p || p.admin || !grantable(id)) return;
    const set = effectiveSet(m, e);
    if (on) set.add(id); else set.delete(id);
    const d = diffFromRole(roleFeatures(m.roles, p.roleId || ''), set);
    p.allow = d.allow; p.deny = d.deny;
    touch(m, e);
};

export const resetToRole = (m, email) => {
    const e = normEmail(email), p = m.persons[e];
    if (!p || p.admin) return;
    p.allow = []; p.deny = [];
    touch(m, e);
};

export const usersOfRole = (m, roleId) => m.order.filter(e => !m.persons[e].admin && m.persons[e].roleId === roleId).length;

/** 기능을 가진 일반(관리자 아님) 사람 수 — 관리자는 따로 센다. */
export const holdersOf = (m, id) => m.order.filter(e => !m.persons[e].admin && effectiveSet(m, e).has(id)).length;
export const adminCount = (m) => m.order.filter(e => m.persons[e].admin).length;

export const nextRoleId = (m) => {
    let i = 1;
    while (own(m.roles, 'custom' + i)) i++;
    return 'custom' + i;
};

/** 새 역할(fromId 를 주면 복제). 만든 roleId 를 돌려준다. */
export const addRole = (m, name, fromId = null) => {
    const id = nextRoleId(m);
    const maxOrder = Math.max(0, ...Object.values(m.roles).map(r => Number(r.order) || 0));
    const src = fromId && m.roles[fromId];
    m.roles[id] = { name: String(name || (src ? src.name + ' 복사본' : '새 역할')).slice(0, 40), order: maxOrder + 1,
                    features: src ? [...src.features] : [] };
    m.touchedRoles.add(id);
    return id;
};

export const renameRole = (m, roleId, name) => {
    if (!m.roles[roleId]) return;
    const n = String(name || '').trim().slice(0, 40);
    if (!n) return;
    m.roles[roleId].name = n;
    m.settingsTouched = true;   // 이름만 바뀐 것은 아무의 기능도 바꾸지 않는다
};

/** 쓰는 사람이 있거나 새 직원 기본 역할이면 지우지 못한다. 지웠으면 true. */
export const deleteRole = (m, roleId) => {
    if (!m.roles[roleId] || usersOfRole(m, roleId) > 0 || m.defaultRole === roleId) return false;
    delete m.roles[roleId];
    m.touchedRoles.add(roleId);
    return true;
};

export const setRoleFeature = (m, roleId, id, on) => {
    const r = m.roles[roleId];
    if (!r || !grantable(id)) return;
    const s = new Set(r.features);
    if (on) s.add(id); else s.delete(id);
    r.features = ALL_FEATURE_IDS.filter(x => s.has(x));
    m.touchedRoles.add(roleId);
};

export const setDefaultRole = (m, roleId) => {
    if (!m.roles[roleId]) return;
    m.defaultRole = roleId;
    m.settingsTouched = true;
};

export const setEnforce = (m, mode) => {
    m.enforce = mode === 'block' ? 'block' : 'warn';
    m.settingsTouched = true;
};

/** 저장할 권한 칸 — 모델에 있는 사람만. 새 팀원·퇴사자 처리는 admin-logic 이 이어서 한다.
 *  groups = withBuiltinMenus(저장할 dashboardMenu). 카탈로그에 없는 메뉴 이름은 옛 memberMenuAccess 의 것을 그대로 남긴다. */
export const permFieldsForSave = (m, groups, cfgBefore) => {
    const before = (cfgBefore && cfgBefore.memberMenuAccess) || {};
    const unmapped = new Set();
    (Array.isArray(groups) ? groups : []).forEach(g => (g.items || []).forEach(i => { if (i && i.name && !featureForMenuItem(i)) unmapped.add(i.name); }));
    const out = {
        memberRoles: {}, memberMenuAccess: {},
        permRoles: sanitizeRoles(m.roles), permDefaultRole: m.defaultRole,
        permAssign: {}, permOverrides: {}, permEnforce: m.enforce,
        permRev: (Number(m.baseRev) || 0) + 1
    };
    for (const e of m.order) {
        const p = m.persons[e];
        out.memberRoles[e] = p.admin ? 'admin' : 'user';
        if (p.admin) { out.memberMenuAccess[e] = []; continue; }   // 관리자는 제한 없음(예전과 같은 값)
        out.permAssign[e] = String(p.roleId || '');
        const allow = uniq(p.allow).filter(grantable), deny = uniq(p.deny).filter(grantable);
        if (allow.length || deny.length) out.permOverrides[e] = { allow, deny };
        const keep = (Array.isArray(before[p.prevEmail || e]) ? before[p.prevEmail || e] : []).filter(n => unmapped.has(n));
        out.memberMenuAccess[e] = uniq([...menuNamesFor(effectiveSet(m, e), groups), ...keep]);
    }
    return out;
};

/** 팀원 탭에서 이메일을 고친 사람 — 모델 항목(역할·예외·관리자 여부)을 새 이메일 키로 옮긴 **사본**을 돌려준다.
 *  renames = [{ from, to }] (소문자). 화면 모델은 그대로 둔다(저장이 실패해도 화면이 어긋나지 않게).
 *  옮긴 사람은 '손댄 사람'으로 치지 않는다 — 저장 전과 기능 집합이 같아야 한다(verifyPermSave 가 본다). */
export const renameEmails = (m, renames = []) => {
    const map = new Map((renames || []).map(r => [normEmail(r.from), normEmail(r.to)]));
    if (!map.size) return m;
    const to = (e) => map.get(e) || e;
    const persons = {};
    for (const e of m.order) persons[to(e)] = { ...m.persons[e], email: to(e), prevEmail: map.has(e) ? e : m.persons[e].prevEmail };
    return { ...m, persons, order: m.order.map(to), touched: new Set([...m.touched].map(to)), touchedRoles: new Set(m.touchedRoles) };
};

/** 저장 직전 검사 — 건수만 돌려준다(이메일·이름 없음).
 *   mismatch  : 저장될 값으로 다시 계산한 집합이 화면(모델)과 다른 사람 수 → 0 이 아니면 저장 형식 버그
 *   changed   : 화면에서 손대지 않았는데 저장 전과 기능 집합이 달라지는 사람 수 → 0 이 아니면 자동 배정 버그
 *   stale     : 이메일을 고친 사람의 옛 이메일 키가 memberRoles·permAssign·permOverrides 에 남은 수(renames 를 줄 때)
 *  퇴사 처리된 사람(newCfg.resignedEmails)은 세지 않는다. */
export const verifyPermSave = (m, newCfg, renames = []) => {
    let mismatch = 0, changed = 0, stale = 0;
    for (const r of (renames || [])) {
        const from = normEmail(r.from);
        if (['memberRoles', 'permAssign', 'permOverrides'].some(k => own(newCfg && newCfg[k], from))) stale++;
    }
    const resigned = (newCfg && newCfg.resignedEmails) || {};
    for (const e of m.order) {
        if (own(resigned, e)) continue;
        const p = m.persons[e];
        const want = effectiveSet(m, e);
        if (!sameSet(resolve(newCfg, e).set, want)) mismatch++;
        const roleTouched = p.roleId != null && m.touchedRoles.has(p.roleId);
        if (!m.touched.has(e) && !roleTouched && p.admin === p.origAdmin && !sameSet(want, p.origSet)) changed++;
    }
    return { mismatch, changed, stale };
};
