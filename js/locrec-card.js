// === js/locrec-card.js ===
// 로케이션관리 대시보드 '로케이션 변경 추천' 카드 — 채우기 지시서 카드 바로 아래.
//   추천은 이 PC 프로그램(업무자동화\앱\로케이션추천)이 매일 06:40 이지어드민 출고 28일로 만들어 Firestore 에 남긴다(14일치).
//   카드: 판정·지표·자료 상태 · 날짜 선택 · 오늘 추천 수 · [표 보기]·[엑셀 받기](그날 전체). 표는 창(#locrec-modal)에 —
//   창: 탭[단독|맞바꾸기|페어] 표 · 행마다 [처리함]/[안 함]/되돌리기(처음 보여 주는 날짜만, 지난 날짜는 볼 수만) · 엑셀 받기(지금 탭, 5열, 맞바꾸기·페어는 2행).
//   카드는 접힌 띠 한 줄(판정 · 추천 n건 · 엑셀 받기 · 펼치기)이 기본, [펼치기]로 아래 요약. 펼침은 js/lib/card-fold.js.
//   [변경 추천] 모달(업로드 자료 기준, location.js)과는 수요 자료가 달라 결과가 다를 수 있다 — 계산 모듈은 같다(js/lib/loc-recommend.js).
// 문서 모양·순수 함수는 js/lib/locrec-view.js 머리말 참고.
// ⚠️ Firebase 를 여기서 초기화하지 않는다 — location.js 가 만든 db·auth 를 받아 쓴다(두 번 초기화하면 duplicate-app).
// ⚠️ 표시에 남기는 이름은 getMemberName()(= memberNameFor, 직원 이름)만. 없으면 '이름 없음' — 이메일은 쓰지 않는다.
import { doc, onSnapshot, setDoc, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml } from './utils.js?v=202610191604';
import {
    dayKey, fmtHM, fmtMDHM, parseRecDay, verdictBadge, metricItems, dataWarnings, dataLine, rowState, dayOptions, defaultDay,
    dayMessage, fileNameOf, tabCounts, stockAtOf, excelRows, EXCEL_COLS, TABS, TAB_LABEL, SHEET_NAME, fmtNum, recStrip,
    stripRows, fileNameAll, tabSummary, canMark, tabMeta, dayLabel, rowLines
} from './lib/locrec-view.js?v=202610191604';
import { initFold } from './lib/card-fold.js?v=202610191604';

const APP = 'artifacts/team-work-logger-v2';
const LATEST_PATH = `${APP}/integrations/locRecLatest`;
const DAY_PATH = (key) => `${APP}/integrations/locRec_${key}`;
const MARKS_PATH = `${APP}/locRecWork/marks`;
const NO_NAME = '이름 없음';
/** window.localStorage 참조 자체가 던지는 브라우저도 있다 */
const getStorage = () => { try { return window.localStorage; } catch (e) { return null; } };

export function initLocRecCard({ db, auth, getMemberName }) {
    const card = document.getElementById('locrec-card');
    const body = document.getElementById('locrec-body');
    const sel = document.getElementById('locrec-day');
    const modal = document.getElementById('locrec-modal');
    if (!card || !body || !sel || !modal || !db || !auth) return;
    const mTitle = document.getElementById('locrec-modal-title');
    const mMeta = document.getElementById('locrec-modal-meta');
    const mTabs = document.getElementById('locrec-tabs');
    const mSkipWrap = document.getElementById('locrec-skip-wrap');
    const mSkip = document.getElementById('locrec-show-skip');
    const mSkipTxt = document.getElementById('locrec-skip-txt');
    const mDl = document.getElementById('locrec-dl-btn');
    const mTbody = document.getElementById('locrec-tbody');
    const strip = document.getElementById('locrec-strip');
    const stripAct = document.getElementById('locrec-strip-act');
    const foldBtn = document.getElementById('locrec-fold');
    const detail = document.getElementById('locrec-detail');

    const S = {
        signedIn: false, latest: null, latestErr: '',
        key: '', userPicked: false,
        day: null, dayErr: '', dayLoading: false,       // day = { key, data, parsed }
        marks: {}, tab: 'single', showSkipped: false, saving: new Set()
    };
    let unsubs = [], unsubDay = null, dayKeyWatching = '';

    const nameOf = () => {
        try { const n = getMemberName && getMemberName(); return (typeof n === 'string' && n.trim()) ? n.trim().slice(0, 20) : NO_NAME; }
        catch (e) { return NO_NAME; }
    };
    const todayKey = () => dayKey(Date.now());
    const entryOf = (key) => (S.latest && S.latest.days && S.latest.days[key]) || null;

    // ── 구독 ──
    function stopDay() {
        if (unsubDay) { try { unsubDay(); } catch (e) { /* 무시 */ } unsubDay = null; }
        dayKeyWatching = '';
    }
    function stopAll() {
        unsubs.forEach(u => { try { u(); } catch (e) { /* 무시 */ } });
        unsubs = [];
        stopDay();
    }
    function start() {
        stopAll();
        unsubs.push(onSnapshot(doc(db, LATEST_PATH), snap => {
            S.latest = snap.exists() ? (snap.data() || {}) : {};
            S.latestErr = '';
            syncDay();
            render();
        }, err => { S.latestErr = (err && err.code) || '읽기 오류'; render(); }));
        unsubs.push(onSnapshot(doc(db, MARKS_PATH), snap => {
            const d = snap.exists() ? (snap.data({ serverTimestamps: 'estimate' }) || {}) : {};
            S.marks = (d.marks && typeof d.marks === 'object') ? d.marks : {};
            render();
        }, () => { /* 못 읽으면 표시 없이 */ }));
    }

    function syncDay() {
        const today = todayKey();
        const opts = dayOptions(S.latest, today).map(o => o.key);
        if (!S.userPicked || !opts.includes(S.key)) S.key = defaultDay(S.latest, today);
        const e = entryOf(S.key);
        if (!e || e.status !== 'ok') { stopDay(); S.day = null; S.dayErr = ''; S.dayLoading = false; return; }
        if (dayKeyWatching === S.key) return;
        stopDay();
        const key = S.key;
        dayKeyWatching = key;
        S.dayLoading = true; S.dayErr = '';
        unsubDay = onSnapshot(doc(db, DAY_PATH(key)), snap => {
            if (dayKeyWatching !== key) return;
            S.dayLoading = false;
            const data = snap.exists() ? snap.data() : null;
            S.day = data ? { key, data, parsed: parseRecDay(data) } : null;
            S.dayErr = data ? '' : '추천 문서를 찾지 못했습니다';
            render();
        }, err => {
            if (dayKeyWatching !== key) return;
            S.dayLoading = false; S.dayErr = `추천을 읽지 못했습니다(${(err && err.code) || '오류'})`;
            render();
        });
    }

    // ── 그리기 ──
    let lastSelHtml = '';
    function renderSelect(today) {
        const html = dayOptions(S.latest, today).map(o =>
            `<option value="${o.key}"${o.key === S.key ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
        if (lastSelHtml !== html) { lastSelHtml = html; sel.innerHTML = html; }   // 같으면 다시 그리지 않는다(열린 목록이 닫히지 않게)
    }

    const n0 = (v) => (v == null ? '' : Number(v).toLocaleString('ko-KR'));
    const nameCell = (name, option) => `${escapeHtml(name || '')}${option ? ` <span class="locrec-opt">(${escapeHtml(option)})</span>` : ''}`;

    function rowHtml(r, st, i, editable) {
        const busy = S.saving.has(r.recKey) || !editable;   // 지난 날짜는 볼 수만
        const k = escapeHtml(r.recKey);
        const mk = st.mark;
        const who = mk ? `<div class="locrec-who">${escapeHtml(mk.state === 'skip' ? '안 함' : '처리함')} · ${escapeHtml(mk.by || NO_NAME)} ${escapeHtml(fmtHM(mk.at))}</div>` : '';
        const btns = st.label === '처리됨' && !mk ? ''                       // 서버가 위치 변화를 확인한 행 — 누를 것이 없다
            : mk
            ? `<button type="button" class="btn btn-ghost btn-sm" data-locrec-act="undo" data-locrec-key="${k}"${busy ? ' disabled' : ''}>되돌리기</button>`
            : `<button type="button" class="btn btn-secondary btn-sm" data-locrec-act="done" data-locrec-key="${k}"${busy ? ' disabled' : ''}>처리함</button>`
              + `<button type="button" class="btn btn-ghost btn-sm" data-locrec-act="skip" data-locrec-key="${k}"${busy ? ' disabled' : ''}>안 함</button>`;
        const badges = (r.capWarn ? '<span class="badge badge-warn locrec-badge" title="옮길 자리 적재량보다 수량이 많습니다">적재량 확인</span>' : '')
            + (r.pairNear ? `<span class="badge badge-accent locrec-badge" title="함께 잘 팔리는 상품이 옮길 자리와 같은 동에 있습니다">페어 ${escapeHtml(r.pairNear)}</span>` : '');
        // 맞바꾸기·페어는 줄(A/B)마다 <tr> — 상품·현재·추천·이동수량·일출고 칸끼리 짝이 맞게. 순위·이득·상태·표시는 rowspan 으로 하나만.
        // 줄무늬는 추천 단위(.locrec-alt) — usage-table 의 tr:nth-child(even) 는 줄 단위라 locrec-table 에서 끈다(location.html).
        const lines = rowLines(r);
        const span = lines.length > 1 ? ` rowspan="${lines.length}"` : '';
        const trCls = `locrec-row tone-${st.tone}${st.label === '안 함' ? ' locrec-skipped' : ''}${i % 2 ? ' locrec-alt' : ''}`;
        return lines.map((l, j) => {
            const last = j === lines.length - 1;
            const cells = `<td class="locrec-prod"><span class="locrec-code">${escapeHtml(l.code)}</span> ${nameCell(l.name, l.option)}`
                + (last && badges ? `<div class="locrec-badges">${badges}</div>` : '') + '</td>'
                + `<td class="locrec-loc locrec-from">${escapeHtml(l.from || '-')}</td>`
                + `<td class="locrec-loc"><b class="locrec-to">${escapeHtml(l.to || '-')}</b></td>`
                + `<td class="locrec-num locrec-qty">${l.qty == null ? '' : `${n0(l.qty)}개`}</td>`
                + `<td class="locrec-num locrec-daily">${l.daily == null ? '' : fmtNum(l.daily)}</td>`;
            if (j > 0) return `<tr class="${trCls} locrec-sub">${cells}</tr>`;
            return `<tr class="${trCls}">`
                + `<td class="locrec-rank"${span}>${r.rank == null ? i + 1 : r.rank}</td>`
                + cells
                + `<td class="locrec-gain"${span}>${fmtNum(r.gain)}</td>`
                + `<td class="locrec-state"${span}><span class="locrec-st st-${st.tone}">${escapeHtml(st.label)}</span>${who}</td>`
                + `<td class="locrec-acts"${span}>${btns}</td></tr>`;
        }).join('');
    }

    function visibleRows(today) {
        const p = S.day && S.day.key === S.key ? S.day.parsed : null;
        const list = p ? p[S.tab] || [] : [];
        const open = (S.latest && S.latest.open) || {};
        const now = Date.now();
        return list.map(r => ({ r, st: rowState({ row: r, open: open[r.recKey], mark: S.marks[r.recKey], viewDay: S.key, todayKey: today, nowMs: now }) }));
    }

    // ── 접힌 띠 ── 같은 내용이면 다시 그리지 않는다(누르던 버튼 포커스가 풀리지 않게)
    let lastStrip = '', lastAct = '';
    function setStrip(sumHtml, actHtml) {
        if (strip && lastStrip !== sumHtml) { lastStrip = sumHtml; strip.innerHTML = sumHtml; }
        if (stripAct && lastAct !== actHtml) { lastAct = actHtml; stripAct.innerHTML = actHtml; }
    }
    const warnBadge = (warns) => (warns.length
        ? `<span class="badge badge-warn topcard-warn" role="note" tabindex="0" title="${escapeHtml(warns.join(' / '))}" aria-label="주의 ${warns.length}건: ${escapeHtml(warns.join(' / '))}">주의 ${warns.length}</span>` : '');
    function renderStrip(today) {
        const loaded = S.day && S.day.key === S.key;
        const sp = recStrip({ latest: S.latest, key: S.key, todayKey: today, parsed: loaded ? S.day.parsed : null,
                              marks: S.marks, nowMs: Date.now(), extraWarns: S.dayErr ? [S.dayErr] : [] });
        // 좁은 카드에서는 '판정 '·'(MM/DD까지)' 를 숨긴다(.tc-long) — 전체 문구는 title 에
        const vm = /^(.*?)( \(.+\))$/.exec(sp.verdict.label);
        const vMain = vm ? vm[1] : sp.verdict.label, vTail = vm ? vm[2] : '';
        let sum = `<span class="locrec-verdict v-${sp.verdict.tone}" title="판정 ${escapeHtml(sp.verdict.label)}"><span class="tc-long">판정&nbsp;</span>${escapeHtml(vMain)}`
            + (vTail ? `<span class="tc-long">&nbsp;${escapeHtml(vTail.trim())}</span>` : '') + '</span>';
        let act = '';
        if (sp.msg) sum += `<span class="${sp.tone === 'warn' ? 'refill-warn' : 'refill-sub'}">${escapeHtml(sp.msg)}</span>`;
        else if (sp.n == null) sum += `<span class="refill-sub">${S.dayErr ? '추천을 읽지 못했습니다' : '불러오는 중…'}</span>`;
        else {
            sum += `<span>${escapeHtml(sp.dayText)} 추천 <b>${sp.n}건</b>${sp.newN ? ` (새로 ${sp.newN})` : ''}</span>`;
            // 접힌 띠에서도 [표 보기]·[엑셀 받기] (펼치지 않아도 바로)
            act = '<button type="button" class="btn btn-secondary btn-sm" data-locrec-act="table">표 보기</button>'
                + `<button type="button" class="btn btn-primary btn-sm" data-locrec-act="downloadAll" title="${escapeHtml(sp.dayText)} 추천 전체(단독·맞바꾸기·페어, 안 함 제외)"${sp.n ? '' : ' disabled'}>엑셀 받기</button>`;
        }
        setStrip(sum + warnBadge(sp.warns), act);
    }

    function render() {
        if (!S.signedIn) {
            body.innerHTML = '<div class="refill-msg">로그인하면 보입니다.</div>';
            setStrip('<span class="refill-sub">로그인하면 보입니다.</span>', '');
            return;
        }
        if (S.latest == null) {
            const t = S.latestErr ? '추천 상태를 읽지 못했습니다(' + escapeHtml(S.latestErr) + ')' : '불러오는 중…';
            body.innerHTML = `<div class="refill-msg">${t}</div>`;
            setStrip(`<span class="${S.latestErr ? 'refill-warn' : 'refill-sub'}">${t}</span>`, '');
            return;
        }
        const today = todayKey();
        renderSelect(today);
        const parts = [];
        const e = entryOf(S.key);
        const vb = verdictBadge(e && e.verdict, S.latest.observeUntil);
        // 지난 날짜는 그날 지표(days[k].metrics, 지난주 비교 없음), 최신 날짜는 색인 지표(지난주 비교 포함)
        const ms = metricItems(S.key !== S.latest.latestDay && e && e.metrics ? e.metrics : S.latest.metrics);
        parts.push('<div class="locrec-kpis">'
            + `<span class="locrec-verdict v-${vb.tone}">판정 ${escapeHtml(vb.label)}</span>`
            + ms.map(m => `<span class="locrec-kpi">${escapeHtml(m.label)} <b>${escapeHtml(m.value)}</b>${m.prev ? `<span class="refill-sub"> (지난주 ${escapeHtml(m.prev)})</span>` : ''}</span>`).join('')
            + '</div>');
        const dl = dataLine(S.latest);
        if (dl) parts.push(`<div class="refill-sub">자동 추천(이지어드민 출고 28일) · ${escapeHtml(dl)}</div>`);
        dataWarnings(S.latest, Date.now()).forEach(w => parts.push(`<div class="refill-msg refill-warn">${escapeHtml(w)}</div>`));

        const msg = dayMessage(e);
        if (msg) {
            parts.push(`<div class="refill-msg${e && e.status === 'fail' ? ' refill-warn' : ''}">${escapeHtml(msg)}</div>`);
        } else if (S.dayErr) {
            parts.push(`<div class="refill-msg refill-warn">${escapeHtml(S.dayErr)}</div>`);
        } else if (!S.day || S.day.key !== S.key) {
            parts.push('<div class="refill-sub">표 불러오는 중…</div>');
        } else {
            const p = S.day.parsed;
            if (p.error) parts.push(`<div class="refill-msg refill-warn">${escapeHtml(p.error)}</div>`);
            const sm = tabSummary({ latest: S.latest, key: S.key, todayKey: today, parsed: p, marks: S.marks, nowMs: Date.now() });
            const dayText = S.key === today ? '오늘' : dayLabel(S.key);
            parts.push(`<div class="refill-line">${escapeHtml(dayText)} 추천 `
                + TABS.map(t => `${TAB_LABEL[t]} <b>${sm.counts[t]}</b>`).join(' · ')
                + (sm.newN ? `, 새로 <b>${sm.newN}</b>` : '')
                + (sm.hiddenN ? `<span class="refill-sub"> (안 함 ${sm.hiddenN}건 숨김)</span>` : '') + '</div>');
            const basedAt = stockAtOf(S.day.data && S.day.data.basedOn);
            if (basedAt) parts.push(`<div class="refill-sub">이 추천은 재고 자료 ${escapeHtml(fmtMDHM(basedAt))} 기준</div>`);
            parts.push('<div class="refill-actions">'
                + '<button type="button" class="btn btn-secondary btn-sm" data-locrec-act="table">표 보기</button>'
                + `<button type="button" class="btn btn-primary btn-sm" data-locrec-act="downloadAll" title="${escapeHtml(dayText)} 추천 전체(단독·맞바꾸기·페어, 안 함 제외)"${sm.total ? '' : ' disabled'}>엑셀 받기</button>`
                + '</div>');
        }
        body.innerHTML = parts.join('');
        renderStrip(today);
        renderModal();
    }

    // ── 표 창 ── 열려 있을 때만 그린다(서버 문서·marks 가 바뀌면 render() 에서 같이 다시)
    const isOpen = () => modal.style.display === 'flex';
    function renderModal() {
        if (!isOpen()) return;
        const today = todayKey();
        const loaded = !!(S.signedIn && S.latest && S.day && S.day.key === S.key);
        const editable = loaded && canMark(S.latest, S.key, today);
        mTitle.textContent = `변경 추천 ${dayLabel(S.key || today)}`;
        const cnt = tabCounts(loaded ? S.day.parsed : null);
        const tabsHtml = TABS.map(t => `<button type="button" class="seg-tab${t === S.tab ? ' active' : ''}" data-locrec-tab="${t}">${TAB_LABEL[t]} ${cnt[t]}</button>`).join('');
        if (lastTabsHtml !== tabsHtml) { lastTabsHtml = tabsHtml; mTabs.innerHTML = tabsHtml; }
        const all = loaded ? visibleRows(today) : [];
        const hiddenN = all.filter(x => x.st.hidden).length;
        const rows = all.filter(x => S.showSkipped || !x.st.hidden);
        mSkip.checked = S.showSkipped;
        mSkipWrap.hidden = !(hiddenN || S.showSkipped);
        mSkipTxt.textContent = `안 함${hiddenN ? ` ${hiddenN}건` : ''}도 보기`;
        mDl.disabled = !rows.length;
        if (!loaded) {
            mMeta.textContent = '';
            const t = (S.latest && dayMessage(entryOf(S.key))) || S.dayErr || '표 불러오는 중…';
            mTbody.innerHTML = `<tr><td colspan="9" class="refill-empty">${escapeHtml(t)}</td></tr>`;
            return;
        }
        mMeta.textContent = tabMeta(S.tab, all) + (editable ? '' : ' · 지난 날짜는 볼 수만 있습니다');
        if (!rows.length) {
            mTbody.innerHTML = `<tr><td colspan="9" class="refill-empty">${cnt[S.tab] ? '모두 안 함으로 숨겼습니다' : `${TAB_LABEL[S.tab]} 추천이 없습니다`}</td></tr>`;
            return;
        }
        mTbody.innerHTML = rows.map((x, i) => rowHtml(x.r, x.st, i, editable)).join('');
    }
    let lastTabsHtml = '';
    function openModal() {
        modal.style.display = 'flex';
        renderModal();
    }
    const closeModal = () => { modal.style.display = 'none'; };

    // ── 쓰기·엑셀 ──
    async function mark(key, state) {
        if (!key || S.saving.has(key) || !canMark(S.latest, S.key, todayKey())) return;   // 지난 날짜는 볼 수만
        S.saving.add(key);
        render();
        try {
            const val = state ? { state, by: nameOf(), at: serverTimestamp() } : deleteField();
            await setDoc(doc(db, MARKS_PATH), { marks: { [key]: val } }, { merge: true });
        } catch (e) {
            alert(`표시를 저장하지 못했습니다(${(e && e.code) || '오류'}). 다시 눌러 주세요.`);
        } finally {
            S.saving.delete(key);
            render();
        }
    }

    function writeXlsx(rows, sheetName, fileName) {
        const X = window.XLSX;
        if (!X || !X.utils) { alert('엑셀 도구를 불러오지 못했습니다. 새로고침 후 다시 해 주세요.'); return; }
        if (!rows.length) return;
        const ws = X.utils.json_to_sheet(excelRows(rows), { header: EXCEL_COLS });
        ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 40 }, { wch: 25 }, { wch: 15 }];   // 기존 [변경 추천] 엑셀과 같은 폭
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, ws, sheetName);
        X.writeFile(wb, fileName);
    }
    // 표 창: 지금 탭(안 함도 보기면 그것까지)
    function download() {
        const rows = visibleRows(todayKey()).filter(x => S.showSkipped || !x.st.hidden).map(x => x.r);
        writeXlsx(rows, SHEET_NAME[S.tab], fileNameOf(S.tab, S.key));
    }
    // 접힌 띠·펼친 본문: 탭과 상관없이 그날 추천 전체(단독 → 맞바꾸기 → 페어, 안 함 제외) — 띠 건수와 같은 목록
    function downloadAll() {
        if (!S.day || S.day.key !== S.key) return;
        const rows = stripRows({ latest: S.latest, key: S.key, todayKey: todayKey(), parsed: S.day.parsed, marks: S.marks, nowMs: Date.now() }).map(x => x.r);
        writeXlsx(rows, '변경추천', fileNameAll(S.key));
    }

    // ── 이벤트 ──
    card.addEventListener('click', (ev) => {
        const b = ev.target.closest('button[data-locrec-act]');
        if (!b || b.disabled) return;
        const act = b.getAttribute('data-locrec-act');
        if (act === 'downloadAll') downloadAll();
        else if (act === 'table') openModal();
    });
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal || ev.target.closest('[data-locrec-close]')) { closeModal(); return; }
        const t = ev.target.closest('[data-locrec-tab]');
        if (t) { S.tab = TABS.includes(t.getAttribute('data-locrec-tab')) ? t.getAttribute('data-locrec-tab') : 'single'; renderModal(); return; }
        const b = ev.target.closest('button[data-locrec-act]');
        if (!b || b.disabled) return;
        const act = b.getAttribute('data-locrec-act');
        const key = b.getAttribute('data-locrec-key');
        if (act === 'download') download();
        else if (act === 'done') mark(key, 'done');
        else if (act === 'skip') mark(key, 'skip');
        else if (act === 'undo') mark(key, null);
    });
    mSkip.addEventListener('change', () => { S.showSkipped = mSkip.checked; renderModal(); });
    // ESC — 공통 js/modal-esc.js 는 .fixed.inset-0 오버레이만 닫아서 이 창(.modal-overlay)은 여기서 닫는다
    document.addEventListener('keydown', (ev) => {
        if ((ev.key === 'Escape' || ev.key === 'Esc') && isOpen()) { ev.preventDefault(); closeModal(); }
    });
    sel.addEventListener('change', () => {
        S.key = sel.value;
        S.userPicked = S.key !== defaultDay(S.latest, todayKey());
        syncDay();
        render();
    });

    if (foldBtn && detail) initFold({ btn: foldBtn, panel: detail, card, id: 'locrec', name: '변경 추천', storage: getStorage() });

    // 자정 넘김·'오래됨' 문구를 위해 10분마다 다시
    setInterval(() => { if (S.signedIn && S.latest) { syncDay(); render(); } }, 10 * 60 * 1000);

    auth.onAuthStateChanged(user => {
        S.signedIn = !!user;
        if (user) start();
        else { stopAll(); S.latest = null; S.day = null; S.marks = {}; closeModal(); }
        render();
    });
    render();
}
