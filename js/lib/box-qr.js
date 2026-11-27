// === js/lib/box-qr.js — 박스 번호 QR 스티커(2026-11-27 사용자 요청, 실사용은 검토 중) ===
// 순수 함수만(시험 tests/box-qr.test.js). 화면은 box-qr.html·js/box-qr.js(스티커 만들기), 읽는 쪽은 입고 스캐너 박스 모드
// (js/scan-boxcheck.js · scan.html — 'GGSBOX:<번호>' 를 읽으면 그 번호로 바로 확정, 입고 모드에선 상품으로 처리하지 않음).
//   · QR 내용 = 'GGSBOX:' + 박스 번호(packBoxes 와 같은 모양 — normBox: 'a05' → 'A5', '007' → '7'). 대문자.
//   · 번호 범위: '1~200'·'A1~A50'·'A1~50'·'A1-A50'·'A5' — 줄·쉼표로 여러 개. 같은 번호는 한 번만(처음 나온 순서).
//   · 용지(A4 210×297mm): 24칸(3×8, 64×33.9) · 12칸(2×6, 99.1×42.3) · 직접(가로×세로 칸·여백 mm).
import { normBox } from './box-check.js?v=9ea481795e93-c7b970d6';

export const BOX_QR_PREFIX = 'GGSBOX:';
export const BOX_QR_MAX = 2000;            // 한 번에 만들 번호 수 상한(장수 곱하기 전)
export const BOX_QR_MAX_LABELS = 4000;     // 장수까지 곱한 칸 수 상한(인쇄 미리보기가 너무 무거워지지 않게)

/** 박스 번호 → QR 내용('GGSBOX:A2'). 박스 모양이 아니면 '' */
export function boxQrText(box) {
    const b = normBox(box);
    return b ? BOX_QR_PREFIX + b : '';
}

/** 찍힌 글자가 박스 스티커인가('GGSBOX:' 로 시작 — 대소문자·앞뒤 공백 무시). 번호가 틀려도 true(상품으로 처리하지 않으려고) */
export function isBoxQr(text) {
    return String(text == null ? '' : text).normalize('NFKC').trim().toUpperCase().startsWith(BOX_QR_PREFIX);
}

/** 박스 스티커 글자 → 박스 번호(normBox). 스티커가 아니거나 번호가 박스 모양이 아니면 '' */
export function parseBoxQr(text) {
    if (!isBoxQr(text)) return '';
    const t = String(text).normalize('NFKC').trim().toUpperCase();
    return normBox(t.slice(BOX_QR_PREFIX.length).trim());
}

const RANGE = /^([A-Z]*)0*(\d+)\s*[~\-]\s*([A-Z]*)0*(\d+)$/;

/**
 * 번호 범위 글자 → { boxes:[번호…], errors:[{ part, why }] }.
 *   '1~200' · 'A1~A50' · 'A1~50'(뒤 앞글자 생략) · 'A1-A50' · 'A5' · 줄·쉼표로 여러 개. 거꾸로 쓴 범위('10~1')는 오류.
 *   앞글자가 다른 범위('A1~B5')·박스 모양이 아닌 것·상한(BOX_QR_MAX) 넘음은 errors 에 적고 그 조각은 건너뛴다.
 */
export function expandRanges(text) {
    const boxes = [], errors = [], seen = new Set();
    const add = (b) => { if (!seen.has(b)) { seen.add(b); boxes.push(b); } };
    const parts = String(text == null ? '' : text).normalize('NFKC').toUpperCase().split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
        const m = RANGE.exec(part.replace(/\s+/g, ' '));
        if (m) {
            const pre = m[1], pre2 = m[3] || m[1];
            const lo = Number(m[2]), hi = Number(m[4]);
            if (pre2 !== pre) { errors.push({ part, why: '앞글자가 다름' }); continue; }
            if (hi < lo) { errors.push({ part, why: '뒤 번호가 앞 번호보다 작음' }); continue; }
            if (boxes.length + (hi - lo + 1) > BOX_QR_MAX) { errors.push({ part, why: `한 번에 ${BOX_QR_MAX}개까지` }); continue; }
            for (let n = lo; n <= hi; n++) add(normBox(pre + n));
            continue;
        }
        const b = normBox(part);
        if (!b) { errors.push({ part, why: '박스 번호 모양이 아님' }); continue; }
        if (boxes.length + 1 > BOX_QR_MAX) { errors.push({ part, why: `한 번에 ${BOX_QR_MAX}개까지` }); continue; }
        add(b);
    }
    return { boxes, errors };
}

export const A4 = { w: 210, h: 297 };
/** 용지 틀(mm). 시중 A4 라벨지 규격(24칸 3×8 64×33.9 계열 · 12칸 2×6 99.1×42.3 계열) */
export const SHEETS = {
    '24': { cols: 3, rows: 8, cellW: 64, cellH: 33.9, gapX: 1.5, gapY: 0 },
    '12': { cols: 2, rows: 6, cellW: 99.1, cellH: 42.3, gapX: 2.5, gapY: 0 },
};

/**
 * 용지 종류 → 배치(mm). kind = '24' | '12' | 'custom'(custom = { cols, rows, margin }).
 * @returns {{ cols, rows, cellW, cellH, gapX, gapY, left, top, perPage } | null}  틀린 값이면 null
 */
export function sheetLayout(kind, custom) {
    let s;
    if (SHEETS[kind]) s = { ...SHEETS[kind] };
    else if (kind === 'custom') {
        const cols = Math.floor(Number(custom && custom.cols)), rows = Math.floor(Number(custom && custom.rows));
        const margin = Number(custom && custom.margin);
        if (!(cols >= 1 && cols <= 10 && rows >= 1 && rows <= 20 && margin >= 0 && margin <= 40)) return null;
        s = { cols, rows, cellW: (A4.w - 2 * margin) / cols, cellH: (A4.h - 2 * margin) / rows, gapX: 0, gapY: 0 };
    } else return null;
    const usedW = s.cols * s.cellW + (s.cols - 1) * s.gapX, usedH = s.rows * s.cellH + (s.rows - 1) * s.gapY;
    if (usedW > A4.w + 0.01 || usedH > A4.h + 0.01) return null;
    const r2 = (x) => Math.round(x * 100) / 100;
    return { ...s, cellW: r2(s.cellW), cellH: r2(s.cellH), left: r2((A4.w - usedW) / 2), top: r2((A4.h - usedH) / 2), perPage: s.cols * s.rows };
}

/**
 * 번호들 × 장수 → 쪽 나누기. 같은 번호의 여러 장은 붙여서(1,1,2,2…). 칸 수가 상한을 넘으면 넘는 만큼 자르고 cut 에 적는다.
 * @returns {{ pages: string[][], total: number, cut: number }}
 */
export function paginate(boxes, copies, perPage) {
    const n = Math.max(1, Math.min(50, Math.floor(Number(copies) || 1)));
    const per = Math.max(1, Math.floor(Number(perPage) || 1));
    const all = [];
    for (const b of boxes || []) for (let i = 0; i < n; i++) all.push(b);
    const cut = Math.max(0, all.length - BOX_QR_MAX_LABELS);
    const list = cut ? all.slice(0, BOX_QR_MAX_LABELS) : all;
    const pages = [];
    for (let i = 0; i < list.length; i += per) pages.push(list.slice(i, i + per));
    return { pages, total: list.length, cut };
}

/**
 * QR 모듈 표(isDark(r,c)·count) → SVG path d(가로로 이어진 검은 칸을 한 직사각형으로). 좌표 = 모듈 단위, quiet = 바깥 여백 모듈 수.
 * 인쇄에서 칸 사이 틈이 안 생기게 한 path 로 그린다(viewBox 0 0 count+2q).
 */
export function qrPath(isDark, count, quiet = 0) {
    const d = [];
    for (let r = 0; r < count; r++) {
        let c = 0;
        while (c < count) {
            if (!isDark(r, c)) { c++; continue; }
            let e = c;
            while (e < count && isDark(r, e)) e++;
            d.push(`M${c + quiet} ${r + quiet}h${e - c}v1h${c - e}z`);
            c = e;
        }
    }
    return d.join('');
}
