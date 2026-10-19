// === js/refill-card.js ===
// 로케이션관리 대시보드 맨 위 '채우기 지시서' 카드 + 표 창(#refill-modal).
//   카드는 접힌 띠 한 줄(요약 · 엑셀 받기 · 펼치기)이 기본, [펼치기]로 아래 전체 내용(날짜 선택·진행률·버튼). 펼침은 js/lib/card-fold.js.
//   지시서는 이 PC 프로그램(업무자동화\앱\채우기자동화)이 매일 08:20 슬랙에 보내면서 같은 것을 Firestore 에도 남긴다(7일치).
//   카드: 엑셀 받기 · 표 보기 · 행별 완료 체크(오늘 것만) · 지금 기준으로 다시 만들기(앱에만 갱신, 슬랙에는 안 보냄).
// 문서·순수 함수는 js/lib/refill-view.js 머리말 참고.
// ⚠️ Firebase 를 여기서 초기화하지 않는다 — location.js 가 만든 db·auth 를 받아 쓴다(두 번 초기화하면 duplicate-app).
// ⚠️ 체크·요청에 남기는 이름은 getMemberName()(= memberNameFor, 직원 이름)만. 없으면 '이름 없음' — 이메일은 쓰지 않는다.
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, getHolidayName } from './utils.js?v=202610191558';
import {
    tsMs, dayKey, lastDays, dayLabel, fmtHM, parseDay, progress, runDay, dayStatus, reqUi, b64ToBytes, fileNameOf, refillStrip, fmtCount
} from './lib/refill-view.js?v=202610191558';
import { initFold } from './lib/card-fold.js?v=202610191558';

const APP = 'artifacts/team-work-logger-v2';
const META_PATH = `${APP}/integrations/refillLatest`;
const DAY_PATH = (key) => `${APP}/integrations/refillDay_${key}`;
const WORK_PATH = (key) => `${APP}/refillWork/${key}`;
const REQUEST_PATH = `${APP}/refillWork/request`;
const NO_NAME = '이름 없음';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEETS = { rows: '채우기(현장용)', checks: '확인필요' };
/** window.localStorage 참조 자체가 던지는 브라우저도 있다 */
const getStorage = () => { try { return window.localStorage; } catch (e) { return null; } };

export function initRefillCard({ db, auth, getMemberName }) {
    const card = document.getElementById('refill-card');
    const body = document.getElementById('refill-body');
    const sel = document.getElementById('refill-day');
    const modal = document.getElementById('refill-modal');
    if (!card || !body || !sel || !modal || !db || !auth) return;
    const mTitle = document.getElementById('refill-modal-title');
    const mMeta = document.getElementById('refill-modal-meta');
    const mTbody = document.getElementById('refill-tbody');
    const mTodo = document.getElementById('refill-only-todo');
    const mAll = document.getElementById('refill-all-btn');
    const mTabs = document.getElementById('refill-tabs');
    const strip = document.getElementById('refill-strip');
    const stripAct = document.getElementById('refill-strip-act');
    const foldBtn = document.getElementById('refill-fold');
    const detail = document.getElementById('refill-detail');

    const S = {
        signedIn: false, meta: null, metaErr: '', request: null,
        key: '', userPicked: false,            // 선택한 날짜(기본 = 오늘)
        day: null,                             // { key, rev, data, parsed } — 선택 날짜 문서
        dayLoading: '', dayErr: '',
        work: { key: '', checks: {} },
        tab: 'rows', saving: new Set()
    };
    let unsubs = [], unsubWork = null;

    const nameOf = () => {
        try { const n = getMemberName && getMemberName(); return (typeof n === 'string' && n.trim()) ? n.trim().slice(0, 20) : NO_NAME; }
        catch (e) { return NO_NAME; }
    };
    const todayKey = () => dayKey(Date.now());
    const holidayName = (y, m, d) => getHolidayName(y, m, d);
    const entryOf = (key) => (S.meta && S.meta.days && S.meta.days[key]) || null;

    // ── 구독 ──
    function stopAll() {
        unsubs.forEach(u => { try { u(); } catch (e) { /* 무시 */ } });
        unsubs = [];
        if (unsubWork) { try { unsubWork(); } catch (e) { /* 무시 */ } unsubWork = null; }
    }

    function start() {
        stopAll();
        unsubs.push(onSnapshot(doc(db, META_PATH), snap => {
            S.meta = snap.exists() ? (snap.data() || {}) : {};
            S.metaErr = '';
            syncDay();
            render();
        }, err => { S.metaErr = (err && err.code) || '읽기 오류'; render(); }));
        unsubs.push(onSnapshot(doc(db, REQUEST_PATH), snap => {
            S.request = snap.exists() ? (snap.data({ serverTimestamps: 'estimate' }) || {}) : null;
            render();
        }, () => { S.request = null; }));
    }

    // 선택 날짜 문서: 날짜가 바뀌거나 그날 rev 가 바뀔 때만 다시 읽는다(xlsx 가 들어 있어 매번 받지 않는다)
    function syncDay() {
        const today = todayKey();
        if (!S.userPicked || !lastDays(today, 7).includes(S.key)) S.key = today;
        const e = entryOf(S.key);
        const rev = e && e.status === 'ok' ? e.rev : null;
        if (rev == null) {
            S.day = null; S.dayErr = '';
        } else if (!S.day || S.day.key !== S.key || S.day.rev !== rev) {
            const key = S.key, want = `${key}#${rev}`;
            if (S.dayLoading !== want) {
                S.dayLoading = want;
                getDoc(doc(db, DAY_PATH(key))).then(snap => {
                    if (S.dayLoading !== want) return;
                    S.dayLoading = '';
                    const data = snap.exists() ? snap.data() : null;
                    S.day = data ? { key, rev, data, parsed: parseDay(data) } : null;
                    S.dayErr = data ? '' : '지시서 문서를 찾지 못했습니다';
                    render(); renderModal();
                }).catch(err => {
                    if (S.dayLoading !== want) return;
                    S.dayLoading = ''; S.dayErr = `지시서를 읽지 못했습니다(${(err && err.code) || '오류'})`;
                    render();
                });
            }
        }
        if (S.work.key !== S.key) {
            if (unsubWork) { try { unsubWork(); } catch (e) { /* 무시 */ } }
            const key = S.key;
            S.work = { key, checks: {} };
            unsubWork = onSnapshot(doc(db, WORK_PATH(key)), snap => {
                if (S.work.key !== key) return;
                const d = snap.exists() ? (snap.data({ serverTimestamps: 'estimate' }) || {}) : {};
                S.work.checks = (d.checks && typeof d.checks === 'object') ? d.checks : {};
                render(); renderModal();
            }, () => { /* 못 읽으면 체크 없이 */ });
        }
    }

    // ── 카드 ──
    function renderSelect(today) {
        const keys = lastDays(today, 7);
        const html = keys.map(k => {
            const st = dayStatus({ meta: S.meta, key: k, todayKey: today, nowMs: Date.now(), holidayName });
            const tail = (k === today ? ' · 오늘' : '') + (st.status === 'rest' ? ' (휴일)' : '');
            return `<option value="${k}"${k === S.key ? ' selected' : ''}>${escapeHtml(dayLabel(k) + tail)}</option>`;
        }).join('');
        if (lastSelHtml !== html) { lastSelHtml = html; sel.innerHTML = html; }   // 같으면 다시 그리지 않는다(열린 목록이 닫히지 않게)
    }
    let lastSelHtml = '';

    // ── 접힌 띠 ── 같은 내용이면 다시 그리지 않는다(누르던 버튼 포커스가 1분마다 풀리지 않게)
    let lastStrip = '', lastAct = '';
    function setStrip(sumHtml, actHtml) {
        if (strip && lastStrip !== sumHtml) { lastStrip = sumHtml; strip.innerHTML = sumHtml; }
        if (stripAct && lastAct !== actHtml) { lastAct = actHtml; stripAct.innerHTML = actHtml; }
    }
    const warnBadge = (warns) => (warns.length
        ? `<span class="badge badge-warn topcard-warn" role="note" tabindex="0" title="${escapeHtml(warns.join(' / '))}" aria-label="주의 ${warns.length}건: ${escapeHtml(warns.join(' / '))}">주의 ${warns.length}</span>` : '');
    function renderStrip({ st, key, isToday, d, ru }) {
        const warns = [];
        if (st.status === 'ok' && !d && S.dayErr) warns.push(S.dayErr);
        if (st.status === 'ok' && ru.show && ru.note && ru.tone === 'warn') warns.push(ru.note);
        const sp = refillStrip({ st, entry: entryOf(key), parsed: d ? d.parsed : null, checkMap: S.work.checks, extraWarns: warns });
        const day = isToday ? '' : `<span>${escapeHtml(dayLabel(key))}</span>`;
        if (sp.msg) { setStrip(day + `<span class="${sp.tone === 'warn' ? 'refill-warn' : ''}">${escapeHtml(sp.msg)}</span>` + warnBadge(sp.warns), ''); return; }
        const sum = day + sp.items.map(it => `<span>${escapeHtml(it.label)} <b>${escapeHtml(it.value)}</b></span>`).join('')
            + (sp.prog ? `<span>완료 <b>${sp.prog.done}/${sp.prog.total}</b></span>` : '') + warnBadge(sp.warns);
        const omitted = d && d.data.fileOmitted;
        const act = omitted
            ? '<button type="button" class="btn btn-primary btn-sm" disabled title="파일이 너무 커서 PC 채우기자동화\\출력\\ 사용">엑셀 받기</button>'
            : `<button type="button" class="btn btn-primary btn-sm" data-refill="download"${d && d.data.file ? '' : ' disabled'}>엑셀 받기</button>`;
        setStrip(sum, act);
    }

    function render() {
        if (!S.signedIn) {
            body.innerHTML = '<div class="refill-msg">로그인하면 보입니다.</div>';
            setStrip('<span class="refill-sub">로그인하면 보입니다.</span>', '');
            return;
        }
        if (S.meta == null) {
            const t = S.metaErr ? '지시서 상태를 읽지 못했습니다(' + escapeHtml(S.metaErr) + ')' : '불러오는 중…';
            body.innerHTML = `<div class="refill-msg">${t}</div>`;
            setStrip(`<span class="${S.metaErr ? 'refill-warn' : 'refill-sub'}">${t}</span>`, '');
            return;
        }
        const today = todayKey();
        renderSelect(today);
        const key = S.key, isToday = key === today, now = Date.now();
        const st = dayStatus({ meta: S.meta, key, todayKey: today, nowMs: now, holidayName });
        const rd = runDay(key, S.meta.schedule, holidayName);
        const ru = reqUi({ req: S.meta.req, requestMs: S.request ? tsMs(S.request.requestedAt) : 0, nowMs: now,
                           isToday, isRunDay: rd.run, todayKey: today });
        const parts = [];
        const d = st.status === 'ok' && S.day && S.day.key === key ? S.day : null;
        if (st.status === 'ok') {
            const e = entryOf(key) || {};
            const rows = d ? d.parsed.rows : [], checks = d ? d.parsed.checks : [];
            const pr = progress(rows, S.work.checks), pc = progress(checks, S.work.checks);
            parts.push(`<div class="refill-line">기준 <b>${escapeHtml(fmtHM(e.basedAt) || '-')}</b> · 채울 칸 <b>${num(e.rows)}</b> · 채울 수량 <b>${num(e.fillQty)}</b> · 확인필요 <b>${num(e.checks)}</b></div>`);
            if (e.source === 'request') {
                const sl = d && d.data.slack;
                const slackTxt = sl && sl.at ? `슬랙에는 ${escapeHtml(fmtHM(sl.at))} 판` : '슬랙에는 보내지 않음';
                parts.push(`<div class="refill-sub">앱에서 다시 만듦 ${escapeHtml(fmtHM(e.basedAt))} · ${slackTxt}</div>`);
            }
            if (d) {
                parts.push(`<div class="refill-prog"><span>완료 <b>${pr.done}/${pr.total}</b> (${pr.pct}%)</span>`
                    + `<div class="kpi-bar refill-bar"><div style="width:${pr.pct}%; background:var(--c-ok);"></div></div>`
                    + (pc.total ? `<span class="refill-sub">확인필요 ${pc.done}/${pc.total}</span>` : '') + '</div>');
                if (d.parsed.error) parts.push(`<div class="refill-msg refill-warn">${escapeHtml(d.parsed.error)}</div>`);
            } else if (S.dayErr) {
                parts.push(`<div class="refill-msg refill-warn">${escapeHtml(S.dayErr)}</div>`);
            } else {
                parts.push('<div class="refill-sub">표 불러오는 중…</div>');
            }
            const omitted = d && d.data.fileOmitted;
            parts.push('<div class="refill-actions">'
                + (omitted ? '<span class="refill-sub">파일이 너무 커서 PC 채우기자동화\\출력\\ 사용</span>'
                    : `<button type="button" class="btn btn-primary btn-sm" data-refill="download"${d && d.data.file ? '' : ' disabled'}>엑셀 받기</button>`)
                + `<button type="button" class="btn btn-secondary btn-sm" data-refill="table"${d ? '' : ' disabled'}>표 보기</button>`
                + reqButton(ru) + '</div>');
        } else {
            parts.push(`<div class="refill-msg${st.status === 'fail' || st.status === 'missing' ? ' refill-warn' : ''}">${escapeHtml(st.text)}</div>`);
            // 다시 만들기는 그날 정기 지시서가 있어야 받는다(프로그램 --요청확인 이 정기 발송 기록 없으면 거절) — 버튼을 두지 않는다
        }
        if (ru.show && ru.note && st.status === 'ok') parts.push(`<div class="refill-note${ru.tone === 'warn' ? ' refill-warn' : ''}">${escapeHtml(ru.note)}</div>`);
        body.innerHTML = parts.join('');
        renderStrip({ st, key, isToday, d, ru });
    }

    const num = fmtCount;
    const reqButton = (ru) => (ru.show
        ? `<button type="button" class="btn btn-secondary btn-sm" data-refill="rebuild"${ru.enabled ? '' : ' disabled'}>${escapeHtml(ru.label)}</button>` : '');

    // ── 표 창 ──
    function renderModal() {
        if (modal.style.display !== 'flex') return;
        const d = S.day && S.day.key === S.key ? S.day : null;
        const editable = S.key === todayKey();
        mTitle.textContent = `채우기 지시서 ${dayLabel(S.key)}`;
        mTabs.querySelectorAll('[data-refill-tab]').forEach(b => b.classList.toggle('active', b.getAttribute('data-refill-tab') === S.tab));
        const list = d ? d.parsed[S.tab] : [];
        const pr = progress(list, S.work.checks);
        mMeta.textContent = `${SHEETS[S.tab]} ${list.length}행 · 완료 ${pr.done}/${pr.total}`
            + (editable ? '' : ' · 지난 날짜는 볼 수만 있습니다');
        // [전체 완료] / 모두 완료면 [전체 해제] — 오늘 지시서·보고 있는 시트만
        const allDone = pr.total > 0 && pr.done >= pr.total;
        mAll.hidden = !(editable && list.length);
        mAll.textContent = allDone ? '전체 해제' : '전체 완료';
        mAll.disabled = S.saving.has('*all');
        const todoOnly = mTodo.checked;
        const rows = list.filter(r => !(todoOnly && S.work.checks[r.code] && S.work.checks[r.code].done === true));
        if (!rows.length) {
            mTbody.innerHTML = `<tr><td colspan="6" class="refill-empty">${list.length ? '안 한 것이 없습니다' : '행이 없습니다'}</td></tr>`;
            return;
        }
        mTbody.innerHTML = rows.map(r => {
            const c = S.work.checks[r.code] || {};
            const done = c.done === true;
            const who = done ? `${escapeHtml(c.by || NO_NAME)} ${escapeHtml(fmtHM(c.at))}` : '';
            const busy = S.saving.has(r.code);
            return `<tr class="${done ? 'refill-done' : ''}">`
                + `<td class="refill-chk"><input type="checkbox" data-refill-code="${escapeHtml(r.code)}" aria-label="완료 ${escapeHtml(r.loc)}"`
                + `${done ? ' checked' : ''}${editable && !busy ? '' : ' disabled'}></td>`
                + `<td class="refill-loc">${escapeHtml(r.loc)}</td><td>${escapeHtml(r.reserve)}</td>`
                + `<td class="refill-num">${r.qty == null ? '' : num(r.qty)}</td><td class="refill-num">${r.stock == null ? '' : num(r.stock)}</td>`
                + `<td class="refill-who">${who}</td></tr>`;
        }).join('');
    }

    function openModal() {
        modal.style.display = 'flex';
        renderModal();
    }

    async function toggleCheck(code, done) {
        if (S.key !== todayKey() || S.saving.has(code)) return;
        const key = S.key;
        S.saving.add(code);
        try {
            await setDoc(doc(db, WORK_PATH(key)), { checks: { [code]: { done, by: nameOf(), at: serverTimestamp() } } }, { merge: true });
        } catch (e) {
            alert(`완료 표시를 저장하지 못했습니다(${(e && e.code) || '오류'}). 다시 눌러 주세요.`);
        } finally {
            S.saving.delete(code);
            renderModal(); render();
        }
    }

    // 보고 있는 시트의 행을 한 번에 완료(또는 모두 완료면 해제) — 문서 하나에 merge 1회(행마다 키라 다른 사람 체크와 섞이지 않음)
    async function toggleAll() {
        const key = S.key;
        const d = S.day && S.day.key === key ? S.day : null;
        if (key !== todayKey() || !d || S.saving.has('*all')) return;
        const list = d.parsed[S.tab] || [];
        const pr = progress(list, S.work.checks);
        const done = !(pr.total > 0 && pr.done >= pr.total);
        const targets = list.map(r => r.code).filter(c => c && ((S.work.checks[c] || {}).done === true) !== done);
        if (!targets.length) return;
        const msg = done ? `${SHEETS[S.tab]} ${targets.length}행을 모두 완료로 표시할까요?`
                         : `${SHEETS[S.tab]} ${targets.length}행의 완료 표시를 모두 지울까요?`;
        if (!confirm(msg)) return;
        S.saving.add('*all');
        renderModal();
        try {
            const by = nameOf(), at = serverTimestamp(), checks = {};
            targets.forEach(c => { checks[c] = { done, by, at }; });
            await setDoc(doc(db, WORK_PATH(key)), { checks }, { merge: true });
        } catch (e) {
            alert(`한꺼번에 저장하지 못했습니다(${(e && e.code) || '오류'}). 다시 눌러 주세요.`);
        } finally {
            S.saving.delete('*all');
            renderModal(); render();
        }
    }

    function download() {
        const d = S.day && S.day.key === S.key ? S.day : null;
        if (!d || !d.data.file || !d.data.file.b64) return;
        let url = '';
        try {
            const blob = new Blob([b64ToBytes(d.data.file.b64)], { type: XLSX_TYPE });
            url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileNameOf(d.data, d.key);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            alert('엑셀 파일을 만들지 못했습니다. PC 채우기자동화\\출력\\ 의 파일을 쓰세요.');
        } finally {
            if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
    }

    async function rebuild() {
        const today = todayKey();
        if (S.key !== today || !S.meta) return;
        const ru = reqUi({ req: S.meta.req, requestMs: S.request ? tsMs(S.request.requestedAt) : 0, nowMs: Date.now(),
                           isToday: true, isRunDay: runDay(today, S.meta.schedule, holidayName).run, todayKey: today });
        if (!ru.enabled) { render(); return; }
        if (!confirm('이 PC 프로그램이 지금 재고로 지시서를 새로 만듭니다.\n슬랙에는 다시 보내지 않습니다(앱에서만 바뀝니다). 보통 3~8분 걸립니다.\n\n다시 만들까요?')) return;
        try {
            await setDoc(doc(db, REQUEST_PATH), { requestedAt: serverTimestamp(), by: nameOf(), day: today });
        } catch (e) {
            alert(`요청하지 못했습니다(${(e && e.code) || '오류'}).`);
        }
    }

    // ── 이벤트 ──
    card.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-refill]');
        if (!b || b.disabled) return;
        const act = b.getAttribute('data-refill');
        if (act === 'download') download();
        else if (act === 'table') openModal();
        else if (act === 'rebuild') rebuild();
    });
    sel.addEventListener('change', () => {
        S.key = sel.value;
        S.userPicked = S.key !== todayKey();
        syncDay();
        render(); renderModal();
    });
    mTabs.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-refill-tab]');
        if (!b) return;
        S.tab = b.getAttribute('data-refill-tab') === 'checks' ? 'checks' : 'rows';
        renderModal();
    });
    mTodo.addEventListener('change', renderModal);
    mAll.addEventListener('click', toggleAll);
    mTbody.addEventListener('change', (ev) => {
        const t = ev.target;
        if (!t || !t.matches('input[type=checkbox][data-refill-code]')) return;
        toggleCheck(t.getAttribute('data-refill-code'), t.checked);
    });
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal || ev.target.closest('[data-refill-close]')) modal.style.display = 'none';
    });
    // ESC — 공통 js/modal-esc.js 는 .fixed.inset-0 오버레이만 닫아서 이 창(.modal-overlay)은 여기서 닫는다(열려 있을 때만)
    document.addEventListener('keydown', (ev) => {
        if ((ev.key === 'Escape' || ev.key === 'Esc') && modal.style.display === 'flex') { ev.preventDefault(); modal.style.display = 'none'; }
    });

    if (foldBtn && detail) initFold({ btn: foldBtn, panel: detail, card, id: 'refill', name: '채우기 지시서', storage: getStorage() });

    // 시간에 따라 바뀌는 문구(08:20 대기 → 확인 중, 처리 대기 15분, 자정 넘김)를 1분마다 다시
    setInterval(() => { if (S.signedIn && S.meta) { syncDay(); render(); } }, 60 * 1000);

    auth.onAuthStateChanged(user => {
        S.signedIn = !!user;
        if (user) start();
        else { stopAll(); S.meta = null; S.day = null; S.work = { key: '', checks: {} }; modal.style.display = 'none'; }
        render();
    });
    render();
}
