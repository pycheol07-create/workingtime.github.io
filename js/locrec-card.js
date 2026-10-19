// === js/locrec-card.js ===
// 로케이션관리 대시보드 '로케이션 변경 추천' 카드 — 채우기 지시서 카드 바로 아래.
//   추천은 이 PC 프로그램(업무자동화\앱\로케이션추천)이 매일 06:40 이지어드민 출고 28일로 만들어 Firestore 에 남긴다(14일치).
//   카드: 판정·지표·자료 상태 · 날짜 선택 · 탭[단독|맞바꾸기|페어] 표 · 행마다 [처리함]/[안 함] · 엑셀 받기(5열, 맞바꾸기·페어는 2행).
//   [변경 추천] 모달(업로드 자료 기준, location.js)과는 수요 자료가 달라 결과가 다를 수 있다 — 계산 모듈은 같다(js/lib/loc-recommend.js).
// 문서 모양·순수 함수는 js/lib/locrec-view.js 머리말 참고.
// ⚠️ Firebase 를 여기서 초기화하지 않는다 — location.js 가 만든 db·auth 를 받아 쓴다(두 번 초기화하면 duplicate-app).
// ⚠️ 표시에 남기는 이름은 getMemberName()(= memberNameFor, 직원 이름)만. 없으면 '이름 없음' — 이메일은 쓰지 않는다.
import { doc, onSnapshot, setDoc, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml } from './utils.js?v=202610191431';
import {
    dayKey, fmtHM, fmtMDHM, parseRecDay, verdictBadge, metricItems, dataWarnings, dataLine, rowState, dayOptions, defaultDay,
    dayMessage, fileNameOf, tabCounts, stockAtOf, excelRows, EXCEL_COLS, TABS, TAB_LABEL, SHEET_NAME, fmtNum
} from './lib/locrec-view.js?v=202610191431';

const APP = 'artifacts/team-work-logger-v2';
const LATEST_PATH = `${APP}/integrations/locRecLatest`;
const DAY_PATH = (key) => `${APP}/integrations/locRec_${key}`;
const MARKS_PATH = `${APP}/locRecWork/marks`;
const NO_NAME = '이름 없음';

export function initLocRecCard({ db, auth, getMemberName }) {
    const card = document.getElementById('locrec-card');
    const body = document.getElementById('locrec-body');
    const sel = document.getElementById('locrec-day');
    if (!card || !body || !sel || !db || !auth) return;

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
    const locCell = (from, to) => `<span class="locrec-from">${escapeHtml(from || '-')}</span><span class="locrec-arrow">→</span><b class="locrec-to">${escapeHtml(to || '-')}</b>`;
    const nameCell = (name, option) => `${escapeHtml(name || '')}${option ? ` <span class="locrec-opt">(${escapeHtml(option)})</span>` : ''}`;

    function rowHtml(r, st, i) {
        const two = (r.type === 'swap' || r.type === 'pair') && r.code2;
        const busy = S.saving.has(r.recKey);
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
        const line = (code, name, option, from, to, qty, daily) =>
            `<div class="locrec-item"><span class="locrec-code">${escapeHtml(code)}</span> ${nameCell(name, option)}</div>`
            + `<div class="locrec-move">${locCell(from, to)}<span class="locrec-qty">${qty == null ? '' : `${n0(qty)}개`}</span>`
            + `<span class="locrec-daily">${daily == null ? '' : `일 ${fmtNum(daily)}개`}</span></div>`;
        return `<tr class="locrec-row tone-${st.tone}${st.label === '안 함' ? ' locrec-skipped' : ''}">`
            + `<td class="locrec-rank">${r.rank == null ? i + 1 : r.rank}</td>`
            + `<td class="locrec-main">${line(r.code, r.name, r.option, r.from, r.to, r.qty, r.daily)}`
            + (two ? `<div class="locrec-sep"></div>${line(r.code2, r.name2, r.option2, r.from2, r.to2, r.qty2, r.daily2)}` : '')
            + (badges ? `<div class="locrec-badges">${badges}</div>` : '') + '</td>'
            + `<td class="locrec-gain">${fmtNum(r.gain)}</td>`
            + `<td class="locrec-state"><span class="locrec-st st-${st.tone}">${escapeHtml(st.label)}</span>${who}</td>`
            + `<td class="locrec-acts">${btns}</td></tr>`;
    }

    function visibleRows(today) {
        const p = S.day && S.day.key === S.key ? S.day.parsed : null;
        const list = p ? p[S.tab] || [] : [];
        const open = (S.latest && S.latest.open) || {};
        const now = Date.now();
        return list.map(r => ({ r, st: rowState({ row: r, open: open[r.recKey], mark: S.marks[r.recKey], viewDay: S.key, todayKey: today, nowMs: now }) }));
    }

    function render() {
        if (!S.signedIn) { body.innerHTML = '<div class="refill-msg">로그인하면 보입니다.</div>'; return; }
        if (S.latest == null) {
            body.innerHTML = `<div class="refill-msg">${S.latestErr ? '추천 상태를 읽지 못했습니다(' + escapeHtml(S.latestErr) + ')' : '불러오는 중…'}</div>`;
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
            const cnt = tabCounts(p);
            const all = visibleRows(today);
            const hiddenN = all.filter(x => x.st.hidden).length;
            const rows = all.filter(x => S.showSkipped || !x.st.hidden);
            parts.push('<div class="locrec-tools">'
                + '<div class="seg-tabs locrec-tabs" style="margin-bottom:0;">'
                + TABS.map(t => `<button type="button" class="seg-tab${t === S.tab ? ' active' : ''}" data-locrec-tab="${t}">${TAB_LABEL[t]} ${cnt[t]}</button>`).join('')
                + '</div>'
                + `<button type="button" class="btn btn-primary btn-sm" data-locrec-act="download"${rows.length ? '' : ' disabled'}>엑셀 받기</button>`
                + (hiddenN || S.showSkipped ? `<label class="refill-sub locrec-skipchk"><input type="checkbox" data-locrec-act="showskip"${S.showSkipped ? ' checked' : ''}> 안 함${hiddenN ? ` ${hiddenN}건` : ''}도 보기</label>` : '')
                + '</div>');
            if (!rows.length) {
                parts.push(`<div class="refill-sub locrec-empty">${cnt[S.tab] ? '모두 안 함으로 숨겼습니다' : `${TAB_LABEL[S.tab]} 추천이 없습니다`}</div>`);
            } else {
                parts.push('<div class="table-box locrec-table-wrap"><table class="usage-table locrec-table"><thead><tr>'
                    + '<th>순위</th><th title="상품 · 현재 → 변경 · 이동수량 · 일평균 출고">상품 · 이동</th><th title="하루에 덜 걷는 양(동·개/일)">이득</th><th>상태</th><th>표시</th>'
                    + '</tr></thead><tbody>' + rows.map((x, i) => rowHtml(x.r, x.st, i)).join('') + '</tbody></table></div>');
            }
            const basedAt = stockAtOf(S.day.data && S.day.data.basedOn);
            if (basedAt) parts.push(`<div class="refill-sub">이 추천은 재고 자료 ${escapeHtml(fmtMDHM(basedAt))} 기준</div>`);
        }
        body.innerHTML = parts.join('');
    }

    // ── 쓰기·엑셀 ──
    async function mark(key, state) {
        if (!key || S.saving.has(key)) return;
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

    function download() {
        const X = window.XLSX;
        if (!X || !X.utils) { alert('엑셀 도구를 불러오지 못했습니다. 새로고침 후 다시 해 주세요.'); return; }
        const rows = visibleRows(todayKey()).filter(x => S.showSkipped || !x.st.hidden).map(x => x.r);
        if (!rows.length) return;
        const ws = X.utils.json_to_sheet(excelRows(rows), { header: EXCEL_COLS });
        ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 40 }, { wch: 25 }, { wch: 15 }];   // 기존 [변경 추천] 엑셀과 같은 폭
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, ws, SHEET_NAME[S.tab]);
        X.writeFile(wb, fileNameOf(S.tab, S.key));
    }

    // ── 이벤트 ──
    card.addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-locrec-tab]');
        if (t) { S.tab = TABS.includes(t.getAttribute('data-locrec-tab')) ? t.getAttribute('data-locrec-tab') : 'single'; render(); return; }
        const b = ev.target.closest('button[data-locrec-act]');
        if (!b || b.disabled) return;
        const act = b.getAttribute('data-locrec-act');
        const key = b.getAttribute('data-locrec-key');
        if (act === 'download') download();
        else if (act === 'done') mark(key, 'done');
        else if (act === 'skip') mark(key, 'skip');
        else if (act === 'undo') mark(key, null);
    });
    card.addEventListener('change', (ev) => {
        const t = ev.target;
        if (t && t.matches('input[data-locrec-act="showskip"]')) { S.showSkipped = t.checked; render(); }
    });
    sel.addEventListener('change', () => {
        S.key = sel.value;
        S.userPicked = S.key !== defaultDay(S.latest, todayKey());
        syncDay();
        render();
    });

    // 자정 넘김·'오래됨' 문구를 위해 10분마다 다시
    setInterval(() => { if (S.signedIn && S.latest) { syncDay(); render(); } }, 10 * 60 * 1000);

    auth.onAuthStateChanged(user => {
        S.signedIn = !!user;
        if (user) start();
        else { stopAll(); S.latest = null; S.day = null; S.marks = {}; }
        render();
    });
    render();
}
