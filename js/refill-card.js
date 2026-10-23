// === js/refill-card.js ===
// 로케이션관리 대시보드 맨 위 '채우기 지시서' 카드(띠·본문). 데이터는 js/refill-store.js, 표 창은 js/refill-table.js.
//   카드는 접힌 띠 한 줄(요약 · 엑셀 받기 · 펼치기)이 기본, [펼치기]로 아래 전체 내용(날짜 선택·진행률·버튼). 펼침은 js/lib/card-fold.js.
//   지시서는 이 PC 프로그램(업무자동화\앱\채우기자동화)이 매일 08:20 슬랙에 보내면서 같은 것을 Firestore 에도 남긴다(7일치).
//   카드: 엑셀 받기 · 표 보기 · 행별 완료 체크(오늘 것만) · 지금 기준으로 다시 만들기(앱에만 갱신, 슬랙에는 안 보냄).
//   같은 지시서를 대시보드 '채우기' 업무 카드에서도 연다(js/refill-dash.js).
// 문서·순수 함수는 js/lib/refill-view.js 머리말 참고.
// ⚠️ Firebase 를 여기서 초기화하지 않는다 — location.js 가 만든 db·auth 를 받아 쓴다(두 번 초기화하면 duplicate-app).
// ⚠️ 체크·요청에 남기는 이름은 getMemberName()(= memberNameFor, 직원 이름)만. 없으면 '이름 없음' — 이메일은 쓰지 않는다.
import { escapeHtml } from './utils.js?v=202610231017';
import { lastDays, dayLabel, fmtHM, progress, dayStatus, refillStrip, fmtCount } from './lib/refill-view.js?v=202610231017';
import { initFold } from './lib/card-fold.js?v=202610231017';
import { getRefillStore, todayKey, holidayName } from './refill-store.js?v=202610231017';
import { mountRefillTable } from './refill-table.js?v=202610231017';

/** window.localStorage 참조 자체가 던지는 브라우저도 있다 */
const getStorage = () => { try { return window.localStorage; } catch (e) { return null; } };

export function initRefillCard({ db, auth, getMemberName }) {
    const card = document.getElementById('refill-card');
    const body = document.getElementById('refill-body');
    const sel = document.getElementById('refill-day');
    if (!card || !body || !sel || !db || !auth) return;
    const strip = document.getElementById('refill-strip');
    const stripAct = document.getElementById('refill-strip-act');
    const foldBtn = document.getElementById('refill-fold');
    const detail = document.getElementById('refill-detail');

    const store = getRefillStore({ db, auth, getMemberName });
    const table = mountRefillTable({ store });

    // ── 카드 ──
    let lastSelHtml = '';
    function renderSelect(S, today) {
        const keys = lastDays(today, 7);
        const html = keys.map(k => {
            const st = dayStatus({ meta: S.meta, key: k, todayKey: today, nowMs: Date.now(), holidayName });
            const tail = (k === today ? ' · 오늘' : '') + (st.status === 'rest' ? ' (휴일)' : '');
            return `<option value="${k}"${k === S.key ? ' selected' : ''}>${escapeHtml(dayLabel(k) + tail)}</option>`;
        }).join('');
        if (lastSelHtml !== html) { lastSelHtml = html; sel.innerHTML = html; }   // 같으면 다시 그리지 않는다(열린 목록이 닫히지 않게)
    }

    // ── 접힌 띠 ── 같은 내용이면 다시 그리지 않는다(누르던 버튼 포커스가 1분마다 풀리지 않게)
    let lastStrip = '', lastAct = '';
    function setStrip(sumHtml, actHtml) {
        if (strip && lastStrip !== sumHtml) { lastStrip = sumHtml; strip.innerHTML = sumHtml; }
        if (stripAct && lastAct !== actHtml) { lastAct = actHtml; stripAct.innerHTML = actHtml; }
    }
    const warnBadge = (warns) => (warns.length
        ? `<span class="badge badge-warn topcard-warn" role="note" tabindex="0" title="${escapeHtml(warns.join(' / '))}" aria-label="주의 ${warns.length}건: ${escapeHtml(warns.join(' / '))}">주의 ${warns.length}</span>` : '');
    function renderStrip(S, { st, key, isToday, d, ru }) {
        const warns = [];
        if (st.status === 'ok' && !d && S.dayErr) warns.push(S.dayErr);
        if (st.status === 'ok' && ru.show && ru.note && ru.tone === 'warn') warns.push(ru.note);
        if (st.status === 'ok' && S.work.err) warns.push(S.work.err);
        const sp = refillStrip({ st, entry: store.entryOf(key), parsed: d ? d.parsed : null, checkMap: S.work.checks, extraWarns: warns });
        const day = isToday ? '' : `<span>${escapeHtml(dayLabel(key))}</span>`;
        if (sp.msg) { setStrip(day + `<span class="${sp.tone === 'warn' ? 'refill-warn' : ''}">${escapeHtml(sp.msg)}</span>` + warnBadge(sp.warns), ''); return; }
        const sum = day + sp.items.map(it => `<span>${escapeHtml(it.label)} <b>${escapeHtml(it.value)}</b></span>`).join('')
            + (sp.prog ? `<span>완료 <b>${sp.prog.done}/${sp.prog.total}</b></span>` : '') + warnBadge(sp.warns);
        const omitted = d && d.data.fileOmitted;
        // 접힌 띠에서도 [표 보기]·[엑셀 받기] (펼치지 않아도 바로)
        const tableBtn = `<button type="button" class="btn btn-secondary btn-sm" data-refill="table"${d ? '' : ' disabled'}>표 보기</button>`;
        const act = tableBtn + (omitted
            ? '<button type="button" class="btn btn-primary btn-sm" disabled title="파일이 너무 커서 앱에서는 못 받음 — 슬랙으로 받은 지시서 엑셀을 쓰세요">엑셀 받기</button>'
            : `<button type="button" class="btn btn-primary btn-sm" data-refill="download"${d && d.data.file ? '' : ' disabled'}>엑셀 받기</button>`);
        setStrip(sum, act);
    }

    function render() {
        const S = store.get();
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
        renderSelect(S, today);
        const key = S.key, isToday = key === today, now = Date.now();
        const st = dayStatus({ meta: S.meta, key, todayKey: today, nowMs: now, holidayName });
        const ru = store.reqState(isToday);
        const parts = [];
        const d = st.status === 'ok' ? store.currentDay() : null;
        if (st.status === 'ok') {
            const e = store.entryOf(key) || {};
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
                + (omitted ? '<span class="refill-sub">파일이 너무 커서 앱에서는 못 받음 — 슬랙으로 받은 지시서 엑셀을 쓰세요</span>'
                    : `<button type="button" class="btn btn-primary btn-sm" data-refill="download"${d && d.data.file ? '' : ' disabled'}>엑셀 받기</button>`)
                + `<button type="button" class="btn btn-secondary btn-sm" data-refill="table"${d ? '' : ' disabled'}>표 보기</button>`
                + reqButton(ru) + '</div>');
        } else {
            parts.push(`<div class="refill-msg${st.status === 'fail' || st.status === 'missing' ? ' refill-warn' : ''}">${escapeHtml(st.text)}</div>`);
            // 다시 만들기는 그날 정기 지시서가 있어야 받는다(프로그램 --요청확인 이 정기 발송 기록 없으면 거절) — 버튼을 두지 않는다
        }
        if (ru.show && ru.note && st.status === 'ok') parts.push(`<div class="refill-note${ru.tone === 'warn' ? ' refill-warn' : ''}">${escapeHtml(ru.note)}</div>`);
        body.innerHTML = parts.join('');
        renderStrip(S, { st, key, isToday, d, ru });
    }

    const num = fmtCount;
    const reqButton = (ru) => (ru.show
        ? `<button type="button" class="btn btn-secondary btn-sm" data-refill="rebuild"${ru.enabled ? '' : ' disabled'}>${escapeHtml(ru.label)}</button>` : '');

    // ── 이벤트 ──
    card.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-refill]');
        if (!b || b.disabled) return;
        const act = b.getAttribute('data-refill');
        if (act === 'download') store.download();
        else if (act === 'table') table.open();
        else if (act === 'rebuild') store.rebuild();
    });
    sel.addEventListener('change', () => store.setDay(sel.value));

    if (foldBtn && detail) initFold({ btn: foldBtn, panel: detail, card, id: 'refill', name: '채우기 지시서', storage: getStorage() });

    store.on(render);
    store.start();
    render();
}
