// === js/scan-boxcheck.js — 입고 스캐너(scan.html) '박스 확인' 모드(2026-11-27 사용자 결정) ===
// 박스 라벨을 찍으면(카메라·키보드 스캐너·번호 입력) 그 박스에 아직 미발인 상품이 들었는지 크게 보여 준다.
//   · 읽기만 한다 — 입고 목록·ScanDB·입고이력에 아무것도 쓰지 않는다. 모드를 끄면 원래 입고/위치 스캔.
//   · 박스 번호 = integrations/packBoxes(패킹봇 box_sync.py) 중 고른 패킹 하나(기본 = 가장 최근, 고른 것은 이 폰 localStorage 에 기억).
//   · 미발 = ChinaStockGoods_ScanDB/{상품코드}.mibalQty > 0(입고 팝업의 미발과 같은 문서 — 다른 기기가 잡아 둔 몫(hold)은 빼지 않는다).
//     ScanDB 에는 미발 대상 상품만 있다 — 문서 없음 = 미발 0('스캐너 목록에 없음' 작게). 읽기 실패(오류·권한)만 '확인 못 함'
//     (하나라도 있으면 초록 '미발 없음' 대신 회색).
//   · 판단(박스 번호 찾기·집계·패킹 목록)은 js/lib/box-check.js·pack-boxes.js 의 순수 함수(시험 tests/box-check.test.js).
//   · 찍은 글자는 화면의 '최근 확인' 10건에만 보이고 저장하지 않는다.
// scan.html 은 setupScanBoxCheck({ db, doc, getDoc, speak }) 한 번 부르고, onScan 에서 isOn() 이면 check(raw) 로 넘긴다.
import { parsePackBoxes } from './lib/pack-boxes.js?v=ff567fa413e9-8c6a9912';
import { boxIndex, findBox, boxReport, packChoices, pickPack, scanDbRows, mapLimit } from './lib/box-check.js?v=4138f2b97f75-a9ee3001';
import { escapeHtml as esc } from './utils.js?v=65bb3512764f-e315797c';

const PACK_BOXES = 'artifacts/team-work-logger-v2/integrations/packBoxes';
const SCANDB = 'ChinaStockGoods_ScanDB';
const PACK_KEY = 'scanBoxPack';   // 고른 패킹No(이 폰에만) — 스캐너 반영 작업 패킹이 없을 때만 쓴다
const SETTINGS = 'artifacts/team-work-logger-v2/mibal2/settings';   // batch.ships = 지금 스캐너에 반영한 작업의 출고일(읽기만)
const HIST_MAX = 10;
const READ_LIMIT = 6;             // ScanDB 동시 읽기 수
const SAME_MS = 5000;             // 카메라가 같은 라벨을 계속 읽을 때 — 마지막으로 본 뒤 5초 안의 같은 글자는 다시 확인하지 않는다
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 저장 못 해도 이번 화면에서는 쓴다 */ } };
const hhmm = (d) => d.toTimeString().slice(0, 5);

/**
 * @param {{ db:object, doc:Function, getDoc:Function, speak?:(t:string)=>void }} o
 * @returns {{ isOn:()=>boolean, setOn:(v:boolean)=>void, check:(raw:string, opt?:object)=>Promise<void>, reload:()=>Promise<void> } | null}
 */
export function setupScanBoxCheck(o) {
    const $ = (id) => document.getElementById(id);
    const panel = $('bx-panel'), tab = $('tab-box'), sel = $('bx-pack'), src = $('bx-src'), form = $('bx-form'),
        input = $('bx-input'), out = $('bx-result'), hist = $('bx-hist'), reloadBtn = $('bx-reload');
    if (!panel || !tab || !sel || !src || !form || !input || !out || !hist) return null;
    if (panel.dataset.wired) return null;
    panel.dataset.wired = '1';

    let on = false;
    let parsed = null;        // parsePackBoxes 결과(못 읽었으면 null)
    let loadState = 'idle';   // idle · loading · ok · fail(마지막 읽기 실패 — parsed 가 있으면 전에 읽은 것을 쓴다)
    let loadedAt = null;
    let packKey = '';
    let workShips = [];       // 스캐너 반영 작업 출고일
    let manual = false;       // 이번에 켠 동안 사람이 패킹을 직접 골랐다(그동안은 자동으로 안 바꿈)
    let newer = false;
    let idx = new Map();
    let seq = 0;              // 늦게 끝난 앞 확인이 새 결과를 덮지 않게
    let last = { raw: '', at: 0 };
    const history = [];

    const choices = () => packChoices(parsed, workShips);
    const curPack = () => (parsed ? parsed.packs.find(p => p.key === packKey) || null : null);
    const curLabel = () => { const c = choices().find(x => x.key === packKey); return c ? c.label : ''; };

    function rebuild() {
        const p = curPack();
        idx = p && !p.err ? boxIndex([{ key: p.key, tag: '', b: p.b }]) : new Map();
    }
    function fillPacks() {
        const cs = choices();
        const pk = manual ? pickPack(cs, packKey) : pickPack(cs, lsGet(PACK_KEY), true);
        packKey = pk ? pk.key : '';
        newer = !!(pk && pk.newer);
        sel.innerHTML = cs.length ? cs.map(c => `<option value="${esc(c.key)}"${c.key === packKey ? ' selected' : ''}>${esc(c.label)}</option>`).join('')
            : '<option value="">박스 번호 자료 없음</option>';
        sel.disabled = !cs.length;
        rebuild();
        renderSrc();
    }
    function renderSrc() {
        let t;
        if (!parsed) t = loadState === 'fail' ? '박스 번호 자료를 읽지 못했습니다 — [다시 읽기]를 누르세요' : '박스 번호 자료를 읽는 중…';
        else if (!choices().length) t = '박스 번호 자료가 없습니다(패킹봇이 보낸 패킹만 박스 번호가 있음)';
        else if (curPack() && curPack().err) t = '이 패킹은 박스 번호를 읽지 못했습니다(수정본 파일) — 다른 패킹을 고르세요';
        else t = `이 패킹의 박스 ${num(idx.size)}개` + (loadedAt ? ` · ${hhmm(loadedAt)} 읽음` : '')
            + (loadState === 'fail' ? ' · 새로 읽기 실패(전에 읽은 자료)' : '');
        src.textContent = t;
        src.classList.toggle('bx-src-warn', !!(parsed && newer));
        if (parsed && newer) src.textContent += ' · 더 최근 패킹이 있습니다';
    }

    async function reload() {
        loadState = 'loading';
        if (!parsed) renderSrc();
        if (reloadBtn) reloadBtn.disabled = true;
        try {
            const [snap, st] = await Promise.all([o.getDoc(o.doc(o.db, PACK_BOXES)),
                o.getDoc(o.doc(o.db, SETTINGS)).catch(() => null)]);   // 작업 출고일은 못 읽어도 박스 확인은 된다
            parsed = parsePackBoxes(snap.exists() ? snap.data() : null);
            const b = st && st.exists() ? (st.data() || {}).batch : null;
            workShips = b && Array.isArray(b.ships) ? b.ships.map(String) : [];
            loadState = 'ok';
            loadedAt = new Date();
        } catch (e) {
            console.warn('[scan-box] 박스 번호 자료 읽기 실패', (e && e.code) || '');
            loadState = 'fail';
        } finally {
            if (reloadBtn) reloadBtn.disabled = false;
        }
        fillPacks();
    }

    function focusInput() {
        // 터치 화면은 키보드가 튀어나오므로 자동으로 커서를 두지 않는다(카메라로 찍는 것이 기본)
        let touch = false;
        try { touch = window.matchMedia('(hover: none)').matches; } catch (e) { /* 모르면 PC 로 본다 */ }
        if (!touch) { try { input.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
    }

    function setOn(v) {
        on = !!v;
        document.body.classList.toggle('box-mode', on);
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-pressed', on ? 'true' : 'false');
        last = { raw: '', at: 0 };
        if (on) {
            manual = false;   // 켤 때마다 스캐너 반영 작업 패킹으로 다시 고른다
            if (loadState !== 'loading') reload();   // 켤 때마다 새로 읽는다(문서 하나)
            focusInput();
        }
    }

    function banner(cls, say, sub, extra) {
        return `<div class="bx-banner ${cls}" role="status">${say}${sub ? `<div class="bx-sub">${sub}</div>` : ''}${extra || ''}</div>`;
    }
    function addHist(label, text, cls) {
        history.unshift({ label, text, cls, at: new Date() });
        if (history.length > HIST_MAX) history.pop();
        hist.innerHTML = history.map(x => `<li class="${esc(x.cls)}"><span class="bx-t">${esc(hhmm(x.at))}</span> <b>${esc(x.label)}</b> — ${esc(x.text)}</li>`).join('');
    }
    const ask = (say, sub, label, text) => { out.innerHTML = banner('bx-ask', `<div class="bx-say">${esc(say)}</div>`, sub ? esc(sub) : ''); addHist(label, text, 'bx-h-ask'); };

    async function readCodes(codes) {
        return mapLimit(codes, READ_LIMIT, async (code) => {
            try {
                const d = await o.getDoc(o.doc(o.db, SCANDB, String(code).trim()));
                return { code, ok: true, exists: d.exists(), data: d.exists() ? d.data() : null };
            } catch (e) {
                return { code, ok: false };
            }
        });
    }

    function showHit(box, packs, raw, weak, results) {
        const rep = boxReport(packs, scanDbRows(results));
        const has = rep.mibalCodes > 0;
        // 박스 안 상품이 전부 스캐너 목록(ScanDB)에 없으면 초록 대신 회색 — [스캐너에 반영] 전이거나 초기화 직후일 수 있다(2026-11-27 리뷰)
        const items0 = rep.packs.flatMap(p => p.items);
        const allNoDoc = !has && items0.length > 0 && items0.every(x => x.noDoc);
        const unsure = !has && (rep.unknown > 0 || allNoDoc);
        const say = has ? `미발 있음 ${num(rep.mibalCodes)}종 · ${num(rep.mibalQty)}개`
            : rep.unknown > 0 ? `확인 못 함 ${num(rep.unknown)}종`
            : allNoDoc ? '스캐너 목록에 없음 — 반영 여부 확인' : '미발 없음';
        const sub = `${esc(curLabel())} · 박스 안 ${num(rep.total)}종`
            + (rep.unknown ? ` · 확인 못 함 ${num(rep.unknown)}종(${navigator.onLine === false ? '오프라인' : '읽기 실패'})` : '');
        const warn = weak ? `<div class="bx-warn">라벨 글자 '${esc(raw)}' 에서 ${esc(box)}번으로 읽었습니다 — 라벨의 박스 번호와 맞는지 확인하세요</div>` : '';
        let h = banner(has ? 'bx-yes' : unsure ? 'bx-ask' : 'bx-no',
            `<div class="bx-box">${esc(box)}번 박스</div><div class="bx-say">${say}</div>`, sub, warn);
        const items = rep.packs.flatMap(p => p.items);
        if (items.length) {
            h += '<ul class="bx-list">' + items.map(x => {
                const right = !x.inTable ? '<span class="bx-q bx-q-unk">확인 못 함</span>'
                    : x.mibal > 0 ? `<span class="bx-q bx-q-yes">미발 ${esc(num(x.mibal))}</span>`
                    : x.noDoc ? '<span class="bx-q bx-q-nodoc">스캐너 목록에 없음</span>' : '<span class="bx-q">0</span>';
                return `<li class="${x.mibal > 0 ? 'bx-hit' : ''}"><span class="bx-code">${esc(x.code)}</span>`
                    + `<span class="bx-name">${x.name ? esc(x.name) : ''}</span>${right}</li>`;
            }).join('') + '</ul>';
        }
        out.innerHTML = h;
        if (has) {
            try { if (o.speak) o.speak('미발'); } catch (e) { /* 무시 */ }
            try { navigator.vibrate(150); } catch (e) { /* 무시 */ }
        }
        addHist(`${box}번`, has ? `미발 ${num(rep.mibalCodes)}종 · ${num(rep.mibalQty)}개` : rep.unknown > 0 ? `확인 못 함 ${num(rep.unknown)}종` : allNoDoc ? '스캐너 목록에 없음' : '미발 없음',
            has ? 'bx-h-yes' : unsure ? 'bx-h-ask' : 'bx-h-no');
    }

    /**
     * 찍은 글자 하나 확인. opt.manual = 입력칸에서 넣음(같은 글자 거르기 안 함), opt.pick = 'many' 에서 고른 번호.
     * 예외를 밖으로 던지지 않는다(스캐너가 멈추지 않게).
     */
    async function check(raw, opt = {}) {
        const s = String(raw == null ? '' : raw).trim();
        if (!s) return;
        const now = Date.now();
        if (!opt.manual && !opt.pick && s === last.raw && now - last.at < SAME_MS) { last.at = now; return; }
        last = { raw: s, at: now };
        const my = ++seq;
        try {
            if (!parsed) {
                if (loadState === 'fail') ask('박스 번호 자료를 읽지 못했습니다', '[다시 읽기]를 누른 뒤 다시 찍으세요.', s, '자료 못 읽음');
                else ask('박스 번호 자료를 읽는 중입니다', '잠시 뒤 다시 찍으세요.', s, '아직 판정 안 함');
                return;
            }
            const p = curPack();
            if (!p) { ask('박스 번호 자료가 없습니다', '패킹봇이 보낸 패킹만 박스 번호가 있습니다.', s, '자료 없음'); return; }
            if (p.err) { ask('이 패킹은 박스 번호를 읽지 못했습니다', '수정본 파일의 박스를 못 읽은 패킹입니다 — 위에서 다른 패킹을 고르세요.', s, '읽기 실패 패킹'); return; }
            const r = opt.pick && idx.has(opt.pick) ? { status: 'hit', box: opt.pick, packs: idx.get(opt.pick), weak: false } : findBox(s, idx);
            if (r.status === 'hit') {
                out.innerHTML = banner('bx-ask', `<div class="bx-box">${esc(r.box)}번 박스</div><div class="bx-say">미발 확인 중…</div>`, '');
                const codes = [...new Set(r.packs.flatMap(x => x.codes || []))];
                const results = await readCodes(codes);
                if (my !== seq) return;   // 그사이 다른 라벨을 찍었다
                showHit(r.box, r.packs, s, r.weak, results);
            } else if (r.status === 'many') {
                out.innerHTML = banner('bx-ask', '<div class="bx-say">박스 번호가 여럿으로 읽힙니다 — 고르세요</div>', '',
                    `<div class="bx-choices">${r.choices.map(b => `<button type="button" class="bx-pick" data-box="${esc(b)}">${esc(b)}번</button>`).join('')}</div>`);
                out.querySelectorAll('[data-box]').forEach(b => b.addEventListener('click', () => { check(s, { pick: b.dataset.box }); }));
                addHist(s, '번호 고르기', 'bx-h-ask');
            } else if (r.status === 'empty') {
                ask('이 패킹에 박스 번호 자료가 없습니다', '다른 패킹을 고르세요.', s, '자료 없음');
            } else {
                ask('이 패킹에 없는 박스 번호입니다',
                    `읽은 번호: ${r.candidates.length ? r.candidates.join(', ') : '없음'} — 고른 패킹(${curLabel()})이 맞는지, 라벨이 이 패킹 것인지 확인하세요.`,
                    s, '없는 박스');
            }
        } catch (e) {
            console.warn('[scan-box] 확인 오류', e);
            if (my === seq) ask('확인 중 오류가 났습니다', '다시 찍어 주세요.', s, '확인 안 됨');
        }
    }

    sel.addEventListener('change', () => {
        packKey = sel.value;
        manual = true;
        if (packKey) lsSet(PACK_KEY, packKey);
        newer = !!(pickPack(choices(), packKey) || {}).newer;
        rebuild(); renderSrc();
        seq++; last = { raw: '', at: 0 };
        out.innerHTML = '';
    });
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = input.value;
        input.value = '';
        check(v, { manual: true }).finally(() => focusInput());
    });
    if (reloadBtn) reloadBtn.addEventListener('click', () => { reload(); });
    tab.addEventListener('click', () => setOn(!on));

    return { isOn: () => on, setOn, check, reload };
}
