// === js/lib/ez-stock-view.js ===
// 로케이션관리 머리줄의 재고 최신화 두 칸(파일 업로드 / 이지어드민 자동)과 자리별 '자동' 표식의 순수 판정 — Firebase import 없음(node --test 대상: tests/ez-stock-view.test.js).
// 입력 문서:
//   locationStock/ezStockStatus { at(재고 캐시 시각 ms), writtenAt(쓴 시각 ms), slots, basisLastDataUpdate } — 쓴 자리가 1곳 이상일 때만 바뀐다(로케이션추천\재고기록.py)
//   locationStock/ezStockRun    { lastRunAt, lastOkAt, lastFailAt, ok, state, note, errorKind, slots } — 회차마다(로케이션추천\재고기록상태.py)
//     skip 회차는 ok·slots·errorKind 를 안 쓰므로 직전 결과가 남아 있다 → 화면은 직전 상태를 유지하고 사유만 툴팁에.
//   자리 ezAt(재고 캐시 시각 ms) — 값이 바뀌어 서버가 쓴 자리에만 있다. 일일 업로드가 지운다.
// 시각 표시는 브라우저 시간대(location.js 머리줄과 같음). 함수는 now 를 받아 자정 넘김을 시험할 수 있다.

import { tsMs } from './busy-view.js?v=202611111506';

const p2 = (n) => String(n).padStart(2, '0');
const DAY_MS = 86400000;
const hm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;

function startOfDay(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 달력 날짜로 며칠 전인가(오늘 0). */
export function daysAgo(ms, now = Date.now()) {
    return Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
}

/** 오늘 ok · 어제 warn · 2일 이상 risk — 업로드 칸·자동 칸 공통. */
export function ageTone(ms, now = Date.now()) {
    const n = daysAgo(ms, now);
    return n <= 0 ? 'ok' : (n === 1 ? 'warn' : 'risk');
}

function fullWhen(ms) {
    const d = new Date(ms);
    return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${hm(d)}`;
}

/** 오늘이면 HH:MM, 아니면 MM/DD HH:MM. */
function shortWhen(ms, now) {
    return daysAgo(ms, now) === 0 ? hm(new Date(ms)) : fullWhen(ms);
}

/** 파일 업로드 칸. ts = INFO_CONFIG.lastDataUpdate. → { value, tone, title } (tone 'muted' = 회색) */
export function uploadStockView(ts, now = Date.now()) {
    const ms = tsMs(ts);
    if (!ms) return { value: '기록 없음', tone: 'muted', title: '파일 업로드 기록 없음' };
    return { value: fullWhen(ms), tone: ageTone(ms, now), title: `파일 업로드로 재고를 마지막으로 올린 시각: ${new Date(ms).toLocaleString('ko-KR')}` };
}

function view(kind, label, value, tone, title) {
    return { kind, label, value, tone, title, text: `${label} ${value}` };
}

/**
 * 이지어드민 자동 칸 — 표의 위에서부터 먼저 맞는 상태. 숨기지 않는다.
 * @param {{run?:object|null, status?:object|null, last?:any, autoSlots?:number|null}} a  autoSlots: 화면 자리 ezAt 집계, 아직 못 받았으면 null(자리 수 생략)
 * @returns {{kind:'fail'|'none'|'file'|'ok'|'same', label:string, value:string, tone:'ok'|'warn'|'risk'|'muted', title:string, text:string}}
 */
export function ezStockView({ run, status, last, autoSlots } = {}, now = Date.now()) {
    const r = run || {}, s = status || {};
    const at = Number(s.at) || 0;
    const okAt = tsMs(r.lastOkAt);
    const lastMs = tsMs(last);
    const seen = at || okAt;
    const skipped = r.state === 'skip' && r.note ? ` · 이번 회차 건너뜀: ${r.note}` : '';

    if (r.ok === false) {
        const failAt = tsMs(r.lastFailAt) || tsMs(r.lastRunAt);
        const lastOk = okAt || Number(s.writtenAt) || at;
        const value = [failAt ? shortWhen(failAt, now) : '', lastOk ? `마지막 성공 ${shortWhen(lastOk, now)}` : '성공 기록 없음'].filter(Boolean).join(' · ');
        const kind = r.errorKind ? `(${r.errorKind})` : '';
        return view('fail', '자동 실패', value, 'risk', `이지어드민 자동 갱신 실패${kind}${r.note ? ` · ${r.note}` : ''}${skipped ? ` — 그 뒤 회차는 건너뜀` : ''}`);
    }
    if (!seen) return view('none', '자동 갱신', '기록 없음', 'muted', `이지어드민 자동 갱신 기록 없음${skipped}`);

    // 직전(건너뛴 회차 제외) 결과가 '바뀐 자리 0곳'인가. skip 은 ok·slots 를 안 지우므로 그 값으로 안다
    // lastOkAt 은 회차 시작 시각 — 회차 도중 올린 파일은 이 비교에서 '더 새것'이 된다
    const sameRun = !!okAt && r.ok === true && (r.state === 'same' || (r.state === 'skip' && !Number(r.slots)));
    if (sameRun && okAt >= lastMs) {
        return view('same', '자동 확인', `${shortWhen(okAt, now)} · 바뀐 자리 없음`, ageTone(okAt, now), `이지어드민 재고와 비교했고 바뀐 자리가 없음 — ${new Date(okAt).toLocaleString('ko-KR')}${skipped}`);
    }
    if (seen < lastMs || (at && lastMs && Number(s.basisLastDataUpdate) !== lastMs)) {
        return view('file', '자동', `${shortWhen(seen, now)} · 지금은 파일 기준`, 'warn', `파일 업로드가 더 새것이라 재고 숫자는 파일 기준 — 자동 갱신은 ${new Date(seen).toLocaleString('ko-KR')}${skipped}`);
    }
    const n = autoSlots == null ? '' : ` · ${Number(autoSlots).toLocaleString('en-US')}자리`;
    return view('ok', '자동', `${shortWhen(seen, now)}${n}`, ageTone(seen, now), `재고 숫자: 이지어드민 ${new Date(seen).toLocaleString('ko-KR')} 기준 — 파일을 새로 올리면 파일 기준${skipped}`);
}

/** 상품이 있는 자리인가(location.js 필터의 hasCode 와 같은 기준). */
function hasItem(item) {
    const code = String(item.code ?? '').trim();
    const name = String(item.name ?? '').trim();
    return (code !== '' && code !== String(item.id ?? '')) || name !== '';
}

/** 자리의 재고 출처 → 'auto'(서버가 바꾼 자리) | 'file'(파일 값 그대로) | ''(빈 자리). */
export function stockSrcOf(item) {
    if (!item || !hasItem(item)) return '';
    return item.ezAt != null ? 'auto' : 'file';
}

export function countAuto(items) {
    let n = 0;
    for (const it of items || []) if (stockSrcOf(it) === 'auto') n += 1;
    return n;
}

export function autoBadgeTitle(ezAt) {
    const ms = tsMs(ezAt);
    return ms ? `이지어드민 ${fullWhen(ms)} 기준` : '이지어드민 기준';
}

/** 재고 숫자 뒤 '자동' 표식 HTML. 자동으로 바뀐 자리만, 아니면 ''. 글자는 숫자에서 만든 것뿐이라 이스케이프가 필요 없다. */
export function autoBadge(item) {
    if (stockSrcOf(item) !== 'auto') return '';
    return `<span class="list-sub" style="margin-left:4px;" title="${autoBadgeTitle(item.ezAt)}">자동</span>`;
}
