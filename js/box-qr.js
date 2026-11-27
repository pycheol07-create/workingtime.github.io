// === js/box-qr.js — 박스 번호 QR 스티커 만들기 화면(box-qr.html, 2026-11-27 사용자 요청, 실사용은 검토 중) ===
// 번호 범위·장수·용지 → A4 라벨지 미리보기(QR + 큰 박스 번호 + 'GGS BOX') → 브라우저 인쇄(PDF 저장 가능).
//   · QR 은 vendor/qrcode/qrcode.mjs(npm qrcode-generator 2.0.4, MIT — 외부 요청 없음)로 이 화면 안에서만 만든다. 오류정정 M.
//   · 내용·범위·배치 계산은 js/lib/box-qr.js(시험 tests/box-qr.test.js). Firestore 는 읽지도 쓰지도 않는다(로그인 확인만 — 권한 scan.view, js/page-gate.js).
import qrcode from '../vendor/qrcode/qrcode.mjs';
import { initializeFirebase } from './config.js?v=242bb63abbe9-dd1665a9';
import { setShellContext } from './app-shell-bridge.js?v=b9a7199f3e1d-c80c27e9';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { boxQrText, expandRanges, sheetLayout, paginate, qrPath } from './lib/box-qr.js?v=b6f91b6e9e93-9b7fb1d9';
import { escapeHtml as esc } from './utils.js?v=65bb3512764f-e315797c';

const QUIET = 2;            // QR 바깥 흰 여백(모듈 수) — 칸 안쪽 여백이 더 있다
const $ = (id) => document.getElementById(id);
const svgCache = new Map(); // 번호 → svg 글자

/** 번호 → QR SVG(크기는 CSS mm 로 따로 준다). data-qr = 내용(시험이 다시 읽어 맞춰 본다) */
function qrSvg(box) {
    if (svgCache.has(box)) return svgCache.get(box);
    const text = boxQrText(box);
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(), size = n + QUIET * 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="bq-qr" data-qr="${esc(text)}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${esc(text)}">`
        + `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${qrPath((r, c) => qr.isDark(r, c), n, QUIET)}"/></svg>`;
    svgCache.set(box, svg);
    return svg;
}

function readForm() {
    const kind = $('bq-sheet').value;
    const layout = sheetLayout(kind, { cols: $('bq-cols').value, rows: $('bq-rows').value, margin: $('bq-margin').value });
    const { boxes, errors } = expandRanges($('bq-ranges').value);
    return { kind, layout, boxes, errors, copies: $('bq-copies').value };
}

function render() {
    const { kind, layout, boxes, errors, copies } = readForm();
    document.querySelectorAll('.bq-custom').forEach(el => { el.hidden = kind !== 'custom'; });
    const errEl = $('bq-err');
    const errs = errors.map(e => `'${e.part}' — ${e.why}`);
    if (!layout) errs.unshift('용지 칸·여백 값이 맞지 않습니다(가로 1~10칸 · 세로 1~20칸 · 여백 0~40mm)');
    errEl.hidden = !errs.length;
    errEl.textContent = errs.length ? '건너뜀: ' + errs.join(' · ') : '';
    const pv = $('bq-preview');
    if (!layout || !boxes.length) {
        pv.innerHTML = '';
        $('bq-sum').textContent = boxes.length ? '' : '박스 번호를 넣어 주세요';
        $('bq-print').disabled = true;
        return;
    }
    const pg = paginate(boxes, copies, layout.perPage);
    const per = Math.max(1, Math.floor(Number(copies) || 1));
    $('bq-sum').textContent = `번호 ${boxes.length.toLocaleString('ko-KR')}개 × ${Math.min(per, 50)}장 = ${pg.total.toLocaleString('ko-KR')}칸 · A4 ${pg.pages.length}쪽`
        + (pg.cut ? ` (칸이 많아 ${pg.cut.toLocaleString('ko-KR')}칸은 뺐습니다 — 나눠서 뽑으세요)` : '');
    $('bq-print').disabled = false;
    // 칸 안: QR(칸 높이 - 여백, 칸 너비의 48% 이하) + 번호(남은 너비·높이에 맞춘 글자 크기)
    const qr = Math.max(8, Math.min(layout.cellH - 3, layout.cellW * 0.48));
    const txtW = layout.cellW - qr - 6;
    const numSize = (b) => Math.max(4, Math.min(layout.cellH * 0.58, txtW / (Math.max(1, b.length) * 0.66)));
    pv.innerHTML = pg.pages.map(page => '<div class="bq-sheet">' + page.map((b, i) => {
        const c = i % layout.cols, r = Math.floor(i / layout.cols);
        const left = layout.left + c * (layout.cellW + layout.gapX), top = layout.top + r * (layout.cellH + layout.gapY);
        return `<div class="bq-cell" data-box="${esc(b)}" style="left:${left}mm; top:${top}mm; width:${layout.cellW}mm; height:${layout.cellH}mm;">`
            + qrSvg(b).replace('<svg ', `<svg style="width:${qr}mm; height:${qr}mm;" `)
            + `<div class="bq-txt"><div class="bq-num" style="font-size:${numSize(b).toFixed(2)}mm;">${esc(b)}</div><div class="bq-tag">GGS BOX</div></div></div>`;
    }).join('') + '</div>').join('');
    fitZoom();
}

/** 미리보기 용지를 화면 너비에 맞춰 줄인다(인쇄는 실제 크기 — CSS @media print) */
function fitZoom() {
    const w = $('bq-preview').clientWidth || 360;
    const mmPx = 96 / 25.4;
    const z = Math.max(0.2, Math.min(1, (w - 8) / (210 * mmPx)));
    document.documentElement.style.setProperty('--bq-zoom', z.toFixed(3));
}

let timer = 0;
const later = () => { clearTimeout(timer); timer = setTimeout(render, 200); };
['bq-ranges', 'bq-copies', 'bq-cols', 'bq-rows', 'bq-margin'].forEach(id => $(id).addEventListener('input', later));
$('bq-sheet').addEventListener('change', render);
$('bq-print').addEventListener('click', () => { render(); window.print(); });
window.addEventListener('resize', fitZoom);

const { auth } = initializeFirebase();
if (auth) {
    onAuthStateChanged(auth, (user) => {
        setShellContext(user ? { signedIn: true, uid: user.uid } : { signedIn: false });
        $('bq-loading').hidden = true;
        $('bq-gate').hidden = !!user;
        $('bq-main').hidden = !user;
        if (user) render();
    });
} else {
    $('bq-loading').textContent = '불러오지 못했습니다 — 새로고침해 주세요';
}
