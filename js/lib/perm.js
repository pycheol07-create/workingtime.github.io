// === js/lib/perm.js ===
// 권한 계산 — '이 사람은 어떤 기능을 쓸 수 있나'를 한 곳에서 정한다(권한 개편, 2026-10-19).
// 메뉴(셸·사이드바)·관리 화면 미리보기·(다음 단계) 페이지 가드·규칙 테스트가 같은 답을 내게 하려고 순수 함수로 둔다.
// ※ 의존성은 feature-catalog.js 하나. 메뉴 병합(withBuiltinMenus)은 부르는 쪽(menu-catalog.js)이 해서 넘긴다
//    — menu-catalog 가 이 모듈을 쓰므로 거꾸로 import 하면 순환이 된다.
//
// 저장 형식(같은 config/mainConfig, 이메일 키는 소문자)
//   memberRoles      { email: 'admin'|'user' }        관리자 = 전체 기능(그대로)
//   permRoles        { roleId: { name, features:[id], order } }
//   permDefaultRole  'basic'                           새 직원 역할
//   permAssign       { email: roleId }                 '' = 역할 없음
//   permOverrides    { email: { allow:[id], deny:[id] } }
//   permRev          number                            저장마다 +1
//   permEnforce      'warn'|'block'                    페이지 가드 모드(5단계)
//   memberMenuAccess { email: [메뉴 이름] }            파생값(옛 코드 호환)

import { FEATURES, FEATURE_BY_ID, ALL_FEATURE_IDS, ACTION_MENU_NAMES, isFeatureId, childFeaturesOf } from './feature-catalog.js?v=202610271137';

const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
export const normEmail = (email) => String(email || '').trim().toLowerCase();
const grantable = (id) => isFeatureId(id) && FEATURE_BY_ID[id].grantable;
const idList = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

// 'calculator/index.html?x#y' → 'calculator/index.html' (앞의 ./ 와 / 도 뗀다) — menu-catalog.js 와 같은 규칙
export const linkPath = (link) => String(link || '').split('#')[0].split('?')[0].replace(/^\.?\//, '');

/** 메뉴 항목 → 기능 id. 없으면 null.
 *  동작 메뉴(ACTION_MENU_NAMES — 관리자 화면이 이름을 잠근다)는 이름으로 먼저 잇는다(설계 2.3 — 링크가 무엇이든 같은 동작이다).
 *  그 밖은 링크 우선(페이지 메뉴는 이름을 바꿔도 이어진다), 링크로 못 찾으면 이름. */
const featureByMenuName = (name) => {
    // 예전 기본 이름(menuAliases)도 같은 기능 — 이름을 바꾸기 전에 저장된 memberMenuAccess 가 끊기지 않게(2026-10-20)
    const f = FEATURES.find(x => x.menu && (x.menu === name || (Array.isArray(x.menuAliases) && x.menuAliases.includes(name))));
    return f ? f.id : null;
};
export const featureForMenuItem = (item) => {
    if (!item) return null;
    if (ACTION_MENU_NAMES.includes(item.name)) return featureByMenuName(item.name);
    const p = linkPath(item.link);
    if (p) {
        const byLink = FEATURES.find(f => f.kind === 'page' && f.page === p);
        if (byLink) return byLink.id;
    }
    return featureByMenuName(item.name);
};

/** 역할 기능 ∪ allow − deny (deny 우선). 관리자 전용·모르는 id 는 버린다. */
export const combine = (roleFeatures, allow, deny) => {
    const out = new Set(idList(roleFeatures).filter(grantable));
    idList(allow).filter(grantable).forEach(id => out.add(id));
    idList(deny).forEach(id => out.delete(id));
    return out;
};

/** 역할 정의의 기능 목록(없는 역할·모양이 틀린 값은 빈 목록). */
export const roleFeatures = (roles, roleId) => {
    const r = own(roles, roleId) ? roles[roleId] : null;
    return r && typeof r === 'object' ? idList(r.features).filter(grantable) : [];
};

/** 개인 예외 — 모양이 틀리면 빈 예외. */
export const overridesOf = (cfg, email) => {
    const all = (cfg && cfg.permOverrides) || {};
    const o = own(all, email) ? all[email] : null;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { allow: [], deny: [] };
    return { allow: idList(o.allow).filter(grantable), deny: idList(o.deny).filter(isFeatureId) };
};

/** 메뉴 이름 → 기능 id. 저장된 메뉴(cfg.dashboardMenu)에 그 이름의 항목이 있으면 그 링크로, 없으면 카탈로그 이름으로. */
const featureForMenuName = (dashboardMenu, name) => {
    for (const g of (Array.isArray(dashboardMenu) ? dashboardMenu : [])) {
        for (const i of ((g && Array.isArray(g.items)) ? g.items : [])) {
            if (i && i.name === name) {
                const id = featureForMenuItem(i);
                if (id) return id;
            }
        }
    }
    return featureForMenuItem({ name, link: '' });
};

/** 옛 memberMenuAccess → 기능 집합(설계 3.1 4단계). 그 사람 칸이 없으면 null.
 *  페이지에 들어갈 수 있었으면 그 페이지의 func·sub 도 전부 준다(예전엔 들어가면 다 할 수 있었다).
 *  관리자 전용(grantable=false)·옛 관리자 전용(legacyAdminOnly)은 주지 않는다 — 예전에도 화면이 막았다. */
export const legacyFeatures = (cfg, email) => {
    const c = cfg || {};
    const e = normEmail(email);
    const acc = c.memberMenuAccess || {};
    if (!e || !own(acc, e) || !Array.isArray(acc[e])) return null;
    const out = new Set();
    const ok = (id) => grantable(id) && !FEATURE_BY_ID[id].legacyAdminOnly;
    for (const name of acc[e]) {
        const id = featureForMenuName(c.dashboardMenu, name);
        if (!id || !ok(id)) continue;
        out.add(id);
        childFeaturesOf(id).filter(ok).forEach(x => out.add(x));
    }
    return out;
};

/** 이 사람의 권한. → { isAdmin, resigned, source, roleId, set:Set<id> }
 *  source: 'resigned' | 'admin' | 'role' | 'legacy' | 'none'
 *  opts.role 을 주면 memberRoles 대신 그 값을 쓴다(셸처럼 role 을 따로 받는 곳).
 *  순서: 퇴사 → 관리자 → 역할 배정 → 옛 메뉴 권한 → 아무것도 없음(빈 집합 — 지금 사이드바가 아무 메뉴도 안 보여 주는 것과 같다). */
export const resolve = (cfg, email, opts = {}) => {
    const c = cfg || {};
    const e = normEmail(email);
    const base = { isAdmin: false, resigned: false, source: 'none', roleId: null, set: new Set() };
    if (!e) return base;
    if (own(c.resignedEmails, e)) return { ...base, resigned: true, source: 'resigned' };
    const role = own(opts, 'role') ? opts.role : (c.memberRoles || {})[e];
    if (role === 'admin') return { ...base, isAdmin: true, source: 'admin', set: new Set(ALL_FEATURE_IDS) };
    if (own(c.permAssign, e)) {
        const roleId = typeof c.permAssign[e] === 'string' ? c.permAssign[e] : '';
        const ov = overridesOf(c, e);
        return { ...base, source: 'role', roleId, set: combine(roleFeatures(c.permRoles, roleId), ov.allow, ov.deny) };
    }
    const legacy = legacyFeatures(c, e);
    if (legacy) return { ...base, source: 'legacy', set: legacy };
    return base;
};

/** resolve 결과로 판정. 결과가 없으면 false(막는 쪽). */
export const can = (resolved, id) => !!(resolved && resolved.set instanceof Set && resolved.set.has(id));

/** 기능 집합 → 메뉴 이름(memberMenuAccess 파생값). groups = withBuiltinMenus(dashboardMenu) 결과. 메뉴 순서, 중복 없음. */
export const menuNamesFor = (set, groups) => {
    const out = [];
    for (const g of (Array.isArray(groups) ? groups : [])) {
        for (const i of ((g && g.items) || [])) {
            if (!i || !i.name || out.includes(i.name)) continue;
            const id = featureForMenuItem(i);
            if (id && set && set.has(id)) out.push(i.name);
        }
    }
    return out;
};

/** 카탈로그에 이어지지 않는 메뉴 이름(외부 링크·카탈로그에 없는 새 페이지 등). */
export const unmappedMenuNames = (groups) => {
    const out = [];
    for (const g of (Array.isArray(groups) ? groups : [])) {
        for (const i of ((g && g.items) || [])) {
            if (i && i.name && !featureForMenuItem(i) && !out.includes(i.name)) out.push(i.name);
        }
    }
    return out;
};

// 셸 메뉴에서는 관리자에게도 넣지 않는다 — 마감은 대시보드에서만(menu-catalog.js SHELL_EXCLUDED_ACTIONS 와 같은 뜻)
export const SHELL_EXCLUDED_FEATURES = ['dash.endShift'];

/** 보이는 메뉴 그룹 — [{ category, items:[{ name, link }] }] (빈 그룹은 뺀다). 셸·사이드바가 같은 기준을 쓴다.
 *  groups = withBuiltinMenus(dashboardMenu) 결과. surface: 'shell' 이면 업무 마감을 뺀다(사이드바는 권한대로 둔다).
 *  카탈로그에 없는 메뉴는 관리자에게만, 일반 직원은 옛 memberMenuAccess 이름에 있을 때만(legacyNames) 보인다. */
export const visibleMenuGroups = (groups, resolved, surface = 'shell', legacyNames = []) => {
    const isAdmin = !!(resolved && resolved.isAdmin);
    const names = Array.isArray(legacyNames) ? legacyNames : [];
    return (Array.isArray(groups) ? groups : [])
        .map(g => ({
            category: (g && g.category) || '',
            items: ((g && g.items) || [])
                .filter(i => i && i.name)
                .filter(i => {
                    const id = featureForMenuItem(i);
                    if (surface === 'shell' && id && SHELL_EXCLUDED_FEATURES.includes(id)) return false;
                    if (!id) return isAdmin || (!!resolved && !resolved.resigned && names.includes(i.name));
                    return can(resolved, id);
                })
                .map(i => ({ name: i.name, link: i.link || '' }))
        }))
        .filter(g => g.items.length > 0);
};

/** 역할 기능과 원하는 집합의 차이 → 예외. */
export const diffFromRole = (roleFeats, set) => {
    const role = new Set(idList(roleFeats).filter(grantable));
    const want = new Set([...(set || [])].filter(grantable));
    return {
        allow: ALL_FEATURE_IDS.filter(id => want.has(id) && !role.has(id)),
        deny: ALL_FEATURE_IDS.filter(id => role.has(id) && !want.has(id))
    };
};

/** 예외 개수(allow+deny)가 가장 적은 역할. 같으면 order 가 작은 것, 그다음 roleId 순. roles 가 비면 roleId ''(역할 없음). */
export const bestRole = (roles, set, { exclude = [] } = {}) => {
    const ids = Object.keys(roles || {}).filter(id => !exclude.includes(id) && roles[id] && typeof roles[id] === 'object');
    ids.sort((a, b) => (Number(roles[a].order) || 0) - (Number(roles[b].order) || 0) || (a < b ? -1 : a > b ? 1 : 0));
    let best = { roleId: '', ...diffFromRole([], set) };
    let bestN = best.allow.length + best.deny.length;
    for (const id of ids) {
        const d = diffFromRole(roleFeatures(roles, id), set);
        const n = d.allow.length + d.deny.length;
        if (n < bestN || (best.roleId === '' && n === bestN)) { best = { roleId: id, ...d }; bestN = n; }
    }
    return best;
};

/** 두 기능 집합이 같은가. */
export const sameSet = (a, b) => {
    const x = a instanceof Set ? a : new Set(a || []);
    const y = b instanceof Set ? b : new Set(b || []);
    if (x.size !== y.size) return false;
    for (const v of x) if (!y.has(v)) return false;
    return true;
};

// 다른 화면이 셸에 넘길 메뉴 설정 — 권한 계산에 쓰는 칸만(이메일 키 원본을 캐시에 남기지 않는 것은 셸이 지킨다).
export const PERM_CONFIG_KEYS = ['dashboardMenu', 'memberMenuAccess', 'memberRoles', 'resignedEmails',
    'permRoles', 'permAssign', 'permOverrides', 'permDefaultRole', 'permRev', 'permEnforce'];
export const menuConfigOf = (appConfig) => {
    const c = appConfig || {};
    const out = {};
    PERM_CONFIG_KEYS.forEach(k => { if (c[k] !== undefined) out[k] = c[k]; });
    return out;
};
