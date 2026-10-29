// === js/china-mibal2-live-loc.js ===
// 신규 부족수량관리 단독 운영(live) — 위치지정 보기의 쓰기 버튼과 옵션추가항목1 원천. 2026-10-28 준비.
// js/china-mibal2-live.js 가 불러온다(live 일 때만). 기존 화면 js/china-stock-goods.js 의 같은 기능을 복사해 옮겼다(그 파일은 그대로):
//   [기존재고 엑셀 올리기] btn-loc-off-upload ← handleExistingLocUpload (LOC_SHARD_i.map 에 merge — 오늘 당일입고 지정은 base 만)
//   [위치 초기화]         btn-loc-off-reset  ← clearLocationData (샤드 8개를 빈 map 으로)
//   [기존재고 목록 비우기] btn-loc-off-clear  ← resetLocMove (sub 'existing' 을 뺀 map 으로 샤드 교체)
//   [새 위치를 맨앞에]    chk-loc-front      ← setNewLocPosition (CONFIG.newLocPosition merge)
//   샤드 해시(locShardId)는 기존 화면·scan.html 과 같다. 쓰기 전 샤드는 서버에서 새로 읽는다(구독 값으로 덮지 않게).
// 위치값 엑셀의 옵션추가항목1 원천 = 로케이션관리(Locations ZONE_*)의 rawData '옵션추가항목1' 칸 하나(공급처 등 다른 칸은 꺼내지 않음,
//   앱\채우기자동화\수집.py opt1_from_fields 와 같은 순서). 마지막 업로드(locationStock/uploadStatus 의 끝난 시각)가 LOC_STALE_DAYS 일보다
//   오래됐거나 모르면(업로드 중·실패 포함) 받기를 막는다.
import { doc, getDoc, getDocs, setDoc, collection, query, where, documentId } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { buildLocIndex } from './lib/mibal2-rows.js?v=202610291646';
import { locSourceOf, locFreshMsOf, locStaleReason } from './lib/mibal2-live.js?v=202610291646';
import { locPartsArr, mergeCsvLocs } from './lib/loc-mode.js?v=202610291646';
import { readSheetRowsAOA } from './china-mibal2-live-admin.js?v=202610291646';

const CHINA = 'ChinaStockGoods';
const NUM_LOC_SHARDS = 8;
const UPLOAD_STATUS_PATH = 'artifacts/team-work-logger-v2/locationStock/uploadStatus';   // 로케이션관리 업로드 상태(js/location.js)
function locShardId(code) { let h = 0; const s = String(code || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return 'LOC_SHARD_' + (h % NUM_LOC_SHARDS); }
const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');
const normLocList = (s) => (s || '').toString().split(',').map(x => x.trim()).filter(Boolean).join(',');
const pad2 = (n) => String(n).padStart(2, '0');
const mdhm = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

export function setupLiveLoc(ctx) {
    const { db, showToast, setLoading, errText } = ctx;
    let locTools = null;
    const $ = (id) => document.getElementById(id);

    // ── 옵션추가항목1 원천(로케이션관리) ──
    async function loadSource() {
        const [qs, us] = await Promise.all([
            getDocs(query(collection(db, 'Locations'), where(documentId(), '>=', 'ZONE_'), where(documentId(), '<=', 'ZONE_'))),
            getDoc(doc(db, UPLOAD_STATUS_PATH)).catch(() => null)
        ]);
        const zoneDocs = qs.docs.map(d => ({ id: d.id, data: d.data() || {} }));
        const map = locSourceOf(zoneDocs, buildLocIndex(zoneDocs));
        const fresh = locFreshMsOf(us && us.exists() ? us.data() : null);   // 로케이션관리 업로드 상태의 끝난 시각만
        const reason = locStaleReason(fresh, Date.now());
        return { map, reason, note: fresh ? `옵션추가항목1 = 로케이션관리 자료(${mdhm(fresh)} 업로드)` : '' };
    }

    /** 샤드 8개를 서버에서 읽는다 → { sid: map } (하나라도 못 읽으면 throw — 덮어쓰기 전에 멈춤) */
    async function readShards() {
        const out = {};
        await Promise.all(Array.from({ length: NUM_LOC_SHARDS }, (_, i) => 'LOC_SHARD_' + i).map(async sid => {
            const s = await getDoc(doc(db, CHINA, sid));
            out[sid] = (s.exists() && s.data() && s.data().map) ? s.data().map : {};
        }));
        return out;
    }
    /** 샤드 → { code: {location, at, sub, worker, base} } — 기존 rebuildLocationAssignMap 과 같다 */
    function assignMapOf(shards) {
        const m = {};
        Object.keys(shards).sort().forEach(sid => {
            const map = shards[sid] || {};
            for (const code in map) {
                const v = map[code] || {};
                m[code] = { location: v.location || '', at: v.at, sub: v.sub || '', worker: v.worker || '', base: (v.base !== undefined ? v.base : (v.location || '')) };
            }
        });
        return m;
    }

    // ── [기존재고 엑셀 올리기] — 기존 handleExistingLocUpload 와 같다 ──
    async function uploadExisting(file) {
        setLoading(true, '기존재고 위치값 처리 중...');
        try {
            const rows = await readSheetRowsAOA(file, ['상품코드']);
            let hi = -1, headers = [];
            for (let i = 0; i < Math.min(20, rows.length); i++) { const cl = rows[i].map(cleanKey); if (cl.includes('상품코드')) { hi = i; headers = cl; break; } }
            if (hi < 0) { setLoading(false); alert('상품코드 열을 찾지 못했습니다.'); return; }
            const codeIdx = headers.indexOf('상품코드');
            let locIdx = -1;
            for (const name of ['옵션추가항목1', '로케이션', '위치', '옵션']) { const idx = headers.indexOf(name); if (idx >= 0 && idx !== codeIdx) { locIdx = idx; break; } }
            if (locIdx < 0) { setLoading(false); alert("'옵션추가항목1' 열을 찾지 못했습니다.\n헤더에 '옵션추가항목1'(또는 로케이션/위치)이 있어야 합니다."); return; }
            const entries = [];
            for (let i = hi + 1; i < rows.length; i++) {
                const code = (rows[i][codeIdx] || '').toString().trim().toUpperCase();
                if (!code) continue;
                entries.push([code, normLocList(rows[i][locIdx])]);
            }
            if (!entries.length) { setLoading(false); alert('상품코드가 있는 행이 없습니다.\n(파일이 비었거나 형식이 올바르지 않아 올리지 못했습니다)'); return; }
            const assign = assignMapOf(await readShards());
            const now = Date.now();
            const byShard = {};
            let mergedCnt = 0, keptToday = 0;
            entries.forEach(([code, seedLoc]) => {
                const sid = locShardId(code);
                const prev = assign[code];
                // 오늘 '당일 입고분'으로 자리를 정한 상품은 sub·location 을 그대로 두고 base 만 넣는다(기존과 같다)
                if (prev && (prev.sub || '') === 'today' && prev.location && prev.at && new Date(prev.at).toDateString() === new Date().toDateString()) {
                    keptToday++;
                    (byShard[sid] = byShard[sid] || {})[code] = { ...prev, base: seedLoc };
                    return;
                }
                let newSpots = '';
                if (prev && prev.location) { const b = new Set(locPartsArr(prev.base || '')); newSpots = locPartsArr(prev.location).filter(p => !b.has(p)).join(','); }
                const scanned = !!newSpots; if (scanned) mergedCnt++;
                const location = scanned ? mergeCsvLocs(seedLoc, newSpots) : seedLoc;
                (byShard[sid] = byShard[sid] || {})[code] = { location, base: seedLoc, sub: 'existing', at: (scanned && prev.at) ? prev.at : now, worker: scanned ? 'Scanner_Web' : 'Seed_Upload' };
            });
            for (const sid in byShard) await setDoc(doc(db, CHINA, sid), { map: byShard[sid], updatedAt: new Date() }, { merge: true });
            setLoading(false);
            showToast(`✅ 기존재고 위치값 세팅 완료 (${entries.length - keptToday}건${mergedCnt ? ` · 먼저 찍힌 ${mergedCnt}건 병합` : ''}${keptToday ? ` · 당일입고 지정 ${keptToday}건은 그대로 둠` : ''})`);
        } catch (err) { setLoading(false); alert('기존재고 위치값 처리 실패: ' + errText(err)); }
    }

    // ── [위치 초기화] — 기존 clearLocationData 와 같다 ──
    async function resetAll() {
        let cnt = '?';
        try { cnt = Object.keys(assignMapOf(await readShards())).length.toLocaleString(); } catch (e) { /* 세지 못해도 묻는다 */ }
        if (!confirm(`위치 데이터를 초기화할까요? 되돌릴 수 없습니다.\n\n지워지는 것: 당일·기존재고 위치 지정 ${cnt}개 상품(전체)\n유지되는 것: 부족수량·스캐너 자료`)) return;
        setLoading(true, '위치 데이터 초기화 중...');
        try {
            for (let i = 0; i < NUM_LOC_SHARDS; i++) await setDoc(doc(db, CHINA, 'LOC_SHARD_' + i), { map: {}, updatedAt: new Date() });
            setLoading(false);
            showToast('✅ 위치 데이터 초기화 완료');
        } catch (e) { setLoading(false); alert('초기화 실패: ' + errText(e)); }
    }

    // ── [기존재고 목록 비우기] — 기존 resetLocMove 와 같다 ──
    async function clearExisting() {
        setLoading(true, '위치 데이터 읽는 중...');
        let assign;
        try { assign = assignMapOf(await readShards()); } catch (e) { setLoading(false); alert('위치 데이터를 읽지 못했습니다 — ' + errText(e)); return; }
        setLoading(false);
        const cnt = Object.values(assign).filter(v => (v.sub || '') === 'existing').length;
        if (!cnt) { alert('초기화할 기존재고 내역이 없습니다.'); return; }
        if (!confirm(`기존재고 위치 이동 내역 ${cnt}건을 삭제할까요?\n(당일입고 위치확인은 유지됩니다. 되돌릴 수 없습니다.)`)) return;
        setLoading(true, '기존재고 내역 삭제 중...');
        try {
            const byShard = {};
            for (let i = 0; i < NUM_LOC_SHARDS; i++) byShard['LOC_SHARD_' + i] = {};
            Object.entries(assign).forEach(([c, v]) => {
                if ((v.sub || '') !== 'existing') byShard[locShardId(c)][c] = { location: v.location || '', base: v.base || '', sub: v.sub || '', worker: v.worker || '', at: v.at || Date.now() };
            });
            for (const sid in byShard) await setDoc(doc(db, CHINA, sid), { map: byShard[sid], updatedAt: new Date() });
            setLoading(false);
            showToast('✅ 기존재고 내역 초기화 완료');
        } catch (e) { setLoading(false); alert('기존재고 내역을 삭제하지 못했습니다 — ' + errText(e)); }
    }

    // ── [새 위치를 맨앞에] — 기존 setNewLocPosition 과 같다 ──
    async function setFront(front) {
        const prev = (ctx.getConfig() || {}).newLocPosition === 'front' ? 'front' : 'back';
        const pos = front ? 'front' : 'back';
        try {
            await setDoc(doc(db, CHINA, 'CONFIG'), { newLocPosition: pos, updatedAt: new Date() }, { merge: true });
            ctx.patchConfig({ newLocPosition: pos });
            showToast(`🆕 받기 시 새 자리가 기존값 ${pos === 'front' ? '맨앞' : '맨뒤'}에 놓입니다`);
        } catch (e) {
            alert('새 위치 앞/뒤 설정을 저장하지 못했습니다 — ' + errText(e) + '.\n이전 설정(' + (prev === 'front' ? '맨앞' : '맨뒤') + ')을 그대로 씁니다.');
        }
        if (locTools) locTools.refresh();
    }

    function attach(tools) {
        locTools = tools;
        const note = document.querySelector('#loc-panel .d-note');
        if (note) note.innerHTML = '위치값 엑셀의 <b>옵션추가항목1</b>은 로케이션관리에 올린 자료에서 가져옵니다(오래된 자료면 받기를 막습니다). '
            + '출고일과 상관없이 비축 입고분과 오늘 지정한 상품이 모두 보입니다.';
        const on = (id, title) => { const b = $(id); if (!b) return null; b.disabled = false; b.title = title; return b; };
        const up = on('btn-loc-off-upload', '이지어드민에서 받은 기존재고 엑셀(상품코드·옵션추가항목1)을 올려 기준 위치를 세팅합니다');
        on('btn-loc-off-reset', '당일·기존재고 위치 지정을 모두 지웁니다');
        on('btn-loc-off-clear', '기존재고 위치 이동 내역만 지웁니다(당일입고 지정은 유지)');
        const chk = $('chk-loc-front');
        if (chk) { chk.disabled = false; const lb = chk.closest('label'); if (lb) lb.title = '받는 위치값 엑셀에서 새로 찍은 자리를 기존값 맨앞에 둡니다'; }
        const file = document.createElement('input');
        file.type = 'file'; file.accept = '.xls,.xlsx,.csv,.html,.htm'; file.style.display = 'none';
        document.body.appendChild(file);
        if (up) up.addEventListener('click', () => file.click());
        file.addEventListener('change', async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) await uploadExisting(f); });
        $('btn-loc-off-reset')?.addEventListener('click', resetAll);
        $('btn-loc-off-clear')?.addEventListener('click', clearExisting);
        chk?.addEventListener('change', (e) => setFront(!!e.target.checked));
    }

    return { locOptions: { loadSource }, attach };
}
