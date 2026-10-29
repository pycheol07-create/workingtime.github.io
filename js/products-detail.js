// === js/products-detail.js ===
// 상품 관리 — 상세(#p=품목코드) · 메모 저장 · (관리자) 기본정보 화면 편집 · 위치 카드 · 기본정보 변경 이력. 2026-10-13
// 설계: 상품DB_설계_v2.md 3-5·4-1, 시안 ProductDetail.dc.html
//
// 상세를 열 때 추가 읽기 0 — 이력은 [이력 보기]를 누를 때만(≤20+1).
// 메모: 전원 편집. 열 때 본 at 과 지금 at 이 다르면 충돌 확인창. 직전 5개 보관(되돌리기).
// 기본정보 편집: 관리자만(D5). 같은 트랜잭션 헬퍼(버킷 + META rev + 이력, ver 비교).
import { doc, getDoc, getDocs, collection, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { S, countRead, locOf, fmtDateTime, tsMs, applyLocalProduct, putLocalNote, noteHistory } from './products-store.js?v=202610291126';
import { esc, toast, setHead, isLocOld } from './products.js?v=202610291126';
import { statusPill } from './products-list.js?v=202610291126';
import { renderCostCard, renderCostHistory } from './products-cost.js?v=202610291126';
import { writeBucket, saveNote, NoteConflict } from './products-write.js?v=202610291126';
import { catalogBucketId, CATALOG_BUCKETS } from './lib/product-bucket.js?v=202610291126';
import { diffProduct, FIELD_LABEL, NAME_MAX, TEXT_MAX } from './lib/product-excel-rows.js?v=202610291126';
import { parseNum } from './lib/product-price.js?v=202610291126';
import { friendlyFirebaseError } from './utils.js?v=202610291126';   // 원시 오류 코드 대신 할 일 한 줄
import { sidebarLinkTarget } from './app-shell-data.js?v=202610291126';   // 열기 방식(같은 탭/이름 붙은 창)은 한 곳에서

const LOCATION_URL = 'location.html';

export function catalogChangeText(c) {
    const lab = c.opt ? `${c.opt} ${c.field === 'opt' ? '' : (FIELD_LABEL[c.field] || c.field)}`.trim() : (FIELD_LABEL[c.field] || c.field);
    if (c.field === 'gone') return `<b>${esc(lab)}</b> ${c.after ? '사라짐' : '다시 나타남'}`;
    if (c.field === 'opt') return `<b>${esc(lab)}</b> 새 옵션 ${esc(c.after)}`;
    const v = (x) => (x === null || x === '' || x === undefined) ? '(빈칸)' : String(x);
    return `<b>${esc(lab)}</b> ${esc(v(c.before))} → ${esc(v(c.after))}`;
}
const KIND_LABEL = { excel: '엑셀', 'excel-init': '첫 업로드', ui: '화면' };

export function renderDetail(main, pid) {
    const p = S.products.get(pid);
    if (!p) {
        setHead({ title: '상품을 찾지 못했습니다', back: true });
        main.innerHTML = `<section class="pd-card"><div class="pd-empty">품목코드 ${esc(pid)} 가 기본정보에 없습니다.<br><a href="#" class="pd-link">목록으로</a></div></section>`;
        return;
    }
    setHead({ title: p.name || pid, code: p.code2 || pid, crumb: `상품 관리 · ${p.cat || '카테고리 없음'}`, back: true });
    main.innerHTML = `<div class="pd-detail">
        <div class="pd-col">
            ${S.isAdmin ? '<section class="pd-card pd-card-pad" id="pd-cost"></section>' : ''}
            <section class="pd-card pd-card-pad" id="pd-info"></section>
            <section class="pd-card pd-card-pad" id="pd-opts"></section>
            <section class="pd-card pd-card-pad" id="pd-memo"></section>
        </div>
        <aside class="pd-col pd-aside">
            <section class="pd-card pd-card-pad" id="pd-loc"></section>
            <section class="pd-card pd-card-pad" id="pd-hist"></section>
            ${S.isAdmin ? '<section class="pd-card pd-card-pad" id="pd-costhist"></section>'
                : '<section class="pd-card pd-card-pad"><h2 class="pd-h2">원가 정보</h2><div class="pd-sub" style="margin-top:10px">원가와 공급처는 관리자만 볼 수 있습니다.</div></section>'}
        </aside></div>`;
    const rerender = () => renderDetail(main, pid);
    if (S.isAdmin) {
        renderCostCard(main.querySelector('#pd-cost'), pid, p, rerender);
        lazyHistory(main.querySelector('#pd-costhist'), '단가 변경 이력', (el) => renderCostHistory(el, pid), true);
    }
    renderInfo(main.querySelector('#pd-info'), main.querySelector('#pd-opts'), pid, p, rerender);
    renderMemo(main.querySelector('#pd-memo'), pid);
    renderLoc(main.querySelector('#pd-loc'), p);
    lazyHistory(main.querySelector('#pd-hist'), '기본정보 변경 이력', (el) => renderCatalogHistory(el, pid));
}

function lazyHistory(el, title, load, admin = false) {
    el.innerHTML = `<div class="pd-row"><h2 class="pd-h2 pd-grow">${title}</h2>${admin ? '<span class="pd-lock">관리자</span>' : ''}</div>
        <button class="d-btn" style="margin-top:12px" data-act="load">이력 보기</button>`;
    el.querySelector('[data-act="load"]').addEventListener('click', () => load(el));
}

// ── 기본정보 + 옵션 ───────────────────────────────────────
function renderInfo(info, optsEl, pid, p, rerender, editing = false) {
    const loadedVer = p.ver | 0;
    const kv = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const inp = (f, v, extra = '') => `<input class="pd-in" data-f="${f}" value="${esc(v ?? '')}" ${extra}>`;
    const src = p.src === 'ui' ? '화면 편집' : '엑셀';
    info.innerHTML = `<div class="pd-row"><h2 class="pd-h2 pd-grow">기본정보</h2>
            <span class="pd-sub">${p.at ? `${fmtDateTime(p.at)} ${src} · ${esc(p.by)}` : ''}</span>
            ${S.isAdmin && !editing ? '<button class="d-btn" data-act="edit">편집</button>' : ''}</div>
        ${p.gone ? `<div class="pd-alert risk" style="margin-top:12px">전체 목록 업로드에서 빠진 상품입니다(${fmtDateTime(p.goneAt)}). 지우지 않고 보관합니다 — 다시 올리면 돌아옵니다.</div>` : ''}
        ${editing ? `<div class="pd-grid4">
            <label class="pd-field span2">상품명${inp('name', p.name, `maxlength="${NAME_MAX}"`)}</label>
            <label class="pd-field">자체상품코드${inp('code2', p.code2, `maxlength="${TEXT_MAX}"`)}</label>
            <label class="pd-field">판매가${inp('price', p.price ?? '', 'inputmode="numeric" style="text-align:right"')}</label>
            <label class="pd-field">카테고리${inp('cat', p.cat, `maxlength="${TEXT_MAX}"`)}</label>
            <label class="pd-field">브랜드${inp('brand', p.brand, `maxlength="${TEXT_MAX}"`)}</label>
            <label class="pd-field">상태${inp('status', p.status, `maxlength="${TEXT_MAX}"`)}</label>
            <label class="pd-field">등록일${inp('regDate', p.regDate, 'maxlength="20"')}</label></div>`
        : `<dl class="pd-kv">
            ${kv('상품명', esc(p.name))}${kv('품목코드', `<span class="num">${esc(pid)}</span>`)}${kv('자체상품코드', `<span class="num">${esc(p.code2) || '–'}</span>`)}
            ${kv('브랜드', esc(p.brand) || '–')}${kv('카테고리', esc(p.cat) || '–')}
            ${kv('판매가', p.price !== null && p.price !== undefined ? `<span class="num">${Number(p.price).toLocaleString()}원</span>` : '–')}
            ${kv('상태', statusPill(p) || '–')}${kv('등록일', `<span class="num">${esc(p.regDate) || '–'}</span>`)}</dl>`}`;

    const opts = p.o;
    optsEl.innerHTML = `<div class="pd-row"><h2 class="pd-h2 pd-grow">옵션 <span class="pd-sub num">${opts.filter(o => !o[4]).length}개</span></h2></div>
        <div class="pd-table-box pd-scroll"><table class="pd-t pd-t-sm" style="min-width:620px">
        <thead><tr><th>상품코드</th><th>옵션명</th><th>바코드</th><th>옵션상태</th><th>위치</th><th class="r">자리 수량</th></tr></thead>
        <tbody>${opts.map((o, i) => {
            const L = locOf(o[0]);
            const q = L.spots.reduce((a, s) => a + (Number(s[2]) || 0), 0);
            const gone = o[4] ? ' <span class="pd-pill risk">사라짐</span>' : '';
            if (editing) return `<tr data-i="${i}"><td class="num">${esc(o[0])}${gone}</td>
                <td><input class="pd-in" data-o="1" value="${esc(o[1])}" maxlength="${NAME_MAX}" aria-label="${esc(o[0])} 옵션명"></td>
                <td><input class="pd-in num" data-o="2" value="${esc(o[2])}" maxlength="${TEXT_MAX}" aria-label="${esc(o[0])} 바코드"></td>
                <td><input class="pd-in" data-o="3" value="${esc(o[3])}" maxlength="${TEXT_MAX}" aria-label="${esc(o[0])} 옵션상태" style="width:110px"></td><td></td><td></td></tr>`;
            return `<tr class="${o[4] ? 'is-gone' : ''}"><td class="num">${esc(o[0])}${gone}</td><td>${esc(o[1])}</td><td class="num pd-inh">${esc(o[2])}</td><td>${esc(o[3])}</td>
                <td class="num">${L.spots.map(s => esc(s[0])).join(', ') || '<span class="pd-inh">–</span>'}</td><td class="r num">${L.spots.length ? q.toLocaleString() : ''}</td></tr>`;
        }).join('') || '<tr><td colspan="6" class="pd-inh">옵션 없음</td></tr>'}</tbody></table></div>
        ${editing ? `<div class="pd-actions" data-info-editing><span class="pd-note pd-err" data-f="msg"></span>
            <button class="d-btn pd-btn-lg" data-act="cancel">취소</button><button class="d-btn d-btn-primary pd-btn-lg" data-act="save">기본정보 저장</button></div>`
        : (S.isAdmin ? '' : '<div class="pd-note" style="margin-top:10px">기본정보는 관리자가 엑셀 업로드·화면 편집으로 고칩니다.</div>')}`;

    if (!S.isAdmin) return;
    info.querySelector('[data-act="edit"]')?.addEventListener('click', () => renderInfo(info, optsEl, pid, p, rerender, true));
    if (!editing) return;
    optsEl.querySelector('[data-act="cancel"]').addEventListener('click', () => renderInfo(info, optsEl, pid, p, rerender, false));
    optsEl.querySelector('[data-act="save"]').addEventListener('click', async (ev) => {
        const msg = optsEl.querySelector('[data-f="msg"]');
        const val = (f) => info.querySelector(`[data-f="${f}"]`).value.trim();
        const next = { ...p, o: p.o.map(o => o.slice()) };
        for (const f of ['name', 'code2', 'cat', 'brand', 'status', 'regDate']) next[f] = val(f);
        if (!next.name) { msg.textContent = '상품명은 비울 수 없습니다'; return; }
        const pr = val('price');
        if (pr === '') next.price = null;
        else { const n = parseNum(pr); if (!Number.isFinite(n) || n < 0) { msg.textContent = '판매가가 숫자가 아닙니다'; return; } next.price = n; }
        optsEl.querySelectorAll('tr[data-i]').forEach(tr => {
            const o = next.o[+tr.dataset.i];
            tr.querySelectorAll('[data-o]').forEach(inp2 => { o[+inp2.dataset.o] = inp2.value.trim(); });
        });
        if (next.o.some(o => /^\d(\.\d+)?e\+?\d+$/i.test(o[2]))) { msg.textContent = '바코드가 1.23E+12 꼴입니다'; return; }
        delete next.bid; delete next.ver; delete next.at; delete next.by;
        const changes = diffProduct(pid, p, next);
        if (!changes.length) { msg.className = 'pd-note'; msg.textContent = '바뀐 것이 없습니다'; return; }
        ev.target.disabled = true; msg.className = 'pd-note'; msg.textContent = '저장 중…';
        try {
            const bid = p.bid || catalogBucketId(pid, Number(S.meta && S.meta.n) || CATALOG_BUCKETS);
            const r = await writeBucket(S.db, 'catalog', bid, [{ pid, expectVer: loadedVer, next, changes }], { email: S.email, logKind: 'ui', src: 'ui' });
            if (r.conflict.length) {
                const cur = r.conflict[0].cur;
                if (cur) { cur.bid = bid; applyLocalProduct(pid, cur); }
                toast('다른 관리자가 먼저 고쳤습니다 — 최신 값을 다시 보여 줍니다', 5000);
            } else {
                const obj = { ...r.ok[0].obj, bid };
                applyLocalProduct(pid, obj);
                if (S.meta && S.meta.chunks && S.meta.chunks[bid]) S.meta.chunks[bid].rev = (Number(S.meta.chunks[bid].rev) || 0) + 1;
                toast('기본정보를 저장했습니다');
            }
            rerender();
        } catch (e) {
            console.error('[products] 기본정보 저장 실패:', e && e.code);
            ev.target.disabled = false;
            msg.className = 'pd-note pd-err';
            msg.textContent = '저장 실패 — ' + friendlyFirebaseError(e);
        }
    });
}

// ── 메모 ─────────────────────────────────────────────────
function renderMemo(el, pid) {
    const n = S.notes.get(pid) || { inspect: '', pack: '', at: 0, by: '', h: [] };
    const loadedAt = n.at || 0;
    el.innerHTML = `<div class="pd-row"><h2 class="pd-h2 pd-grow">앱 메모</h2><span class="pd-sub">${n.at ? `${fmtDateTime(n.at)} · ${esc(n.by)}` : '팀원 누구나 고칠 수 있습니다'}</span></div>
        <div class="pd-alert warn" data-f="memo-warn" style="margin-top:12px">원가·공급처명·고객 정보(이름·연락처·주문번호)는 적지 마세요 — 팀원 전원이 봅니다.</div>
        <div class="pd-grid2">
            <label class="pd-field">검수 주의사항<textarea class="pd-in" data-f="inspect" maxlength="2000" placeholder="원가·공급처명은 적지 마세요">${esc(n.inspect)}</textarea></label>
            <label class="pd-field">포장 메모<textarea class="pd-in" data-f="pack" maxlength="2000" placeholder="원가·공급처명은 적지 마세요">${esc(n.pack)}</textarea></label></div>
        ${(n.h || []).length ? `<details style="margin-top:12px"><summary class="pd-sub" style="cursor:pointer">직전 기록 ${n.h.length}개 (실수로 지웠을 때)</summary>
            <ol class="pd-hist">${n.h.map((x, i) => `<li><div class="top"><span class="pd-sub">${fmtDateTime(x.at)} · ${esc(x.by)}</span><button class="d-btn d-btn-sm" data-h="${i}">이 내용으로 채우기</button></div>
                <div class="chg">검수: ${esc(x.inspect) || '–'}<br>포장: ${esc(x.pack) || '–'}</div></li>`).join('')}</ol></details>` : ''}
        <div class="pd-actions"><span class="pd-note" data-f="msg"></span><button class="d-btn d-btn-primary pd-btn-lg" data-act="save">메모 저장</button></div>`;
    const ta = (f) => el.querySelector(`[data-f="${f}"]`);
    el.querySelectorAll('[data-h]').forEach(b => b.addEventListener('click', () => {
        const x = n.h[+b.dataset.h];
        ta('inspect').value = x.inspect || ''; ta('pack').value = x.pack || '';
        el.querySelector('[data-f="msg"]').textContent = '채웠습니다 — 저장을 눌러야 반영됩니다';
    }));
    el.querySelector('[data-act="save"]').addEventListener('click', async (ev) => {
        const msg = el.querySelector('[data-f="msg"]');
        const vals = { inspect: ta('inspect').value.trim(), pack: ta('pack').value.trim() };
        if (vals.inspect === (n.inspect || '') && vals.pack === (n.pack || '')) { msg.textContent = '바뀐 것이 없습니다'; return; }
        ev.target.disabled = true; msg.textContent = '저장 중…';
        const done = async () => {
            const s = await getDoc(doc(S.db, 'ProductNotes', pid));      // 서버 시각(at)을 받아 다음 충돌 비교에 쓴다
            countRead('메모');
            const x = s.data() || {};
            await putLocalNote(pid, { inspect: x.inspect || '', pack: x.pack || '', at: tsMs(x.at), by: x.by || '', h: noteHistory(x.h) });
            toast('메모를 저장했습니다');
            renderMemo(el, pid);
        };
        try {
            await saveNote(S.db, pid, vals, loadedAt, S.email);
            await done();
        } catch (e) {
            if (e instanceof NoteConflict) {
                const c = e.cur;
                const ok = confirm(`다른 사람이 먼저 고쳤습니다${c ? ` (${fmtDateTime(c.at)} · ${c.by})` : ''}.\n\n지금 내용:\n검수: ${c ? c.inspect : ''}\n포장: ${c ? c.pack : ''}\n\n[확인] 내 내용으로 덮어쓰기 (앞 내용은 직전 기록에 남음)\n[취소] 최신 내용 보기`);
                try {
                    if (ok) { await saveNote(S.db, pid, vals, c ? c.at : 0, S.email); await done(); }
                    else { await putLocalNote(pid, c ? { ...c, h: (S.notes.get(pid) || {}).h || [] } : { inspect: '', pack: '', at: 0, by: '', h: [] }); renderMemo(el, pid); }
                } catch (e2) {
                    console.error('[products] 메모 저장 실패:', e2 && e2.code);
                    msg.textContent = '저장 실패 — ' + friendlyFirebaseError(e2); ev.target.disabled = false;
                }
                return;
            }
            console.error('[products] 메모 저장 실패:', e && e.code);
            msg.textContent = '저장 실패 — ' + friendlyFirebaseError(e);
            ev.target.disabled = false;
        }
    });
}

// ── 위치·재고 (채우기 요약) ──────────────────────────────────
// 같은 탭 모드(1b)면 target 없이, 되돌리면 사이드바와 같은 이름 붙은 창
const locTarget = () => { const t = sidebarLinkTarget(LOCATION_URL); return t ? ` target="${t}"` : ''; };
function renderLoc(el, p) {
    const at = S.locMeta && S.locMeta.at ? tsMs(S.locMeta.at) : 0;
    const head = `<div class="pd-row"><h2 class="pd-h2 pd-grow">위치 · 재고</h2>${at && isLocOld() ? '<span class="pd-pill warn">오래됨</span>' : ''}</div>`;
    // 이 상품의 옵션 코드로 로케이션관리 데이터 리스트를 걸러서 연다(?q=쉼표로 여러 개 — js/location.js applyUrlSearchOnce).
    // 요약은 아침 기준이라 걸러 넘기지 않는다 — 살아 있는 옵션 전부(코드당 약 10자라 주소 길이 문제 없음)
    const codes = p.o.filter(o => !o[4]).map(o => String(o[0] || '').trim()).filter(Boolean);
    const href = codes.length ? `${LOCATION_URL}?q=${encodeURIComponent(codes.join(','))}#tab=list` : LOCATION_URL;
    const link = `<a class="d-btn pd-btn-lg" style="display:block; margin-top:16px; text-decoration:none" href="${esc(href)}"${locTarget()}>로케이션관리에서 보기</a>`;
    if (!S.loc) {
        el.innerHTML = head + `<div class="pd-note" style="margin-top:12px">위치 요약이 아직 없습니다. 실시간 위치는 로케이션관리에서 확인하세요.</div>` + link;
        return;
    }
    const rows = [];
    let anyStock = false;
    for (const o of p.o) {
        if (o[4]) continue;
        const L = locOf(o[0]);
        if (!L.spots.length && !L.reserve && !L.stock) continue;
        if (L.stock) anyStock = true;
        rows.push(`<li style="padding:8px 0; border-bottom:1px solid var(--c-line-soft)"><div class="num"><b style="font-weight:600">${esc(o[0])}</b> <span class="pd-sub">${esc(o[1])}</span></div>
            ${L.spots.map(s => `<div class="num">${esc(s[0])} <span class="pd-inh">${esc(s[1] || '')}</span> · ${s[2] ?? '–'}개</div>`).join('')}
            ${L.reserve ? `<div class="num">비축 ${L.reserve[0]}개${L.reserve[1] ? ` · ${esc(L.reserve[1])}` : ''}</div>` : ''}
            ${L.stock ? `<div class="num pd-sub">정상 ${L.stock[0] ?? '–'} · 출고예정 ${L.stock[1] ?? '–'}</div>` : ''}</li>`);
    }
    el.innerHTML = head + `<div class="pd-sub" style="margin-top:6px">${fmtDateTime(at)} 기준 · 로케이션 기준 수량</div>
        ${rows.length ? `<ul class="pd-locs" style="gap:0">${rows.join('')}</ul>` : '<div class="pd-note" style="margin-top:12px">로케이션에 등록된 자리가 없습니다(요약 기준).</div>'}
        <div class="pd-note" style="margin-top:10px">평일 아침 채우기 지시서를 만들 때의 요약입니다. 정상재고·출고예정은 비축재고가 있는 상품만 나옵니다${anyStock ? '' : '(이 상품은 없음)'}.</div>` + link;
}

// ── 기본정보 변경 이력 ─────────────────────────────────────
async function renderCatalogHistory(el, pid) {
    el.innerHTML = `<h2 class="pd-h2">기본정보 변경 이력</h2><div class="pd-note" style="margin-top:12px">불러오는 중…</div>`;
    try {
        const snap = await getDocs(query(collection(S.db, 'ProductCatalogLog'), where('pids', 'array-contains', pid), orderBy('at', 'desc'), limit(20)));
        countRead('기본정보 이력', Math.max(1, snap.size));
        const items = snap.docs.map(d => {
            const x = d.data();
            const mine = (x.changes || []).filter(c => c.pid === pid);
            const body = x.kind === 'excel-init' ? '처음 등록' : mine.slice(0, 6).map(catalogChangeText).join('<br>') + (mine.length > 6 ? `<br><span class="pd-inh">외 ${mine.length - 6}건</span>` : '');
            return `<li><div class="top"><b style="font-weight:600">${KIND_LABEL[x.kind] || esc(x.kind)}</b><span class="pd-sub num">${fmtDateTime(tsMs(x.at))} · ${esc(x.by)}</span></div><div class="chg">${body}</div></li>`;
        });
        el.querySelector('.pd-note').outerHTML = items.length ? `<ol class="pd-hist">${items.join('')}</ol>` : '<div class="pd-note" style="margin-top:12px">이력이 없습니다</div>';
    } catch (e) {
        const prep = e && e.code === 'failed-precondition';
        el.querySelector('.pd-note').textContent = prep ? '이력 색인 준비 중 — 관리자가 Firestore 색인을 만들면 보입니다' : `이력을 읽지 못했습니다 — ${friendlyFirebaseError(e)}`;
    }
}

/** 탭: 기본정보 변경 이력(최근 50건, 전원) */
export async function renderCatalogLog(main) {
    main.innerHTML = `<section class="pd-card pd-card-pad"><h2 class="pd-h2">기본정보 변경 이력 (최근 50건)</h2>
        <div class="pd-note" id="pd-gl" style="margin-top:12px">불러오는 중…</div></section>`;
    try {
        const snap = await getDocs(query(collection(S.db, 'ProductCatalogLog'), orderBy('at', 'desc'), limit(50)));
        countRead('기본정보 이력', Math.max(1, snap.size));
        const rows = snap.docs.map(d => {
            const x = d.data(); const ch = x.changes || []; const ct = x.counts || {};
            const sum = x.counts ? ['new', 'changed', 'gone', 'revived'].filter(k => ct[k]).map(k => `${{ new: '새로', changed: '변경', gone: '사라짐', revived: '다시 나타남' }[k]} ${ct[k]}`).join(' · ') : '';
            return `<tr><td class="num">${fmtDateTime(tsMs(x.at))}</td><td>${esc(x.by)}</td><td>${KIND_LABEL[x.kind] || esc(x.kind)}</td><td class="r num">${(x.pids || []).length}</td>
                <td class="pd-chg">${sum ? `<span class="pd-sub">업로드 전체: ${sum}</span><br>` : ''}${ch.slice(0, 3).map(c => `<a href="#p=${encodeURIComponent(c.pid)}" class="num">${esc(c.pid)}</a> ${catalogChangeText(c)}`).join('<br>')}${ch.length > 3 ? `<br><span class="pd-inh">외 ${ch.length - 3}건</span>` : ''}</td></tr>`;
        });
        main.querySelector('#pd-gl').outerHTML = rows.length
            ? `<div class="pd-scroll" style="margin-top:12px"><table class="pd-t pd-t-sm" style="min-width:760px"><thead><tr><th>시각</th><th>누가</th><th>방식</th><th class="r">품목</th><th>바뀐 것</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
            : '<div class="pd-note" style="margin-top:12px">이력이 없습니다</div>';
    } catch (e) {
        main.querySelector('#pd-gl').textContent = `이력을 읽지 못했습니다 — ${friendlyFirebaseError(e)}`;
    }
}
