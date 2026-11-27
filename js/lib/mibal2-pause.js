// === js/lib/mibal2-pause.js — 부족수량관리(신규, live) [중간 저장](2026-11-27 사용자 요청) ===
// 순수 함수만(시험 tests/mibal2-pause.test.js). 화면·쓰기는 js/china-mibal2-live.js(pauseWork · closeWork 확인창 · 위 띠).
//   · [작업 마감]은 입고 오차 확정·입고이력 삭제·비축 비움이라 그날 패킹을 다 못 찍었으면 누르면 안 된다.
//     [중간 저장]은 아무것도 지우거나 확정하지 않고 진행 기록만 mibal2/settings.pause 에 남긴다:
//       pause = { at(serverTimestamp), by(직원 이름 — 이 모듈의 기존 기록자 방식, 이메일 아님), batchId, ships,
//                 totals: { codes, arr, conf, remainCodes, remainQty, remainBoxes?(박스 번호를 못 구하면 칸 없음) } }
//     [스캐너에 반영]·[작업 마감](끝까지 됐을 때) 이 pause 를 지운다. 작업(batch)이 바뀌면 옛 pause 는 무시한다(parsePause).
//   · 남은 = 도착 > 입고확인 인 상품(출고일 밖 입고 행 r.outside 제외). 입고확인이 숫자가 아니면(손으로 쓴 글자) 0 으로 본다.
//   · 남은 박스 = 남은 상품이 든 박스(패킹 파일 BOX — js/lib/pack-boxes.js boxesFor 의 list)의 서로 다른 수.

const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const pad2 = (n) => String(n).padStart(2, '0');
const tsMs = (v) => (!v ? 0 : typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime()
    : typeof v === 'number' ? v : (typeof v === 'object' && Number.isFinite(v.seconds)) ? v.seconds * 1000 : (new Date(v).getTime() || 0));
const fmtMD = (s) => { const p = String(s || '').split('-'); return p.length === 3 ? `${+p[1]}.${+p[2]}` : String(s || ''); };
const n = (v) => Number(v || 0).toLocaleString();

/**
 * 남은 입고 합계. rows = 작업 출고일의 표 행(도착 arr·입고확인 conf). boxesOf(code) → 박스 목록 배열(없으면 null — 그때 remainBoxes 없음).
 * @returns {{ codes, arr, conf, remainCodes, remainQty, remainBoxes? }}
 */
export function remainTotalsOf(rows, boxesOf = null) {
    let codes = 0, arr = 0, conf = 0, remainCodes = 0, remainQty = 0;
    const boxes = new Set();
    (rows || []).forEach(r => {
        if (!r || r.outside) return;
        const a = Math.max(0, num(r.arr)), c = Math.max(0, num(r.conf));
        if (a <= 0 && c <= 0) return;
        codes++; arr += a; conf += c;
        if (a > c) {
            remainCodes++; remainQty += a - c;
            if (typeof boxesOf === 'function') { const l = boxesOf(String(r.code)); (Array.isArray(l) ? l : []).forEach(b => boxes.add(String(b))); }
        }
    });
    const out = { codes, arr, conf, remainCodes, remainQty };
    if (typeof boxesOf === 'function') out.remainBoxes = boxes.size;
    return out;
}

/** '상품 N개 · 수량 M개(박스 K개)' — 박스를 모르면 괄호 없음 */
export function remainText(t) {
    if (!t) return '';
    const bx = Number.isFinite(t.remainBoxes) ? `(박스 ${n(t.remainBoxes)}개)` : '';
    return `상품 ${n(t.remainCodes)}개 · 수량 ${n(t.remainQty)}개${bx}`;
}

/** 저장할 pause(at 은 부르는 쪽이 serverTimestamp 로 넣는다) */
export function pauseRecordOf({ batchId, ships, by, totals }) {
    const t = totals || {};
    const tot = { codes: num(t.codes), arr: num(t.arr), conf: num(t.conf), remainCodes: num(t.remainCodes), remainQty: num(t.remainQty) };
    if (Number.isFinite(t.remainBoxes)) tot.remainBoxes = num(t.remainBoxes);
    return { by: String(by || ''), batchId: String(batchId || ''), ships: (ships || []).map(String), totals: tot };
}

/** 부분 마감 상태인가 — 지난 [작업 마감]이 비우기 직전에 멈춤(settings.closePartial, js/china-mibal2-live.js closeWork). 입고이력이 이미 지워져 있다 */
export const isPartialClose = (settings) => { const s = settings || {}; return !!s.closePartial && s.lastClosedId !== s.closePartial; };

/**
 * settings → 지금 작업의 pause(없거나 다른 작업 것이면 null). { atMs, by, batchId, ships, totals }
 * 부분 마감 상태면 null — 입고이력이 지워진 뒤라 '이어서 찍기' 안내가 맞지 않는다([작업 마감]을 다시 눌러 끝낼 차례)
 */
export function parsePause(settings) {
    const s = settings || {};
    if (isPartialClose(s)) return null;
    const p = s.pause, b = s.batch;
    if (!p || typeof p !== 'object' || !b || typeof b !== 'object' || !b.id || String(p.batchId || '') !== String(b.id)) return null;
    const t = (p.totals && typeof p.totals === 'object') ? p.totals : {};
    const totals = { codes: num(t.codes), arr: num(t.arr), conf: num(t.conf), remainCodes: num(t.remainCodes), remainQty: num(t.remainQty) };
    if (t.remainBoxes !== undefined && t.remainBoxes !== null && Number.isFinite(Number(t.remainBoxes))) totals.remainBoxes = num(t.remainBoxes);
    return { atMs: tsMs(p.at), by: String(p.by || ''), batchId: String(p.batchId), ships: Array.isArray(p.ships) ? p.ships.map(String) : [], totals };
}

/** '오늘' · '어제' · 'N일 전' (그 밖 = 날짜만) */
export function dayWord(atMs, now = new Date()) {
    if (!atMs) return '';
    const d0 = new Date(atMs); d0.setHours(0, 0, 0, 0);
    const d1 = new Date(now); d1.setHours(0, 0, 0, 0);
    const days = Math.round((d1 - d0) / 86400000);
    return days === 0 ? '오늘' : days === 1 ? '어제' : days > 1 ? `${days}일 전` : '';
}
const mdhm = (ms) => { const d = new Date(ms); return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/** 위 띠 두 줄 [본문, 안내] — p = parsePause 결과 */
export function pauseBannerLines(p, now = new Date()) {
    if (!p) return [];
    const when = p.atMs ? `${dayWord(p.atMs, now)}(${mdhm(p.atMs)}) ` : '';
    const ships = p.ships.length ? ` — 출고일 ${p.ships.map(fmtMD).join(', ')}` : '';
    const rest = p.totals.remainCodes > 0 ? ` · 남은 ${remainText(p.totals)}` : ' · 남은 상품 없음';
    return [`⏸ ${when}[중간 저장]한 작업이 있습니다${ships}${rest} · 이어서 찍고 다 끝나면 [작업 마감]`,
        '새 패킹이 왔으면 출고일을 추가로 고른 뒤 [스캐너에 반영]하세요(이어서 같은 작업으로 반영됩니다).'];
}

/** [중간 저장] 확인창 글 — pendingFix = 아래 막대에서 아직 [저장] 안 한 입고확인 수정 건수 */
export function pauseConfirmText(t, ships, pendingFix = 0) {
    return `지금까지 한 것을 중간 저장할까요? (출고일 ${(ships || []).map(fmtMD).join(', ')})\n\n`
        + (pendingFix > 0 ? `⚠ 저장 안 한 입고확인 ${n(pendingFix)}건은 반영되지 않았습니다(아래 막대 [저장] 먼저).\n\n` : '')
        + `지금까지: 상품 ${n(t.codes)}개 · 도착 ${n(t.arr)} · 입고확인 ${n(t.conf)}\n`
        + (t.remainCodes > 0 ? `아직 입고 안 됨: ${remainText(t)}\n\n` : '아직 입고 안 된 상품 없음 — 다 끝났으면 [작업 마감]을 누르세요.\n\n')
        + '아무것도 지우거나 확정하지 않습니다 — 입고이력·비축창고·스캐너 자료는 그대로이고 진행 기록만 남깁니다.\n'
        + '다음에 화면을 열면 위에 멈춘 작업 안내가 보입니다.';
}

/**
 * [작업 마감] 확인창 머리 — 남은 상품이 있으면 경고(제목·단추 글자도 바꿈). 없으면 null(예전 그대로).
 * @returns {null | { head, title, okText }}
 */
export function closeWarnOf(t) {
    if (!t || !(t.remainCodes > 0)) return null;
    return {
        head: `⚠⚠ 아직 입고 안 된 ${remainText(t)} ⚠⚠\n`
            + '남은 박스가 있습니다 — 마감하면 남은 수량이 입고 오차로 확정되고 스캔 이력이 지워집니다.\n'
            + '이어서 할 거면 [취소]를 누르고 [중간 저장]을 누르세요.\n\n',
        title: '남은 박스가 있습니다 — 마감할까요?',
        okText: '그래도 마감하기'
    };
}
