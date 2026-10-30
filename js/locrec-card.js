// === js/locrec-card.js ===
// 로케이션관리 대시보드 '로케이션 변경 추천' 카드 — 채우기 지시서 카드 바로 아래.
//   추천은 이 PC 프로그램(업무자동화\앱\로케이션추천)이 매일 06:40 이지어드민 출고 28일로 만들어 Firestore 에 남긴다(14일치).
//   카드: 판정·지표·자료 상태 · 날짜 선택 · 오늘 추천 수 · [표 보기]·[엑셀 받기](그날 전체). 표는 창(#locrec-modal, js/locrec-table.js)에 —
//   창: 탭[단독|맞바꾸기|페어] 표 · 행마다 [처리함]/[안 함]/되돌리기(처음 보여 주는 날짜만, 지난 날짜는 볼 수만) · 엑셀 받기(지금 탭, 5열, 맞바꾸기·페어는 2행).
//   카드는 접힌 띠 한 줄(판정 · 추천 n건 · 엑셀 받기 · 펼치기)이 기본, [펼치기]로 아래 요약. 펼침은 js/lib/card-fold.js.
//   [변경 추천] 모달(업로드 자료 기준, location.js)과는 수요 자료가 달라 결과가 다를 수 있다 — 계산 모듈은 같다(js/lib/loc-recommend.js).
//   데이터(구독·처리 표시·엑셀)는 js/locrec-store.js. 같은 표 창을 대시보드 '로케이션 동선관리' 업무 카드에서도 연다(js/locrec-dash.js).
//   다시 만들기 버튼은 대시보드 머리줄 [지금 재고로 다시 만들기] 하나(js/rebuild-bar.js — 채우기 지시서와 같이, 앱에만·슬랙 없음).
//   카드에는 상태 문구(js/lib/locrec-view.js recReqUi)와 기준 줄(rebuildLine)만. 카드 자체가 location.locrec 권한일 때만 생긴다(location.js whenPerm).
//   동선 점수·앞쪽 자리 출고·추이는 이 카드가 아니라 인사이트 줄 '동선 효율' 카드(js/locrec-route-card.js)에 — 같은 store 를 넘겨 시작한다.
// 문서 모양·순수 함수는 js/lib/locrec-view.js 머리말 참고.
// ⚠️ Firebase 를 여기서 초기화하지 않는다 — location.js 가 만든 db·auth 를 받아 쓴다(두 번 초기화하면 duplicate-app).
// ⚠️ 표시에 남기는 이름은 getMemberName()(= memberNameFor, 직원 이름)만. 없으면 '이름 없음' — 이메일은 쓰지 않는다.
import { escapeHtml } from './utils.js?v=202610301845';
import {
    verdictBadge, metricItems, dataWarnings, dataLine, dayOptions, dayMessage,
    TABS, TAB_LABEL, recStrip, tabSummary, dayLabel, rebuildLine
} from './lib/locrec-view.js?v=202610301845';
import { initFold } from './lib/card-fold.js?v=202610301845';
import { getLocRecStore, todayKey } from './locrec-store.js?v=202610301845';
import { mountLocRecTable } from './locrec-table.js?v=202610301845';
import { initRouteCard } from './locrec-route-card.js?v=202610301845';

/** window.localStorage 참조 자체가 던지는 브라우저도 있다 */
const getStorage = () => { try { return window.localStorage; } catch (e) { return null; } };

export function initLocRecCard({ db, auth, getMemberName, sizeOf }) {
    const card = document.getElementById('locrec-card');
    const body = document.getElementById('locrec-body');
    const sel = document.getElementById('locrec-day');
    if (!card || !body || !sel || !document.getElementById('locrec-modal') || !db || !auth) return;
    const strip = document.getElementById('locrec-strip');
    const stripAct = document.getElementById('locrec-strip-act');
    const foldBtn = document.getElementById('locrec-fold');
    const detail = document.getElementById('locrec-detail');

    const store = getLocRecStore({ db, auth, getMemberName });
    const table = mountLocRecTable({ store, sizeOf });   // sizeOf: 옛 문서 행의 칸수 보충(location.js)
    // 머리줄 [변경 추천] 빠른 버튼(location.html)이 여는 창 — 권한이 있어 이 카드가 시작될 때만 생긴다
    window.openLocRecTable = () => table.open();

    // ── 그리기 ──
    let lastSelHtml = '';
    function renderSelect(S, today) {
        const html = dayOptions(S.latest, today).map(o =>
            `<option value="${o.key}"${o.key === S.key ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
        if (lastSelHtml !== html) { lastSelHtml = html; sel.innerHTML = html; }   // 같으면 다시 그리지 않는다(열린 목록이 닫히지 않게)
    }

    // ── 접힌 띠 ── 같은 내용이면 다시 그리지 않는다(누르던 버튼 포커스가 풀리지 않게)
    let lastStrip = '', lastAct = '';
    function setStrip(sumHtml, actHtml) {
        if (strip && lastStrip !== sumHtml) { lastStrip = sumHtml; strip.innerHTML = sumHtml; }
        if (stripAct && lastAct !== actHtml) { lastAct = actHtml; stripAct.innerHTML = actHtml; }
    }
    const warnBadge = (warns) => (warns.length
        ? `<span class="badge badge-warn topcard-warn" role="note" tabindex="0" title="${escapeHtml(warns.join(' / '))}" aria-label="주의 ${warns.length}건: ${escapeHtml(warns.join(' / '))}">주의 ${warns.length}</span>` : '');
    function renderStrip(S, today) {
        const loaded = S.day && S.day.key === S.key;
        const sp = recStrip({ latest: S.latest, key: S.key, todayKey: today, parsed: loaded ? S.day.parsed : null,
                              marks: S.marks, nowMs: Date.now(), extraWarns: [S.dayErr, S.marksErr].filter(Boolean) });
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
        // 머리줄 [지금 재고로 다시 만들기]가 진행 중이면 띠에도 작은 표시(단계·경과는 머리줄에)
        const ru = store.reqState();
        const busy = ru && ru.phase === 'running'
            ? '<span class="badge badge-accent" role="status" title="지금 재고로 다시 만드는 중입니다 — 끝나면 이 카드가 새 추천으로 바뀝니다">다시 만드는 중</span>' : '';
        setStrip(sum + busy + warnBadge(sp.warns), act);
    }

    function render() {
        const S = store.get();
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
        renderSelect(S, today);
        const parts = [];
        const e = store.entryOf(S.key);
        const ru = store.reqState();
        const vb = verdictBadge(e && e.verdict, S.latest.observeUntil);
        // 지난 날짜는 그날 지표(days[k].metrics, 지난주 비교 없음), 최신 날짜는 색인 지표(지난주 비교 포함)
        const mSrc = S.key !== S.latest.latestDay && e && e.metrics ? e.metrics : S.latest.metrics;
        const ms = metricItems(mSrc);
        parts.push('<div class="locrec-kpis">'
            + `<span class="locrec-verdict v-${vb.tone}">판정 ${escapeHtml(vb.label)}</span>`
            + ms.map(m => `<span class="locrec-kpi">${escapeHtml(m.label)} <b>${escapeHtml(m.value)}</b>${m.prev ? `<span class="refill-sub"> (지난주 ${escapeHtml(m.prev)})</span>` : ''}</span>`).join('')
            + '</div>');
        const dl = dataLine(S.latest);
        if (dl) parts.push(`<div class="refill-sub">자동 추천(이지어드민 출고 28일) · ${escapeHtml(dl)}</div>`);
        dataWarnings(S.latest, Date.now()).forEach(w => parts.push(`<div class="refill-msg refill-warn">${escapeHtml(w)}</div>`));

        const msg = dayMessage(e);
        const made = !!e && (e.status === 'ok' || e.status === 'fail');      // 다시 만들기는 정기 판(성공·실패) 뒤에만
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
            // 기준 줄 '10:42 다시 만듦 · 배치: 업로드 MM/DD HH:MM · 재고: 이지어드민 HH:MM' — 재고가 업로드 대체면 노랗게
            const bl = rebuildLine(S.day.data);
            if (bl.text) {
                parts.push('<div class="refill-sub">' + [bl.head, bl.layout].filter(Boolean).map(escapeHtml).join(' · ')
                    + ((bl.head || bl.layout) ? ' · ' : '')
                    + (bl.warn ? `<span class="refill-warn" title="이지어드민 재고를 못 받아 업로드한 재고로 계산했습니다">${escapeHtml(bl.stock)}</span>` : escapeHtml(bl.stock))
                    + '</div>');
            }
            parts.push('<div class="refill-actions">'
                + '<button type="button" class="btn btn-secondary btn-sm" data-locrec-act="table">표 보기</button>'
                + `<button type="button" class="btn btn-primary btn-sm" data-locrec-act="downloadAll" title="${escapeHtml(dayText)} 추천 전체(단독·맞바꾸기·페어, 안 함 제외)"${sm.total ? '' : ' disabled'}>엑셀 받기</button>`
                + '</div>');
        }
        // 다시 만들기 상태 문구(요청 대기·만드는 중·거절·실패·재고 새로 올라옴) — 오늘 날짜 · 정기 판 뒤일 때만
        if (made && ru.show && ru.note) parts.push(`<div class="refill-note${ru.tone === 'warn' ? ' refill-warn' : ''}">${escapeHtml(ru.note)}</div>`);
        body.innerHTML = parts.join('');
        renderStrip(S, today);
    }

    // ── 이벤트 ──
    card.addEventListener('click', (ev) => {
        const b = ev.target.closest('button[data-locrec-act]');
        if (!b || b.disabled) return;
        const act = b.getAttribute('data-locrec-act');
        if (act === 'downloadAll') store.downloadAll();
        else if (act === 'table') table.open();
    });
    sel.addEventListener('change', () => store.setDay(sel.value));

    if (foldBtn && detail) initFold({ btn: foldBtn, panel: detail, card, id: 'locrec', name: '변경 추천', storage: getStorage() });

    store.on(render);
    initRouteCard({ store });      // 인사이트 줄 '동선 효율' 카드 — 같은 store(구독 한 번)
    store.start();
    render();
}
