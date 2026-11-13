// === js/lib/ship-log.js ===
// 플랫폼 출고 진행 기록(#sp-log-list) 그리기 — 글자 한 줄씩 붙이던 글상자를 '실행 묶음 + 줄 목록'으로(2026-11-13).
//   화면(js/ship.js logLine)은 줄 글자를 지금처럼 쌓고(글상자 #sp-log 값도 그대로 — 시험 tools/ship-check.py 가 읽는다),
//   여기서는 그 글자의 앞 표시(⚠ · ⚠⚠ · ✗ · ℹ · ✓ · → · ▶ · 들여쓰기)만 보고 모양을 정한다. 문장 내용·숫자는 바꾸지 않는다.
//   묶음 = 사용자가 한 번 한 일(파일 넣기 · [만들기] · 묶음 빼기 …) — 화면이 묶음을 열고(meta), 이 모듈은 머리 줄(시각·플랫폼·단계·결과·경고 수)을 센다.
//   순수 모듈(DOM 없음). 글자는 모두 esc() 를 거쳐 HTML 로 만든다. 테스트: tests/ship-log.test.js
//
// 묶음 모양: { id, kind: 'drop'|'run'|'other', title?, tab?, step?, entries: [{ t: ms, s: string }] }

const TAB_NAME = { zikjin: '직진배송', ably: '에이블리' };
export const RUN_START_RE = /^=====\s*(직진배송|에이블리)\s*(\d)단계 시작\s*=====$/;
export const RUN_DONE_RE = /^=====\s*완료\s*=====$/;
const FAIL_RE = /^✗\s*실패/;
export const AUTO_MARK = '▶';
const UNIT_RE = /(?<![A-Za-z0-9_.,])(\d[\d,]*)(\s?)(건|개|봉|줄|행|종|곳|명|일)/g;
const KST_MS = 9 * 3600000;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = (n) => String(n).padStart(2, '0');

/** ms → 'HH:MM:SS'(한국 시각) */
export function clock(ms) {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms + KST_MS);
    return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

/**
 * 줄 하나의 모양. 앞 공백 2칸 = 한 단계 들여쓰기(옛 글상자와 같은 뜻).
 * @returns {{ kind: string, depth: number, icon: string, text: string, raw: string }}
 *   kind: blank · start · done · fail · warn2 · warn · info · ok · move · auto · save · section · plain
 */
export function classifyLine(raw) {
    const s = String(raw ?? '');
    const lead = s.length - s.replace(/^ +/, '').length;
    const depth = Math.min(4, Math.floor(lead / 2));
    const t = s.trim();
    const out = (kind, icon, text) => ({ kind, depth, icon, text, raw: s });
    if (!t) return out('blank', '', '');
    if (RUN_START_RE.test(t)) return out('start', '', t.replace(/^=+\s*|\s*=+$/g, ''));
    if (RUN_DONE_RE.test(t)) return out('done', '', '완료');
    if (t.startsWith('⚠⚠')) return out('warn2', '⚠', t.replace(/^⚠⚠\s*/, ''));
    if (t.startsWith('⚠')) return out('warn', '⚠', t.replace(/^⚠\s*/, ''));
    if (t.startsWith('✗')) return out('fail', '✗', t.replace(/^✗\s*/, ''));
    if (t.startsWith('ℹ')) return out('info', 'ℹ', t.replace(/^ℹ\s*/, ''));
    if (t.startsWith('✓')) return out('ok', '✓', t.replace(/^✓\s*/, ''));
    if (t.startsWith(AUTO_MARK)) return out('auto', AUTO_MARK, t.replace(/^▶\s*/, ''));
    if (t.startsWith('→')) return out('move', '→', t.replace(/^→\s*/, ''));
    if (/^저장:/.test(t)) return out('save', '↓', t.replace(/^저장:\s*/, ''));
    if (/^\[[^\]]+\]/.test(t)) return out('section', '', t);
    return out('plain', '', t);
}

const FLAGGED = new Set(['warn2', 'warn', 'fail', 'info']);

/**
 * 묶음 하나 → 머리 줄 + 보일 줄. 숨기는 줄: 빈 줄 · 끝 표시(===== 완료 =====) · 앞에 넣기 줄이 없을 때의 시작 표시(머리 줄이 말함).
 * 하위 줄(위 ⚠·✗·ℹ 줄보다 더 들여쓴 줄)은 그 색을 이어받는다(tone).
 */
export function summarizeGroup(g) {
    const entries = (g && g.entries) || [];
    const lines = entries.map(e => ({ ...classifyLine(e.s), t: e.t }));
    const startIdx = lines.findIndex(l => l.kind === 'start');
    let title = '', tab = g.tab || null, step = g.step || null;
    let status;
    if (startIdx >= 0) {
        const m = RUN_START_RE.exec(lines[startIdx].raw.trim());
        title = `${m[1]} ${m[2]}단계`;
        const after = lines.slice(startIdx + 1);
        if (after.some(l => l.kind === 'fail' && FAIL_RE.test(l.raw.trim()))) status = 'fail';
        else if (after.some(l => l.kind === 'done')) status = 'done';
        else status = 'running';
    } else {
        const base = g.title || (g.kind === 'drop' ? '파일 넣기' : '기록');
        title = tab && TAB_NAME[tab] && step ? `${TAB_NAME[tab]} ${step}단계 · ${base}` : base;
        if (lines.some(l => l.kind === 'fail')) status = 'error';
        else if (lines.some(l => l.raw.includes('저절로 시작하지 않았습니다'))) status = 'wait';
        else status = 'note';
    }
    const warns = lines.filter(l => l.kind === 'warn' || l.kind === 'warn2').length;
    const errors = lines.filter(l => l.kind === 'fail').length;
    const auto = lines.some(l => l.kind === 'auto');
    // 보일 줄 — 시작 표시는 앞에 넣기 줄이 있을 때만 구분선으로
    const rows = [];
    lines.forEach((l, i) => {
        if (l.kind === 'blank' || l.kind === 'done') return;
        if (l.kind === 'start' && !lines.slice(0, i).some(x => x.kind !== 'blank')) return;
        rows.push(l);
    });
    // 들여쓰기는 구역(시작 표시 앞·뒤)마다 가장 얕은 줄을 0 으로
    let sec = [];
    const flush = () => {
        const min = sec.length ? Math.min(...sec.map(r => r.depth)) : 0;
        sec.forEach(r => { r.level = r.depth - min; });
        sec = [];
    };
    for (const r of rows) {
        if (r.kind === 'start') { flush(); r.level = 0; continue; }
        sec.push(r);
    }
    flush();
    // 하위 줄 색 이어받기
    let parent = null;
    for (const r of rows) {
        if (r.kind === 'start') { parent = null; r.tone = ''; continue; }
        if (FLAGGED.has(r.kind)) { parent = r; r.tone = r.kind; continue; }
        if (parent && r.kind === 'plain' && r.depth > parent.depth) { r.tone = parent.kind; continue; }
        parent = null;
        r.tone = '';
    }
    return {
        id: g.id, at: entries.length ? entries[0].t : null, title, tab, step, status,
        warns, errors, auto, rows, count: rows.filter(r => r.kind !== 'start').length,
    };
}

export const STATUS_LABEL = { done: '완료', fail: '실패', running: '진행 중', error: '못 넣음', wait: '[만들기] 기다림', note: '' };
const STATUS_PILL = { done: 'ok', fail: 'risk', running: 'accent', error: 'risk', wait: 'warn', note: 'mute' };

/** 숫자 + 단위(건·개·봉…)를 굵게, 쉼표 없는 4자리 넘는 수는 쉼표를 넣는다(앞자리 0 이면 그대로 — 코드일 수 있음). HTML(이스케이프됨) */
export function numberHtml(text) {
    const s = String(text ?? '');
    let out = '', last = 0;
    for (const m of s.matchAll(UNIT_RE)) {
        out += esc(s.slice(last, m.index));
        let n = m[1];
        if (/^\d{4,}$/.test(n) && !n.startsWith('0')) n = Number(n).toLocaleString('ko-KR');
        out += `<b class="sp-lg-num">${esc(n)}${esc(m[2])}${esc(m[3])}</b>`;
        last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
}

function rowHtml(r) {
    if (r.kind === 'start') return `<li class="sp-lg-row k-start" role="separator"><span>${esc(r.text)}</span></li>`;
    const cls = ['sp-lg-row', `k-${r.kind}`];
    if (r.tone && r.tone !== r.kind) cls.push(`t-${r.tone}`);
    const lv = Math.min(4, r.level || 0);
    const ic = r.icon ? `<span class="sp-lg-ic" aria-hidden="true">${esc(r.icon)}</span>` : '<span class="sp-lg-ic" aria-hidden="true"></span>';
    return `<li class="${cls.join(' ')}" style="--lv:${lv}">${ic}<span class="sp-lg-tx">${numberHtml(r.text)}</span></li>`;
}

/**
 * 묶음들 → 진행 기록 HTML. 가장 최근 묶음이 맨 위·펼침, 나머지는 접힘(open 에 사용자가 고른 값이 있으면 그것).
 * @param {Array} groups  오래된 것부터
 * @param {{ open?: Object<string, boolean> }} [o]
 */
export function logHtml(groups, { open = {} } = {}) {
    const list = (groups || []).filter(g => g && g.entries && g.entries.length).map(summarizeGroup).reverse();
    if (!list.length) return '';
    return list.map((v, i) => {
        const isOpen = Object.prototype.hasOwnProperty.call(open, v.id) ? !!open[v.id] : i === 0;
        const label = STATUS_LABEL[v.status];
        const pills = [
            v.auto ? '<span class="pd-pill accent">자동 시작</span>' : '',
            v.warns ? `<span class="pd-pill warn" title="⚠ 줄 수">경고 ${esc(v.warns)}</span>` : '',
            v.errors && v.status !== 'fail' && v.status !== 'error' ? `<span class="pd-pill risk">오류 ${esc(v.errors)}</span>` : '',
        ].join('');
        return `<details class="sp-lg is-${esc(v.status)}" data-g="${esc(v.id)}"${isOpen ? ' open' : ''}>
            <summary class="sp-lg-head">
                <span class="sp-lg-time">${esc(clock(v.at))}</span>
                <span class="sp-lg-title">${esc(v.title)}</span>${pills}
                <span class="sp-lg-grow"></span>
                ${label ? `<span class="pd-pill ${STATUS_PILL[v.status]} sp-lg-status">${esc(label)}</span>` : ''}
                <span class="sp-lg-count">${esc(v.count)}줄</span>
            </summary>
            <ol class="sp-lg-rows">${v.rows.map(rowHtml).join('')}</ol>
        </details>`;
    }).join('');
}

/** [복사] — 전체를 글자로(오래된 묶음부터, 머리 줄 + 원래 줄 그대로) */
export function logText(groups) {
    return (groups || []).filter(g => g && g.entries && g.entries.length).map(g => {
        const v = summarizeGroup(g);
        const label = STATUS_LABEL[v.status];
        const head = `── ${clock(v.at)} ${v.title}${label ? ` · ${label}` : ''}${v.auto ? ' · 자동 시작' : ''}${v.warns ? ` · 경고 ${v.warns}` : ''} ──`;
        return [head, ...g.entries.map(e => String(e.s))].join('\n');
    }).join('\n\n');
}
