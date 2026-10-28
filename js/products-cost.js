// === js/products-cost.js ===
// 상품 관리 — (관리자) 원가·공급처·단가 이력. 2026-10-13. 설계: 상품DB_설계(v1) 1-6~1-8·3장
//
// 🔒 원가(adminProductCost/C00~C15)·공급처 대장(adminSuppliers/LEDGER)·단가 이력(adminProductCostLog)은 관리자만 읽는다(규칙).
//    읽은 값은 **이 모듈의 메모리(C)에만** 둔다 — IndexedDB·localStorage 에 저장하지 않는다. 계정이 바뀌면 products.js 가 reload.
//    팀원 화면에서는 이 모듈의 함수가 불리지 않는다(관리자 영역 DOM 자체를 만들지 않음).
// ⚠️ 원가 값·공급처 이름을 console 에 찍지 말 것(오류는 code 만).
import {
    doc, getDoc, getDocs, collection, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { S, countRead, fmtDateTime, tsMs } from './products-store.js?v=202610281554';
import { esc, toast } from './products.js?v=202610281554';
import { costBucketIds, costBucketId } from './lib/product-bucket.js?v=202610281554';
import { parseCostJson, diffCostObj, emptyCost, FIELD_LABEL, MEMO_MAX, isSupCode } from './lib/product-excel-rows.js?v=202610281554';
import { normalizePrice, round2, fmt2 } from './lib/product-price.js?v=202610281554';
import { writeBucket, addSupplier, updateSupplier } from './products-write.js?v=202610281554';
import { friendlyFirebaseError } from './utils.js?v=202610281554';   // 원시 오류 코드 대신 할 일 한 줄
import { stripCheckMemo } from './lib/product-ezadmin.js?v=202610281554';

export const C = { costs: null, ledger: null };

export const costOf = (pid) => (C.costs && C.costs.get(pid)) || null;
export const ledgerCodes = () => new Set(Object.keys((C.ledger && C.ledger.s) || {}));

/** 원가 16 + 대장 1 읽기 (관리자만 부른다) */
export async function loadCosts() {
    if (!S.isAdmin) return;
    const snaps = await Promise.all(costBucketIds().map(id => getDoc(doc(S.db, 'adminProductCost', id))));
    countRead('원가', snaps.length);
    const m = new Map();
    for (const s of snaps) {
        if (!s.exists()) continue;
        for (const [pid, json] of Object.entries(s.data().p || {})) {
            const c = parseCostJson(json);
            if (c) m.set(pid, c);
        }
    }
    C.costs = m;
    await loadLedger();
}
export async function loadLedger() {
    const s = await getDoc(doc(S.db, 'adminSuppliers', 'LEDGER'));
    countRead('공급처 대장');
    C.ledger = s.exists() ? s.data() : { nextNo: 1, s: {} };
}

const priceText = (p) => p ? `¥${fmt2(p.cny)} ($${fmt2(p.usd)}, 환율 ${p.rate}${p.rateDate ? ', ' + p.rateDate.slice(5) : ''})` : '없음';
export function costChangeText(c) {
    // 원가메모는 원문(단가 원문·메모 내용)을 미리보기·이력 목록에 펼치지 않는다 — 바뀌었다는 것만
    if (c.field === 'memo') {
        const markOnly = stripCheckMemo(c.before || '') === stripCheckMemo(c.after || '');
        return `<b>${esc(FIELD_LABEL.memo)} 변경${markOnly ? '(단가 확인 표식)' : ''}</b>`;
    }
    const lab = c.opt ? `${c.opt} ${c.field === 'opt' ? '개별 단가' : FIELD_LABEL[c.field] || c.field}` : (FIELD_LABEL[c.field] || c.field);
    const v = (x) => (c.field === 'base' || c.field === 'opt') ? priceText(x)
        : (c.field === 'krw' || c.field === 'okrw') ? (x === null || x === undefined ? '없음' : `${Number(x).toLocaleString()}원`)
        : (x === null || x === '' ? '없음' : String(x));
    return `<b>${esc(lab)}</b> ${esc(v(c.before))} → ${esc(v(c.after))}`;
}

// ── 상세: 원가·공급처 카드 ──────────────────────────────────
/** container 에 카드를 그린다. onSaved() = 저장 뒤 다시 그리기 */
export function renderCostCard(container, pid, p, onSaved) {
    const cur = costOf(pid);
    const loadedVer = cur ? (cur.ver | 0) : 0;
    const c = cur || emptyCost();
    const base = c.base;
    const sups = Object.entries((C.ledger && C.ledger.s) || {}).filter(([k, v]) => v.active !== false || k === c.sup).sort();
    const lastRate = base ? base.rate : (Number(localStorage.getItem('products_lastRate')) || '');
    const today = new Date(); const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const opts = p.o.filter(o => !o[4]);
    container.innerHTML = `
        <div class="pd-row"><h2 class="pd-h2 pd-grow">원가 · 공급처</h2>
            <span class="pd-lock"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>관리자만 보임</span></div>
        ${C.costs ? '' : '<div class="pd-alert risk" style="margin-top:12px">원가를 읽지 못했습니다 — 새로고침 후 다시 시도하세요. (이 상태에서는 저장하지 않습니다)</div>'}
        <div class="pd-grid4">
            <label class="pd-field">공급처
                <select class="pd-in" data-f="sup"><option value="">(미지정)</option>${sups.map(([k, v]) => `<option value="${esc(k)}" ${k === c.sup ? 'selected' : ''}>${esc(k)}${v.active === false ? ' (중지)' : ''}${v.auto && !v.name ? ' (자동 등록)' : ''}</option>`).join('')}</select>
                <small>이름·연락처는 공급처 대장에</small></label>
            <label class="pd-field">기본 단가 (위안)<input class="pd-in num" data-f="cny" inputmode="decimal" value="${base ? fmt2(base.cny) : ''}"></label>
            <label class="pd-field">기본 단가 (달러)<input class="pd-in num" data-f="usd" inputmode="decimal" value="${base ? fmt2(base.usd) : ''}">
                <small data-f="srcnote">${base ? (base.src === 'usd' ? '달러로 입력' : base.src === 'both' ? '둘 다 입력' : '위안으로 입력') : ''}</small></label>
            <label class="pd-field">기본 원가 (원)<input class="pd-in num" data-f="krw" inputmode="numeric" value="${c.krw ?? ''}"></label>
            <label class="pd-field">환율 (1달러당 위안)<input class="pd-in num" data-f="rate" inputmode="decimal" value="${lastRate}"></label>
            <label class="pd-field">기준일<input class="pd-in" data-f="rateDate" type="date" value="${base && base.rateDate ? esc(base.rateDate) : ymd}"></label>
            <label class="pd-field">최소 주문(MOQ)<input class="pd-in num" data-f="moq" inputmode="numeric" value="${c.moq ?? ''}"></label>
            <label class="pd-field">제작 기간(일)<input class="pd-in num" data-f="leadDays" inputmode="numeric" value="${c.leadDays ?? ''}"></label>
            <label class="pd-field">원가 메모<input class="pd-in" data-f="memo" maxlength="${MEMO_MAX}" value="${esc(c.memo || '')}"></label>
        </div>
        <div class="pd-row" style="margin-top:26px"><h3 class="pd-h3 pd-grow">옵션별 단가</h3><span class="pd-note">비우면 기본 단가를 따릅니다(회색)</span></div>
        <div class="pd-table-box pd-scroll"><table class="pd-t pd-t-sm" style="min-width:660px">
            <thead><tr><th>상품코드</th><th>옵션</th><th class="r">위안</th><th class="r">달러</th><th>기준일</th><th class="r">원화</th></tr></thead>
            <tbody>${opts.map(o => {
                const own = c.o && c.o[o[0]];
                const ownK = c.ok ? c.ok[o[0]] : undefined;
                return `<tr data-s="${esc(o[0])}"><td class="num">${esc(o[0])}</td><td>${esc(o[1])}</td>
                    <td class="r"><input class="pd-in num sm ${own ? 'is-own' : ''}" data-o="cny" inputmode="decimal" value="${own ? fmt2(own.cny) : ''}" placeholder="${base ? fmt2(base.cny) : ''}" aria-label="${esc(o[0])} 위안"></td>
                    <td class="r"><input class="pd-in num sm ${own ? 'is-own' : ''}" data-o="usd" inputmode="decimal" value="${own ? fmt2(own.usd) : ''}" placeholder="${base ? fmt2(base.usd) : ''}" aria-label="${esc(o[0])} 달러"></td>
                    <td class="${own ? '' : 'pd-inh'}">${own ? esc((own.rateDate || '').slice(5)) : '기본값'}</td>
                    <td class="r"><input class="pd-in num sm ${ownK !== undefined && ownK !== null ? 'is-own' : ''}" data-o="krw" inputmode="numeric" value="${ownK ?? ''}" placeholder="${c.krw ?? ''}" aria-label="${esc(o[0])} 원화"></td></tr>`;
            }).join('') || '<tr><td colspan="6" class="pd-inh">옵션 없음</td></tr>'}</tbody></table></div>
        <div class="pd-actions"><span class="pd-note" data-f="msg"></span>
            <span class="pd-note">${cur ? `마지막 수정 ${fmtDateTime(cur.at)} · ${esc(cur.by)}` : '아직 입력 없음'}</span>
            <button class="d-btn d-btn-primary pd-btn-lg" data-f="save" ${C.costs ? '' : 'disabled'}>원가 저장</button></div>`;

    const q = (f) => container.querySelector(`[data-f="${f}"]`);
    const num = (el) => { const v = el.value.trim(); return v === '' ? null : Number(v.replace(/,/g, '')); };
    // 한쪽을 고치면 반대쪽을 환율로 다시 계산한다 (src 기억)
    let src = base ? (base.src === 'usd' ? 'usd' : 'cny') : 'cny';
    const recalc = (cnyEl, usdEl, from) => {
        const rate = num(q('rate'));
        if (!rate) return;
        if (from === 'cny') { const v = num(cnyEl); usdEl.value = v ? fmt2(round2(v / rate)) : ''; }
        else { const v = num(usdEl); cnyEl.value = v ? fmt2(round2(v * rate)) : ''; }
    };
    q('cny').addEventListener('input', () => { src = 'cny'; recalc(q('cny'), q('usd'), 'cny'); q('srcnote').textContent = '위안으로 입력'; });
    q('usd').addEventListener('input', () => { src = 'usd'; recalc(q('cny'), q('usd'), 'usd'); q('srcnote').textContent = '달러로 입력'; });
    q('rate').addEventListener('input', () => recalc(q('cny'), q('usd'), src));
    const osrc = new Map();
    container.querySelectorAll('tr[data-s]').forEach(tr => {
        const ci = tr.querySelector('[data-o="cny"]'), ui = tr.querySelector('[data-o="usd"]');
        ci.addEventListener('input', () => { osrc.set(tr.dataset.s, 'cny'); recalc(ci, ui, 'cny'); ci.classList.toggle('is-own', !!ci.value); ui.classList.toggle('is-own', !!ci.value); });
        ui.addEventListener('input', () => { osrc.set(tr.dataset.s, 'usd'); recalc(ci, ui, 'usd'); ci.classList.toggle('is-own', !!ui.value); ui.classList.toggle('is-own', !!ui.value); });
        const ki = tr.querySelector('[data-o="krw"]');
        ki.addEventListener('input', () => ki.classList.toggle('is-own', !!ki.value));
    });

    q('save').addEventListener('click', async () => {
        const msg = q('msg');
        msg.className = 'pd-note pd-err';
        const errs = [];
        const rate = num(q('rate')), rateDate = q('rateDate').value || null;
        const price = (cnyV, usdV, s, old) => {
            if (cnyV === null && usdV === null) return { price: null };
            // 손대지 않은 값이면 원래 단가 그대로(환율을 안 바꿨으면 재계산하지 않는다)
            if (old && cnyV === round2(old.cny) && usdV === round2(old.usd) && (!rate || rate === old.rate)) return { price: old };
            const r = normalizePrice(s === 'usd' ? { usd: usdV, rate } : { cny: cnyV, rate }, { rateDate });
            if (r.errors.length) errs.push(r.errors.join(', '));
            return r;
        };
        const next = { ...emptyCost(), ...(cur ? { ...cur } : {}), o: {}, ok: {} };
        next.base = price(num(q('cny')), num(q('usd')), src, base).price || null;
        const krwOk = (v) => v === null || (Number.isInteger(v) && v >= 0);
        next.krw = num(q('krw'));
        if (!krwOk(next.krw)) errs.push('기본 원가(원)는 0 이상 정수');
        container.querySelectorAll('tr[data-s]').forEach(tr => {
            const s = tr.dataset.s;
            const cv = num(tr.querySelector('[data-o="cny"]')), uv = num(tr.querySelector('[data-o="usd"]'));
            const r = price(cv, uv, osrc.get(s) || 'cny', c.o && c.o[s]);
            if (r.price && !(next.base && round2(r.price.cny) === round2(next.base.cny) && round2(r.price.usd) === round2(next.base.usd))) next.o[s] = r.price;
            const kv = num(tr.querySelector('[data-o="krw"]'));       // 비우면 기본 원화 상속, 기본값과 같으면 개별 저장 안 함
            if (!krwOk(kv)) errs.push(`${s} 원화는 0 이상 정수`);
            else if (kv !== null && kv !== next.krw) next.ok[s] = kv;
        });
        // 옵션이 지금 목록에 없는(사라진) 개별 단가·원화는 그대로 둔다
        for (const [s, v] of Object.entries(c.o || {})) if (!opts.some(o => o[0] === s)) next.o[s] = v;
        for (const [s, v] of Object.entries(c.ok || {})) if (!opts.some(o => o[0] === s)) next.ok[s] = v;
        next.sup = q('sup').value;
        if (next.sup && !isSupCode(next.sup)) errs.push('공급처코드 모양');
        for (const k of ['moq', 'leadDays']) {
            const v = num(q(k));
            if (v !== null && (!Number.isInteger(v) || v < 0)) errs.push(`${FIELD_LABEL[k]}는 0 이상 정수`);
            next[k] = v;
        }
        next.memo = q('memo').value.trim();
        if (errs.length) { msg.textContent = errs.join(' / '); return; }
        delete next.ver; delete next.at; delete next.by;
        const changes = diffCostObj(pid, cur, next);
        if (!changes.length) { msg.className = 'pd-note'; msg.textContent = '바뀐 것이 없습니다'; return; }
        q('save').disabled = true; msg.className = 'pd-note'; msg.textContent = '저장 중…';
        try {
            const r = await writeBucket(S.db, 'cost', costBucketId(pid), [{ pid, expectVer: loadedVer, next, changes }], { email: S.email, logKind: 'ui' });
            if (r.conflict.length) {
                const now = r.conflict[0].cur;
                if (now) C.costs.set(pid, now); else C.costs.delete(pid);
                toast('다른 관리자가 먼저 고쳤습니다 — 최신 값을 다시 보여 줍니다. 다시 입력해 주세요', 5000);
            } else {
                C.costs.set(pid, r.ok[0].obj);
                if (rate) localStorage.setItem('products_lastRate', String(rate));   // 환율은 원가가 아님(공개 정보)
                toast('원가를 저장했습니다');
            }
            onSaved && onSaved();
        } catch (e) {
            console.error('[products] 원가 저장 실패:', e && e.code);
            q('save').disabled = false;
            msg.className = 'pd-note pd-err';
            msg.textContent = '저장 실패 — ' + friendlyFirebaseError(e);
        }
    });
}

// ── 상세: 단가 변경 이력 ───────────────────────────────────
export async function renderCostHistory(container, pid) {
    container.innerHTML = `<div class="pd-row"><h2 class="pd-h2 pd-grow">단가 변경 이력</h2><span class="pd-lock">관리자</span></div><div class="pd-note" style="margin-top:12px">불러오는 중…</div>`;
    try {
        const snap = await getDocs(query(collection(S.db, 'adminProductCostLog'), where('pids', 'array-contains', pid), orderBy('at', 'desc'), limit(20)));
        countRead('단가 이력', Math.max(1, snap.size));
        const items = [];
        for (const d of snap.docs) {
            const x = d.data();
            const mine = (x.changes || []).filter(c => c.pid === pid);
            if (!mine.length) continue;
            items.push(`<li><div class="top num"><b style="font-weight:600">${x.kind === 'ui' ? '화면' : '엑셀'}</b><span class="pd-sub">${fmtDateTime(tsMs(x.at))} · ${esc(x.by)}</span></div>
                <div class="chg num">${mine.slice(0, 6).map(costChangeText).join('<br>')}${mine.length > 6 ? `<br><span class="pd-inh">외 ${mine.length - 6}건</span>` : ''}</div></li>`);
        }
        container.querySelector('.pd-note').outerHTML = items.length ? `<ol class="pd-hist">${items.join('')}</ol>` : '<div class="pd-note" style="margin-top:12px">이력이 없습니다</div>';
    } catch (e) {
        const prep = e && e.code === 'failed-precondition';
        container.querySelector('.pd-note').textContent = prep ? '이력 색인 준비 중 — 관리자가 Firestore 색인을 만들면 보입니다' : `이력을 읽지 못했습니다 — ${friendlyFirebaseError(e)}`;
    }
}

// ── 탭: 단가 변경 이력(전체 최근) ──────────────────────────
export async function renderCostLog(main) {
    main.innerHTML = `<section class="pd-card pd-card-pad"><div class="pd-row"><h2 class="pd-h2 pd-grow">단가 변경 이력 (최근 50건)</h2><span class="pd-lock">관리자</span></div>
        <div class="pd-note" id="pd-cl" style="margin-top:12px">불러오는 중…</div></section>`;
    try {
        const snap = await getDocs(query(collection(S.db, 'adminProductCostLog'), orderBy('at', 'desc'), limit(50)));
        countRead('단가 이력', Math.max(1, snap.size));
        const rows = snap.docs.map(d => {
            const x = d.data(); const ch = x.changes || [];
            return `<tr><td class="num">${fmtDateTime(tsMs(x.at))}</td><td>${esc(x.by)}</td><td>${x.kind === 'ui' ? '화면' : '엑셀'}</td>
                <td class="r num">${(x.pids || []).length}</td>
                <td class="pd-chg">${ch.slice(0, 3).map(c => `<a href="#p=${encodeURIComponent(c.pid)}" class="num">${esc(c.pid)}</a> ${costChangeText(c)}`).join('<br>')}${ch.length > 3 ? `<br><span class="pd-inh">외 ${ch.length - 3}건</span>` : ''}</td></tr>`;
        });
        main.querySelector('#pd-cl').outerHTML = rows.length
            ? `<div class="pd-scroll" style="margin-top:12px"><table class="pd-t pd-t-sm" style="min-width:760px"><thead><tr><th>시각</th><th>누가</th><th>방식</th><th class="r">품목</th><th>바뀐 것</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
            : '<div class="pd-note" style="margin-top:12px">이력이 없습니다</div>';
    } catch (e) {
        main.querySelector('#pd-cl').textContent = `이력을 읽지 못했습니다 — ${friendlyFirebaseError(e)}`;
    }
}

// ── 탭: 공급처 대장 ────────────────────────────────────────
export function renderSuppliers(main) {
    const L = C.ledger || { s: {} };
    const entries = Object.entries(L.s || {}).sort();
    const used = new Map();
    if (C.costs) for (const c of C.costs.values()) if (c.sup) used.set(c.sup, (used.get(c.sup) || 0) + 1);
    const inp = (f, v = '', ph = '') => `<input class="pd-in" data-f="${f}" value="${esc(v)}" placeholder="${ph}" maxlength="${f === 'memo' ? 300 : 100}">`;
    main.innerHTML = `<section class="pd-card pd-card-pad">
        <div class="pd-row"><h2 class="pd-h2 pd-grow">공급처 대장</h2><span class="pd-lock">관리자만 보임</span></div>
        <div class="pd-note" style="margin-top:6px">공급처 실명·연락처는 여기 한 곳에만 둡니다. 원가에는 코드만 들어갑니다(직접 추가 = SUP-001 형식, 이지어드민 원가 업로드 = 그 파일의 공급처 값을 코드로 '자동 등록'). 지우지 않고 '중지'로 바꿉니다.</div>
        <div class="pd-scroll" style="margin-top:14px"><table class="pd-t pd-t-sm" style="min-width:880px">
            <thead><tr><th>코드</th><th>이름</th><th>담당자</th><th>연락처</th><th>메모</th><th class="r">상품</th><th>상태</th><th></th></tr></thead>
            <tbody>${entries.map(([k, v]) => `<tr data-code="${esc(k)}"><td class="num"><b>${esc(k)}</b>${v.auto ? ' <span class="pd-pill warn">자동 등록</span>' : ''}</td>
                <td>${inp('name', v.name)}</td><td>${inp('contact', v.contact)}</td><td>${inp('phone', v.phone)}</td><td>${inp('memo', v.memo)}</td>
                <td class="r num">${used.get(k) || 0}</td>
                <td><select class="pd-in" data-f="active" style="width:90px"><option value="1" ${v.active !== false ? 'selected' : ''}>사용</option><option value="0" ${v.active === false ? 'selected' : ''}>중지</option></select></td>
                <td><button class="d-btn d-btn-sm" data-act="save">저장</button></td></tr>`).join('')
                || '<tr><td colspan="8" class="pd-inh">등록된 공급처가 없습니다</td></tr>'}
                <tr data-new="1"><td class="pd-inh">새 코드</td><td>${inp('name', '', '이름')}</td><td>${inp('contact', '', '담당자')}</td><td>${inp('phone', '', '연락처')}</td><td>${inp('memo', '', '메모')}</td><td></td><td></td>
                <td><button class="d-btn d-btn-sm d-btn-primary" data-act="add">추가</button></td></tr>
            </tbody></table></div></section>`;
    main.querySelector('tbody').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-act]'); if (!b) return;
        const tr = b.closest('tr');
        const val = (f) => (tr.querySelector(`[data-f="${f}"]`)?.value || '').trim();
        const entry = { name: val('name'), contact: val('contact'), phone: val('phone'), memo: val('memo') };
        if (b.dataset.act === 'add' && !entry.name) { toast('이름을 넣어 주세요'); return; }   // 기존 행(자동 등록 포함)은 이름 빈칸도 저장
        b.disabled = true;
        try {
            if (b.dataset.act === 'add') {
                const code = await addSupplier(S.db, entry, S.email);
                toast(`${code} 로 등록했습니다`);
            } else {
                entry.active = val('active') !== '0';
                const old = (L.s || {})[tr.dataset.code] || {};
                if (old.auto && !entry.name) entry.auto = 1;          // 이름을 채우기 전까지는 '자동 등록' 표시 유지
                await updateSupplier(S.db, tr.dataset.code, entry, S.email);
                toast('저장했습니다');
            }
            await loadLedger();
            renderSuppliers(main);
        } catch (err) {
            console.error('[products] 공급처 저장 실패:', err && err.code);
            toast('저장 실패 — ' + friendlyFirebaseError(err));
            b.disabled = false;
        }
    });
}
