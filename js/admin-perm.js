// === js/admin-perm.js ===
// 관리자 페이지 '권한 관리' — [사람] [역할] [기능 목록] 하위 탭과 미리보기(권한 개편, 2026-10-19).
// 화면은 메모리 모델(js/lib/perm-model.js)만 고친다. 저장은 지금처럼 '전체 저장' 한 번이고,
// admin-logic.collectConfigFromDOM 이 getPermModel() 로 권한 칸을 만든다(DOM 을 긁지 않는다).
// ※ 봇이 읽는 div[role=dialog]·data-act 는 쓰지 않는다(관리자 페이지라 봇이 열지는 않지만 같은 규칙을 지킨다).

import { FEATURES, FEATURE_GROUPS, FEATURE_BY_ID } from './lib/feature-catalog.js?v=202610230833';
import { roleFeatures, visibleMenuGroups } from './lib/perm.js?v=202610230833';
import {
    createPermModel, autoAssignedCount, effectiveSet, resolvedOf, setAdmin, setRole, setFeature, resetToRole,
    usersOfRole, holdersOf, adminCount, addRole, renameRole, deleteRole, setRoleFeature, setDefaultRole, setEnforce
} from './lib/perm-model.js?v=202610230833';
import { withBuiltinMenus, SHELL_EXCLUDED_ACTIONS } from './menu-catalog.js?v=202610230833';
import { isAdminOnlyNow, DATA_ADMIN_ONLY_NOTE, lastDayKeys, sumHits, HIT_COLLECTION } from './lib/perm-gate.js?v=202610230833';

let model = null;
let config = null;
let people = [];          // [{ email, name, type, kind }] — 화면 표시용(모델에는 이메일만)
let tab = 'people';
let openEmail = null;     // 세부 예외를 펼친 사람
let previewEmail = null;  // 미리보기를 연 사람
let hits = null;          // 최근 7일 '막힐 뻔한 입장' — null(읽는 중) | [{ id, n }] | 'error'
let hitsLoading = false;

/** 페이지 가드 집계(permGateHits/{yyyymmdd}, 기능별 건수만) 최근 7일을 읽는다. 관리자만 읽힌다(규칙).
 *  관리자 페이지가 이미 띄운 기본 앱을 쓴다(같은 SDK 주소 — 에뮬레이터 연결도 따라간다). */
async function loadHits() {
    if (hitsLoading) return;
    hitsLoading = true;
    try {
        // SDK 는 쓸 때 불러온다 — 이 모듈을 node 테스트(admin-logic → admin-ui)가 import 한다
        const { getApps, getApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
        const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        if (!getApps().some(a => a.name === '[DEFAULT]')) throw new Error('no-app');
        const db = getFirestore(getApp());
        const snaps = await Promise.all(lastDayKeys(7).map(k => getDoc(doc(db, HIT_COLLECTION, k))));
        hits = sumHits(snaps.map(sn => (sn.exists() ? sn.data() : null)));
    } catch (e) {
        hits = 'error';
        console.warn('[권한] 입장 집계 읽기 실패:', (e && (e.code || e.message)) || 'unknown');
    } finally {
        hitsLoading = false;
        // 화면 전체를 다시 그리지 않는다 — 입력 중인 칸의 글자·포커스가 사라지지 않게 집계 줄만 바꾼다
        const el = typeof document !== 'undefined' ? document.getElementById('pm-gate-hits') : null;
        if (el) el.outerHTML = hitsLine();
    }
}

function hitsLine() {
    const label = (id) => (FEATURE_BY_ID[id] ? FEATURE_BY_ID[id].label : id);
    let body;
    if (hits === null) body = '<span class="text-gray-400">읽는 중…</span>';
    else if (hits === 'error') body = '<span class="text-gray-400">읽지 못함(규칙 게시 전이면 아직 쌓이지 않습니다)</span>';
    else if (!hits.length) body = '<span class="text-gray-400">없음</span>';
    else body = hits.map(h => `<span class="inline-block mr-2">${esc(label(h.id))} <b>${h.n}</b></span>`).join('');
    return `<div id="pm-gate-hits" class="mb-3 text-[11px] text-gray-600 dark:text-gray-300" title="권한이 없는 화면에 들어간 횟수(같은 창·같은 화면은 하루 1회). 이름·이메일은 남기지 않습니다.">
        <b>최근 7일 막힐 뻔한 입장</b> · ${body}</div>`;
}

/** 저장 때 쓰는 모델. 화면을 못 그렸으면 null — 그때 저장은 막는다(admin.js). */
export const getPermModel = () => model;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 화면 목록 — 재직 팀원(이메일 있음) + 시스템 계정. 퇴사자는 뺀다(저장 때 admin-logic 이 접근을 전부 해제한다). */
const collectPeople = (cfg) => {
    const out = [];
    const resigned = cfg.resignedMembers || {};
    (cfg.teamGroups || []).forEach(g => (g.members || []).forEach(m => {
        if (resigned[m]) return;
        const email = (cfg.memberEmails || {})[m] || '';
        if (email) out.push({ name: m, email: email.toLowerCase(), type: '팀원', kind: 'member' });
    }));
    (cfg.systemAccounts || []).forEach(acc => {
        if (acc && acc.email) out.push({ name: acc.name, email: String(acc.email).toLowerCase(), type: '시스템', kind: 'system' });
    });
    const seen = new Set();
    return out.filter(p => (seen.has(p.email) ? false : (seen.add(p.email), true)));
};

export function renderPermissionPanel(cfg) {
    const container = document.getElementById('permissions-container');
    if (!container) return;
    config = cfg || {};
    people = collectPeople(config);
    try {
        model = createPermModel(config, people.map(p => ({ email: p.email, kind: p.kind })));
    } catch (e) {
        model = null;
        console.error('권한 화면 초기화 실패:', e);
        container.innerHTML = '<p class="text-sm text-red-600 py-4 text-center">권한 화면을 그리지 못했습니다. 새로고침해 주세요(이 상태로는 저장되지 않습니다).</p>';
        return;
    }
    if (!container.dataset.pmBound) {
        container.dataset.pmBound = '1';
        container.addEventListener('click', onClick);
        container.addEventListener('change', onChange);
    }
    if (openEmail && !model.persons[openEmail]) openEmail = null;
    if (previewEmail && !model.persons[previewEmail]) previewEmail = null;
    draw();
    loadHits();
}

// ── 그리기 ──────────────────────────────────────────────

const DANGER_BADGE = {
    2: '<span class="ml-1 text-[10px] font-extrabold text-red-600 dark:text-red-400" title="되돌리기 어려운 기능">!!</span>',
    1: '<span class="ml-1 text-[10px] font-extrabold text-amber-600 dark:text-amber-400" title="주의가 필요한 기능">!</span>',
    0: ''
};
const RULE_TEXT = { yes: '예', partial: '일부', no: '아니오(화면만)' };
// 데이터 관리(data.*) — 지금은 관리자만 효과(history.html 이 관리자만 들인다)
const ADMIN_ONLY_TAG = (id) => (isAdminOnlyNow(id)
    ? `<span class="ml-1 text-[10px] text-gray-400" title="${esc(DATA_ADMIN_ONLY_NOTE)}">(지금은 관리자만 효과)</span>` : '');
const GRANTABLE = FEATURES.filter(f => f.grantable);

const roleIdsSorted = () => Object.keys(model.roles)
    .sort((a, b) => (model.roles[a].order - model.roles[b].order) || (a < b ? -1 : 1));

const tabBtn = (id, label) => `<button type="button" data-pm-act="tab" data-pm-nodirty data-tab="${id}"
    class="px-4 py-1.5 text-sm font-bold rounded-md transition ${tab === id ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}">${label}</button>`;

function draw() {
    const container = document.getElementById('permissions-container');
    if (!container || !model) return;
    const auto = autoAssignedCount(model);
    const head = `
        <div class="flex flex-wrap items-center gap-3 mb-4">
            <div class="inline-flex gap-1 p-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                ${tabBtn('people', '사람')}${tabBtn('roles', '역할')}${tabBtn('features', '기능 목록')}
            </div>
            <div class="ml-auto flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
                <span class="font-bold">페이지 가드</span>
                <label class="inline-flex items-center gap-1 cursor-pointer"><input type="radio" name="pm-enforce" value="warn" data-pm-act="enforce" ${model.enforce === 'warn' ? 'checked' : ''}> 경고만</label>
                <label class="inline-flex items-center gap-1 cursor-pointer"><input type="radio" name="pm-enforce" value="block" data-pm-act="enforce" ${model.enforce === 'block' ? 'checked' : ''}> 막기</label>
            </div>
        </div>
        ${hitsLine()}
        ${auto > 0 ? `<div id="perm-auto-band" class="mb-4 p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-sm text-amber-800 dark:text-amber-200">
            ⚠️ 옛 권한에서 자동 배정됨 <b>${auto}명</b> — 지금 쓸 수 있는 기능 그대로 역할·예외로 옮겼습니다. 확인한 뒤 <b>[전체 저장]</b>을 누르면 새 형식으로 저장됩니다.</div>` : ''}
        ${model.rolesFromPreset ? `<div class="mb-4 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-xs text-blue-800 dark:text-blue-200">
            역할은 아직 저장된 적이 없어 기본 프리셋으로 시작합니다(저장하면 함께 저장됩니다).</div>` : ''}`;
    const body = tab === 'roles' ? drawRoles() : (tab === 'features' ? drawFeatures() : drawPeople());
    container.innerHTML = head + body;
}

function featureGrid(isOn, decorate, act, extraAttr) {
    return FEATURE_GROUPS.map(g => {
        const feats = GRANTABLE.filter(f => f.group === g.id);
        if (!feats.length) return '';
        return `<div class="flex flex-wrap items-start gap-x-4 gap-y-1 py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
            <span class="w-24 shrink-0 text-[11px] font-bold text-gray-500 dark:text-gray-400 pt-0.5">${esc(g.label)}</span>
            <div class="flex flex-wrap gap-x-4 gap-y-1 flex-1">
            ${feats.map(f => `<label class="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs ${decorate(f).cls}" title="${esc(f.id)}">
                <input type="checkbox" class="w-4 h-4" data-pm-act="${act}" data-id="${esc(f.id)}" ${extraAttr} ${isOn(f.id) ? 'checked' : ''}>
                <span>${esc(f.label)}</span>${DANGER_BADGE[f.danger] || ''}${decorate(f).tag}${ADMIN_ONLY_TAG(f.id)}</label>`).join('')}
            </div></div>`;
    }).join('');
}

function roleOptions(selected) {
    const opts = [`<option value="" ${selected === '' ? 'selected' : ''}>(역할 없음)</option>`];
    roleIdsSorted().forEach(id => opts.push(`<option value="${esc(id)}" ${selected === id ? 'selected' : ''}>${esc(model.roles[id].name)}</option>`));
    if (selected && !model.roles[selected]) opts.push(`<option value="${esc(selected)}" selected>(없는 역할)</option>`);
    return opts.join('');
}

function drawPeople() {
    if (!people.length) return '<p class="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">이메일이 등록된 계정이 없습니다.</p>';
    const rows = people.map(u => {
        const p = model.persons[u.email];
        if (!p) return '';
        const ex = p.admin ? '' : `${p.allow.length ? `<span class="text-green-600 dark:text-green-400 font-bold">+${p.allow.length}</span>` : ''} ${p.deny.length ? `<span class="text-red-600 dark:text-red-400 font-bold">-${p.deny.length}</span>` : ''}`.trim();
        const roleCell = p.admin
            ? '<span class="text-sm font-bold text-blue-700 dark:text-blue-300">관리자(전체)</span>'
            : `<select class="pm-role-select w-full p-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 rounded-md text-sm font-bold dark:text-white" data-pm-act="role" data-email="${esc(u.email)}">${roleOptions(p.roleId || '')}</select>`;
        const open = openEmail === u.email && !p.admin;
        const prev = previewEmail === u.email;
        const r = model.roles[p.roleId || ''];
        const rf = new Set(roleFeatures(model.roles, p.roleId || ''));
        const set = effectiveSet(model, u.email);
        const detail = open ? `<div class="mt-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span class="text-[11px] text-gray-500 dark:text-gray-400">회색 = 역할(${esc(r ? r.name : '역할 없음')})에서 온 것 · <span class="text-green-600 font-bold">+</span> 더한 것 · <span class="text-red-600 font-bold">−</span> 뺀 것</span>
                    <button type="button" class="text-xs font-bold text-gray-600 dark:text-gray-300 hover:underline px-2 py-1 rounded" data-pm-act="reset" data-email="${esc(u.email)}">역할대로 되돌리기</button>
                </div>
                ${featureGrid(id => set.has(id), f => {
                    const inR = rf.has(f.id), inS = set.has(f.id);
                    if (inR && inS) return { cls: 'text-gray-500 dark:text-gray-400', tag: '' };
                    if (!inR && inS) return { cls: 'text-green-700 dark:text-green-400 font-bold', tag: '<span class="text-green-600 font-bold">+</span>' };
                    if (inR && !inS) return { cls: 'text-red-600 dark:text-red-400 line-through', tag: '<span class="text-red-600 font-bold no-underline">−</span>' };
                    return { cls: 'text-gray-700 dark:text-gray-300', tag: '' };
                }, 'feat', `data-email="${esc(u.email)}"`)}
            </div>` : '';
        return `<div class="pm-person p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800" data-email="${esc(u.email)}">
            <div class="flex flex-col md:flex-row gap-3 md:items-center">
                <div class="md:w-1/4 flex flex-col gap-0.5 shrink-0">
                    <span class="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-1 flex-wrap">${esc(u.name)}
                        <span class="text-[10px] font-normal bg-gray-100 dark:bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded">${esc(u.type)}</span>
                        ${p.auto && !p.admin ? '<span class="pm-auto text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">자동 배정</span>' : ''}</span>
                    <span class="text-xs text-gray-500 dark:text-gray-400">${esc(u.email)}</span>
                </div>
                <div class="md:w-32 shrink-0">
                    <label class="block text-[10px] text-gray-500 dark:text-gray-400 mb-1 font-bold">기본 권한</label>
                    <select class="pm-admin-select w-full p-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 rounded-md text-sm font-bold dark:text-white" data-pm-act="admin" data-email="${esc(u.email)}">
                        <option value="user" ${p.admin ? '' : 'selected'}>일반</option>
                        <option value="admin" ${p.admin ? 'selected' : ''}>관리자</option>
                    </select>
                </div>
                <div class="md:w-48 shrink-0">
                    <label class="block text-[10px] text-gray-500 dark:text-gray-400 mb-1 font-bold">역할</label>
                    ${roleCell}
                </div>
                <div class="md:w-16 shrink-0 text-sm" title="역할에서 더한 것 / 뺀 것">${ex || '<span class="text-gray-400">-</span>'}</div>
                <div class="flex gap-2 md:ml-auto">
                    ${p.admin ? '' : `<button type="button" data-pm-act="expand" data-pm-nodirty data-email="${esc(u.email)}" class="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline px-2 py-1 rounded">${open ? '세부 예외 ▴' : '세부 예외 ▾'}</button>`}
                    <button type="button" data-pm-act="preview" data-pm-nodirty data-email="${esc(u.email)}" class="text-xs font-bold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 px-2 py-1 rounded">${prev ? '미리보기 닫기' : '미리보기 ›'}</button>
                </div>
            </div>
            ${detail}
            ${prev ? drawPreview(u.email) : ''}
        </div>`;
    }).join('');
    return `<div class="text-xs text-gray-500 dark:text-gray-400 mb-3">새로 추가한 팀원은 <b>[전체 저장]</b> 후 목록에 나타나며, 새 직원 기본 역할(<b>${esc((model.roles[model.defaultRole] || {}).name || '없음')}</b>)을 받습니다. 시스템 계정·재직 복귀자는 역할 없음으로 시작합니다.</div>
        <div id="pm-people" class="space-y-3">${rows}</div>`;
}

function drawPreview(email) {
    const r = resolvedOf(model, email);
    const groups = withBuiltinMenus((config && config.dashboardMenu) || []);
    const names = (surface) => visibleMenuGroups(groups, r, surface, [])
        .flatMap(g => g.items.map(i => i.name))
        .filter(n => surface !== 'shell' || !SHELL_EXCLUDED_ACTIONS.includes(n));
    const list = (arr, empty = '없음') => arr.length ? arr.map(x => `<span class="inline-block mr-1.5 mb-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">${esc(x)}</span>`).join('') : `<span class="text-gray-400">${empty}</span>`;
    const pages = FEATURES.filter(f => f.kind === 'page' && r.set.has(f.id))
        .map(f => f.label + (!r.isAdmin && isAdminOnlyNow(f.id) ? ' (지금은 관리자만 입장)' : ''));
    const danger = FEATURES.filter(f => f.kind !== 'page' && f.danger >= 1 && r.set.has(f.id)).map(f => f.label + (f.danger >= 2 ? ' (!!)' : ''));
    const noRule = FEATURES.filter(f => f.danger >= 1 && f.rule === 'no' && r.set.has(f.id)).map(f => f.label);
    return `<div class="pm-preview mt-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 text-xs text-gray-700 dark:text-gray-200 space-y-2">
        <div class="font-bold text-blue-800 dark:text-blue-200">미리보기 — 저장 전 화면 기준${r.isAdmin ? ' · 관리자는 전체 기능' : ''}</div>
        <div><b class="inline-block w-36">① 보이는 메뉴(사이드바)</b>${list(names('sidebar'))}</div>
        <div><b class="inline-block w-36">　 보이는 메뉴(상단 메뉴)</b>${list(names('shell'))}</div>
        <div><b class="inline-block w-36">② 들어갈 수 있는 페이지</b>${list(pages)}</div>
        <div><b class="inline-block w-36">③ 할 수 있는 위험 기능</b>${list(danger)}</div>
        <div><b class="inline-block w-36">④ 규칙이 막지 않는 것</b>${list(noRule)} <span class="text-gray-400">(화면에서만 막힘 — 콘솔에서는 쓸 수 있음)</span></div>
    </div>`;
}

function drawRoles() {
    const cards = roleIdsSorted().map(id => {
        const r = model.roles[id];
        const n = usersOfRole(model, id);
        const isDefault = model.defaultRole === id;
        const canDel = n === 0 && !isDefault;
        const fs = new Set(r.features);
        return `<div class="pm-role p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800" data-role="${esc(id)}">
            <div class="flex flex-wrap items-center gap-2 mb-2">
                <input type="text" value="${esc(r.name)}" maxlength="40" data-pm-act="role-name" data-role="${esc(id)}"
                    class="text-sm font-extrabold p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md dark:text-white w-48">
                <span class="text-[10px] text-gray-400 font-mono">${esc(id)}</span>
                <span class="text-xs text-gray-600 dark:text-gray-300">${n}명 사용</span>
                ${isDefault ? '<span class="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">새 직원 기본</span>' : ''}
                <div class="ml-auto flex gap-2">
                    <button type="button" data-pm-act="role-dup" data-role="${esc(id)}" class="text-xs font-bold text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700">복제</button>
                    <button type="button" data-pm-act="role-del" data-role="${esc(id)}" ${canDel ? '' : 'disabled'} title="${canDel ? '' : '쓰는 사람이 있거나 새 직원 기본 역할이면 지울 수 없습니다'}"
                        class="text-xs font-bold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed">삭제</button>
                </div>
            </div>
            ${featureGrid(fid => fs.has(fid), () => ({ cls: 'text-gray-700 dark:text-gray-300', tag: '' }), 'role-feat', `data-role="${esc(id)}"`)}
        </div>`;
    }).join('');
    const defOpts = roleIdsSorted().map(id => `<option value="${esc(id)}" ${model.defaultRole === id ? 'selected' : ''}>${esc(model.roles[id].name)}</option>`).join('');
    return `<div class="flex flex-wrap items-center gap-3 mb-4">
            <button type="button" data-pm-act="role-add" class="text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 font-bold px-4 py-2 rounded-lg">+ 새 역할</button>
            <label class="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">새 직원 기본 역할
                <select data-pm-act="default-role" class="p-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 rounded-md text-sm font-bold dark:text-white">${defOpts}</select></label>
            <span class="text-xs text-gray-500 dark:text-gray-400">역할을 고치면 그 역할을 쓰는 사람 모두에게 바로 적용됩니다(저장 후).</span>
        </div>
        <div id="pm-roles" class="space-y-3">${cards}</div>`;
}

function drawFeatures() {
    const admins = adminCount(model);
    const groupLabel = Object.fromEntries(FEATURE_GROUPS.map(g => [g.id, g.label]));
    const rows = FEATURES.map(f => `<tr class="border-b border-gray-100 dark:border-gray-700">
        <td class="py-1.5 pr-3 font-mono text-[11px] text-gray-500">${esc(f.id)}</td>
        <td class="py-1.5 pr-3">${esc(f.label)}${ADMIN_ONLY_TAG(f.id)}</td>
        <td class="py-1.5 pr-3">${esc(groupLabel[f.group] || f.group)}</td>
        <td class="py-1.5 pr-3">${f.grantable ? (DANGER_BADGE[f.danger] || '-') : '-'}</td>
        <td class="py-1.5 pr-3">${f.grantable ? esc(RULE_TEXT[f.rule] || f.rule) : '관리자 전용'}</td>
        <td class="py-1.5 pr-3 text-right">${f.grantable ? holdersOf(model, f.id) + '명' : '-'}</td></tr>`).join('');
    return `<div class="text-xs text-gray-500 dark:text-gray-400 mb-2">읽기 전용. '가진 사람'은 일반 계정 수입니다(관리자 ${admins}명은 전부 가짐). '규칙으로 막음'은 Firestore 규칙 게시 뒤의 목표입니다.</div>
        <div class="overflow-x-auto"><table id="pm-features" class="w-full text-sm text-gray-700 dark:text-gray-200">
        <thead><tr class="text-left text-[11px] text-gray-500 border-b border-gray-200 dark:border-gray-600">
            <th class="py-1.5 pr-3">ID</th><th class="py-1.5 pr-3">이름</th><th class="py-1.5 pr-3">화면</th><th class="py-1.5 pr-3">위험</th><th class="py-1.5 pr-3">규칙으로 막음</th><th class="py-1.5 pr-3 text-right">가진 사람</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
}

// ── 이벤트 ──────────────────────────────────────────────

const DANGER_MSG = '되돌리기 어려운 기능입니다(덮어쓰기·삭제·마감).\n정말 이 권한을 줄까요?';
/** data.* 를 일반 직원에게 줄 때 — 막지 않고 안내만(사용자 결정: 데이터 관리는 지금 관리자만). */
const warnAdminOnlyNow = (id, on) => { if (on && isAdminOnlyNow(id)) alert(DATA_ADMIN_ONLY_NOTE); };
const confirmDanger = (id, on) => !on || !FEATURE_BY_ID[id] || FEATURE_BY_ID[id].danger < 2 || confirm(DANGER_MSG);

function onClick(e) {
    const t = e.target.closest('[data-pm-act]');
    if (!t || !model) return;
    const act = t.dataset.pmAct;
    const email = t.dataset.email;
    if (act === 'tab') { tab = t.dataset.tab; draw(); return; }
    if (act === 'expand') { openEmail = openEmail === email ? null : email; draw(); return; }
    if (act === 'preview') { previewEmail = previewEmail === email ? null : email; draw(); return; }
    if (act === 'reset') { resetToRole(model, email); draw(); return; }
    if (act === 'role-add') { addRole(model, '새 역할'); draw(); return; }
    if (act === 'role-dup') { addRole(model, null, t.dataset.role); draw(); return; }
    if (act === 'role-del') {
        if (!confirm('이 역할을 지울까요?')) return;
        if (!deleteRole(model, t.dataset.role)) alert('쓰는 사람이 있거나 새 직원 기본 역할이라 지울 수 없습니다.');
        draw();
    }
}

function onChange(e) {
    const t = e.target.closest('[data-pm-act]');
    if (!t || !model) return;
    const act = t.dataset.pmAct;
    const email = t.dataset.email;
    if (act === 'admin') {
        setAdmin(model, email, t.value === 'admin');
        if (t.value === 'admin' && openEmail === email) openEmail = null;
    } else if (act === 'role') {
        setRole(model, email, t.value);
    } else if (act === 'feat') {
        if (!confirmDanger(t.dataset.id, t.checked)) { t.checked = false; return; }
        warnAdminOnlyNow(t.dataset.id, t.checked);
        setFeature(model, email, t.dataset.id, t.checked);
    } else if (act === 'role-feat') {
        if (!confirmDanger(t.dataset.id, t.checked)) { t.checked = false; return; }
        warnAdminOnlyNow(t.dataset.id, t.checked);
        setRoleFeature(model, t.dataset.role, t.dataset.id, t.checked);
    } else if (act === 'role-name') {
        renameRole(model, t.dataset.role, t.value);
    } else if (act === 'default-role') {
        setDefaultRole(model, t.value);
    } else if (act === 'enforce') {
        setEnforce(model, t.value);
    } else {
        return;
    }
    draw();
}
