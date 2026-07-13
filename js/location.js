import { initializeFirebase, loadAppConfig } from './config.js';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, writeBatch, getDocs, query, where, documentId, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const { db, auth } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = []; 
let zikjinData = {}; 
let weeklyData = {}; 
let incomingData = {}; 
let incomingTotalByCode = {}; // ★ 상품코드별 입고대기 합계 (오더+사입)
let customTooltips = {}; // ★ v3.53: 사용자 정의 툴팁 { key: html_content, "__deleted__keyName": true }
let sortConfig = { key: 'id', direction: 'asc' };
// ★ v3.57: 모든 필터를 배열로 통일 (다중 선택 지원)
// loc: 구역 prefix, code: ['empty','not-empty'] 중복 불가
// reserved/preassigned: ['only'] 또는 [] (토글)
let filters = { loc: [], code: [], stock: [], stock2f: [], dong: [], pos: [], reserved: [], preassigned: [] };
// 헤더 검색창 입력으로 테이블을 부분일치 필터링 (컬럼키 → 검색어)
let colTextSearch = {};

const RESERVE_EXPIRE_MS = Infinity; 

let currentUserName = "비로그인 작업자";
let appConfig = null;
window.currentUsageTab = '3F';
window.capacity2F = 200000;

window.sheetUrlOrder = ''; 
window.sheetUrlBuy = ''; 

window.visibleColumns = ['std_dong', 'std_pos', 'std_id', 'std_code', 'std_name', 'std_option', 'std_stock'];
window.excelHeaders = []; 

window.isPreAssignMode = false;
window.selectedPreAssignItem = null;

window.currentRecommendations = [];
// v4.1: 단독 추천용 별도 데이터 변수
window.currentSingleRecommendations = [];

window.recommendRatios = { zikjin: 50, weekly: 30, trend: 20 };
window.recommendPriorities = {
    zones: { 0: ['★'], 1: ['A','B','C','D','E','F','G','H','I'], 2: ['Z'], 3: ['L','M','N','O','P','Q','R','S','T'] },
    dongs: ['★', '1', '2', '3', '4', '5', '6'],
    poses: ['★', '2', '3', '4', '1', '5']
};

// [2단계] 입고대기 신규 상품 전용 추천 우선순위 (null이면 openSheetModal에서 recommendPriorities를 fallback으로 사용)
window.incomingRecommendPriorities = null;

const getZoneDocId = (locId) => {
    if (!locId) return 'ZONE_ETC';
    const clean = locId.toString().trim().toUpperCase();
    const prefix = clean.length >= 6 ? clean.substring(0, 6) : clean;
    return 'ZONE_' + prefix;
};

const injectPuzzleStyle = () => {
    if(document.getElementById('puzzle-style')) return;
    const style = document.createElement('style');
    style.id = 'puzzle-style';
    style.innerHTML = `
        .puzzle-container { display: flex; flex-direction: column; gap: 6px; }
        .puzzle-row { display: flex; align-items: stretch; gap: 8px; }
        .puzzle-label { width: 70px; background: #e0e0e0; font-weight: bold; font-size: 12px; color: #333; display: flex; align-items: center; justify-content: center; border-radius: 6px; text-align: center; }
        .puzzle-drop-area { flex: 1; min-height: 42px; border: 2px dashed #bbb; border-radius: 6px; padding: 6px; display: flex; flex-wrap: wrap; gap: 5px; background: #fafafa; transition: 0.2s; }
        .puzzle-drop-area.dragover { background: #eef1ff; border-color: var(--primary); }
        .puzzle-block, .puzzle-sort-block { width: 28px; height: 28px; background: white; border: 2px solid #666; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; cursor: grab; box-shadow: 0 2px 4px rgba(0,0,0,0.1); user-select: none; transition: transform 0.1s; }
        .puzzle-sort-block { width: 34px; border-color: var(--primary); color: var(--primary); }
        .puzzle-block:active, .puzzle-sort-block:active { cursor: grabbing; transform: scale(1.1); }
        .puzzle-block.dragging, .puzzle-sort-block.dragging { opacity: 0.4; border: 2px dashed #999; }
        .sort-container { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; background: #f0f4ff; border-radius: 6px; border: 1px solid #c5cae9; min-height: 46px; align-items: center; }
        .section-toggle { background: #f1f1f1; padding: 10px 15px; border-radius: 6px; font-weight: bold; color: #333; display: flex; justify-content: space-between; cursor: pointer; border: 1px solid #ddd; transition: background 0.2s; }
        .section-toggle:hover { background: #e8e8e8; }
        .section-content { display: none; padding: 15px 5px 5px 5px; animation: slideDown 0.2s ease-out; }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
};

loadAppConfig(db).then(config => {
    appConfig = config;
    if (auth.currentUser) updateCurrentUserName(auth.currentUser);
});

function updateCurrentUserName(user) {
    if (!user) return;
    let email = user.email || "";
    let name = user.displayName || email.split('@')[0];
    if (appConfig && appConfig.memberEmails) {
        for (let key in appConfig.memberEmails) {
            if (appConfig.memberEmails[key] === email) { name = key; break; }
        }
    }
    currentUserName = name;
}

onAuthStateChanged(auth, (user) => {
    if (user) updateCurrentUserName(user);
    else currentUserName = "비로그인 작업자";
});

window.showLoading = function(text) {
    const loadingText = document.getElementById('loading-text');
    if(loadingText) loadingText.innerText = text;
    document.getElementById('loading-overlay').style.display = 'flex';
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
};

window.hideLoading = function() {
    document.getElementById('loading-overlay').style.display = 'none';
};

function setupRealtimeListenerB() {
    onSnapshot(collection(db, 'ZikjinData'), (snapshot) => {
        zikjinData = {};
        snapshot.forEach(docSnap => { 
            let data = docSnap.data();
            if(data.dataStr) {
                try {
                    let chunk = JSON.parse(data.dataStr);
                    chunk.forEach(row => {
                        let code = (row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['품목코드'] || row['바코드'] || row['상품번호']);
                        if(code) zikjinData[code] = row;
                    });
                } catch(e){}
            }
        });
        applyFiltersAndSort();
    }, (error) => console.error("직진배송 오류:", error));

    onSnapshot(collection(db, 'WeeklyData'), (snapshot) => {
        weeklyData = {};
        snapshot.forEach(docSnap => { 
            let data = docSnap.data();
            if(data.dataStr) {
                try {
                    let chunk = JSON.parse(data.dataStr);
                    chunk.forEach(row => {
                        let code = (row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['품목코드'] || row['바코드'] || row['상품번호']);
                        if(code) weeklyData[code] = row;
                    });
                } catch(e){}
            }
        });
        applyFiltersAndSort();
    }, (error) => console.error("주차별데이터 오류:", error));
    
    onSnapshot(collection(db, 'IncomingData'), (snapshot) => {
        incomingData = {};
        incomingTotalByCode = {}; // ★ 합계 초기화
        // ★ v3.53: 오늘 날짜 (YYYY-MM-DD)
        const _today = new Date().toISOString().slice(0, 10);
        snapshot.forEach(docSnap => { 
            let data = docSnap.data();
            if(data.dataStr) {
                try {
                    let chunk = JSON.parse(data.dataStr);
                    chunk.forEach(row => {
                        let code = (row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['품목코드'] || row['바코드'] || row['상품번호']);
                        if(code) {
                            incomingData[code] = row;
                            // ★ v3.53: 도착예정일이 과거이거나 빈칸이면 합계에서 제외
                            const arrivalDate = (row['도착예상일'] || row['표시날짜'] || '').toString().trim();
                            if (!arrivalDate || arrivalDate < _today) return;
                            const qty = Number(row['입고대기수량'] || 0);
                            incomingTotalByCode[code] = (incomingTotalByCode[code] || 0) + qty;
                        }
                    });
                } catch(e){}
            }
        });
        if(document.getElementById('incoming-sidebar').classList.contains('open')) window.renderIncomingQueue();
        applyFiltersAndSort();
    }, (error) => console.error("입고예정데이터 오류:", error));
}

// 🕒 마지막 데이터 최신화 시각 표시 (상단 헤더)
function updateLastUpdateDisplay(ts) {
    const el = document.getElementById('last-data-update');
    if (!el) return;
    if (!ts) { el.textContent = '🕒 최신화: 기록 없음'; return; }
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    el.textContent = `🕒 최신화: ${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    el.title = '마지막 데이터 최신화: ' + d.toLocaleString('ko-KR');
}

function setupRealtimeListenerA() {
    onSnapshot(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), (docSnap) => {
        if(docSnap.exists()) {
            const conf = docSnap.data();
            updateLastUpdateDisplay(conf.lastDataUpdate);
            if (Array.isArray(conf.dupLocations)) window.__dupLocations = conf.dupLocations;
            if (conf.capacity2F) window.capacity2F = conf.capacity2F;
            if (conf.sheetUrlOrder) window.sheetUrlOrder = conf.sheetUrlOrder;
            if (conf.sheetUrlBuy) window.sheetUrlBuy = conf.sheetUrlBuy;
            if (conf.sheetUrl && !conf.sheetUrlOrder) window.sheetUrlOrder = conf.sheetUrl;
            if (conf.visibleColumns) window.visibleColumns = conf.visibleColumns;
            if (conf.excelHeaders) window.excelHeaders = conf.excelHeaders.filter(h => h && !h.includes('<') && !h.includes('>') && !h.includes('='));
            
            if (conf.recommendRatios) {
                let r = conf.recommendRatios;
                if ((r.zikjin + r.weekly + r.trend) === 100) window.recommendRatios = r;
            }
            if (conf.recommendPriorities) {
                window.recommendPriorities = conf.recommendPriorities;
                // v4.1: 기존 설정에 ★이 없으면 자동으로 1순위에 추가 (호환성 보강)
                if (Array.isArray(window.recommendPriorities.dongs) && !window.recommendPriorities.dongs.includes('★')) {
                    window.recommendPriorities.dongs = ['★', ...window.recommendPriorities.dongs];
                }
                if (Array.isArray(window.recommendPriorities.poses) && !window.recommendPriorities.poses.includes('★')) {
                    window.recommendPriorities.poses = ['★', ...window.recommendPriorities.poses];
                }
            }
            // [2단계] 입고대기 신규 상품용 우선순위 로드
            if (conf.incomingRecommendPriorities) {
                window.incomingRecommendPriorities = conf.incomingRecommendPriorities;
                if (Array.isArray(window.incomingRecommendPriorities.dongs) && !window.incomingRecommendPriorities.dongs.includes('★')) {
                    window.incomingRecommendPriorities.dongs = ['★', ...window.incomingRecommendPriorities.dongs];
                }
                if (Array.isArray(window.incomingRecommendPriorities.poses) && !window.incomingRecommendPriorities.poses.includes('★')) {
                    window.incomingRecommendPriorities.poses = ['★', ...window.incomingRecommendPriorities.poses];
                }
            }
            // ★ v3.53: 사용자 정의 툴팁 로드
            if (conf.customTooltips) {
                customTooltips = conf.customTooltips;
            }
            
            renderTableHeader(); 
            applyFiltersAndSort();
            // ★ v3.53: 툴팁 재적용 (페이지 로드/설정 변경 시)
            if (typeof window.applyCustomTooltips === 'function') window.applyCustomTooltips();
        }
    });

    const qZones = query(collection(db, LOC_COLLECTION), where(documentId(), ">=", "ZONE_"), where(documentId(), "<=", "ZONE_\uf8ff"));
    onSnapshot(qZones, (snapshot) => {
        document.getElementById('firebase-guide').style.display = 'none';
        
        let tempLocMap = {}; 
        
        snapshot.forEach(docSnap => {
            const zoneData = docSnap.data();
            for (let locId in zoneData) {
                if (typeof zoneData[locId] === 'object' && zoneData[locId] !== null) {
                    let locObj = { id: locId, ...zoneData[locId] };
                    
                    if (locObj.rawDataStr) {
                        try { locObj.rawData = JSON.parse(locObj.rawDataStr); } catch(e) { locObj.rawData = {}; }
                    } else if (!locObj.rawData) {
                        locObj.rawData = {};
                    }
                    
                    tempLocMap[locId] = locObj; 
                }
            }
        });
        
        originalData = Object.values(tempLocMap);
        
        // ★ codeTag 자정 초기화 체크
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        originalData.forEach(loc => {
            if (loc.codeTag && loc.codeTagAt && loc.codeTagAt < todayStart) {
                loc.codeTag = '';
                loc.codeTagAt = 0;
                // DB에서도 초기화 (비동기, 화면 렌더링 차단 안 함)
                const zoneDocId = getZoneDocId(loc.id);
                setDoc(doc(db, LOC_COLLECTION, zoneDocId), { [loc.id]: { codeTag: '', codeTagAt: 0 } }, { merge: true }).catch(() => {});
            }
        });
        
        renderTableHeader(); 
        applyFiltersAndSort(); 
        if(document.getElementById('incoming-sidebar').classList.contains('open')) window.renderIncomingQueue();
        
        // 도면 탭이 열려있으면 자동 재렌더링
        if (document.getElementById('view-map') && document.getElementById('view-map').style.display !== 'none') {
            window.renderMap();
        }
        
        const pop = document.getElementById('usage-popup');
        if (pop && pop.style.display === 'block') window.calculateAndRenderUsage();
    }, (error) => { console.error("A창고 오류:", error); });
}

window.onload = () => {
    injectPuzzleStyle();
    setupRealtimeListenerA();
    setupRealtimeListenerB();
    // v4.0a-fix4: 페이지 로드 시 페어 캐시 자동 로드 (페어 쌍 추천에 필수)
    if (typeof window.loadOrderPairsCache === 'function') {
        window.loadOrderPairsCache();
    }
    // v4.4 종합 대시보드 UI는 제거됐으나, 대시보드의 '재고 회전율' 지표를 위해
    // 재고 스냅샷 파이프라인(load/snapshot)은 유지한다.
    if (typeof window._v44_init === 'function') {
        setTimeout(() => { window._v44_init(); }, 1500);
    }
};

window.handleDragStart = (e) => {
    e.target.classList.add('dragging');
    e.dataTransfer.setData('text/plain', e.target.innerText);
    e.dataTransfer.effectAllowed = "move";
};
window.handleDragEnd = (e) => { e.target.classList.remove('dragging'); };
window.handleDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
    e.dataTransfer.dropEffect = "move";
};
window.handleDragLeave = (e) => { e.currentTarget.classList.remove('dragover'); };
window.handleDrop = (e, targetArea) => {
    e.preventDefault();
    targetArea.classList.remove('dragover');
    const draggedText = e.dataTransfer.getData('text/plain');
    const draggedEl = Array.from(document.querySelectorAll('.puzzle-block')).find(el => el.innerText === draggedText && el.classList.contains('dragging'));
    if(draggedEl) targetArea.appendChild(draggedEl);
};

window.handleSortDragOver = (e) => {
    e.preventDefault();
    const container = e.currentTarget;
    const dragging = document.querySelector('.puzzle-sort-block.dragging');
    if(!dragging) return;
    const afterElement = getDragAfterElement(container, e.clientX);
    if (afterElement == null) {
        container.appendChild(dragging);
    } else {
        container.insertBefore(dragging, afterElement);
    }
};
window.getDragAfterElement = (container, x) => {
    const draggableElements = [...container.querySelectorAll('.puzzle-sort-block:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
};

window.toggleSection = function(id, iconId) {
    const el = document.getElementById(id);
    const icon = document.getElementById(iconId);
    if(el.style.display === 'block') {
        el.style.display = 'none';
        icon.innerText = '▼';
    } else {
        el.style.display = 'block';
        icon.innerText = '▲';
    }
};

window.toggleUsageDetails = function() {
    const content = document.getElementById('usage-details-content');
    const btn = document.getElementById('usage-details-btn');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        btn.innerText = '간략히보기 ▲';
    } else {
        content.style.display = 'none';
        btn.innerText = '자세히보기 ▼';
    }
};

function updateExcludePreview() {
    const input = document.getElementById('exclude-combos-input');
    const preview = document.getElementById('exclude-combos-preview');
    if (!input || !preview) return;
    const combos = input.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (combos.length === 0) { preview.innerHTML = '<span style="font-size:11px; color:#999;">제외 항목 없음</span>'; return; }
    preview.innerHTML = combos.map(c => `<span style="display:inline-block; background:#ff5252; color:white; padding:3px 8px; border-radius:4px; font-size:12px; font-weight:bold;">❌ ${c}</span>`).join('');
}

window.openRatioModal = function(e) {
    if(e) e.stopPropagation();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    
    let modal = document.getElementById('ratio-settings-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'ratio-settings-modal';
        modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:none; align-items:center; justify-content:center; z-index:10000;";
        modal.innerHTML = `
            <div style="background:white; padding:25px; border-radius:12px; width:520px; max-height:90vh; overflow-y:auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid var(--primary); padding-bottom:10px; margin-bottom:15px;">
                    <h2 style="margin:0; color:var(--primary); font-size:20px;">⚙️ 추천 알고리즘 설정</h2>
                    <button onclick="document.getElementById('ratio-settings-modal').style.display='none'" style="background:none; border:none; font-size:24px; cursor:pointer;">×</button>
                </div>

                <div style="background:#fcfcfc; border:1px solid #ddd; border-radius:8px; padding:15px; margin-bottom:15px;">
                    <h4 style="margin:0 0 10px 0; color:#333;">📊 점수 반영 비율 (총합 100%)</h4>
                    <div style="display:flex; justify-content:space-around; align-items:center; gap:5px;">
                        <label style="display:flex; flex-direction:column; align-items:center; font-size:12px; font-weight:bold;">
                            직진배송
                            <div style="margin-top:5px; display:flex; align-items:center;">
                                <input type="number" id="mod-ratio-zikjin" style="width:50px; text-align:right; padding:6px; border:1px solid #ccc; border-radius:4px; font-weight:bold;">
                                <span style="margin-left:4px; color:#555;">%</span>
                            </div>
                        </label>
                        <span style="font-size:20px; color:#aaa; margin-top:15px;">+</span>
                        <label style="display:flex; flex-direction:column; align-items:center; font-size:12px; font-weight:bold;">
                            주차별
                            <div style="margin-top:5px; display:flex; align-items:center;">
                                <input type="number" id="mod-ratio-weekly" style="width:50px; text-align:right; padding:6px; border:1px solid #ccc; border-radius:4px; font-weight:bold;">
                                <span style="margin-left:4px; color:#555;">%</span>
                            </div>
                        </label>
                        <span style="font-size:20px; color:#aaa; margin-top:15px;">+</span>
                        <label style="display:flex; flex-direction:column; align-items:center; font-size:12px; font-weight:bold;">
                            상승세
                            <div style="margin-top:5px; display:flex; align-items:center;">
                                <input type="number" id="mod-ratio-trend" style="width:50px; text-align:right; padding:6px; border:1px solid #ccc; border-radius:4px; font-weight:bold;">
                                <span style="margin-left:4px; color:#555;">%</span>
                            </div>
                        </label>
                    </div>
                </div>

                <div style="margin-bottom:10px;">
                    <div class="section-toggle" onclick="toggleSection('sec-zone', 'icon-zone')">
                        <span>🧩 구역(알파벳) 우선순위 배치</span>
                        <span id="icon-zone">▼</span>
                    </div>
                    <div id="sec-zone" class="section-content">
                        <p style="margin:0 0 10px 0; font-size:11px; color:#666;">※ 마우스로 알파벳 조각을 끌어서 원하는 순위 칸에 놓으세요.</p>
                        <div class="puzzle-container">
                            <div class="puzzle-row"><div class="puzzle-label" style="background:#ffd54f;">0순위</div><div class="puzzle-drop-area" id="pz-0" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div></div>
                            <div class="puzzle-row"><div class="puzzle-label" style="background:#81c784;">1순위</div><div class="puzzle-drop-area" id="pz-1" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div></div>
                            <div class="puzzle-row"><div class="puzzle-label" style="background:#64b5f6;">2순위</div><div class="puzzle-drop-area" id="pz-2" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div></div>
                            <div class="puzzle-row"><div class="puzzle-label" style="background:#ba68c8; color:white;">3순위</div><div class="puzzle-drop-area" id="pz-3" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div></div>
                            <div class="puzzle-row" style="margin-top:5px;"><div class="puzzle-label" style="background:#eee; border:1px solid #ccc;">미지정<br>(후순위)</div><div class="puzzle-drop-area" id="pz-none" style="background:#f0f0f0; border-color:#ccc;" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, this)"></div></div>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom:20px;">
                    <div class="section-toggle" onclick="toggleSection('sec-dongpos', 'icon-dongpos')">
                        <span>🏢 동 / 위치 우선순위 줄세우기</span>
                        <span id="icon-dongpos">▼</span>
                    </div>
                    <div id="sec-dongpos" class="section-content">
                        <p style="margin:0 0 10px 0; font-size:11px; color:#666;">※ 마우스로 블록을 잡고 좌우로 끌어서 순서를 맞춰주세요. (왼쪽이 1순위)</p>
                        
                        <div style="font-size:13px; font-weight:bold; margin-bottom:5px; color:var(--primary);">▶ 동 우선순위</div>
                        <div class="sort-container" id="sort-dongs" ondragover="handleSortDragOver(event)"></div>

                        <div style="font-size:13px; font-weight:bold; margin-top:15px; margin-bottom:5px; color:var(--primary);">▶ 위치 우선순위</div>
                        <div class="sort-container" id="sort-poses" ondragover="handleSortDragOver(event)"></div>
                    </div>
                </div>

                <div style="margin-bottom:20px;">
                    <div class="section-toggle" onclick="toggleSection('sec-exclude', 'icon-exclude')">
                        <span>❌ 추천 제외 구역 설정</span>
                        <span id="icon-exclude">▼</span>
                    </div>
                    <div id="sec-exclude" class="section-content">
                        <p style="margin:0 0 10px 0; font-size:11px; color:#666;">※ 구역+동 조합을 입력하면 해당 조합의 로케이션이 추천에서 제외됩니다.<br>예시: Z-1, A-3, ★-2 (쉼표로 구분)</p>
                        <input type="text" id="exclude-combos-input" placeholder="예: Z-1, A-3, ★-2" style="width:100%; padding:10px; border:2px solid #ef9a9a; border-radius:6px; font-size:14px; background:#ffebee; box-sizing:border-box;">
                        <div id="exclude-combos-preview" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:5px;"></div>
                    </div>
                </div>
                
                <div style="display:flex; justify-content:center;">
                    <button onclick="saveMasterSettingsModal()" style="width:100%; padding:12px; font-size:16px; border:none; background:var(--primary); color:white; border-radius:6px; cursor:pointer; font-weight:bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">💾 변경사항 저장 및 즉시 재계산</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // ★ 제외 조합 입력 시 프리뷰 업데이트
        document.getElementById('exclude-combos-input').addEventListener('input', updateExcludePreview);
    }
    
    document.getElementById('mod-ratio-zikjin').value = window.recommendRatios.zikjin;
    document.getElementById('mod-ratio-weekly').value = window.recommendRatios.weekly;
    document.getElementById('mod-ratio-trend').value = window.recommendRatios.trend;
    
    const allAlphabets = ['★', 'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
    const priZones = window.recommendPriorities.zones || {0:[], 1:[], 2:[], 3:[]};
    for(let i=0; i<=3; i++) document.getElementById(`pz-${i}`).innerHTML = '';
    document.getElementById('pz-none').innerHTML = '';

    allAlphabets.forEach(alpha => {
        let placedRank = -1;
        for(let i=0; i<=3; i++) { if(priZones[i] && priZones[i].includes(alpha)) { placedRank = i; break; } }
        
        const block = document.createElement('div');
        block.className = 'puzzle-block';
        block.innerText = alpha;
        block.draggable = true;
        block.ondragstart = window.handleDragStart;
        block.ondragend = window.handleDragEnd;

        if(placedRank !== -1) document.getElementById(`pz-${placedRank}`).appendChild(block);
        else document.getElementById('pz-none').appendChild(block);
    });

    const renderSortBlocks = (containerId, items, defaultItems) => {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        let finalItems = [...new Set([...items, ...defaultItems])]; 
        finalItems.forEach(item => {
            const block = document.createElement('div');
            block.className = 'puzzle-sort-block';
            block.innerText = item;
            block.draggable = true;
            block.ondragstart = window.handleDragStart;
            block.ondragend = window.handleDragEnd;
            container.appendChild(block);
        });
    };

    renderSortBlocks('sort-dongs', window.recommendPriorities.dongs || [], ['★','1','2','3','4','5','6']);
    renderSortBlocks('sort-poses', window.recommendPriorities.poses || [], ['★','1','2','3','4','5']);

    // ★ 제외 조합 입력창 로드
    const excludeCombos = window.recommendPriorities.excludeCombos || [];
    document.getElementById('exclude-combos-input').value = excludeCombos.join(', ');
    updateExcludePreview();
    
    modal.style.display = 'flex';
};

window.saveMasterSettingsModal = async function() {
    const z = Number(document.getElementById('mod-ratio-zikjin').value) || 0;
    const w = Number(document.getElementById('mod-ratio-weekly').value) || 0;
    const t = Number(document.getElementById('mod-ratio-trend').value) || 0;
    if (z + w + t !== 100) return alert(`🚨 점수 반영 비율의 합계가 100%가 되어야 합니다.\n(현재 합계: ${z + w + t}%)`);
    
    let newZones = {};
    for(let i=0; i<=3; i++){
        const blocks = document.getElementById(`pz-${i}`).querySelectorAll('.puzzle-block');
        newZones[i] = Array.from(blocks).map(b => b.innerText.trim());
    }

    const newDongs = Array.from(document.getElementById('sort-dongs').querySelectorAll('.puzzle-sort-block')).map(b => b.innerText.trim());
    const newPoses = Array.from(document.getElementById('sort-poses').querySelectorAll('.puzzle-sort-block')).map(b => b.innerText.trim());

    // ★ 제외 조합 수집
    const excludeCombos = document.getElementById('exclude-combos-input').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    const newPriorities = { zones: newZones, dongs: newDongs, poses: newPoses, excludeCombos };

    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { 
            recommendRatios: { zikjin: z, weekly: w, trend: t },
            recommendPriorities: newPriorities
        }, { merge: true });
        
        window.recommendRatios = { zikjin: z, weekly: w, trend: t };
        window.recommendPriorities = newPriorities;
        
        document.getElementById('ratio-settings-modal').style.display = 'none';
        showToast("✅ 마스터 설정이 저장되었습니다.");
        
        const recModal = document.getElementById('recommend-modal');
        if (recModal && recModal.style.display === 'flex') window.showPairRecommendation();
    } catch(e) { console.error(e); alert("설정 저장 중 오류가 발생했습니다."); }
};

// ★ 메인 테이블 엑셀 다운로드 (HTML 테이블 .xls 형식)
window.downloadMainExcel = function() {
    // 1. 체크된 항목 확인 (가상 스크롤 전역 상태 사용)
    const checkedIds = VS.checkedIds;
    
    let targetData;
    let fileLabel;
    
    if (checkedIds.size > 0) {
        targetData = originalData.filter(d => checkedIds.has(d.id));
        fileLabel = `로케이션_선택${targetData.length}건`;
    } else if (window.lastFilteredData && window.lastFilteredData.length !== originalData.length) {
        targetData = window.lastFilteredData;
        fileLabel = `로케이션_필터${targetData.length}건`;
    } else {
        targetData = originalData;
        fileLabel = `로케이션_전체${targetData.length}건`;
    }
    
    if (!targetData || targetData.length === 0) {
        alert('다운로드할 데이터가 없습니다.');
        return;
    }
    
    // 헤더 구성
    const stdHeaders = ['로케이션', '동', '위치', '상품코드', '상품명', '옵션', '정상재고', '2층창고재고'];
    const cusHeaders = (window.excelHeaders || []).filter(h => h && !h.includes('<') && !h.includes('>') && !h.includes('='));
    const allHeaders = [...stdHeaders, ...cusHeaders];
    
    // HTML 테이블 생성
    let headerRow = allHeaders.map(h => `<td class=header>${h}</td>`).join('');
    
    let dataRows = '';
    targetData.forEach(loc => {
        const code = (loc.code === loc.id ? '' : loc.code) || '';
        const stock = loc.stock || '0';
        const stock2f = loc.stock2f || '0';
        
        // ★ 로케이션 컬럼 복원: ★★-01(4)/ S561045 형식
        const angleSize = (loc.angleSize || '').toString().trim();
        let locDisplay = loc.id;
        if (angleSize) {
            locDisplay = code 
                ? `${loc.id}(${angleSize})/ ${code}` 
                : `${loc.id}(${angleSize})`;
        }
        
        let row = '';
        row += `<td class='style1'>${locDisplay}</td>`;
        row += `<td class='style2'>${loc.dong || ''}</td>`;
        row += `<td class='style2'>${loc.pos || ''}</td>`;
        row += `<td class='style1'>${code}</td>`;
        row += `<td class='style1'>${loc.name || ''}</td>`;
        row += `<td class='style1'>${loc.option || ''}</td>`;
        row += `<td class='style3'>${stock}</td>`;
        row += `<td class='style3'>${stock2f}</td>`;
        
        cusHeaders.forEach(h => {
            const val = (loc.rawData && loc.rawData[h]) ? loc.rawData[h] : '';
            const isNum = !isNaN(val) && val !== '';
            row += `<td class='${isNum ? 'style3' : 'style2'}'>${val}</td>`;
        });
        
        dataRows += `<tr>${row}</tr>\n`;
    });
    
    const htmlContent = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<meta http-equiv='Content-Type' content='text/html; charset=utf-8'>
<head>
<style>
    br {mso-data-placement:same-cell;}
    .header {font:bold 10pt "굴림"; white-space:nowrap; background:#CCFFCC;}
    .style1 {font:9pt "굴림"; white-space:nowrap; mso-number-format:\\@;}
    .style2 {font:9pt "굴림"; white-space:nowrap;}
    .style3 {font:9pt "굴림"; white-space:nowrap; mso-number-format:"0_ ";}
</style>
<!--[if gte mso 9]>
<xml>
<x:ExcelWorkbook>
<x:ExcelWorksheets>
<x:ExcelWorksheet>
<x:Name>로케이션</x:Name>
<x:WorksheetOptions><x:Selected/></x:WorksheetOptions>
</x:ExcelWorksheet>
</x:ExcelWorksheets>
</x:ExcelWorkbook>
</xml>
<![endif]-->
</head>
<body>
<table border="1" cellspacing="0" cellpadding="2">
<tr>${headerRow}</tr>
${dataRows}
</table>
</body>
</html>`;
    
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date();
    const dateString = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    a.download = `${fileLabel}_${dateString}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

window.openRecommendModal = function() {
    document.getElementById('recommend-modal').style.display = 'flex';
    if (typeof window._initRecLimitUI === 'function') window._initRecLimitUI(); // v3.97e
};


window.showRecommendation = function() {
    window.showLoading("💡 우선순위 알고리즘을 분석하여 최적의 로케이션을 매칭 중입니다...");

    setTimeout(() => {
        window.currentRecommendations = [];
        
        // ★ 로케이션에 실제 존재하는 상품코드만 대상
        // ★ v3.53: 입고대기 남은 상품 제외 (곧 입고되므로 자리 이동 보류)
        const allCodes = new Set(
            originalData
                .filter(d => d.code && d.code.trim() !== '' && d.code !== d.id)
                .filter(d => !(incomingTotalByCode[d.code.trim()] > 0))
                .map(d => d.code.trim())
        );
        let maxZQty = 0; let maxWQty = 0; let maxTrend = 0;
        let itemDataList = [];

        allCodes.forEach(code => {
            let zItem = zikjinData[code] || {}; let wItem = weeklyData[code] || {};
            let locItem = originalData.find(d => d.code === code);
            let name = (locItem && locItem.name) || zItem['상품명'] || wItem['상품명'] || '알 수 없음';
            let zQty = Number(zItem['수량'] || 0); 
            let wQty = Number(wItem['기간배송수량'] || wItem['기간발주수량'] || 0); 
            let trendVal = 0;
            let dates = Object.keys(wItem).filter(k => /^20\d{6}$/.test(k)).sort();
            if (dates.length >= 6) {
                let recent3 = dates.slice(-3).reduce((sum, d) => sum + Number(wItem[d] || 0), 0);
                let prev3 = dates.slice(-6, -3).reduce((sum, d) => sum + Number(wItem[d] || 0), 0);
                trendVal = Math.max(0, recent3 - prev3); 
            }
            if (zQty > maxZQty) maxZQty = zQty;
            if (wQty > maxWQty) maxWQty = wQty;
            if (trendVal > maxTrend) maxTrend = trendVal;
            itemDataList.push({ code, name, zQty, wQty, trendVal });
        });

        let scoredItems = [];
        itemDataList.forEach(item => {
            let zScore = maxZQty > 0 ? (item.zQty / maxZQty) * 100 : 0;
            let wScore = maxWQty > 0 ? (item.wQty / maxWQty) * 100 : 0;
            let tScore = maxTrend > 0 ? (item.trendVal / maxTrend) * 100 : 0;
            let finalScore = (zScore * (window.recommendRatios.zikjin / 100)) + (wScore * (window.recommendRatios.weekly / 100)) + (tScore * (window.recommendRatios.trend / 100));

            if (finalScore > 0) {
                let currentLocs = originalData.filter(d => d.code === item.code).map(d => d.id).join(', ');
                if (!currentLocs) currentLocs = '신규배치 (없음)';
                // ★ 점수 내역 세부 저장 (툴팁용)
                const zContrib = zScore * (window.recommendRatios.zikjin / 100);
                const wContrib = wScore * (window.recommendRatios.weekly / 100);
                const tContrib = tScore * (window.recommendRatios.trend / 100);
                scoredItems.push({ 
                    code: item.code, name: item.name, score: finalScore, currentLocs,
                    zQty: item.zQty, wQty: item.wQty, trendVal: item.trendVal,
                    zContrib, wContrib, tContrib
                });
            }
        });
        scoredItems.sort((a, b) => b.score - a.score);

        let emptyLocs = originalData.filter(d => {
            const hasContent = (d.code && d.code !== d.id && d.code.trim() !== "") || (d.name && d.name.trim() !== "");
            if (hasContent || d.preAssigned) return false;
            // ★ 구역+동 조합 제외
            const excludeCombos = window.recommendPriorities.excludeCombos || [];
            if (excludeCombos.length > 0) {
                const prefix = (d.id || '').charAt(0).toUpperCase();
                const dong = (d.dong || '').toString().trim();
                const combo = `${prefix}-${dong}`;
                if (excludeCombos.includes(combo)) return false;
            }
            return true;
        });

        const getZoneRank = (locId) => {
            const prefix = (locId || '').charAt(0).toUpperCase();
            const zones = window.recommendPriorities.zones || {};
            for(let i=0; i<=3; i++) {
                if(zones[i] && zones[i].includes(prefix)) return i;
            }
            return 99; 
        };
        const getDongRank = (dong) => {
            const str = (dong || '').toString().trim();
            const idx = window.recommendPriorities.dongs.indexOf(str);
            return idx !== -1 ? idx : 99;
        };
        const getPosRank = (pos) => {
            const str = (pos || '').toString().trim();
            const idx = window.recommendPriorities.poses.indexOf(str);
            return idx !== -1 ? idx : 99;
        };

        emptyLocs.sort((a, b) => {
            let zRankA = getZoneRank(a.id); let zRankB = getZoneRank(b.id);
            if (zRankA !== zRankB) return zRankA - zRankB;
            let dRankA = getDongRank(a.dong); let dRankB = getDongRank(b.dong);
            if (dRankA !== dRankB) return dRankA - dRankB;
            let pRankA = getPosRank(a.pos); let pRankB = getPosRank(b.pos);
            if (pRankA !== pRankB) return pRankA - pRankB;
            return a.id.localeCompare(b.id); 
        });

        // ===== v3.98: 페어 동선 보정 데이터 준비 =====
        const pairMap = {};      
        const codeToLocs = {};   
        let pairDataReady = false;
        let pairWeightMax = 0;   
        
        const includePairOfPair = document.getElementById('rec-include-pair-of-pair')?.checked || false;
        
        try {
            if (window._cachedOrderPairs && window._cachedOrderStats && window._cachedOrderMeta) {
                const pairs = window._cachedOrderPairs;
                const stats = window._cachedOrderStats;
                const meta = window._cachedOrderMeta;
                const N = meta.totalProcessedOrders || 1;
                
                pairs.forEach(p => {
                    const cA = (stats[p.codeA] || {}).count || 0;
                    const cB = (stats[p.codeB] || {}).count || 0;
                    if (cA === 0 || cB === 0) return;
                    const lift = (p.count * N) / (cA * cB);
                    if (p.count < 5 || lift < 2.0) return;
                    const weight = lift * p.count;
                    if (weight > pairWeightMax) pairWeightMax = weight;
                    if (!pairMap[p.codeA]) pairMap[p.codeA] = [];
                    if (!pairMap[p.codeB]) pairMap[p.codeB] = [];
                    pairMap[p.codeA].push({ partner: p.codeB, weight });
                    pairMap[p.codeB].push({ partner: p.codeA, weight });
                });
                
                for (const code in pairMap) {
                    pairMap[code].sort((a, b) => b.weight - a.weight);
                    pairMap[code] = pairMap[code].slice(0, 5);
                }
                
                originalData.forEach(d => {
                    if (d.code && d.code !== d.id && d.code.trim() !== '') {
                        if (!codeToLocs[d.code]) codeToLocs[d.code] = [];
                        codeToLocs[d.code].push(d.id);
                    }
                });
                pairDataReady = true;
            }
        } catch (e) {
            console.warn('[v3.98] 페어 데이터 캐시 사용 실패, 페어 보정 비활성화:', e);
        }
        
        const calcPairScore = (code, eLoc) => {
            if (!pairDataReady) return 0;
            const directPairs = pairMap[code] || [];
            if (directPairs.length === 0) return 0;
            
            let targetPairs = directPairs.slice();
            if (includePairOfPair) {
                const seen = new Set([code, ...directPairs.map(p => p.partner)]);
                for (const dp of directPairs) {
                    const subPairs = pairMap[dp.partner] || [];
                    for (const sp of subPairs) {
                        if (seen.has(sp.partner)) continue;
                        seen.add(sp.partner);
                        targetPairs.push({ partner: sp.partner, weight: sp.weight * 0.5 });
                    }
                }
            }
            
            const eZone = (eLoc.id || '').charAt(0).toUpperCase();
            const eDong = (eLoc.dong || '').toString().trim();
            const ePos = (eLoc.pos || '').toString().trim();
            
            let totalScore = 0;
            for (const tp of targetPairs) {
                const partnerLocs = codeToLocs[tp.partner] || [];
                if (partnerLocs.length === 0) continue;
                
                let bestCoeff = 0;
                for (const pLocId of partnerLocs) {
                    const pLoc = originalData.find(d => d.id === pLocId);
                    if (!pLoc) continue;
                    const pZone = (pLoc.id || '').charAt(0).toUpperCase();
                    const pDong = (pLoc.dong || '').toString().trim();
                    const pPos = (pLoc.pos || '').toString().trim();
                    
                    let coeff = 0;
                    if (eZone === pZone && eDong === pDong) {
                        const ePosNum = parseInt(ePos, 10);
                        const pPosNum = parseInt(pPos, 10);
                        if (!isNaN(ePosNum) && !isNaN(pPosNum)) {
                            const diff = Math.abs(ePosNum - pPosNum);
                            if (diff === 0) coeff = 1.0;
                            else if (diff === 1) coeff = 0.9;
                            else if (diff === 2) coeff = 0.8;
                            else coeff = 0.7;
                        } else {
                            coeff = 0.7;
                        }
                    }
                    if (coeff > bestCoeff) bestCoeff = coeff;
                }
                totalScore += tp.weight * bestCoeff;
            }
            return totalScore;
        };

        const tbody = document.getElementById('recommend-tbody');
        let html = ''; 
        let matchCount = 0;
        let usedEmptyIndices = new Set();
        let displayRank = 1;

        // v3.97e: 사용자 지정 추천 갯수 가져오기
        const limitVal = (typeof window._getRecommendLimit === 'function') ? window._getRecommendLimit() : 10;

        for (let i = 0; i < scoredItems.length; i++) {
            // v3.97e: 사용자 지정 갯수 도달 시 종료
            if (limitVal > 0 && matchCount >= limitVal) break;
            
            let item = scoredItems[i];
            
            let currentLocsObjs = originalData.filter(d => d.code === item.code);
            let currentDongsList = currentLocsObjs.map(d => (d.dong || '').toString().trim());

            let candidateIndices = [];
            for (let j = 0; j < emptyLocs.length; j++) {
                if (usedEmptyIndices.has(j)) continue;
                const eLoc = emptyLocs[j];
                const targetDong = (eLoc.dong || '').toString().trim();
                if (currentDongsList.includes(targetDong)) continue;
                
                const pairScore = calcPairScore(item.code, eLoc);
                candidateIndices.push({ j, pairScore, originalIdx: j });
            }
            
            candidateIndices.sort((a, b) => {
                if (b.pairScore !== a.pairScore) return b.pairScore - a.pairScore;
                return a.originalIdx - b.originalIdx;
            });
            
            let matched = false;
            for (const cand of candidateIndices) {
                const j = cand.j;
                if (usedEmptyIndices.has(j)) continue;
                
                let eLoc = emptyLocs[j];
                let targetDong = (eLoc.dong || '').toString().trim();

                if (currentDongsList.includes(targetDong)) {
                    continue; 
                }

                usedEmptyIndices.add(j);
                matched = true;
                const matchedPairScore = cand.pairScore;
                // ===== v3.98 페어 보정 끝, 기존 매칭 로직 진입 =====
                
                let totalStock = 0;
                let totalStock2f = 0;
                let itemOption = '';
                
                currentLocsObjs.forEach(d => {
                    totalStock += Number(d.stock || 0);
                    totalStock2f += Number(d.stock2f || 0);
                    if (d.option && !itemOption) itemOption = d.option; 
                });
                
                if (!itemOption || itemOption.trim() === '') {
                    let fallbackOption = '';
                    if (zikjinData[item.code] && zikjinData[item.code]['옵션']) fallbackOption = zikjinData[item.code]['옵션'];
                    else if (weeklyData[item.code] && weeklyData[item.code]['옵션']) fallbackOption = weeklyData[item.code]['옵션'];
                    else if (incomingData[item.code] && incomingData[item.code]['옵션']) fallbackOption = incomingData[item.code]['옵션'];
                    
                    itemOption = fallbackOption;
                }

                let moveQty = totalStock - totalStock2f;
                
                // ✨ [방향 지시등 로직] 우선순위 점수 비교 계산
                let bestCurrentScore = 999999;
                if (currentLocsObjs.length > 0) {
                    currentLocsObjs.forEach(loc => {
                        let z = getZoneRank(loc.id);
                        let d = getDongRank(loc.dong);
                        let p = getPosRank(loc.pos);
                        let score = (z * 10000) + (d * 100) + p;
                        if (score < bestCurrentScore) bestCurrentScore = score;
                    });
                }

                let targetZ = getZoneRank(eLoc.id);
                let targetD = getDongRank(eLoc.dong);
                let targetP = getPosRank(eLoc.pos);
                let targetScore = (targetZ * 10000) + (targetD * 100) + targetP;

                let moveBadge = '';
                let moveText = '';
                if (currentLocsObjs.length === 0) {
                    moveBadge = `<span style="display:inline-block; background:#e3f2fd; color:#1565c0; padding:4px 9px; border-radius:5px; font-size:12px; font-weight:bold; margin-top:5px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">✨ 신규</span>`;
                    moveText = '✨신규';
                } else if (targetScore < bestCurrentScore) {
                    moveBadge = `<span style="display:inline-block; background:#ffebee; color:#b71c1c; padding:4px 9px; border-radius:5px; font-size:12px; font-weight:bold; margin-top:5px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">🔺 전진</span>`;
                    moveText = '🔺전진';
                } else if (targetScore > bestCurrentScore) {
                    moveBadge = `<span style="display:inline-block; background:#eceff1; color:#37474f; padding:4px 9px; border-radius:5px; font-size:12px; font-weight:bold; margin-top:5px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">🔻 후퇴</span>`;
                    moveText = '🔻후퇴';
                } else {
                    moveBadge = `<span style="display:inline-block; background:#f5f5f5; color:#616161; padding:4px 9px; border-radius:5px; font-size:12px; font-weight:bold; margin-top:5px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">➖ 수평</span>`;
                    moveText = '➖수평';
                }
                
                window.currentRecommendations.push({
                    moveQty: moveQty,
                    currentLocs: item.currentLocs,
                    targetLoc: eLoc.id,
                    name: item.name,
                    option: itemOption,
                    code: item.code,
                    moveDirection: moveText, // 엑셀용
                    pairScore: matchedPairScore || 0 // v3.98: 페어 점수
                });

                const isEven = displayRank % 2 === 0;
                const rowBg = isEven ? '#f9fafb' : '#ffffff';
                const moveQtyDisplay = moveQty > 0 ? `<span style="color:#e65100; font-weight:900; font-size:15px;">${moveQty.toLocaleString()}</span><br><span style="font-size:10px; color:#888;">개</span>` : `<span style="color:#bbb; font-size:12px;">-</span>`;

                // ★ 점수 세부 툴팁 HTML (html += 윗줄에 선언)
                const scoreTipHtml = `<span class="info-tip" data-tip-key="dyn-rec-score-${item.code}" style="margin-left:3px;">i<span class="info-tip-content">📊 <b>${item.code}</b> 점수 내역<br>━━━━━━━━━━━━━<br>• 직진배송: ${item.zContrib.toFixed(1)}점 <span style="color:#90a4ae;">(원수량 ${Number(item.zQty||0).toLocaleString()})</span><br>• 주차별: ${item.wContrib.toFixed(1)}점 <span style="color:#90a4ae;">(원수량 ${Number(item.wQty||0).toLocaleString()})</span><br>• 상승세: ${item.tContrib.toFixed(1)}점 <span style="color:#90a4ae;">(증가분 ${Number(item.trendVal||0).toLocaleString()})</span><br>━━━━━━━━━━━━━<br><b>합계: ${item.score.toFixed(1)}점</b><br><br>💡 반영 비율: 직진 ${window.recommendRatios.zikjin}% / 주차 ${window.recommendRatios.weekly}% / 상승세 ${window.recommendRatios.trend}%</span></span>`;

                // v3.98: 페어 보정 배지
                let pairBadgeHtml = '';
                if (matchedPairScore > 0 && pairWeightMax > 0) {
                    const normScore = Math.min(100, (matchedPairScore / pairWeightMax) * 100);
                    const partnerCount = (pairMap[item.code] || []).length;
                    pairBadgeHtml = `<br><span style="display:inline-block; background:#fff3e0; color:#e65100; padding:3px 7px; border-radius:4px; font-size:10px; font-weight:bold; margin-top:3px; border:1px solid #ffcc80;" title="페어 가중치: ${matchedPairScore.toFixed(2)} (정규화 ${normScore.toFixed(0)}점, 페어 ${partnerCount}개)">🔗 페어 ${partnerCount}개와 가까이</span>`;
                }

                html += `
                    <tr style="background:${rowBg};">
                        <td style="color:var(--primary); font-weight:900; font-size:15px; border-left:none; padding:14px 10px;">
                            ${displayRank}위
                            <br><span style="font-size:11px; color:#e65100; font-weight:bold; display:inline-block; line-height:18px; vertical-align:middle;">${item.score.toFixed(1)}점${scoreTipHtml}</span>
                        </td>
                        <td style="font-weight:bold; color:#1a237e; font-size:13px; letter-spacing:0.3px;">${item.code}</td>
                        <td style="text-align:left; font-size:14px; font-weight:bold; color:#212121; padding:14px 12px; line-height:1.5;">${item.name}</td>
                        <td style="text-align:center; padding:14px 8px;">${moveQtyDisplay}</td>
                        <td style="color:#555; font-size:12px; padding:14px 10px;">${item.currentLocs}</td>
                        <td style="background:#f1f8e9; border-right:none; padding:14px 12px; text-align:center;">
                            <span style="color:#1b5e20; font-weight:900; font-size:16px;">${eLoc.id}</span><br>
                            ${moveBadge}${pairBadgeHtml}<br>
                            <span style="font-size:11px; color:#555; margin-top:3px; display:inline-block;">${eLoc.dong}동 ${eLoc.pos}위치</span>
                        </td>
                    </tr>
                `;
                displayRank++;
                matchCount++;
                break; 
            }
        }

        if (matchCount === 0) {
            html += '<tr><td colspan="6" style="padding:40px;">데이터가 부족하거나 추천할 빈 로케이션이 없습니다.<br>(또는 이미 모든 상품이 최적의 동에 배치되어 있습니다)</td></tr>';
        }

        tbody.innerHTML = html;
        window.hideLoading();
        document.getElementById('recommend-modal').style.display = 'flex';

    }, 500); 
};

window.downloadRecommendationExcel = function() {
    // v4.1: 활성 탭에 따라 다른 데이터 사용
    const singleTab = document.getElementById('rec-tab-single');
    const singleActive = singleTab && singleTab.style.display !== 'none';
    
    let sourceData = null;
    let sheetName = '';
    let fileSuffix = '';
    
    if (singleActive) {
        sourceData = window.currentSingleRecommendations;
        sheetName = '단독추천';
        fileSuffix = '단독';
    } else {
        sourceData = window.currentRecommendations;
        sheetName = '페어추천';
        fileSuffix = '페어';
    }
    
    if (!sourceData || sourceData.length === 0) {
        alert("다운로드할 추천 데이터가 없습니다.");
        return;
    }
    
    const excelData = sourceData.map(item => {
        return {
            "현재로케이션": item.currentLocs,
            "변경로케이션": item.targetLoc,
            "상품명": item.name,
            "옵션": item.option,
            "상품코드": item.code
        };
    });

    const ws = XLSX.utils.json_to_sheet(excelData);
    
    // v4.1: ws['!cols']를 실제 5개 컬럼에 맞게 정리
    ws['!cols'] = [
        { wch: 20 }, // 현재로케이션
        { wch: 15 }, // 변경로케이션
        { wch: 40 }, // 상품명
        { wch: 25 }, // 옵션
        { wch: 15 }  // 상품코드
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    
    const today = new Date();
    const dateString = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    
    XLSX.writeFile(wb, `로케이션변경추천리스트_${fileSuffix}_${dateString}.xlsx`);
};

// ========================================
// ★ 빈칸확보 기능 (구 2F 이동 추천) — 현재고 0 · 입고대기 0 상품, 공급처 제외 지원
// ========================================
window.current2FList = [];

window.show2FRecommendation = function() {
    document.getElementById('modal-2f').style.display = 'flex';
    window.calc2FList(); // 열자마자 기준(현재고0·입고대기0)으로 조회
};

window.toggle2FCheckAll = function(source) {
    document.querySelectorAll('.check-2f-item').forEach(cb => cb.checked = source.checked);
};

// rawData에서 키를 유연하게 찾는 헬퍼 (공백/전각공백 무시 — \s 는 NBSP도 매칭)
function get2FRawVal(rd, targetKey) {
    if (!rd) return '';
    if (rd[targetKey]) return rd[targetKey];
    const norm = targetKey.replace(/\s/g, '');
    for (const k of Object.keys(rd)) {
        if (k.replace(/\s/g, '') === norm) return rd[k];
    }
    return '';
}

// 마지막출고.배송일: 마지막배송일/마지막출고일(/마지막입고일) 중 가장 최근 날짜를 반환.
// 두 날짜는 서로 다른 이벤트(배송 vs 출고)이므로 둘 중 더 최근 값이 실제 마지막 이동일임.
function __getLastMoveDate(rd) {
    if (!rd) return '';
    let result = '';
    ['마지막배송일', '마지막출고일', '마지막입고일'].forEach(key => {
        const val = get2FRawVal(rd, key);
        if (val) {
            const norm = String(val).replace(/\./g, '-');
            if (norm > result) result = norm;
        }
    });
    return result;
}

// 상품(로케이션 묶음)의 공급처명을 찾는다. 재고 엑셀 헤더명이 확실치 않아 유연 매칭.
const SUPPLIER_KEYS = ['공급처', '공급처명', '공급사', '공급업체', '거래처', '거래처명', 'vendor', 'supplier', 'Supplier'];
function get2FSupplier(locs) {
    for (const loc of locs) {
        const rd = loc.rawData;
        if (!rd) continue;
        for (const key of SUPPLIER_KEYS) {
            const v = get2FRawVal(rd, key);
            if (v) return String(v).trim();
        }
        // '공급처'가 들어간 키(단, 상품명/코드류 제외)
        for (const k of Object.keys(rd)) {
            const ck = k.replace(/\s/g, '');
            if (ck.includes('공급처') && !ck.includes('상품') && !ck.includes('코드')) {
                const v = rd[k];
                if (v) return String(v).trim();
            }
        }
    }
    return '';
}

// 공급처 제외 체크리스트 렌더 (기존 체크 상태 유지)
window.render2FSupplierList = function(supplierSet, excluded) {
    const box = document.getElementById('2f-supplier-box');
    if (!box) return;
    const suppliers = [...supplierSet].sort((a, b) => a.localeCompare(b, 'ko'));
    if (suppliers.length === 0) {
        box.innerHTML = '<span style="font-size:12px; color:#999;">공급처 정보가 있는 상품이 없습니다.</span>';
        const allCb0 = document.getElementById('2f-supplier-all');
        if (allCb0) allCb0.checked = false;
        return;
    }
    box.innerHTML = suppliers.map(s => {
        const checked = excluded.has(s) ? ' checked' : '';
        const safe = String(s).replace(/"/g, '&quot;');
        return '<label style="font-size:12px; color:#333; cursor:pointer; user-select:none; white-space:nowrap;">' +
               '<input type="checkbox" class="f2-supplier-cb" value="' + safe + '"' + checked + ' style="vertical-align:middle;"> ' + s +
               '</label>';
    }).join('');
    const allCb = document.getElementById('2f-supplier-all');
    if (allCb) allCb.checked = suppliers.every(s => excluded.has(s));
};

window.toggle2FSupplierAll = function(source) {
    document.querySelectorAll('.f2-supplier-cb').forEach(cb => cb.checked = source.checked);
    window.calc2FList();
};

window.calc2FList = function() {
    // 재렌더 전에 현재 체크된 '제외 공급처' 수집
    const excluded = new Set(
        Array.from(document.querySelectorAll('.f2-supplier-cb:checked')).map(cb => cb.value)
    );

    // 상품코드별로 그룹핑
    const codeMap = {};
    originalData.forEach(loc => {
        const code = loc.code;
        if (!code || code.trim() === '' || code === loc.id) return;
        if (!codeMap[code]) codeMap[code] = [];
        codeMap[code].push(loc);
    });

    window.current2FList = [];
    const supplierSet = new Set(); // 조건 통과 후보들의 공급처 (체크리스트용)

    // 입고대기(오더/사입 입고 리스트)에 포함된 상품코드 — 공백 정규화하여 집합화
    const incomingCodeSet = new Set(Object.keys(incomingData || {}).map(c => String(c).trim()));

    for (const code in codeMap) {
        // ★ 기준 1: 입고대기에 포함된 상품 제외
        //   (미입고수량>0 이거나, 오더/사입 입고 리스트에 코드가 존재하면 제외 — 도착일 지남·잔량0도 포함)
        if (incomingCodeSet.has(String(code).trim()) || (incomingTotalByCode[code] || 0) > 0) continue;

        const locs = codeMap[code];

        // ★ 기준 2: 현재고(정상재고) 0개
        let totalStock = 0;
        locs.forEach(l => totalStock += Number(l.stock || 0));
        if (totalStock !== 0) continue;

        const firstLoc = locs[0];

        // 공급처 (제외 판별 + 표시)
        const supplier = get2FSupplier(locs);
        if (supplier) supplierSet.add(supplier);
        if (supplier && excluded.has(supplier)) continue; // ★ 선택한 공급처 제외

        // 마지막출고.배송일 (참고 표시용) — 마지막배송일/마지막출고일 중 더 최근 값
        let lastDelivery = '';
        for (const loc of locs) {
            const val = __getLastMoveDate(loc.rawData);
            if (val && val > lastDelivery) lastDelivery = val;
        }

        // 옵션추가항목1 값
        let extraOpt = '';
        for (const loc of locs) {
            const val = get2FRawVal(loc.rawData, '옵션추가항목1');
            if (val) { extraOpt = val; break; }
        }

        const locIds = locs.map(l => l.id).join(', ');
        const name = firstLoc.name || '';
        const option = firstLoc.option || '';
        const changeValue = `2F-${code}${extraOpt ? ' ' + extraOpt : ''}`;

        window.current2FList.push({
            code, name, option, supplier, totalStock, lastDelivery: lastDelivery || '기록없음',
            locIds, locs, changeValue, extraOpt
        });
    }

    // 공급처 체크리스트 갱신 (선택 상태 유지)
    window.render2FSupplierList(supplierSet, excluded);

    // 마지막배송일 오래된 순 정렬 (기록없음이 맨 위)
    window.current2FSortAsc = true;
    window.current2FList.sort((a, b) => {
        const aVal = a.lastDelivery === '기록없음' ? '0000-00-00' : a.lastDelivery;
        const bVal = b.lastDelivery === '기록없음' ? '0000-00-00' : b.lastDelivery;
        return aVal.localeCompare(bVal);
    });

    const icon = document.getElementById('2f-sort-icon');
    if (icon) icon.textContent = '▲';

    window.render2FTable();
};

window.current2FSortAsc = true; // 기본: 오래된 순 (오름차순)

window.sort2FList = function() {
    if (!window.current2FList || window.current2FList.length === 0) return;
    
    window.current2FSortAsc = !window.current2FSortAsc;
    
    window.current2FList.sort((a, b) => {
        const aVal = a.lastDelivery === '기록없음' ? '0000-00-00' : a.lastDelivery;
        const bVal = b.lastDelivery === '기록없음' ? '0000-00-00' : b.lastDelivery;
        return window.current2FSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
    
    // 아이콘 업데이트
    const icon = document.getElementById('2f-sort-icon');
    if (icon) icon.textContent = window.current2FSortAsc ? '▲' : '▼';
    
    // 테이블 다시 렌더링
    window.render2FTable();
};

window.render2FTable = function() {
    const tbody = document.getElementById('2f-tbody');
    let html = '';
    window.current2FList.forEach((item, idx) => {
        const rowBg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
        html += `
            <tr style="background:${rowBg};">
                <td><input type="checkbox" class="check-2f-item" data-idx="${idx}"></td>
                <td style="font-weight:bold; color:#7b1fa2;">${idx + 1}</td>
                <td style="font-weight:bold; color:#1a237e; white-space:nowrap;">${item.code}</td>
                <td style="text-align:left; font-size:13px; white-space:nowrap;">${item.name}</td>
                <td style="font-size:12px; white-space:nowrap;">${item.option}</td>
                <td style="font-size:12px; color:#555; white-space:nowrap;">${item.supplier || '-'}</td>
                <td style="font-weight:bold;">${item.totalStock}</td>
                <td style="font-size:12px; color:${item.lastDelivery === '기록없음' ? '#ff5252' : '#555'};">${item.lastDelivery}</td>
                <td style="font-size:12px;">${item.locIds}</td>
                <td style="background:#f3e5f5; font-weight:bold; color:#4a148c; font-size:12px;">${item.changeValue}</td>
            </tr>
        `;
    });
    if (window.current2FList.length === 0) {
        html = '<tr><td colspan="10" style="padding:40px; color:#888;">조건에 해당하는 상품이 없습니다.</td></tr>';
    }
    tbody.innerHTML = html;
    document.getElementById('2f-check-all').checked = false;
};

window.download2FExcel = function() {
    if (!window.current2FList || window.current2FList.length === 0) {
        alert("다운로드할 데이터가 없습니다. 먼저 조회해주세요.");
        return;
    }

    // 체크된 항목이 있으면 선택만, 없으면 전체 다운로드
    const checked = document.querySelectorAll('.check-2f-item:checked');
    let targetList;
    let fileLabel;
    if (checked.length > 0) {
        const indices = Array.from(checked).map(cb => Number(cb.dataset.idx));
        targetList = indices.map(i => window.current2FList[i]).filter(Boolean);
        fileLabel = `빈칸확보_선택${targetList.length}건`;
    } else {
        targetList = window.current2FList;
        fileLabel = `빈칸확보_전체${targetList.length}건`;
    }

    const excelData = targetList.map((item, idx) => ({
        "No": idx + 1,
        "상품코드": item.code,
        "상품명": item.name,
        "옵션": item.option,
        "공급처": item.supplier || '',
        "정상재고": item.totalStock,
        "마지막출고.배송일": item.lastDelivery,
        "현재위치": item.locIds,
        "변경값": item.changeValue
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    ws['!cols'] = [
        { wch: 5 }, { wch: 15 }, { wch: 40 }, { wch: 25 }, { wch: 18 },
        { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 30 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "빈칸확보");
    const today = new Date();
    const dateString = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, `${fileLabel}_${dateString}.xlsx`);
};

function renderTableHeader() {
    const theadTr = document.getElementById('dynamic-thead-tr');
    const popupContainer = document.getElementById('dynamic-popups');
    if (!theadTr || !popupContainer) return;

    let html = `<th class="checkbox-cell"><input type="checkbox" id="check-all" class="loc-check" onclick="toggleAllCheckboxes(this)"></th>`;
    let popupHtml = '';
    
    window.visibleColumns.forEach(col => {
        if (col === 'std_dong') { html += createTh('dong', '동', 80, true); popupHtml += `<div id="pop-dong" class="filter-popup"></div>`; }
        else if (col === 'std_pos') { html += createTh('pos', '위치', 80, true); popupHtml += `<div id="pop-pos" class="filter-popup"></div>`; }
        else if (col === 'std_id') { html += createTh('id', '로케이션', 150, true); popupHtml += `<div id="pop-id" class="filter-popup"></div>`; }
        else if (col === 'std_code') { html += createTh('code', '상품코드', 150, true); popupHtml += `<div id="pop-code" class="filter-popup"></div>`; }
        else if (col === 'std_name') { html += createTh('name', '상품명', 'auto', true); popupHtml += `<div id="pop-name" class="filter-popup"></div>`; }
        else if (col === 'std_option') { html += createTh('option', '옵션', 180, true); popupHtml += `<div id="pop-option" class="filter-popup"></div>`; }
        else if (col === 'std_stock') { html += createTh('stock', '정상재고', 130, true); popupHtml += `<div id="pop-stock" class="filter-popup"></div>`; }
        else if (col === 'std_stock2f') { html += createTh('stock2f', '2층창고재고', 130, true); popupHtml += `<div id="pop-stock2f" class="filter-popup"></div>`; }
        else if (col.startsWith('cus_')) {
            const label = col.replace('cus_', '');
            // ★ 입고대기 컬럼에 툴팁 추가
            let displayLabel = label;
            if (label === '입고대기') {
                displayLabel = `입고대기<span class="info-tip" data-tip-key="header-incoming">i<span class="info-tip-content">📦 <b>오더리스트 + 사입리스트 합계</b><br>입고대기 사이드바에 연동된 구글시트의 <b>미입고수량</b>을 상품코드 기준으로 합산한 값입니다.<br>(같은 상품코드의 옵션별 수량이 모두 더해집니다)</span></span>`;
            }
            html += createTh(col, displayLabel, 120, true);
            popupHtml += `<div id="pop-${col}" class="filter-popup"></div>`;
        }
    });
    
    theadTr.innerHTML = html;
    popupContainer.innerHTML = popupHtml;
    
    document.querySelectorAll('.filter-popup').forEach(p => { p.addEventListener('click', function(e) { e.stopPropagation(); }); });
    setupFilterPopups();
}

function createTh(key, label, width, hasFilter) {
    let widthStyle = width === 'auto' ? '' : `style="width: ${width}px;"`;
    let filterHtml = hasFilter ? `<span class="filter-btn" id="btn-filter-${key}" onclick="toggleFilterPopup(event, 'pop-${key}')">▼</span>` : '';
    return `<th ${widthStyle}><div class="th-content"><span class="title-text">${label}</span>${filterHtml}</div></th>`;
}

window.openSettingsModal = (e) => {
    if(e) e.stopPropagation();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    
    const container = document.getElementById('setting-headers-container');
    
    let html = '<div style="margin-bottom:15px; font-weight:bold; color:var(--primary);">■ 화면 헤더(컬럼) 설정</div><div style="display:flex; flex-wrap:wrap; gap:5px;">';
    
    const stdCols = [
        { id: 'std_dong', label: '동' }, { id: 'std_pos', label: '위치' }, { id: 'std_id', label: '로케이션(ID)' },
        { id: 'std_code', label: '상품코드' }, { id: 'std_name', label: '상품명' }, { id: 'std_option', label: '옵션' }, { id: 'std_stock', label: '정상재고' }, { id: 'std_stock2f', label: '2층창고재고' }
    ];
    
    stdCols.forEach(col => {
        const isChecked = window.visibleColumns.includes(col.id) ? 'checked' : '';
        html += `<label style="display:flex; align-items:center; gap:5px; width: 45%;"><input type="checkbox" class="chk-header" value="${col.id}" ${isChecked}> ${col.label}</label>`;
    });
    
    window.excelHeaders.forEach(header => {
        const colId = 'cus_' + header;
        const isChecked = window.visibleColumns.includes(colId) ? 'checked' : '';
        html += `<label style="display:flex; align-items:center; gap:5px; width: 45%; color:#e65100;"><input type="checkbox" class="chk-header" value="${colId}" ${isChecked}> ${header}</label>`;
    });

    html += `</div>`;
    container.innerHTML = html;
    document.getElementById('settings-modal').style.display = 'flex';
};

window.saveHeaderSettings = async () => {
    const checkboxes = document.querySelectorAll('.chk-header:checked');
    const newVisible = Array.from(checkboxes).map(cb => cb.value);
    
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { 
            visibleColumns: newVisible
        }, { merge: true });
        
        window.visibleColumns = newVisible;
        document.getElementById('settings-modal').style.display = 'none';
        renderTableHeader(); 
        applyFiltersAndSort(); 
        showToast("✅ 화면 헤더 설정이 저장되었습니다.");
    } catch(e) { console.error(e); alert("저장 실패"); }
};

// [1단계] 입고대기 설정 모달 내 탭 전환 함수
window.switchIncomingSettingsTab = function(tab) {
    const tabBtnSheet = document.getElementById('incoming-tab-btn-sheet');
    const tabBtnPriority = document.getElementById('incoming-tab-btn-priority');
    const contentSheet = document.getElementById('incoming-tab-content-sheet');
    const contentPriority = document.getElementById('incoming-tab-content-priority');
    if (!tabBtnSheet || !tabBtnPriority || !contentSheet || !contentPriority) return;
    
    if (tab === 'sheet') {
        contentSheet.style.display = 'block';
        contentPriority.style.display = 'none';
        tabBtnSheet.style.background = '#607d8b';
        tabBtnSheet.style.color = 'white';
        tabBtnPriority.style.background = '#eee';
        tabBtnPriority.style.color = '#555';
    } else if (tab === 'priority') {
        contentSheet.style.display = 'none';
        contentPriority.style.display = 'block';
        tabBtnSheet.style.background = '#eee';
        tabBtnSheet.style.color = '#555';
        tabBtnPriority.style.background = '#607d8b';
        tabBtnPriority.style.color = 'white';
        
        // 2단계에서 우선순위 UI 렌더링 함수 호출 예정
    }
};

window.openSheetModal = (e) => {
    if (e) e.stopPropagation();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    
    // 시트 링크 값 설정 (시스템 전체에서 window.sheetUrlOrder/Buy 사용)
    const urlOrder = document.getElementById('modal-sheet-url-order');
    const urlBuy = document.getElementById('modal-sheet-url-buy');
    if (urlOrder) urlOrder.value = window.sheetUrlOrder || '';
    if (urlBuy) urlBuy.value = window.sheetUrlBuy || '';

    // [1단계] 모달 오픈 시 기본 탭 초기화
    if (typeof window.switchIncomingSettingsTab === 'function') {
        window.switchIncomingSettingsTab('sheet');
    }
    
    // [2단계] 우선순위 탭 UI 데이터 채우기 (incomingRecommendPriorities 우선, 없으면 recommendPriorities를 기본값으로)
    try {
        const source = window.incomingRecommendPriorities || window.recommendPriorities || { zones:{0:[],1:[],2:[],3:[]}, dongs:[], poses:[], excludeCombos:[] };
        
        // 구역 퍼즐 채우기
        const allAlphabets = ['★', 'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
        const priZones = source.zones || {0:[], 1:[], 2:[], 3:[]};
        for(let i=0; i<=3; i++) {
            const el = document.getElementById(`incoming-pz-${i}`);
            if (el) el.innerHTML = '';
        }
        const noneEl = document.getElementById('incoming-pz-none');
        if (noneEl) noneEl.innerHTML = '';
        allAlphabets.forEach(alpha => {
            let placedRank = -1;
            for(let i=0; i<=3; i++) { 
                if(priZones[i] && priZones[i].includes(alpha)) { placedRank = i; break; } 
            }
            const block = document.createElement('div');
            block.className = 'puzzle-block';
            block.innerText = alpha;
            block.draggable = true;
            block.ondragstart = window.handleDragStart;
            block.ondragend = window.handleDragEnd;
            const target = placedRank !== -1 
                ? document.getElementById(`incoming-pz-${placedRank}`)
                : document.getElementById('incoming-pz-none');
            if (target) target.appendChild(block);
        });
        
        // 동/위치 정렬 블록 채우기
        const renderIncomingSortBlocks = (containerId, items, defaultItems) => {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';
            const finalItems = [...new Set([...items, ...defaultItems])];
            finalItems.forEach(item => {
                const block = document.createElement('div');
                block.className = 'puzzle-sort-block';
                block.innerText = item;
                block.draggable = true;
                block.ondragstart = window.handleDragStart;
                block.ondragend = window.handleDragEnd;
                container.appendChild(block);
            });
        };
        renderIncomingSortBlocks('incoming-sort-dongs', source.dongs || [], ['★','1','2','3','4','5','6']);
        renderIncomingSortBlocks('incoming-sort-poses', source.poses || [], ['★','2','3','4','1','5']);
        
        // 제외 조합 입력값 채우기
        const excludeInput = document.getElementById('incoming-exclude-combos-input');
        if (excludeInput) {
            const excludeCombos = source.excludeCombos || [];
            excludeInput.value = excludeCombos.join(', ');
        }
    } catch (err) {
        console.warn('[입고대기 우선순위 탭 초기화 실패]', err);
    }

    const modal = document.getElementById('sheet-modal');
    if (modal) modal.style.display = 'flex';
};

// [2단계] 입고대기 신규 상품용 우선순위 저장
window.saveIncomingPriorities = async function() {
    try {
        // 1) 구역 퍼즐 수집
        const newZones = {};
        for(let i=0; i<=3; i++){
            const pz = document.getElementById(`incoming-pz-${i}`);
            if (!pz) { 
                console.warn(`[saveIncomingPriorities] incoming-pz-${i} 엘리먼트 없음`); 
                return alert("⚠️ 우선순위 UI를 찾을 수 없습니다. 페이지를 새로고침 해주세요.");
            }
            const blocks = pz.querySelectorAll('.puzzle-block');
            newZones[i] = Array.from(blocks).map(b => b.innerText.trim());
        }
        
        // 2) 동/위치 정렬 블록 수집
        const dongsEl = document.getElementById('incoming-sort-dongs');
        const posesEl = document.getElementById('incoming-sort-poses');
        if (!dongsEl || !posesEl) {
            return alert("⚠️ 동/위치 우선순위 UI를 찾을 수 없습니다. 페이지를 새로고침 해주세요.");
        }
        const newDongs = Array.from(dongsEl.querySelectorAll('.puzzle-sort-block')).map(b => b.innerText.trim());
        const newPoses = Array.from(posesEl.querySelectorAll('.puzzle-sort-block')).map(b => b.innerText.trim());
        
        // 3) 제외 조합 수집
        const excludeEl = document.getElementById('incoming-exclude-combos-input');
        const excludeCombos = excludeEl 
            ? excludeEl.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
            : [];
        
        // 4) 데이터 객체 구성 (recommendPriorities와 동일한 스키마)
        const newPriorities = { zones: newZones, dongs: newDongs, poses: newPoses, excludeCombos };
        
        // 5) Firestore 저장 + 메모리 동기화
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { 
            incomingRecommendPriorities: newPriorities
        }, { merge: true });
        
        window.incomingRecommendPriorities = newPriorities;
        
        if (typeof showToast === 'function') {
            showToast("✅ 입고 추천 우선순위가 저장되었습니다.");
        } else {
            alert("✅ 입고 추천 우선순위가 저장되었습니다.");
        }
        
        if (typeof window.closeSheetModal === 'function') window.closeSheetModal();
    } catch(e) {
        console.error("[saveIncomingPriorities] 저장 실패:", e);
        alert("⚠️ 입고 추천 우선순위 저장 중 오류가 발생했습니다.");
    }
};

// [3단계] 입고대기 상품용 추천 자리 계산 함수
// 반환값: { case: 'A'|'B', loc: <originalData 원소>, score: number, partnerCount: number } 또는 null
// - Case A: 주문 데이터의 신뢰 페어(count≥5, lift≥2.0) 발견 → 페어 위치 점수 최고 빈칸
// - Case B: 신뢰 페어 0개(또는 모든 partner가 시스템에 미배치) → incomingRecommendPriorities 기준 1순위 빈칸
// - 빈칸 없거나 입력 오류 → null
// [5단계] 두 번째 인자 excludeLocIds (Set): 이 자리 ID들은 빈칸 후보에서 제외 (일괄적용 충돌 처리)
window.calcIncomingRecommend = function(code, excludeLocIds) {
    // 입력/시스템 상태 검증
    if (!code || typeof code !== 'string') return null;
    if (!Array.isArray(originalData) || originalData.length === 0) return null;
    
    // 우선순위 선택 (incomingRecommendPriorities 우선, 없으면 recommendPriorities를 fallback)
    const priorities = window.incomingRecommendPriorities || window.recommendPriorities || {
        zones: { 0: [], 1: [], 2: [], 3: [] },
        dongs: [],
        poses: [],
        excludeCombos: []
    };
    
    // 현재 이 code가 이미 배치된 동들 (같은 동 중복 배치 방지용)
    const currentDongsSet = new Set(
        originalData
            .filter(d => d.code === code)
            .map(d => (d.dong || '').toString().trim())
    );
    
    // 빈칸 추출 (선지정 제외 + 같은 동 제외 + 제외 조합 제외 + 일괄적용 시 이미 사용된 자리 제외)
    const excludeCombos = priorities.excludeCombos || [];
    const hasExclude = excludeLocIds && typeof excludeLocIds.has === 'function';
    const emptyLocs = originalData.filter(d => {
        const hasContent = (d.code && d.code !== d.id && String(d.code).trim() !== '')
                        || (d.name && String(d.name).trim() !== '');
        // 점유(상품 배치)·선지정·당일지정·예약된 자리는 추천에서 제외
        if (hasContent || d.preAssigned || d.reserved) return false;
        if (d.codeTag && String(d.codeTag).trim() !== '') return false; // 선지정/당일지정 등 태그된 자리

        // [5단계] 일괄적용 시 이미 다른 카드가 가져간 자리 제외
        if (hasExclude && excludeLocIds.has(d.id)) return false;
        
        const targetDong = (d.dong || '').toString().trim();
        if (currentDongsSet.has(targetDong)) return false;
        
        if (excludeCombos.length > 0) {
            const prefix = (d.id || '').charAt(0).toUpperCase();
            const dong = (d.dong || '').toString().trim();
            const combo = `${prefix}-${dong}`;
            if (excludeCombos.includes(combo)) return false;
        }
        return true;
    });
    
    if (emptyLocs.length === 0) return null;
    
    // Case A 판정: 주문 데이터에서 신뢰 페어 검색
    const trustedPartners = []; // [{ partner, weight }, ...]
    try {
        if (window._cachedOrderPairs && window._cachedOrderStats && window._cachedOrderMeta) {
            const pairs = window._cachedOrderPairs;
            const stats = window._cachedOrderStats;
            const N = window._cachedOrderMeta.totalProcessedOrders || 1;
            
            for (const p of pairs) {
                let partner = null;
                if (p.codeA === code) partner = p.codeB;
                else if (p.codeB === code) partner = p.codeA;
                else continue;
                
                const cA = (stats[p.codeA] || {}).count || 0;
                const cB = (stats[p.codeB] || {}).count || 0;
                if (cA === 0 || cB === 0) continue;
                
                const lift = (p.count * N) / (cA * cB);
                if (p.count < 5 || lift < 2.0) continue;
                
                trustedPartners.push({ partner, weight: lift * p.count });
            }
        }
    } catch (e) {
        console.warn('[calcIncomingRecommend] 페어 데이터 조회 실패:', e);
    }
    
    // Case A: 신뢰 페어 있음 → 위치 점수로 최고 빈칸 선택
    if (trustedPartners.length > 0) {
        // partner들의 현재 위치 캐시 (중복 조회 방지)
        const partnerLocsCache = {};
        for (const tp of trustedPartners) {
            if (!partnerLocsCache[tp.partner]) {
                partnerLocsCache[tp.partner] = originalData.filter(d => d.code === tp.partner);
            }
        }
        
        let bestEmpty = null;
        let bestScore = -1;
        
        for (const eLoc of emptyLocs) {
            const eZone = (eLoc.id || '').charAt(0).toUpperCase();
            const eDong = (eLoc.dong || '').toString().trim();
            const ePos = (eLoc.pos || '').toString().trim();
            
            let totalScore = 0;
            for (const tp of trustedPartners) {
                const partnerLocs = partnerLocsCache[tp.partner] || [];
                if (partnerLocs.length === 0) continue;
                
                let bestCoeff = 0;
                for (const pLoc of partnerLocs) {
                    const pZone = (pLoc.id || '').charAt(0).toUpperCase();
                    const pDong = (pLoc.dong || '').toString().trim();
                    const pPos = (pLoc.pos || '').toString().trim();
                    
                    let coeff = 0;
                    if (eZone === pZone && eDong === pDong) {
                        const ePosNum = parseInt(ePos, 10);
                        const pPosNum = parseInt(pPos, 10);
                        if (!isNaN(ePosNum) && !isNaN(pPosNum)) {
                            const diff = Math.abs(ePosNum - pPosNum);
                            if (diff === 0) coeff = 1.0;
                            else if (diff === 1) coeff = 0.9;
                            else if (diff === 2) coeff = 0.8;
                            else coeff = 0.7;
                        } else {
                            coeff = 0.7;
                        }
                    }
                    if (coeff > bestCoeff) bestCoeff = coeff;
                }
                totalScore += tp.weight * bestCoeff;
            }
            
            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestEmpty = eLoc;
            }
        }
        
        // 점수가 0보다 크면 Case A 결과 반환
        // (점수 0인 경우 = 신뢰 페어는 있으나 partner가 시스템에 미배치 → Case B로 폴백)
        if (bestEmpty && bestScore > 0) {
            return { case: 'A', loc: bestEmpty, score: bestScore, partnerCount: trustedPartners.length };
        }
    }
    
    // Case B: 신뢰 페어 없거나 점수 0 → 우선순위 기반 1순위 빈칸 선택
    const getZoneRank = (locId) => {
        const prefix = (locId || '').charAt(0).toUpperCase();
        const zones = priorities.zones || {};
        for (let i = 0; i <= 3; i++) {
            if (zones[i] && zones[i].includes(prefix)) return i;
        }
        return 99;
    };
    const getDongRank = (dong) => {
        const str = (dong || '').toString().trim();
        const arr = priorities.dongs || [];
        const idx = arr.indexOf(str);
        return idx !== -1 ? idx : 99;
    };
    const getPosRank = (pos) => {
        const str = (pos || '').toString().trim();
        const arr = priorities.poses || [];
        const idx = arr.indexOf(str);
        return idx !== -1 ? idx : 99;
    };
    
    const sortedEmpty = emptyLocs.slice().sort((a, b) => {
        const zA = getZoneRank(a.id), zB = getZoneRank(b.id);
        if (zA !== zB) return zA - zB;
        const dA = getDongRank(a.dong), dB = getDongRank(b.dong);
        if (dA !== dB) return dA - dB;
        const pA = getPosRank(a.pos), pB = getPosRank(b.pos);
        if (pA !== pB) return pA - pB;
        return (a.id || '').localeCompare(b.id || '');
    });
    
    return { case: 'B', loc: sortedEmpty[0], score: 0, partnerCount: 0 };
};

// [5단계] 입고대기 추천 자리 일괄 적용
// - 정렬: 출고예상일 빠른 순 → 같으면 미입고수량 많은 순
// - 충돌 처리: 우선순위 높은 카드가 먼저 자리를 차지, 후순위 카드는 해당 자리를 제외하고 차순위 자리 재계산
// - Firestore 저장 패턴은 기존 단일 선지정과 동일 (preAssigned, preAssignedCode 등)
window.applyAllRecommendations = async function() {
    try {
        // 1) 현재 입고대기 목록 (renderIncomingQueue와 같은 필터 적용)
        const filterSource = document.getElementById('filter-source')?.value || 'all';
        
        const existingLocMap = {};
        originalData.forEach(loc => {
            if (loc.preAssigned && loc.preAssignedCode) existingLocMap[loc.preAssignedCode] = true;
            if (loc.code && loc.code !== loc.id) existingLocMap[loc.code] = true;
        });
        
        const _today = new Date().toISOString().slice(0, 10);
        
        let list = [];
        for (const code in incomingData) { list.push(incomingData[code]); }
        
        list = list.filter(item => {
            if (filterSource !== 'all' && item.source !== filterSource) return false;
            if (existingLocMap[item['상품코드']]) return false;
            if (!item['표시날짜'] || item['표시날짜'].toString().trim() === '') return false;
            const arrivalDate = (item['도착예상일'] || item['표시날짜'] || '').toString().trim();
            if (arrivalDate && arrivalDate < _today) return false;
            return true;
        });
        
        if (list.length === 0) {
            return alert("일괄 적용할 입고대기 상품이 없습니다.");
        }
        
        // 2) 충돌 처리용 정렬: 출고예상일 빠른 순 → 같으면 미입고수량 많은 순
        list.sort((a, b) => {
            const dA = (a['표시날짜'] || '9999-99-99').toString();
            const dB = (b['표시날짜'] || '9999-99-99').toString();
            if (dA !== dB) return dA.localeCompare(dB);
            return Number(b['입고대기수량'] || 0) - Number(a['입고대기수량'] || 0);
        });
        
        // 3) 각 카드의 추천 자리 계산 (이미 사용된 자리는 제외하고 재계산)
        const usedLocIds = new Set();
        const assignments = [];
        const skipped = [];
        
        for (const item of list) {
            const code = item['상품코드'];
            const rec = window.calcIncomingRecommend(code, usedLocIds);
            if (rec && rec.loc && rec.loc.id) {
                usedLocIds.add(rec.loc.id);
                assignments.push({ item, locId: rec.loc.id, rec });
            } else {
                skipped.push(item);
            }
        }
        
        if (assignments.length === 0) {
            return alert("추천 가능한 자리가 없습니다. (3층 빈칸이 부족할 수 있습니다.)");
        }
        
        // 4) 사용자 확인
        const msg = `📍 추천 자리 일괄 적용\n\n` +
                    `대상: ${assignments.length}개 상품\n` +
                    (skipped.length > 0 ? `추천 불가로 제외: ${skipped.length}개\n` : '') +
                    `\n계속 진행하시겠습니까?`;
        if (!confirm(msg)) return;
        
        // 5) zone 별로 묶어서 Firestore 일괄 저장
        const zoneUpdates = {};
        const now = Date.now();
        for (const { item, locId } of assignments) {
            const zoneDocId = getZoneDocId(locId);
            if (!zoneUpdates[zoneDocId]) zoneUpdates[zoneDocId] = {};
            zoneUpdates[zoneDocId][locId] = {
                preAssigned: true,
                preAssignedCode: item['상품코드'],
                preAssignedName: item['상품명'] || '',
                preAssignedQty: item['입고대기수량'] || 0,
                preAssignedAt: now,
                code: item['상품코드'],
                name: item['상품명'] || '',
                option: item['옵션'] || '',
                stock: (item['입고대기수량'] || 0).toString(),
                reserved: false, reservedBy: '', reservedAt: 0,
                codeTag: '선지정', codeTagAt: now,
                updatedAt: new Date()
            };
        }
        
        const savePromises = [];
        for (const zoneDocId in zoneUpdates) {
            savePromises.push(setDoc(doc(db, LOC_COLLECTION, zoneDocId), zoneUpdates[zoneDocId], { merge: true }));
        }
        await Promise.all(savePromises);
        
        // 6) 사이드바 갱신 (적용된 카드는 자동으로 사라짐)
        // ※ Firestore 실시간 리스너가 originalData를 갱신하므로 일반적으로 자동 갱신되나, 명시적 호출로 안정성 확보
        if (typeof window.renderIncomingQueue === 'function') {
            window.renderIncomingQueue();
        }
    } catch (e) {
        console.error('[applyAllRecommendations] 실패:', e);
        alert('⚠️ 일괄 적용 중 오류가 발생했습니다: ' + (e && e.message ? e.message : e));
    }
};

window.saveSheetUrl = async () => {
    const urlOrder = document.getElementById('modal-sheet-url-order').value.trim();
    const urlBuy = document.getElementById('modal-sheet-url-buy').value.trim();
    
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { sheetUrlOrder: urlOrder, sheetUrlBuy: urlBuy }, { merge: true });
        window.sheetUrlOrder = urlOrder;
        window.sheetUrlBuy = urlBuy;
        alert("✅ 구글시트 링크가 안전하게 저장되었습니다.");
        if (typeof window.closeSheetModal === 'function') window.closeSheetModal();
    } catch(e) { console.error("링크 저장 실패:", e); alert("오류가 발생했습니다."); }
};

const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');

function formatExcelDate(excelDate) {
    if (!excelDate || excelDate.toString().trim() === "") return '';
    if (typeof excelDate === 'string' && (excelDate.includes('-') || excelDate.includes('.'))) return excelDate;
    const num = parseFloat(excelDate);
    if (isNaN(num)) return excelDate;
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

window.syncIncomingData = async () => {
    if (!window.sheetUrlOrder && !window.sheetUrlBuy) return alert("구글시트 링크가 설정되지 않았습니다.\n[⚙️ 링크 설정] 에서 시트 링크를 저장해주세요.");
    window.showLoading("🔄 원본 시트에서 데이터를 분석하여 가져오는 중입니다...");
    
    try {
        let combinedData = [];

        const fetchAndParse = async (url, sourceName) => {
            if (!url) return [];
            let textData = "";
            try {
                const res1 = await fetch(url);
                if (!res1.ok) throw new Error("1차 다이렉트 연결 실패");
                textData = await res1.text(); 
            } catch (e1) {
                try {
                    const res2 = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
                    if (!res2.ok) throw new Error("2차 프록시 실패");
                    textData = await res2.text();
                } catch (e2) {
                    const res3 = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
                    if (!res3.ok) throw new Error("3차 프록시 실패");
                    textData = await res3.text();
                }
            }

            const workbook = XLSX.read(textData, { type: 'string' });
            const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
            
            let headerRowIndex = -1;
            let pureHeaders = [];
            
            for (let i = 0; i < Math.min(20, rawData.length); i++) {
                const row = rawData[i];
                const cleanRow = row.map(h => cleanKey(h));
                if (cleanRow.includes('어드민상품코드') || cleanRow.includes('상품코드')) {
                    headerRowIndex = i;
                    pureHeaders = cleanRow; 
                    break;
                }
            }

            if (headerRowIndex === -1) return []; 

            const parsedList = [];
            for (let i = headerRowIndex + 1; i < rawData.length; i++) {
                let rowObj = {};
                let isEmpty = true;
                for (let j = 0; j < pureHeaders.length; j++) {
                    const key = pureHeaders[j];
                    if (key) {
                        rowObj[key] = rawData[i][j];
                        if (rawData[i][j] !== "" && rawData[i][j] !== undefined) isEmpty = false;
                    }
                }
                if (!isEmpty) {
                    rowObj.source = sourceName; 
                    parsedList.push(rowObj);
                }
            }
            return parsedList;
        };

        const [orderData, buyData] = await Promise.all([
            fetchAndParse(window.sheetUrlOrder, '제작'),
            fetchAndParse(window.sheetUrlBuy, '사입')
        ]);

        combinedData = [...orderData, ...buyData];

        // ★ v3.96: '오더취소' 상품코드 수집
        const cancelledCodes = new Set();
        combinedData.forEach(row => {
            const status = (row['상태'] || '').toString().trim();
            if (status === '오더취소') {
                const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim();
                if (code) cancelledCodes.add(code);
            }
        });

        const finalJson = combinedData.map(row => {
            let code = row['어드민상품코드'] || row['상품코드'] || '';
            let name = row['상품명'] || row['공급처상품명'] || '';
            
            let rawQty = row['총미입고수량본사입고기준'];
            if (rawQty === undefined || rawQty === "") rawQty = row['최종미입고수량추가입고예정'];
            if (rawQty === undefined || rawQty === "") rawQty = row['미입고수량'];
            let qty = Number(rawQty) || 0;
            
            let rawDate = "";
            let rawFactoryDate = "";
            let rawArrivalDate = "";
            if (row.source === '제작') {
                rawFactoryDate = row['공장출고예상일'] || '';
                rawDate = rawFactoryDate;
            } else if (row.source === '사입') {
                rawArrivalDate = row['검수창고도착일'] || '';
                rawDate = rawArrivalDate;
            }
            
            let date = formatExcelDate(rawDate);

            return {
                '상품코드': code,
                '상품명': name,
                '옵션': row['옵션'] || '',
                '입고대기수량': qty,
                '공장출고예상일': row.source === '제작' ? formatExcelDate(rawFactoryDate) : '',
                '검수창고도착일': row.source === '사입' ? formatExcelDate(rawArrivalDate) : '',
                '도착예상일': formatExcelDate(row['도착예상일'] || ''),
                '표시날짜': date,
                'source': row.source || '기타',
                '상태': (row['상태'] || '').toString().trim()
            };
        }).filter(row => 
            row['상품코드'] && row['상품코드'].toString().trim() !== '' && 
            Number(row['입고대기수량']) > 0 && 
            row['표시날짜'] && row['표시날짜'].toString().trim() !== '' &&
            row['상태'] !== '오더취소'  // ★ v3.96: 오더취소 상품은 IncomingData에서 제외
        );

        if (finalJson.length > 0) {
            await updateDatabaseB(finalJson, 'IncomingData', null, true);
            window.hideLoading();
            alert(`✅ 입고 대기 상품 연동 완료!\n(오더리스트 ${orderData.length}건, 사입리스트 ${buyData.length}건)`);
        } else { 
            window.hideLoading(); 
            alert("입고 대기(수량 1개 이상) 상품이 없거나 데이터를 찾지 못했습니다."); 
        }

        // ★ v3.96: 오더취소된 상품 중 선지정된 자리 찾기 → 모달 자동 표시
        if (cancelledCodes.size > 0) {
            const cancelledPreAssigns = originalData.filter(loc => 
                loc.preAssigned === true && 
                loc.preAssignedCode && 
                cancelledCodes.has(loc.preAssignedCode.toString().trim())
            );
            
            if (cancelledPreAssigns.length > 0) {
                window.showCancelledPreAssignModal(cancelledPreAssigns);
            }
        }
    } catch (error) { 
        window.hideLoading(); 
        alert(`🚨 연결 실패!\n데이터를 가져오지 못했습니다.\n(${error.message})`); 
        console.error("데이터 동기화 실패:", error);
    }
};

// ★ v3.96: 오더취소 선지정 모달 표시
window.showCancelledPreAssignModal = function(items) {
    if (!items || items.length === 0) return;
    
    // 전역 변수로 보관 (해제 함수에서 참조)
    window._cancelledPreAssignItems = items;
    
    const tbody = document.getElementById('cancelled-preassign-tbody');
    if (!tbody) return;
    
    let html = '';
    items.forEach((loc, idx) => {
        const rowBg = idx % 2 === 0 ? '#ffffff' : '#fff5f5';
        const code = loc.preAssignedCode || '';
        const name = loc.preAssignedName || '';
        const option = loc.option || '';
        const source = loc.preAssignedSource || '-';
        
        html += `
            <tr style="background:${rowBg};">
                <td style="font-weight:bold; color:#d32f2f;">${idx + 1}</td>
                <td style="font-weight:bold; color:#1a237e; font-size:14px;">${loc.id}</td>
                <td style="font-weight:bold; color:#1a237e;">${code}</td>
                <td style="text-align:left; font-size:13px;">${name}</td>
                <td style="font-size:12px;">${option}</td>
                <td style="font-size:11px; color:#666;">${source}</td>
                <td style="background:#ffebee;">
                    <button onclick="window.releasePreAssign('${loc.id}')" style="padding:5px 10px; background:#d32f2f; color:white; border:none; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">🗑️ 해제</button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    document.getElementById('cancelled-preassign-modal').style.display = 'flex';
};

// ★ v3.96: 개별 선지정 해제
window.releasePreAssign = async function(locId) {
    if (!locId) return;
    if (!confirm(`[${locId}] 자리의 선지정을 해제하시겠습니까?`)) return;
    
    try {
        const zoneDocId = getZoneDocId(locId);
        await setDoc(doc(db, LOC_COLLECTION, zoneDocId), {
            [locId]: {
                preAssigned: false,
                preAssignedCode: '',
                preAssignedName: '',
                preAssignedQty: '',
                preAssignedAt: 0,
                codeTag: '',
                codeTagAt: 0,
                code: '',
                name: '',
                option: '',
                stock: '0',
                updatedAt: new Date()
            }
        }, { merge: true });
        
        showToast(`[${locId}] 선지정 해제 완료`);
        
        // 모달의 해당 행 제거
        if (window._cancelledPreAssignItems) {
            window._cancelledPreAssignItems = window._cancelledPreAssignItems.filter(item => item.id !== locId);
            
            // 모두 해제됐으면 모달 닫기
            if (window._cancelledPreAssignItems.length === 0) {
                document.getElementById('cancelled-preassign-modal').style.display = 'none';
                showToast(`✅ 모든 취소된 선지정 자리가 해제되었습니다.`);
            } else {
                // 남은 항목으로 모달 다시 그리기
                window.showCancelledPreAssignModal(window._cancelledPreAssignItems);
            }
        }
    } catch (e) {
        console.error("선지정 해제 오류:", e);
        alert("선지정 해제 중 오류가 발생했습니다.");
    }
};

// ★ v3.96: 일괄 선지정 해제
window.releaseAllCancelledPreAssigns = async function() {
    const items = window._cancelledPreAssignItems || [];
    if (items.length === 0) return;
    if (!confirm(`총 ${items.length}건의 선지정을 모두 해제하시겠습니까?\n\n해제된 자리는 다시 빈 자리로 돌아갑니다.`)) return;
    
    window.showLoading(`${items.length}건의 선지정을 일괄 해제 중...`);
    
    try {
        let batch = writeBatch(db);
        let batchCount = 0;
        
        for (const loc of items) {
            const zoneDocId = getZoneDocId(loc.id);
            batch.set(doc(db, LOC_COLLECTION, zoneDocId), {
                [loc.id]: {
                    preAssigned: false,
                    preAssignedCode: '',
                    preAssignedName: '',
                    preAssignedQty: '',
                    preAssignedAt: 0,
                    codeTag: '',
                    codeTagAt: 0,
                    code: '',
                    name: '',
                    option: '',
                    stock: '0',
                    updatedAt: new Date()
                }
            }, { merge: true });
            batchCount++;
            
            // 400개마다 커밋
            if (batchCount >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                batchCount = 0;
            }
        }
        
        if (batchCount > 0) await batch.commit();
        
        window.hideLoading();
        document.getElementById('cancelled-preassign-modal').style.display = 'none';
        window._cancelledPreAssignItems = [];
        alert(`✅ 총 ${items.length}건의 선지정이 일괄 해제되었습니다.`);
    } catch (e) {
        window.hideLoading();
        console.error("일괄 해제 오류:", e);
        alert("일괄 해제 중 오류가 발생했습니다.");
    }
};

window.saveCapacity2F = async function() {
    const input = document.getElementById('input-cap-2f');
    if (!input) return;
    const newVal = parseInt(input.value.replace(/,/g, ''), 10);
    if (isNaN(newVal) || newVal <= 0) return alert("올바른 수량을 입력해주세요.");
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { capacity2F: newVal }, { merge: true });
        window.capacity2F = newVal;
        window.calculateAndRenderUsage();
        alert(`2층 기준 수량이 ${newVal.toLocaleString()}장으로 변경되었습니다.`);
    } catch(e) { console.error(e); alert("오류가 발생했습니다."); }
};

window.switchUsageTab = function(tab) { window.currentUsageTab = tab; window.calculateAndRenderUsage(); };

// 대시보드 KPI 카드 → 데이터 리스트 뷰로 전환 + 해당 상태 필터 적용 (작업 가능 화면으로 바로 연결)
window.__dashGoToList = function(state) {
    filters = { loc: [], code: [], stock: [], stock2f: [], dong: [], pos: [], reserved: [], preassigned: [] };
    if (state === 'used') filters.code = ['not-empty'];
    else if (state === 'empty') filters.code = ['empty'];
    else if (state === 'reserved') filters.reserved = ['only'];
    else if (state === 'preassigned') filters.preassigned = ['only'];
    setupFilterPopups();
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    // 3개 뷰 중 '데이터 리스트'로 전환 (대시보드/도면 숨김 + 탭 활성화)
    const vList = document.getElementById('view-list');
    const vMap = document.getElementById('view-map');
    const vDash = document.getElementById('view-locdash');
    if (vList) vList.style.display = 'block';
    if (vMap) vMap.style.display = 'none';
    if (vDash) vDash.style.display = 'none';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-btn-list')?.classList.add('active');
    if (typeof window.showFilterResetBtn === 'function') window.showFilterResetBtn();
    if (vList && vList.scrollIntoView) vList.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.applyUsageFilter = function(zone, state) {
    // ★ v3.57: 모든 필터 배열 초기화
    filters = { loc: [], code: [], stock: [], stock2f: [], dong: [], pos: [], reserved: [], preassigned: [] };
    if (zone !== 'all') filters.loc = [zone];
    if (state === 'used') filters.code = ['not-empty'];
    else if (state === 'empty') filters.code = ['empty'];
    else if (state === 'reserved') filters.reserved = ['only'];
    else if (state === 'preassigned') filters.preassigned = ['only'];
    setupFilterPopups();
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    document.getElementById('view-list').style.display = 'block';
    document.getElementById('view-map').style.display = 'none';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.tab-btn')?.classList.add('active');
    window.showFilterResetBtn();
};

window.calculateAndRenderUsage = function() {
    const popup = document.getElementById('usage-popup');
    if (!popup) return;
    let html = `<div style="display:flex; gap:10px; margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;"><button onclick="switchUsageTab('3F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '3F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '3F' ? 'white' : '#555'}">3층 로케이션</button><button onclick="switchUsageTab('2F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '2F' ? 'var(--primary)' : '#eee'}; color:${window.currentUsageTab === '2F' ? 'white' : '#555'}">2층 창고재고</button></div>`;

    if (window.currentUsageTab === '3F') {
        const locations = originalData.filter(d => d.id.charAt(0).toUpperCase() !== 'K');
        let total = locations.length;
        if (total === 0) { popup.innerHTML = html + '<div style="padding: 10px;">데이터가 없습니다.</div>'; return; }
        
        let used = 0; 
        let zoneStats = {};
        let dongStats = {};
        let posStats = {};
        let todayReservedCount = 0;
        let preAssignedCount = 0; 
        
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        locations.forEach(loc => {
            const isUsed = (loc.code && loc.code.trim() !== '' && loc.code !== loc.id) || (loc.name && loc.name.trim() !== '');
            if (isUsed) used++;
            if (loc.codeTag === '당일지정') todayReservedCount++;
            if (loc.codeTag === '선지정') preAssignedCount++;
            
            const zone = loc.id.charAt(0).toUpperCase();
            if (!zoneStats[zone]) { zoneStats[zone] = { total: 0, used: 0 }; }
            zoneStats[zone].total++;
            if (isUsed) zoneStats[zone].used++;
            
            const dong = (loc.dong || '').toString().trim();
            if (dong) {
                if (!dongStats[dong]) dongStats[dong] = { total: 0, used: 0 };
                dongStats[dong].total++;
                if (isUsed) dongStats[dong].used++;
            }
            
            const pos = (loc.pos || '').toString().trim();
            if (pos) {
                if (!posStats[pos]) posStats[pos] = { total: 0, used: 0 };
                posStats[pos].total++;
                if (isUsed) posStats[pos].used++;
            }
        });

        const usageRate = ((used / total) * 100).toFixed(1);
        
        html += `
            <div style="display:flex; justify-content: space-around; background: #eef1ff; padding: 10px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #c5cae9;">
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#555; font-weight:bold;">당일지정수량<span class="info-tip" data-tip-key="usage-today-reserved">i<span class="info-tip-content">📌 <b>오늘 작업 중 예약된 자리</b><br>로케이션 셀을 클릭하면 현재 작업자가 예약(복사+잠금)한 상태가 됩니다.<br><br>자정에 자동으로 초기화됩니다.</span></span></div>
                    <div style="font-size:18px; color:var(--primary); font-weight:900;">${todayReservedCount}</div>
                </div>
                <div style="width:1px; background:#ccc;"></div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#555; font-weight:bold;">선지정수량<span class="info-tip" data-tip-key="usage-pre-assigned">i<span class="info-tip-content">📦 <b>입고 전에 미리 찜해둔 자리</b><br>입고대기 사이드바에서 상품을 클릭하고 빈 자리를 지정하면 선지정됩니다.<br><br>로케이션 변경 추천에서 보호(제외)되며, 자정에 초기화되지 않습니다.</span></span></div>
                    <div style="font-size:18px; color:#e65100; font-weight:900;">${preAssignedCount}</div>
                </div>
            </div>
            <div style="font-size:16px; font-weight:bold; margin-bottom:5px; color:var(--primary); text-align:center;">📊 3층 전체 사용률: ${usageRate}%</div>
            <div style="font-size:12px; color:#333; text-align:center;">전체 ${total}칸 중 <span style="color:var(--primary); font-weight:bold;">${used}칸 사용</span> / <span style="color:#ff5252; font-weight:bold;">${total - used}칸 빈칸</span></div>
            <div style="text-align:center; margin-top:10px;">
                <span onclick="toggleUsageDetails()" id="usage-details-btn" style="color:var(--primary); font-size:13px; text-decoration:underline; cursor:pointer; font-weight:bold;">자세히보기 ▼</span>
            </div>
        `;
        
        let detailHtml = `<div id="usage-details-content" style="display:none; margin-top:15px; border-top:1px solid #eee; padding-top:15px;">`;
        detailHtml += `<div style="font-size:11px; color:#888; text-align:center; margin-bottom:10px;">※ 숫자를 클릭하면 리스트에 해당 내용만 보입니다.</div>`;
        
        detailHtml += `<div onclick="document.getElementById('sec-zone-detail').style.display = document.getElementById('sec-zone-detail').style.display==='none'?'block':'none'; this.querySelector('.toggle-icon').textContent = document.getElementById('sec-zone-detail').style.display==='none'?'▶':'▼';" style="font-size:13px; font-weight:bold; margin-bottom:5px; color:var(--primary); cursor:pointer; user-select:none;"><span class="toggle-icon">▶</span> 구역별 사용률</div>`;
        detailHtml += `<div id="sec-zone-detail" style="display:none;">`;
        detailHtml += `<table class="usage-table" style="width:100%; margin-bottom:15px;"><thead><tr><th>구역명</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr></thead><tbody>`;
        const zones = Object.keys(zoneStats).sort((a,b) => (a==='★'?-1:(b==='★'?1:a.localeCompare(b))));
        zones.forEach(z => {
            const zTotal = zoneStats[z].total; const zUsed = zoneStats[z].used; const zEmpty = zTotal - zUsed; const zRate = ((zUsed / zTotal) * 100).toFixed(1);
            detailHtml += `<tr><td><strong>${z}</strong> 구역</td><td>${zTotal}</td><td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'used')">${zUsed}</td><td style="color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${z}', 'empty')">${zEmpty}</td><td>${zRate}%</td></tr>`;
        });
        detailHtml += `</tbody></table></div>`;

        detailHtml += `<div onclick="document.getElementById('sec-dong-detail').style.display = document.getElementById('sec-dong-detail').style.display==='none'?'block':'none'; this.querySelector('.toggle-icon').textContent = document.getElementById('sec-dong-detail').style.display==='none'?'▶':'▼';" style="font-size:13px; font-weight:bold; margin-bottom:5px; color:var(--primary); cursor:pointer; user-select:none;"><span class="toggle-icon">▶</span> 동별 사용률</div>`;
        detailHtml += `<div id="sec-dong-detail" style="display:none;">`;
        detailHtml += `<table class="usage-table" style="width:100%; margin-bottom:15px;"><thead><tr><th>동</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr></thead><tbody>`;
        const dongs = Object.keys(dongStats).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
        dongs.forEach(d => {
            const dTotal = dongStats[d].total; const dUsed = dongStats[d].used; const dEmpty = dTotal - dUsed; const dRate = ((dUsed / dTotal) * 100).toFixed(1);
            detailHtml += `<tr><td><strong>${d}</strong> 동</td><td>${dTotal}</td><td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'used'); filters.dong=['${d}']; setupFilterPopups(); applyFiltersAndSort();">${dUsed}</td><td style="color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'empty'); filters.dong=['${d}']; setupFilterPopups(); applyFiltersAndSort();">${dEmpty}</td><td>${dRate}%</td></tr>`;
        });
        detailHtml += `</tbody></table></div>`;

        detailHtml += `<div onclick="document.getElementById('sec-pos-detail').style.display = document.getElementById('sec-pos-detail').style.display==='none'?'block':'none'; this.querySelector('.toggle-icon').textContent = document.getElementById('sec-pos-detail').style.display==='none'?'▶':'▼';" style="font-size:13px; font-weight:bold; margin-bottom:5px; color:var(--primary); cursor:pointer; user-select:none;"><span class="toggle-icon">▶</span> 위치별 사용률</div>`;
        detailHtml += `<div id="sec-pos-detail" style="display:none;">`;
        detailHtml += `<table class="usage-table" style="width:100%;"><thead><tr><th>위치</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr></thead><tbody>`;
        const poses = Object.keys(posStats).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
        poses.forEach(p => {
            const pTotal = posStats[p].total; const pUsed = posStats[p].used; const pEmpty = pTotal - pUsed; const pRate = ((pUsed / pTotal) * 100).toFixed(1);
            detailHtml += `<tr><td><strong>${p}</strong> 위치</td><td>${pTotal}</td><td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'used'); filters.pos=['${p}']; setupFilterPopups(); applyFiltersAndSort();">${pUsed}</td><td style="color:#ff5252; cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'empty'); filters.pos=['${p}']; setupFilterPopups(); applyFiltersAndSort();">${pEmpty}</td><td>${pRate}%</td></tr>`;
        });
        detailHtml += `</tbody></table></div>`;
        detailHtml += `</div>`; 

        html += detailHtml;

    } else {
        let sum2F = 0; originalData.forEach(loc => { sum2F += Number(loc.stock2f || 0); });
        let rate2F = ((sum2F / window.capacity2F) * 100).toFixed(1);
        let remaining2F = window.capacity2F - sum2F;
        
        // ★ 만재 예측: 현재 적재수량 + 도착예상일별 입고수량 누적
        let incomingByDate = {}; // {날짜: 총수량}
        let totalIncoming = 0;
        for (let code in incomingData) {
            const item = incomingData[code];
            // 도착예상일 우선, 없으면 표시날짜 폴백
            const rawDate = item['도착예상일'] || item['표시날짜'] || '';
            const date = rawDate.toString().trim();
            const qty = Number(item['입고대기수량'] || 0);
            if (date && qty > 0) {
                incomingByDate[date] = (incomingByDate[date] || 0) + qty;
                totalIncoming += qty;
            }
        }
        const sortedDates = Object.keys(incomingByDate).sort();
        
        let predictionHtml = '';
        let fullDate = '';
        let cumTotal = sum2F; // 현재 적재수량에서 시작
        
        for (const date of sortedDates) {
            cumTotal += incomingByDate[date];
            if (cumTotal >= window.capacity2F) {
                fullDate = date;
                break;
            }
        }
        
        if (sortedDates.length === 0) {
            predictionHtml = `<tr><th style="background:#eceff1;">📅 만재 예측<span class="info-tip" data-tip-key="usage-full-prediction">i<span class="info-tip-content">📊 <b>만재 예측 계산 방식</b><br>현재 2층 적재수량에 입고대기 중인 수량을 <b>도착예상일 순</b>으로 누적 더해서, 총 적재가능수량에 도달하는 날짜를 계산합니다.<br><br>입고예정 전량을 더해도 여유가 있으면, 일평균 입고량을 기준으로 만재 예상일을 추정합니다.</span></span></th><td style="color:#888; text-align:right;">입고대기 데이터 없음 (시트 동기화 필요)</td></tr>`;
        } else if (sum2F >= window.capacity2F) {
            predictionHtml = `<tr><th style="background:#ffebee;">⚠️ 만재 예측<span class="info-tip" data-tip-key="usage-full-prediction">i<span class="info-tip-content">📊 <b>만재 예측 계산 방식</b><br>현재 2층 적재수량에 입고대기 중인 수량을 <b>도착예상일 순</b>으로 누적 더해서, 총 적재가능수량에 도달하는 날짜를 계산합니다.<br><br>입고예정 전량을 더해도 여유가 있으면, 일평균 입고량을 기준으로 만재 예상일을 추정합니다.</span></span></th><td style="font-weight:bold; color:#d32f2f; text-align:right;">이미 초과 상태입니다! (${(sum2F - window.capacity2F).toLocaleString()}장 초과)</td></tr>`;
        } else if (fullDate) {
            predictionHtml = `<tr><th style="background:#fff3e0;">📅 만재 예측일<span class="info-tip" data-tip-key="usage-full-prediction">i<span class="info-tip-content">📊 <b>만재 예측 계산 방식</b><br>현재 2층 적재수량에 입고대기 중인 수량을 <b>도착예상일 순</b>으로 누적 더해서, 총 적재가능수량에 도달하는 날짜를 계산합니다.<br><br>입고예정 전량을 더해도 여유가 있으면, 일평균 입고량을 기준으로 만재 예상일을 추정합니다.</span></span></th><td style="font-weight:bold; color:#e65100; text-align:right;">${fullDate}<br><span style="font-size:11px; color:#888;">현재 ${sum2F.toLocaleString()}장 + 입고예정 누적 → ${cumTotal.toLocaleString()}장 도달</span></td></tr>`;
        } else {
            const afterAll = sum2F + totalIncoming;
            const remainAfter = window.capacity2F - afterAll;
            
            // 일평균 입고량 기반 만재 예측 날짜 계산
            const firstDate = sortedDates[0];
            const lastDate = sortedDates[sortedDates.length - 1];
            const d1 = new Date(firstDate);
            const d2 = new Date(lastDate);
            const daySpan = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
            const dailyAvg = totalIncoming / daySpan;
            
            let estimatedDate = '';
            if (dailyAvg > 0) {
                const extraDays = Math.ceil(remainAfter / dailyAvg);
                const estDate = new Date(d2);
                estDate.setDate(estDate.getDate() + extraDays);
                estimatedDate = estDate.toISOString().slice(0, 10);
            }
            
            if (estimatedDate && dailyAvg > 0) {
                predictionHtml = `<tr><th style="background:#e8f5e9;">📅 만재 예측일<span class="info-tip" data-tip-key="usage-full-prediction">i<span class="info-tip-content">📊 <b>만재 예측 계산 방식</b><br>현재 2층 적재수량에 입고대기 중인 수량을 <b>도착예상일 순</b>으로 누적 더해서, 총 적재가능수량에 도달하는 날짜를 계산합니다.<br><br>입고예정 전량을 더해도 여유가 있으면, 일평균 입고량을 기준으로 만재 예상일을 추정합니다.</span></span></th><td style="font-weight:bold; color:#2e7d32; text-align:right;">${estimatedDate} (추정)<br><span style="font-size:11px; color:#888;">일평균 입고 ${Math.round(dailyAvg).toLocaleString()}장 기준, 입고예정 후 여유 ${remainAfter.toLocaleString()}장</span></td></tr>`;
            } else {
                predictionHtml = `<tr><th style="background:#e8f5e9;">📅 만재 예측<span class="info-tip" data-tip-key="usage-full-prediction">i<span class="info-tip-content">📊 <b>만재 예측 계산 방식</b><br>현재 2층 적재수량에 입고대기 중인 수량을 <b>도착예상일 순</b>으로 누적 더해서, 총 적재가능수량에 도달하는 날짜를 계산합니다.<br><br>입고예정 전량을 더해도 여유가 있으면, 일평균 입고량을 기준으로 만재 예상일을 추정합니다.</span></span></th><td style="font-weight:bold; color:#2e7d32; text-align:right;">입고예정 전량 입고 후에도 여유 ${remainAfter.toLocaleString()}장<br><span style="font-size:11px; color:#888;">예상 적재: ${afterAll.toLocaleString()} / ${window.capacity2F.toLocaleString()}장</span></td></tr>`;
            }
        }
        
        html += `<div style="font-size:15px; font-weight:bold; margin-bottom:15px; color:var(--primary); text-align:center;">🏢 2층 전체 창고 사용률: ${rate2F}%</div><table class="usage-table" style="width:100%;"><tr><th style="background:#eef1ff; width: 40%;">총 적재가능수량</th><td style="text-align: right;"><input type="number" id="input-cap-2f" value="${window.capacity2F}" style="width:80px; padding:3px; text-align:right; font-size:13px; font-weight:bold;"> 장 <button onclick="saveCapacity2F()" style="padding:4px 8px; margin-left:5px; font-size:11px; background:var(--primary); color:white; border:none; border-radius:3px; cursor:pointer;">기준변경</button></td></tr><tr><th style="background:#eef1ff;">현재 적재수량</th><td style="font-weight:bold; color:var(--primary); text-align: right;">${sum2F.toLocaleString()} 장</td></tr><tr><th style="background:#eef1ff;">남은 수량</th><td style="font-weight:bold; color:#ff5252; text-align: right;">${remaining2F.toLocaleString()} 장</td></tr>${predictionHtml}</table>`;
    }
    popup.innerHTML = html;
};

window.toggleUsagePopup = function(e) {
    e.stopPropagation();
    const pop = document.getElementById('usage-popup');
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    if (pop.style.display !== 'block') { pop.style.display = 'block'; window.calculateAndRenderUsage(); }
};

function getSortButtonsHtml(key) {
    const isAsc = sortConfig.key === key && sortConfig.direction === 'asc';
    const isDesc = sortConfig.key === key && sortConfig.direction === 'desc';
    return `<div class="filter-option ${isAsc ? 'selected' : ''}" onclick="executeSort('${key}', 'asc')">${isAsc ? '✔️ ' : ''}⬆️ 오름차순 정렬</div><div class="filter-option ${isDesc ? 'selected' : ''}" onclick="executeSort('${key}', 'desc')">${isDesc ? '✔️ ' : ''}⬇️ 내림차순 정렬</div><div class="filter-divider"></div>`;
}

function updateLocPopupUI() {
    const locPop = document.getElementById('pop-id');
    if (!locPop) return;
    let prefixSet = new Set(originalData.map(d => d.id.charAt(0))); prefixSet.add('★');
    const prefixes = [...prefixSet].sort((a, b) => (a === '★' ? -1 : (b === '★' ? 1 : a.localeCompare(b))));
    let locHtml = window.getFilterSearchHtml('pop-id') + getSortButtonsHtml('id');
    const isAllSelected = filters.loc.length === 0;
    locHtml += `<div class="filter-option ${isAllSelected ? 'selected' : ''}" onclick="toggleLocFilter('all')">${isAllSelected ? '✔️ ' : ''}🔄 전체선택/해제</div>`;
    prefixes.forEach(p => { const isSelected = filters.loc.includes(p); locHtml += `<div class="filter-option ${isSelected ? 'selected' : ''}" onclick="toggleLocFilter('${p}')">${isSelected ? '✔️ ' : ''}${p} 구역</div>`; });
    locPop.innerHTML = locHtml;
}

function updateFilterButtonStates() {
    const btnId = document.getElementById('btn-filter-id');
    if (btnId) {
        if (filters.loc.length === 0) btnId.classList.remove('active');
        else btnId.classList.add('active');
    }
    
    ['code', 'dong', 'pos', 'stock', 'stock2f'].forEach(type => {
        const btn = document.getElementById('btn-filter-' + type);
        if (btn) {
            if (type === 'code') {
                const active = (filters.code && filters.code.length > 0) || 
                               (filters.reserved && filters.reserved.includes('only')) || 
                               (filters.preassigned && filters.preassigned.includes('only'));
                if (active) btn.classList.add('active'); else btn.classList.remove('active');
            } else {
                const arr = filters[type];
                if (!Array.isArray(arr) || arr.length === 0) btn.classList.remove('active');
                else btn.classList.add('active');
            }
        }
    });

    // 커스텀 헤더 필터 버튼 활성 상태
    window.visibleColumns.forEach(col => {
        if (!col.startsWith('cus_')) return;
        const btn = document.getElementById('btn-filter-' + col);
        if (btn) {
            const arr = filters[col];
            if (!Array.isArray(arr) || arr.length === 0) btn.classList.remove('active');
            else btn.classList.add('active');
        }
    });
}

function setupFilterPopups() {
    const codePop = document.getElementById('pop-code'); const namePop = document.getElementById('pop-name');
    const optionPop = document.getElementById('pop-option'); const stockPop = document.getElementById('pop-stock');
    const dongPop = document.getElementById('pop-dong'); const posPop = document.getElementById('pop-pos');
    
    updateLocPopupUI();
    
    const isReservedOnly = filters.reserved.includes('only');
    const isPreassignedOnly = filters.preassigned.includes('only');
    const isDesignatedOnly = filters.code.includes('designated-only'); // 신규
    const isEmpty = filters.code.includes('empty');
    const isNotEmpty = filters.code.includes('not-empty');
    const codeAll = filters.code.length === 0 && !isReservedOnly && !isPreassignedOnly && !isDesignatedOnly;
    let codeHtml = window.getFilterSearchHtml('pop-code') + getSortButtonsHtml('code') + 
      `<div class="filter-option ${codeAll ? 'selected' : ''}" onclick="setCodeTagFilter('all')">${codeAll ? '✔️ ' : ''}🔄 전체선택/해제</div>` +
        `<div class="filter-option ${isEmpty ? 'selected' : ''}" onclick="setCodeTagFilter('empty')">${isEmpty ? '✔️ ' : ''}빈칸</div>` +
        `<div class="filter-option ${isNotEmpty ? 'selected' : ''}" onclick="setCodeTagFilter('not-empty')">${isNotEmpty ? '✔️ ' : ''}내용있음</div>` +
        `<div class="filter-divider"></div>` +
        `<div class="filter-option ${isDesignatedOnly ? 'selected' : ''}" onclick="setCodeTagFilter('designated-only')">${isDesignatedOnly ? '✔️ ' : ''}📝 지정값만 보기</div>` + // 추가
        `<div class="filter-option ${isReservedOnly ? 'selected' : ''}" onclick="setCodeTagFilter('당일지정')">${isReservedOnly ? '✔️ ' : ''}📌 당일지정</div>` +
        `<div class="filter-option ${isPreassignedOnly ? 'selected' : ''}" onclick="setCodeTagFilter('선지정')">${isPreassignedOnly ? '✔️ ' : ''}📦 선지정</div>`;
    if(codePop) codePop.innerHTML = codeHtml;
    if(namePop) namePop.innerHTML = window.getFilterSearchHtml('pop-name') + getSortButtonsHtml('name');
    if(optionPop) optionPop.innerHTML = window.getFilterSearchHtml('pop-option') + getSortButtonsHtml('option');
    const dongs = [...new Set(originalData.map(d => (d.dong || '').toString()))].filter(Boolean).sort();
    const dongAll = filters.dong.length === 0;
    let dongHtml = window.getFilterSearchHtml('pop-dong') + getSortButtonsHtml('dong') + `<div class="filter-option ${dongAll ? 'selected' : ''}" onclick="setFilter('dong', 'all')">${dongAll ? '✔️ ' : ''}🔄 전체선택/해제</div>`;
    dongs.forEach(d => { 
        const sel = filters.dong.includes(d);
        dongHtml += `<div class="filter-option ${sel ? 'selected' : ''}" onclick="setFilter('dong', '${d}')">${sel ? '✔️ ' : ''}${d}</div>`; 
    });
    if(dongPop) dongPop.innerHTML = dongHtml;
    const poses = [...new Set(originalData.map(d => (d.pos || '').toString()))].filter(Boolean).sort();
    const posAll = filters.pos.length === 0;
    let posHtml = window.getFilterSearchHtml('pop-pos') + getSortButtonsHtml('pos') + `<div class="filter-option ${posAll ? 'selected' : ''}" onclick="setFilter('pos', 'all')">${posAll ? '✔️ ' : ''}🔄 전체선택/해제</div>`;
    poses.forEach(p => { 
        const sel = filters.pos.includes(p);
        posHtml += `<div class="filter-option ${sel ? 'selected' : ''}" onclick="setFilter('pos', '${p}')">${sel ? '✔️ ' : ''}${p}</div>`; 
    });
    if(posPop) posPop.innerHTML = posHtml;
    const stocks = [...new Set(originalData.map(d => (d.stock || '0').toString()))].sort((a, b) => Number(a) - Number(b));
    const stockAll = filters.stock.length === 0;
    let stockHtml = window.getFilterSearchHtml('pop-stock') + getSortButtonsHtml('stock') + `<div class="filter-option ${stockAll ? 'selected' : ''}" onclick="setFilter('stock', 'all')">${stockAll ? '✔️ ' : ''}🔄 전체선택/해제</div>`;
    stocks.forEach(s => { 
        const sel = filters.stock.includes(s);
        stockHtml += `<div class="filter-option ${sel ? 'selected' : ''}" onclick="setFilter('stock', '${s}')">${sel ? '✔️ ' : ''}${s}</div>`; 
    });
    if(stockPop) stockPop.innerHTML = stockHtml;
   const stock2fPop = document.getElementById('pop-stock2f');
    const stocks2f = [...new Set(originalData.map(d => (d.stock2f || '0').toString()))].sort((a, b) => Number(a) - Number(b));
    const stock2fAll = !filters.stock2f || filters.stock2f.length === 0;
    let stock2fHtml = window.getFilterSearchHtml('pop-stock2f') + getSortButtonsHtml('stock2f') + `<div class="filter-option ${stock2fAll ? 'selected' : ''}" onclick="setFilter('stock2f', 'all')">${stock2fAll ? '✔️ ' : ''}🔄 전체선택/해제</div>`;
    stocks2f.forEach(s => { 
        const sel = filters.stock2f && filters.stock2f.includes(s);
        stock2fHtml += `<div class="filter-option ${sel ? 'selected' : ''}" onclick="setFilter('stock2f', '${s}')">${sel ? '✔️ ' : ''}${s}</div>`; 
    });
    if(stock2fPop) stock2fPop.innerHTML = stock2fHtml;

    updateFilterButtonStates();

    // 커스텀 헤더 필터 팝업 생성
    window.visibleColumns.forEach(col => {
        if (!col.startsWith('cus_')) return;
        const pop = document.getElementById(`pop-${col}`);
        if (!pop) return;
        const key = col.replace('cus_', '');
        if (!Array.isArray(filters[col])) filters[col] = [];
        const arr = filters[col];
        const curAll = arr.length === 0;

        // ★ 옵션추가항목1: 빈칸/내용있음 전용 필터
        if (key === '옵션추가항목1') {
            const isE = arr.includes('empty');
            const isN = arr.includes('not-empty');
            let html = getSortButtonsHtml(col) +
                `<div class="filter-option ${curAll ? 'selected' : ''}" onclick="setFilter('${col}', 'all')">${curAll ? '✔️ ' : ''}🔄 전체선택/해제</div>` +
                `<div class="filter-option ${isE ? 'selected' : ''}" onclick="setFilter('${col}', 'empty')">${isE ? '✔️ ' : ''}빈칸</div>` +
                `<div class="filter-option ${isN ? 'selected' : ''}" onclick="setFilter('${col}', 'not-empty')">${isN ? '✔️ ' : ''}내용있음</div>`;
            pop.innerHTML = html;
            return;
        }

        // ★ 값 수집
        const vals = [...new Set(originalData.map(d => {
            // ★ v3.57fix: 입고대기는 incomingTotalByCode 기준으로 필터값 수집
            if (key === '입고대기') {
                const code = (d.code && d.code !== d.id) ? d.code : '';
                const v = code && incomingTotalByCode[code] ? incomingTotalByCode[code].toString() : '';
                return v;
            }
            return (d.rawData && d.rawData[key]) ? d.rawData[key].toString().trim() : '';
        }))].filter(Boolean);

        // ★ v3.59: 날짜 필터 자동 감지 (70% 이상 YYYY-MM-DD 형식이면 날짜 필터)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const dateValsCount = vals.filter(v => dateRegex.test(v)).length;
        const isDateFilter = vals.length > 0 && (dateValsCount / vals.length) >= 0.7;

        if (isDateFilter) {
            // 유효한 날짜만 필터링
            const dateVals = vals.filter(v => dateRegex.test(v));
            // 빈칸 여부 (rawData에서 빈 값인 행이 있는지 체크)
            const hasEmpty = originalData.some(d => {
                const v = (d.rawData && d.rawData[key]) ? d.rawData[key].toString().trim() : '';
                return v === '';
            });
            
            // 년/월별로 그룹핑
            const byYear = {}; // { '2026': { '04': ['2026-04-15','2026-04-16'], '03': [...] }, ... }
            dateVals.forEach(d => {
                const [y, m] = d.split('-');
                if (!byYear[y]) byYear[y] = {};
                if (!byYear[y][m]) byYear[y][m] = [];
                byYear[y][m].push(d);
            });
            
            // 년도 최신순, 월 최신순, 일 최신순 정렬
            const years = Object.keys(byYear).sort().reverse();
            years.forEach(y => {
                const months = Object.keys(byYear[y]).sort().reverse();
                const sortedMonths = {};
                months.forEach(m => {
                    sortedMonths[m] = byYear[y][m].sort().reverse();
                });
                byYear[y] = sortedMonths;
            });
            
            // 정렬 + 전체선택/해제
            let html = window.getFilterSearchHtml(`pop-${col}`) + getSortButtonsHtml(col) +
                `<div class="filter-option ${curAll ? 'selected' : ''}" onclick="setFilter('${col}', 'all')">${curAll ? '✔️ ' : ''}🔄 전체선택/해제</div>`;
            
            // 빈칸 옵션 (있을 경우만)
            if (hasEmpty) {
                const isE = arr.includes('empty');
                html += `<div class="filter-option ${isE ? 'selected' : ''}" onclick="setFilter('${col}', 'empty')">${isE ? '✔️ ' : ''}📋 빈칸</div>`;
            }
            
            // 년도 계층 구조
            years.forEach(y => {
                const yearDates = [];
                Object.keys(byYear[y]).forEach(m => { yearDates.push(...byYear[y][m]); });
                const yearAllSelected = yearDates.every(d => arr.includes(d));
                const yearPartialSelected = !yearAllSelected && yearDates.some(d => arr.includes(d));
                const yearCheck = yearAllSelected ? '✔️' : (yearPartialSelected ? '🟦' : '☐');
                
                html += `<div class="date-node date-year" data-col="${col}" data-year="${y}">
                    <div class="date-row date-year-row">
                        <span class="date-toggle" onclick="event.stopPropagation(); window.toggleDateNode(this);">▶</span>
                        <span class="date-check" onclick="event.stopPropagation(); window.toggleDateGroup('${col}', 'year', '${y}');">${yearCheck}</span>
                        <span class="date-label">${y}</span>
                    </div>
                    <div class="date-children" style="display:none;">`;
                
                // 월 계층
                Object.keys(byYear[y]).forEach(m => {
                    const monthDates = byYear[y][m];
                    const monthAllSelected = monthDates.every(d => arr.includes(d));
                    const monthPartialSelected = !monthAllSelected && monthDates.some(d => arr.includes(d));
                    const monthCheck = monthAllSelected ? '✔️' : (monthPartialSelected ? '🟦' : '☐');
                    
                    html += `<div class="date-node date-month" data-col="${col}" data-year="${y}" data-month="${m}">
                        <div class="date-row date-month-row">
                            <span class="date-toggle" onclick="event.stopPropagation(); window.toggleDateNode(this);">▶</span>
                            <span class="date-check" onclick="event.stopPropagation(); window.toggleDateGroup('${col}', 'month', '${y}-${m}');">${monthCheck}</span>
                            <span class="date-label">${m}월</span>
                        </div>
                        <div class="date-children" style="display:none;">`;
                    
                    // 일 체크박스
                    monthDates.forEach(d => {
                        const sel = arr.includes(d);
                        const dayCheck = sel ? '✔️' : '☐';
                        html += `<div class="date-row date-day-row ${sel ? 'selected' : ''}" onclick="event.stopPropagation(); setFilter('${col}', '${d}');">
                            <span class="date-check">${dayCheck}</span>
                            <span class="date-label">${d}</span>
                        </div>`;
                    });
                    
                    html += `</div></div>`;
                });
                
                html += `</div></div>`;
            });
            
            pop.innerHTML = html;
            return;
        }

        // ★ 일반 필터 (기존 로직)
        const normalVals = vals.sort((a, b) => {
            // 숫자 정렬 (문자열 "1", "10", "100" → 숫자 순)
            const na = Number(a), nb = Number(b);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a.localeCompare(b);
        });

        let html = window.getFilterSearchHtml(`pop-${col}`) + getSortButtonsHtml(col) +
            `<div class="filter-option ${curAll ? 'selected' : ''}" onclick="setFilter('${col}', 'all')">${curAll ? '✔️ ' : ''}🔄 전체선택/해제</div>`;

        // ★ 입고대기: 빈칸 옵션 추가
        if (key === '입고대기') {
            const isE = arr.includes('empty');
            html += `<div class="filter-option ${isE ? 'selected' : ''}" onclick="setFilter('${col}', 'empty')">${isE ? '✔️ ' : ''}빈칸</div>`;
        }

        normalVals.forEach(v => {
            const escaped = v.replace(/'/g, "\\'");
            const sel = arr.includes(v);
            html += `<div class="filter-option ${sel ? 'selected' : ''}" onclick="setFilter('${col}', '${escaped}')">${sel ? '✔️ ' : ''}${v}</div>`;
        });
        pop.innerHTML = html;
    });
}

window.executeSort = (key, direction) => { sortConfig = { key: key, direction: direction }; setupFilterPopups(); applyFiltersAndSort(); if (typeof window.closeAllPopups === 'function') window.closeAllPopups(); };
window.toggleLocFilter = (val) => { 
    if (val === 'all') filters.loc = []; 
    else { 
        if (filters.loc.includes(val)) filters.loc = filters.loc.filter(v => v !== val); 
        else filters.loc.push(val); 
    } 
    setupFilterPopups(); 
    applyFiltersAndSort();
    window.showFilterResetBtn();
};
// ★ v3.57: 모든 필터 배열 토글 방식
window.setFilter = (type, value) => { 
    if (!Array.isArray(filters[type])) filters[type] = [];
    if (value === 'all') {
        // ★ v3.57fix: 전체선택/해제 토글
        if (filters[type].length > 0) {
            // 선택된 게 있으면 → 전체 해제 (빈 배열 = 전체 표시)
            filters[type] = [];
        } else {
            // 아무것도 선택 안 된 상태면 → 전체 값 수집해서 모두 선택
            const pop = document.getElementById('pop-' + type);
            if (pop) {
                const allVals = [];
                pop.querySelectorAll('.filter-option[onclick]').forEach(opt => {
                    const m = opt.getAttribute('onclick').match(/setFilter\([^,]+,\s*'([^']+)'\)/);
                    if (m && m[1] !== 'all') allVals.push(m[1]);
                });
                filters[type] = allVals;
            }
        }
    } else {
        // 특수값 상호 배제: empty ↔ not-empty 는 하나만 선택
        if (value === 'empty' || value === 'not-empty') {
            const opposite = value === 'empty' ? 'not-empty' : 'empty';
            filters[type] = filters[type].filter(v => v !== opposite);
        }
        // 토글
        if (filters[type].includes(value)) {
            filters[type] = filters[type].filter(v => v !== value);
        } else {
            filters[type].push(value);
        }
    }
    setupFilterPopups(); 
    applyFiltersAndSort(); 
    // ★ 다중 선택 지원을 위해 팝업 자동 닫힘 제거 (사용자가 원할 때 닫음)
    window.showFilterResetBtn();
};

// ★ v3.59: 날짜 계층 필터 - 펼침/접힘 토글
window.toggleDateNode = function(toggleEl) {
    const node = toggleEl.closest('.date-node');
    if (!node) return;
    const children = node.querySelector('.date-children');
    if (!children) return;
    const isOpen = children.style.display === 'block';
    children.style.display = isOpen ? 'none' : 'block';
    toggleEl.textContent = isOpen ? '▶' : '▼';
};

// ★ v3.59: 날짜 그룹(년/월) 단위 토글 선택/해제
window.toggleDateGroup = function(col, level, keyStr) {
    if (!Array.isArray(filters[col])) filters[col] = [];
    
    // 해당 그룹에 속하는 모든 날짜 수집
    const pop = document.getElementById('pop-' + col);
    if (!pop) return;
    
    let targetDates = [];
    if (level === 'year') {
        // 해당 년도의 모든 일자
        const yearNode = pop.querySelector(`.date-year[data-year="${keyStr}"]`);
        if (yearNode) {
            yearNode.querySelectorAll('.date-day-row').forEach(row => {
                const label = row.querySelector('.date-label');
                if (label) targetDates.push(label.textContent.trim());
            });
        }
    } else if (level === 'month') {
        // 'YYYY-MM' 형식
        const [y, m] = keyStr.split('-');
        const monthNode = pop.querySelector(`.date-month[data-year="${y}"][data-month="${m}"]`);
        if (monthNode) {
            monthNode.querySelectorAll('.date-day-row').forEach(row => {
                const label = row.querySelector('.date-label');
                if (label) targetDates.push(label.textContent.trim());
            });
        }
    }
    
    if (targetDates.length === 0) return;
    
    // 전부 선택되어 있으면 → 전부 해제, 아니면 → 전부 선택
    const allSelected = targetDates.every(d => filters[col].includes(d));
    if (allSelected) {
        filters[col] = filters[col].filter(v => !targetDates.includes(v));
    } else {
        targetDates.forEach(d => {
            if (!filters[col].includes(d)) filters[col].push(d);
        });
    }
    
    setupFilterPopups();
    applyFiltersAndSort();
    window.showFilterResetBtn();
};
// ★ v3.60: 필터 검색 기능
// 각 팝업의 검색 쿼 저장 (팝업이 열려있는 동안만 유효)
window._filterSearchQuery = window._filterSearchQuery || {};

// 검색 쿼리 업데이트 및 리스트 재렌더링 트리거
window.updateFilterSearch = function(popId, query) {
    window._filterSearchQuery[popId] = query || '';
    const pop = document.getElementById(popId);
    if (!pop) return;
    
    // 일반 필터: filter-option 표시/숨김
    // 날짜 필터: 계층 구조면 평탄화 토글
    const isDateFilter = !!pop.querySelector('.date-node');
    
    if (isDateFilter) {
        // 날짜 필터: 검색 시 평탄화 모드로 재렌더링
        window.renderDateFilterFlat(popId, query);
    } else {
        // 일반 필터: 옵션 표시/숨김
        const q = (query || '').toLowerCase();
        pop.querySelectorAll('.filter-option').forEach(opt => {
            // 정렬 버튼(⬆️/⬇️)과 전체선택/해제는 항상 표시
            const text = opt.textContent || '';
            if (text.includes('오름차순') || text.includes('내림차순') || text.includes('전체선택/해제')) {
                opt.style.display = '';
                return;
            }
            if (!q) {
                opt.style.display = '';
            } else {
                // ✔️ 앞자리 마크 제외하고 비교
                const cleanText = text.replace(/^✔️\s*/, '').toLowerCase();
                opt.style.display = cleanText.includes(q) ? '' : 'none';
            }
        });
        // 구분선은 항상 표시
        pop.querySelectorAll('.filter-divider').forEach(d => { d.style.display = ''; });
    }

    // ★ 검색창 입력으로 테이블 본문도 해당 컬럼 부분일치 필터링
    const colKey = popId.replace('pop-', '');
    colTextSearch[colKey] = (query || '').trim();
    applyFiltersAndSort();
};

// 날짜 필터 평탄화 렌더링 (검색 모드)
window.renderDateFilterFlat = function(popId, query) {
    const pop = document.getElementById(popId);
    if (!pop) return;
    
    const q = (query || '').toLowerCase().trim();
    
    // 검색어가 없으면 원래 계층 구조 복구 = setupFilterPopups 재호출
    if (!q) {
        setupFilterPopups();
        // 재호출 후 검색창 값도 복원
        const input = pop.querySelector('.filter-search-input');
        if (input) input.value = '';
        return;
    }
    
    // 기존 모든 날짜 수집 (data-label 속성 기반)
    const allDates = [];
    pop.querySelectorAll('.date-day-row .date-label').forEach(label => {
        const d = label.textContent.trim();
        if (d && !allDates.includes(d)) allDates.push(d);
    });
    
    if (allDates.length === 0) return;
    
    // col 추출 (pop-cus_마지막배송일 → cus_마지막배송일)
    const col = popId.replace(/^pop-/, '');
    const arr = Array.isArray(filters[col]) ? filters[col] : [];
    
    // 평탄화 + 필터링
    const matched = allDates.filter(d => d.toLowerCase().includes(q)).sort().reverse();
    
    // 검색창 부분만 남기고 나머지 제거 후 재생성
    const searchWrap = pop.querySelector('.filter-search-wrap');
    const searchHtml = searchWrap ? searchWrap.outerHTML : '';
    
    // 정렬 버튼 + 전체선택/해제 + 검색 결과
    let html = searchHtml + getSortButtonsHtml(col);
    
    if (matched.length === 0) {
        html += `<div class="filter-option" style="color:#999; font-style:italic; cursor:default;">검색 결과 없음</div>`;
    } else {
        matched.forEach(d => {
            const sel = arr.includes(d);
            const dayCheck = sel ? '✔️' : '☐';
            html += `<div class="date-row date-day-row ${sel ? 'selected' : ''}" style="padding-left:15px;" onclick="event.stopPropagation(); setFilter('${col}', '${d}');">
                <span class="date-check">${dayCheck}</span>
                <span class="date-label">${d}</span>
            </div>`;
        });
    }
    
    pop.innerHTML = html;
    
    // 검색창에 포커스 유지
    const newInput = pop.querySelector('.filter-search-input');
    if (newInput) {
        newInput.value = query;
        newInput.focus();
        // 커서를 맨 끝으로
        newInput.setSelectionRange(query.length, query.length);
    }
};

// 검색창 HTML 생성 헬퍼
window.getFilterSearchHtml = function(popId) {
    const curQuery = (window._filterSearchQuery && window._filterSearchQuery[popId]) || '';
    return `<div class="filter-search-wrap" onclick="event.stopPropagation();">
        <input type="text" class="filter-search-input" placeholder="🔍 검색..." value="${curQuery}"
               onkeydown="event.stopPropagation();"
               oninput="event.stopPropagation(); updateFilterSearch('${popId}', this.value);">
        ${curQuery ? `<button type="button" class="filter-search-clear" onclick="event.stopPropagation(); this.previousElementSibling.value=''; updateFilterSearch('${popId}', '');">✕</button>` : ''}
    </div>`;
};

window.setCodeTagFilter = (mode) => {
    // mode: 'all', 'empty', 'not-empty', 'designated-only', '당일지정', '선지정'
    if (mode === 'all') {
        filters.code = []; filters.reserved = []; filters.preassigned = [];
    } else if (mode === 'empty') {
        filters.code = filters.code.filter(v => v !== 'not-empty' && v !== 'designated-only');
        if (filters.code.includes('empty')) filters.code = filters.code.filter(v => v !== 'empty');
        else filters.code.push('empty');
    } else if (mode === 'not-empty') {
        filters.code = filters.code.filter(v => v !== 'empty' && v !== 'designated-only');
        if (filters.code.includes('not-empty')) filters.code = filters.code.filter(v => v !== 'not-empty');
        else filters.code.push('not-empty');
    } else if (mode === 'designated-only') {
        // 지정값만 보기는 empty, not-empty, 당일지정, 선지정과 상호 배제
        filters.code = filters.code.filter(v => v !== 'empty' && v !== 'not-empty');
        filters.reserved = []; filters.preassigned = [];
        if (filters.code.includes('designated-only')) filters.code = filters.code.filter(v => v !== 'designated-only');
        else filters.code.push('designated-only');
    } else if (mode === '당일지정') {
        filters.code = filters.code.filter(v => v !== 'designated-only');
        if (filters.reserved.includes('only')) filters.reserved = [];
        else filters.reserved = ['only'];
    } else if (mode === '선지정') {
        filters.code = filters.code.filter(v => v !== 'designated-only');
        if (filters.preassigned.includes('only')) filters.preassigned = [];
        else filters.preassigned = ['only'];
    }
    setupFilterPopups();
    applyFiltersAndSort();
    window.showFilterResetBtn();
};

window.showFilterResetBtn = function() {
    // 필터 초기화 버튼 비활성화
    let btn = document.getElementById('filter-reset-btn');
    if (btn) btn.style.display = 'none';
};

// ★ v3.94: 모든 필터를 한 번에 해제
window.clearAllFilters = function(e) {
    if (e) e.stopPropagation();
    
    // 기본 필터 키 모두 빈 배열로 초기화
    filters = { loc: [], code: [], stock: [], stock2f: [], dong: [], pos: [], reserved: [], preassigned: [] };
    
    // 동적으로 추가된 커스텀 헤더 필터(cus_*)도 모두 제거
    Object.keys(filters).forEach(key => {
        if (key.startsWith('cus_')) delete filters[key];
    });
    
    // 검색 쿼리도 초기화
    if (window._filterSearchQuery) window._filterSearchQuery = {};
    colTextSearch = {};
    
    // 팝업/메뉴 모두 닫기
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    
    // 필터 UI 갱신 + 테이블 재렌더링
    setupFilterPopups();
    applyFiltersAndSort();
    
    // 사용자에게 알림
    showToast("✅ 모든 필터가 해제되었습니다.");
};

function applyFiltersAndSort() {
    let filtered = originalData.filter(item => {
        // ★ v3.57: 모든 필터 배열 기반 (OR 조건)
        if (filters.loc.length > 0 && !filters.loc.includes(item.id.charAt(0))) return false;
        if (filters.dong.length > 0 && !filters.dong.includes((item.dong || '').toString())) return false;
        if (filters.pos.length > 0 && !filters.pos.includes((item.pos || '').toString())) return false;
        
        // code: 'empty'/'not-empty'/'designated-only' 특수값 배열
        if (filters.code.length > 0) {
            const hasCode = (item.code && item.code !== item.id && item.code.trim() !== "") || (item.name && item.name.trim() !== "");
            const matchEmpty = filters.code.includes('empty') && !hasCode;
            const matchNotEmpty = filters.code.includes('not-empty') && hasCode;
            const matchDesignatedOnly = filters.code.includes('designated-only') && hasCode && item.codeTag !== '당일지정' && item.codeTag !== '선지정';
            if (!matchEmpty && !matchNotEmpty && !matchDesignatedOnly) return false;
        }
        
        if (filters.stock.length > 0 && !filters.stock.includes((item.stock || '0').toString())) return false;
        if (filters.stock2f.length > 0 && !filters.stock2f.includes((item.stock2f || '0').toString())) return false;
        
        if (filters.reserved.length > 0 && filters.reserved.includes('only') && item.codeTag !== '당일지정') return false;
        if (filters.preassigned.length > 0 && filters.preassigned.includes('only') && item.codeTag !== '선지정') return false;
        
        // 커스텀 헤더 필터 (cus_*)
        for (const col in filters) {
            if (!col.startsWith('cus_')) continue;
            const arr = filters[col];
            if (!Array.isArray(arr) || arr.length === 0) continue;
            const key = col.replace('cus_', '');
            let val = (item.rawData && item.rawData[key]) ? item.rawData[key].toString().trim() : '';
            // ★ 입고대기 컬럼은 오더+사입 합계 기준으로 필터
            if (key === '입고대기') {
                const code = (item.code && item.code !== item.id) ? item.code : '';
                val = code && incomingTotalByCode[code] ? incomingTotalByCode[code].toString() : '';
            }
            // 매칭: 'empty' / 'not-empty' 특수값 또는 정확 일치 값
            let matched = false;
            for (const f of arr) {
                if (f === 'empty' && val === '') matched = true;
                else if (f === 'not-empty' && val !== '') matched = true;
                else if (f === val) matched = true;
                if (matched) break;
            }
            if (!matched) return false;
        }

        // ★ 헤더 검색창 텍스트 필터 (각 컬럼 부분일치, 대소문자 무시)
        for (const ck in colTextSearch) {
            const q = (colTextSearch[ck] || '').toLowerCase();
            if (!q) continue;
            let cv = '';
            if (ck === 'id') cv = item.id || '';
            else if (ck === 'code') cv = (item.code && item.code !== item.id) ? item.code : '';
            else if (ck === 'name') cv = item.name || '';
            else if (ck === 'option') cv = item.option || '';
            else if (ck === 'dong') cv = item.dong != null ? item.dong : '';
            else if (ck === 'pos') cv = item.pos != null ? item.pos : '';
            else if (ck === 'stock') cv = item.stock != null ? item.stock : '';
            else if (ck === 'stock2f') cv = item.stock2f != null ? item.stock2f : '';
            else if (ck.startsWith('cus_')) {
                const key = ck.replace('cus_', '');
                if (key === '입고대기') {
                    const c = (item.code && item.code !== item.id) ? item.code : '';
                    cv = c && incomingTotalByCode[c] ? incomingTotalByCode[c].toString() : '';
                } else {
                    cv = (item.rawData && item.rawData[key] != null) ? item.rawData[key] : '';
                }
            }
            if (!String(cv).toLowerCase().includes(q)) return false;
        }
        return true;
    });
    filtered.sort((a, b) => {
        let aVal, bVal;
        if (sortConfig.key.startsWith('cus_')) {
            const key = sortConfig.key.replace('cus_', '');
            aVal = (a.rawData && a.rawData[key]) ? a.rawData[key].toString() : '';
            bVal = (b.rawData && b.rawData[key]) ? b.rawData[key].toString() : '';
        } else {
            aVal = a[sortConfig.key] || ''; bVal = b[sortConfig.key] || '';
        }
        if (sortConfig.key === 'stock') return sortConfig.direction === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
        return sortConfig.direction === 'asc' ? aVal.toString().localeCompare(bVal.toString()) : bVal.toString().localeCompare(aVal.toString());
    });
    window.lastFilteredData = filtered;
    renderTable(filtered);

    // ── 병합(v4.4+대시보드): 로케이션 현황 대시보드 탭이 표시 중이면 자동 갱신 ──
    const __locdashEl = document.getElementById('view-locdash');
    if (__locdashEl && __locdashEl.style.display !== 'none' && typeof window.renderLocationDashboard === 'function') {
        window.renderLocationDashboard();
    }
}

window.handleRowClick = async function(event, locId) {
    if (event.target.tagName === 'INPUT') return;
    
    if (window.isPreAssignMode && window.selectedPreAssignItem) {
        const loc = originalData.find(d => d.id === locId);
        if (!loc) return;
        const hasContent = (loc.code && loc.code !== loc.id && loc.code.trim() !== "") || (loc.name && loc.name.trim() !== "");
        
        const zoneDocId = getZoneDocId(locId);

        if (loc.preAssigned) { 
            if (loc.preAssignedCode === window.selectedPreAssignItem.code) {
                if (confirm(`이미 '${loc.preAssignedCode}' 상품으로 선지정된 자리입니다.\n지정을 해제(취소)하시겠습니까?`)) {
                    await setDoc(doc(db, LOC_COLLECTION, zoneDocId), {
                        [locId]: { preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '', preAssignedAt: 0, codeTag: '', codeTagAt: 0, code: '', name: '', option: '', stock: '0', updatedAt: new Date() }
                    }, { merge: true });
                    showToast(`[${locId}] 선지정 취소 완료`);
                    window.cancelPreAssignMode();
                    return;
                } else return;
            }
            if (!confirm(`이미 다른 상품(${loc.preAssignedCode})이 선지정된 자리입니다.\n기존 선지정을 무시하고 덮어쓰시겠습니까?`)) return; 
        } else {
            if (hasContent) { alert("🚨 이미 물건이 들어있는 자리입니다. 텅 빈 빈칸을 선택해주세요."); return; }
        }
        
        try {
            await setDoc(doc(db, LOC_COLLECTION, zoneDocId), {
                [locId]: {
                    preAssigned: true, preAssignedCode: window.selectedPreAssignItem.code,
                    preAssignedName: window.selectedPreAssignItem.name, preAssignedQty: window.selectedPreAssignItem.qty,
                    preAssignedAt: Date.now(),
                    code: window.selectedPreAssignItem.code, name: window.selectedPreAssignItem.name,
                    option: window.selectedPreAssignItem.option || '', stock: window.selectedPreAssignItem.qty.toString(), 
                    reserved: false, reservedBy: '', reservedAt: 0,
                    codeTag: '선지정', codeTagAt: Date.now(),
                    updatedAt: new Date()
                }
            }, { merge: true });
            showToast(`[${locId}] 자리에 선지정 락(Lock)이 완료되었습니다!`);
            window.cancelPreAssignMode(); 
        } catch(e) { console.error(e); alert("선지정 저장 오류"); }
        return;
    }
    
    // v3.90: 모달 대신 선지정 해제 로직으로 대체
    const targetData = originalData.find(d => d.id === locId);
    if (!targetData) return;

    if (targetData.preAssigned === true) {
        if (confirm(`[${locId}] 선지정을 해제하시겠습니까?`)) {
            try {
                const zoneDocId = getZoneDocId(locId);
                setDoc(doc(db, LOC_COLLECTION, zoneDocId), { 
                    [locId]: { 
                        preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '', preAssignedAt: 0, 
                        codeTag: '', codeTagAt: 0, code: '', name: '', option: '', stock: '0', updatedAt: new Date() 
                    } 
                }, { merge: true });
                showToast("선지정이 해제되었습니다.");
            } catch(e) { 
                console.error(e); 
            }
        }
    }
};

// ★ 가상 스크롤 전역 상태
const VS = {
    data: [],
    rowHeight: 42,
    bufferRows: 20,
    checkedIds: new Set(),
    scrollHandler: null
};

function renderTable(data) {
    VS.data = data;
    
    // 체크 상태 보존
    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    checkedBoxes.forEach(cb => { if (cb.value && cb.value !== 'on') VS.checkedIds.add(cb.value); });
    
    const container = document.getElementById('list-container');
    const tbody = document.getElementById('location-list-body');
    if (!tbody || !container) return;
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="padding:50px;">데이터가 없습니다.</td></tr>';
        return;
    }
    
    // 스크롤 이벤트 등록 (1회)
    if (!VS.scrollHandler) {
        VS.scrollHandler = () => { requestAnimationFrame(() => renderVisibleRows()); };
        container.addEventListener('scroll', VS.scrollHandler);
    }
    
    renderVisibleRows();
}

function renderVisibleRows() {
    const container = document.getElementById('list-container');
    const tbody = document.getElementById('location-list-body');
    if (!tbody || !container || VS.data.length === 0) return;
    
    const totalRows = VS.data.length;
    const totalHeight = totalRows * VS.rowHeight;
    
    // thead 높이 감안 (약 45px)
    const scrollTop = Math.max(0, container.scrollTop - 45);
    const viewHeight = container.clientHeight;
    
    let startIdx = Math.floor(scrollTop / VS.rowHeight) - VS.bufferRows;
    let endIdx = Math.ceil((scrollTop + viewHeight) / VS.rowHeight) + VS.bufferRows;
    startIdx = Math.max(0, startIdx);
    endIdx = Math.min(totalRows, endIdx);
    
    const topPad = startIdx * VS.rowHeight;
    const bottomPad = (totalRows - endIdx) * VS.rowHeight;
    
    let html = '';
    if (topPad > 0) html += `<tr style="height:${topPad}px;"><td colspan="20"></td></tr>`;
    
    for (let i = startIdx; i < endIdx; i++) {
        const loc = VS.data[i];
        let rowStyle = ''; 
        let codeTagHtml = '';
        
        if (loc.codeTag === '당일지정') { 
            rowStyle = 'background-color: #fffde7 !important;';
            codeTagHtml = `<br><span style="color:#1565c0; font-size:10px; font-weight:bold; background:#e3f2fd; padding:1px 5px; border-radius:3px;">📌 당일지정</span>`;
        } else if (loc.codeTag === '선지정') {
            rowStyle = 'background-color: #ffe0b2 !important;';
            codeTagHtml = `<br><span style="color:#e65100; font-size:10px; font-weight:bold; background:#fff3e0; padding:1px 5px; border-radius:3px;">📦 선지정</span>`;
        }
        
        let isChecked = VS.checkedIds.has(loc.id) ? 'checked' : '';
        html += `<tr onclick="handleRowClick(event, '${loc.id}')" style="${rowStyle}">`;
        html += `<td onclick="event.stopPropagation()"><input type="checkbox" class="loc-check" value="${loc.id}" ${isChecked} onchange="window.vsCheckChanged(this)"></td>`;
        window.visibleColumns.forEach(col => {
            if (col === 'std_dong') html += `<td style="color:#666;">${loc.dong || ''}</td>`;
            else if (col === 'std_pos') html += `<td style="color:#666;">${loc.pos || ''}</td>`;
            else if (col === 'std_id') html += `<td class="loc-copy-cell" onclick="copyLocationToClipboard(event, '${loc.id}')" title="클릭하여 복사 및 예약">${loc.id}</td>`;
            else if (col === 'std_code') html += `<td style="color:#3d5afe; font-weight:bold;">${loc.code === loc.id ? '' : (loc.code || '')}${codeTagHtml}</td>`;
            else if (col === 'std_name') html += `<td style="text-align:left;">${loc.name || ''}</td>`;
            else if (col === 'std_option') html += `<td style="text-align:left; font-size:12px;">${loc.option || ''}</td>`;
            else if (col === 'std_stock') html += `<td style="font-weight:bold;">${loc.stock || '0'}</td>`;
            else if (col === 'std_stock2f') html += `<td style="font-weight:bold;">${loc.stock2f || '0'}</td>`;
            else if (col.startsWith('cus_')) {
                const key = col.replace('cus_', '');
                let val = (loc.rawData && loc.rawData[key]) ? loc.rawData[key] : '';
                // ★ 입고대기 컬럼은 오더리스트/사입리스트 합계로 덮어쓰기
                if (key === '입고대기') {
                    const code = (loc.code && loc.code !== loc.id) ? loc.code : '';
                    val = code && incomingTotalByCode[code] ? incomingTotalByCode[code] : '0';
                }
                html += `<td>${val}</td>`;
            }
        });
        html += `</tr>`;
    }
    
    if (bottomPad > 0) html += `<tr style="height:${bottomPad}px;"><td colspan="20"></td></tr>`;
    
    tbody.innerHTML = html;
}

// 체크박스 상태를 가상 스크롤에서 유지
window.vsCheckChanged = function(cb) {
    if (cb.checked) VS.checkedIds.add(cb.value);
    else VS.checkedIds.delete(cb.value);
};

// toggleAllCheckboxes 오버라이드 - 전체 데이터 기준으로 동작
window.toggleAllCheckboxes = (source) => {
    if (source.checked) {
        VS.data.forEach(d => VS.checkedIds.add(d.id));
    } else {
        VS.checkedIds.clear();
    }
    renderVisibleRows();
};

const extractDataFromHTML = function(htmlString) {
    const parser = new DOMParser();
    const cleanHtml = htmlString.replace(/<br\s*[\/]?>/gi, " ");
    const doc = parser.parseFromString(cleanHtml, 'text/html');
    const rows = doc.querySelectorAll('tr');
    
    let rawData = [];
    for (let i = 0; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll('th, td');
        let rowData = [];
        for (let j = 0; j < cells.length; j++) {
            rowData.push(cells[j].innerText.trim());
        }
        if (rowData.length > 0) rawData.push(rowData);
    }
    return rawData;
};

const smartParseToJSON = function(rawData) {
    if (!rawData || rawData.length === 0) return [];

    let headerRowIndex = -1;
    let pureHeaders = [];

    for (let i = 0; i < Math.min(30, rawData.length); i++) {
        const row = rawData[i];
        if (!row || !Array.isArray(row)) continue;
        const cleanRow = row.map(h => (h || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, ''));
        
        if (cleanRow.includes('상품코드') || cleanRow.includes('어드민상품코드') || 
            cleanRow.includes('대표상품코드') || cleanRow.includes('품목코드') || 
            cleanRow.includes('바코드') || cleanRow.includes('로케이션')) {
            headerRowIndex = i;
            pureHeaders = row.map(h => (h || '').toString().replace(/\s+/g, '')); 
            break;
        }
    }

    if (headerRowIndex === -1) {
        headerRowIndex = 0;
        pureHeaders = (rawData[0] || []).map(h => (h || '').toString().replace(/\s+/g, ''));
    } 

    const parsedList = [];
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || !Array.isArray(row)) continue;
        
        let rowObj = {};
        let isEmpty = true;
        
        for (let j = 0; j < pureHeaders.length; j++) {
            const key = pureHeaders[j];
            if (key && key !== '') {
                let val = row[j];
                if (val !== undefined && val !== "") {
                    rowObj[key] = val;
                    isEmpty = false;
                }
            }
        }
        if (!isEmpty) parsedList.push(rowObj);
    }
    return parsedList;
};

const universalExcelReader = (file) => {
    return new Promise((resolve) => {
        // ★ v3.95: 진단 헬퍼 - 텍스트에서 어떤 케이스인지 판단
        const diagnoseText = (text, parsedJson) => {
            if (!text) return 'unknown';
            // A. 프레임셋 HTML 감지
            if (text.includes('c_rgszSh') || text.includes('Excel Workbook Frameset') || /\.files\/sheet\d+\.htm/.test(text)) {
                return 'frameset';
            }
            // 데이터 행 분석
            if (parsedJson && parsedJson.length === 0) {
                return 'empty-table';
            }
            if (parsedJson && parsedJson.length > 0) {
                const isValid = parsedJson.some(row => row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['로케이션'] || row['품목코드'] || row['바코드']);
                if (!isValid) return 'no-required-header';
            }
            return 'unknown';
        };

        const bufferReader = new FileReader();
        bufferReader.onload = (eBuf) => {
            let json = [];
            try {
                const data = new Uint8Array(eBuf.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
                json = smartParseToJSON(rawData);
            } catch(e) {}

            const isValid = json.some(row => row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['로케이션'] || row['품목코드'] || row['바코드']);
            if (json.length > 0 && isValid) {
                return resolve({ rows: json, diagnosis: 'ok' });
            }

            const textReader = new FileReader();
            textReader.onload = (eTxt) => {
                let text = eTxt.target.result;
                if (text.includes('<table') || text.includes('<TABLE') || text.includes('<html') || text.includes('<meta')) {
                    try {
                        const rawData = extractDataFromHTML(text); 
                        const utfJson = smartParseToJSON(rawData);
                        const isValidUtf = utfJson.some(row => row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['로케이션'] || row['품목코드'] || row['바코드']);
                        if (utfJson.length > 0 && isValidUtf) {
                            return resolve({ rows: utfJson, diagnosis: 'ok' });
                        }
                        const utfDiag = diagnoseText(text, utfJson);
                        if (utfDiag !== 'unknown') {
                            return resolve({ rows: [], diagnosis: utfDiag });
                        }
                    } catch(err) {}
                }

                const eucReader = new FileReader();
                eucReader.onload = (eEuc) => {
                    try {
                        let eucText = eEuc.target.result;
                        const rawData = extractDataFromHTML(eucText); 
                        const eucJson = smartParseToJSON(rawData);
                        const isValidEuc = eucJson.some(row => row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['로케이션'] || row['품목코드'] || row['바코드']);
                        if (eucJson.length > 0 && isValidEuc) {
                            return resolve({ rows: eucJson, diagnosis: 'ok' });
                        }
                        const eucDiag = diagnoseText(text, eucJson);
                        if (eucDiag !== 'unknown') {
                            return resolve({ rows: [], diagnosis: eucDiag });
                        }
                        resolve({ rows: [], diagnosis: 'unknown' });
                    } catch(err) {
                        resolve({ rows: [], diagnosis: 'unknown' });
                    }
                };
                eucReader.readAsText(file, 'euc-kr');
            };
            textReader.readAsText(file, 'utf-8');
        };
        bufferReader.readAsArrayBuffer(file);
    });
};

// ★ v3.95: 업로드별 필수 헤더 안내 + 진단 코드별 alert 메시지 헬퍼
const _uploadHeaderGuide = {
    'permanent': '로케이션, 동, 위치, 칸수',
    'daily':     '로케이션, 상품코드, 상품명, 옵션, 정상재고, 2층창고재고',
    'zikjin':    '상품코드(또는 어드민상품코드/대표상품코드 등), 수량',
    'weekly':    '상품코드(또는 어드민상품코드/대표상품코드 등), 기간배송수량 또는 기간발주수량'
};

function _showUploadDiagnosisAlert(diagnosis, uploadType) {
    const headers = _uploadHeaderGuide[uploadType] || '';
    let msg = '';
    if (diagnosis === 'frameset') {
        msg = "🚨 잘못된 파일 형식입니다.\n\n" +
              "이 파일은 Excel에서 '웹 페이지(*.htm)' 형식으로 저장된 파일입니다.\n" +
              "실제 데이터가 별도 폴더에 분리되어 있어 시스템에서 읽을 수 없습니다.\n\n" +
              "✅ 해결 방법:\n" +
              "1. 파일을 Excel로 엽니다\n" +
              "2. [다른 이름으로 저장] → 형식을 'Excel 통합 문서(*.xlsx)' 로 선택\n" +
              "3. 다시 업로드해주세요";
    } else if (diagnosis === 'empty-table') {
        msg = "⚠️ 파일에 데이터 행이 없습니다.\n\n" +
              "헤더(첫 행)는 있지만 실제 데이터가 입력되지 않은 빈 파일입니다.\n" +
              "데이터가 입력된 파일을 업로드해주세요.";
    } else if (diagnosis === 'no-required-header') {
        msg = "⚠️ 파일에서 필수 컬럼을 찾을 수 없습니다.\n\n" +
              "이 업로드에 필요한 헤더: " + headers + "\n\n" +
              "✅ 해결 방법:\n" +
              "- 파일의 첫 행에 위 헤더가 정확히 입력되어 있는지 확인\n" +
              "- 한글이 깨져 보이면 UTF-8 또는 EUC-KR로 다시 저장";
    } else {
        msg = "⚠️ 데이터가 없습니다.\n\n" +
              "파일 형식 또는 내용을 다시 확인해주세요.\n" +
              "(예상 헤더: " + headers + ")";
    }
    alert(msg);
}

const fileInputZikjin = document.getElementById('excel-upload-zikjin');
if (fileInputZikjin) {
    fileInputZikjin.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('직진배송 데이터를 분석 중입니다...');
        try {
            const result = await universalExcelReader(file);
            if(result.rows.length > 0) await updateDatabaseB(result.rows, 'ZikjinData', e.target, false);
            else { window.hideLoading(); _showUploadDiagnosisAlert(result.diagnosis, 'zikjin'); e.target.value=''; }
        } catch(err) { window.hideLoading(); alert("오류 발생"); e.target.value=''; }
    });
}

const fileInputWeekly = document.getElementById('excel-upload-weekly');
if (fileInputWeekly) {
    fileInputWeekly.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('주차별 데이터를 분석 중입니다...');
        try {
            const result = await universalExcelReader(file);
            if(result.rows.length > 0) await updateDatabaseB(result.rows, 'WeeklyData', e.target, false);
            else { window.hideLoading(); _showUploadDiagnosisAlert(result.diagnosis, 'weekly'); e.target.value=''; }
        } catch(err) { window.hideLoading(); alert("오류 발생"); e.target.value=''; }
    });
}

const fileInputA = document.getElementById('excel-upload-a');
if (fileInputA) {
    fileInputA.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('일일 재고/상품 데이터를 최신화 중입니다...');
        try {
            const result = await universalExcelReader(file);
            if(result.rows.length > 0) {
                await updateDatabaseA(result.rows, 'daily');
                // 🕒 데이터 최신화 시각 기록 (헤더 표시용)
                try { await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { lastDataUpdate: Date.now() }, { merge: true }); } catch(_) {}
            }
            else { window.hideLoading(); _showUploadDiagnosisAlert(result.diagnosis, 'daily'); }
        } catch(err) { window.hideLoading(); alert("오류 발생"); }
        finally { e.target.value=''; }
    });
}

const fileInputPerm = document.getElementById('excel-upload-permanent');
if (fileInputPerm) {
    fileInputPerm.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('도면(동/위치) 영구 데이터를 덮어쓰기 세팅 중입니다...');
        try {
            const result = await universalExcelReader(file);
            if(result.rows.length > 0) await updateDatabaseA(result.rows, 'permanent');
            else { window.hideLoading(); _showUploadDiagnosisAlert(result.diagnosis, 'permanent'); }
        } catch(err) { window.hideLoading(); alert("오류 발생"); }
        finally { e.target.value=''; }
    });
}

// ===== v3.97a: 주문 페어 분석 (청크 압축 + 중복 방지) =====
const ORDER_PAIRS_COLL = 'OrderPairsChunks';
const ORDER_STATS_COLL = 'OrderStatsChunks';
const PROCESSED_ORDERS_COLL = 'ProcessedOrders';
const CHUNK_SIZE_PAIRS = 200;
const CHUNK_SIZE_STATS = 200;

// 주문 데이터 파일 업로드 핸들러
const fileInputOrders = document.getElementById('excel-upload-orders');
if (fileInputOrders) {
    fileInputOrders.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('📦 주문 데이터를 분석 중입니다...');
        try {
            const result = await universalExcelReader(file);
            if (result.rows.length > 0) {
                await window.processOrderData(result.rows);
            } else {
                window.hideLoading();
                _showUploadDiagnosisAlert(result.diagnosis, 'orders');
                e.target.value = '';
            }
        } catch (err) {
            window.hideLoading();
            console.error('주문 파일 처리 오류:', err);
            alert('오류 발생: ' + err.message);
            e.target.value = '';
        } finally {
            e.target.value = '';
        }
    });
}

// 주문 데이터 처리: 중복 검사 → 신규만 자동 누적 저장
window.processOrderData = async function(rows) {
    try {
        window.showLoading('🔍 주문번호별로 그룹화 중...');
        // 1. 주문번호별 그룹화
        const orderMap = {};
        for (const row of rows) {
            const orderNo = (row['주문번호'] || '').toString().trim();
            const code = (row['상품코드'] || row['바코드'] || '').toString().trim();
            const orderDate = (row['주문일'] || '').toString().trim();
            if (!orderNo || !code) continue;
            if (!orderMap[orderNo]) orderMap[orderNo] = { codes: new Set(), date: orderDate };
            orderMap[orderNo].codes.add(code);
        }

        const orderNos = Object.keys(orderMap);
        if (orderNos.length === 0) {
            window.hideLoading();
            alert('처리할 주문 데이터가 없습니다.');
            return;
        }

        // 2. 기존 ProcessedOrders 조회 (중복 업로드 방지)
        window.showLoading('💾 중복 주문 검사 중...');
        const processedSet = new Set();
        const processedSnap = await getDocs(collection(db, PROCESSED_ORDERS_COLL));
        processedSnap.forEach(d => { processedSet.add(d.id); });

        // 3. 신규 주문만 필터링
        const targetOrderNos = orderNos.filter(ono => !processedSet.has(ono));
        const dupCount = orderNos.length - targetOrderNos.length;

        if (targetOrderNos.length === 0) {
            window.hideLoading();
            alert(`⚠️ 모든 주문이 이미 처리되었습니다.\n\n파일 총 주문: ${orderNos.length.toLocaleString()}건\n이미 처리됨: ${dupCount.toLocaleString()}건\n\n이전에 같은 파일을 업로드했을 가능성이 큽니다.`);
            return;
        }

        // 4. 페어/단독 카운트 집계 (신규분만)
        window.showLoading('📊 페어 통계 계산 중...');
        const newPairCounts = {};
        const newCodeCounts = {};
        let latestDate = '';

        for (const ono of targetOrderNos) {
            const obj = orderMap[ono];
            if (!obj) continue;
            const codes = [...obj.codes].sort();
            const date = obj.date;
            if (date > latestDate) latestDate = date;

            // 단독 카운트
            for (const c of codes) {
                if (!newCodeCounts[c]) newCodeCounts[c] = { count: 0, lastDate: '' };
                newCodeCounts[c].count++;
                if (date > newCodeCounts[c].lastDate) newCodeCounts[c].lastDate = date;
            }

            // 페어 카운트
            if (codes.length >= 2) {
                for (let i = 0; i < codes.length; i++) {
                    for (let j = i + 1; j < codes.length; j++) {
                        const pairId = codes[i] + '__' + codes[j];
                        if (!newPairCounts[pairId]) newPairCounts[pairId] = { count: 0, lastDate: '' };
                        newPairCounts[pairId].count++;
                        if (date > newPairCounts[pairId].lastDate) newPairCounts[pairId].lastDate = date;
                    }
                }
            }
        }

        // 5. 기존 청크 로드 + 병합
        window.showLoading('💾 기존 누적 데이터와 병합 중...');
        const existingPairs = {};
        const existingStats = {};

        const pairsSnap = await getDocs(collection(db, ORDER_PAIRS_COLL));
        pairsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(p => {
                    const pid = p.cA + '__' + p.cB;
                    existingPairs[pid] = { codeA: p.cA, codeB: p.cB, count: p.c, lastDate: p.d };
                });
            } catch (e) {}
        });

        const statsSnap = await getDocs(collection(db, ORDER_STATS_COLL));
        statsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(s => {
                    existingStats[s.c] = { code: s.c, count: s.n, lastDate: s.d };
                });
            } catch (e) {}
        });

        // 병합
        for (const code in newCodeCounts) {
            const nd = newCodeCounts[code];
            if (existingStats[code]) {
                existingStats[code].count += nd.count;
                if (nd.lastDate > existingStats[code].lastDate) existingStats[code].lastDate = nd.lastDate;
            } else {
                existingStats[code] = { code, count: nd.count, lastDate: nd.lastDate };
            }
        }
        for (const pid in newPairCounts) {
            const nd = newPairCounts[pid];
            const [codeA, codeB] = pid.split('__');
            if (existingPairs[pid]) {
                existingPairs[pid].count += nd.count;
                if (nd.lastDate > existingPairs[pid].lastDate) existingPairs[pid].lastDate = nd.lastDate;
            } else {
                existingPairs[pid] = { codeA, codeB, count: nd.count, lastDate: nd.lastDate };
            }
        }

        // 6. 청크 압축 저장 (기존 청크 삭제 후 다시 작성)
        window.showLoading('💾 Firebase에 청크 압축 저장 중...');

        let batch = writeBatch(db);
        let bc = 0;
        pairsSnap.forEach(d => { batch.delete(d.ref); bc++; if (bc >= 400) { batch.commit(); batch = writeBatch(db); bc = 0; } });
        if (bc > 0) await batch.commit();

        batch = writeBatch(db);
        bc = 0;
        statsSnap.forEach(d => { batch.delete(d.ref); bc++; if (bc >= 400) { batch.commit(); batch = writeBatch(db); bc = 0; } });
        if (bc > 0) await batch.commit();

        // 새 청크 작성 (페어)
        const allPairs = Object.values(existingPairs).map(p => ({ cA: p.codeA, cB: p.codeB, c: p.count, d: p.lastDate }));
        batch = writeBatch(db);
        bc = 0;
        let chunkIdx = 0;
        for (let i = 0; i < allPairs.length; i += CHUNK_SIZE_PAIRS) {
            const chunk = allPairs.slice(i, i + CHUNK_SIZE_PAIRS);
            const docRef = doc(db, ORDER_PAIRS_COLL, `CHUNK_${chunkIdx}`);
            batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            chunkIdx++;
            bc++;
            if (bc >= 400) { await batch.commit(); batch = writeBatch(db); bc = 0; }
        }
        if (bc > 0) await batch.commit();

        // 새 청크 작성 (단독)
        const allStats = Object.values(existingStats).map(s => ({ c: s.code, n: s.count, d: s.lastDate }));
        batch = writeBatch(db);
        bc = 0;
        chunkIdx = 0;
        for (let i = 0; i < allStats.length; i += CHUNK_SIZE_STATS) {
            const chunk = allStats.slice(i, i + CHUNK_SIZE_STATS);
            const docRef = doc(db, ORDER_STATS_COLL, `CHUNK_${chunkIdx}`);
            batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            chunkIdx++;
            bc++;
            if (bc >= 400) { await batch.commit(); batch = writeBatch(db); bc = 0; }
        }
        if (bc > 0) await batch.commit();

        // 7. ProcessedOrders 추가 (처리한 주문번호)
        window.showLoading('💾 처리 이력 저장 중...');
        batch = writeBatch(db);
        bc = 0;
        for (const ono of targetOrderNos) {
            const obj = orderMap[ono];
            const docRef = doc(db, PROCESSED_ORDERS_COLL, ono);
            batch.set(docRef, { date: obj.date || latestDate, at: Date.now() }, { merge: true });
            bc++;
            if (bc >= 400) { await batch.commit(); batch = writeBatch(db); bc = 0; }
        }
        if (bc > 0) await batch.commit();

        // 8. 메타정보 갱신 (누적 처리 주문수 더하기)
        let prevTotal = 0;
        try {
            const cfgSnap = await getDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'));
            if (cfgSnap.exists()) {
                const prevMeta = cfgSnap.data().orderAnalysisMeta || {};
                prevTotal = prevMeta.totalProcessedOrders || 0;
            }
        } catch (e) {}
        const metaUpdate = {
            orderAnalysisMeta: {
                lastUploadDate: latestDate || new Date().toISOString().slice(0, 10),
                lastUploadAt: Date.now(),
                totalProcessedOrders: prevTotal + targetOrderNos.length,
                totalPairs: Object.keys(existingPairs).length,
                totalCodes: Object.keys(existingStats).length
            }
        };
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), metaUpdate, { merge: true });

        window.hideLoading();

        // 9. 결과 alert + 자동 리포트 표시
        let msg = `✅ 주문 데이터 분석 완료!\n\n`;
        msg += `파일 총 주문: ${orderNos.length.toLocaleString()}건\n`;
        msg += `✨ 신규 처리: ${targetOrderNos.length.toLocaleString()}건\n`;
        if (dupCount > 0) msg += `🔄 이미 처리됨 (건너뜀): ${dupCount.toLocaleString()}건\n`;
        msg += `\n누적 페어: ${Object.keys(existingPairs).length.toLocaleString()}개\n`;
        msg += `누적 상품: ${Object.keys(existingStats).length.toLocaleString()}개\n\n`;
        msg += `자세한 리포트는 [📊 페어 분석 리포트 보기]에서 확인하세요.`;
        alert(msg);
        
        // v3.98: 페어 캐시 갱신
        if (typeof window.loadOrderPairsCache === 'function') {
            window.loadOrderPairsCache();
        }
        
        // v4.4 v3: 주문 업로드 후 자동 팝업 호출 삭제
        // 사용자가 [📊 페어 분석 리포트 보기] 버튼을 직접 클릭해서 열도록 변경
        // window.openOrderAnalysisReport();
    } catch (e) {
        window.hideLoading();
        console.error('processOrderData 오류:', e);
        alert('주문 데이터 처리 중 오류가 발생했습니다.\n' + e.message);
    }
};

// 분석 리포트 모달 열기
window.openOrderAnalysisReport = async function() {
    document.getElementById('order-analysis-modal').style.display = 'flex';
    document.getElementById('order-analysis-summary').innerHTML = '<div style="text-align:center; color:#666;">데이터 로딩 중...</div>';
    document.getElementById('order-analysis-tbody').innerHTML = '';
    window.showLoading('📊 분석 리포트 로딩 중...');

    try {
        let meta = {};
        const cfgSnap = await getDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'));
        if (cfgSnap.exists()) meta = cfgSnap.data().orderAnalysisMeta || {};

        const pairs = [];
        const stats = {};
        const pairsSnap = await getDocs(collection(db, ORDER_PAIRS_COLL));
        pairsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(p => pairs.push({ codeA: p.cA, codeB: p.cB, count: p.c, lastDate: p.d }));
            } catch (e) {}
        });

        const statsSnap = await getDocs(collection(db, ORDER_STATS_COLL));
        statsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(s => { stats[s.c] = { code: s.c, count: s.n, lastDate: s.d }; });
            } catch (e) {}
        });

        const totalOrdersEstimate = meta.totalProcessedOrders || 1;
        const pairsWithLift = pairs.map(p => {
            const cntA = (stats[p.codeA] && stats[p.codeA].count) || 1;
            const cntB = (stats[p.codeB] && stats[p.codeB].count) || 1;
            const lift = (p.count * totalOrdersEstimate) / (cntA * cntB);
            return { ...p, lift };
        });

        const trustedPairs = pairsWithLift
            .filter(p => p.count >= 5 && p.lift >= 2.0)
            .sort((a, b) => (b.lift * b.count) - (a.lift * a.count));

        let summaryHtml = `
            <div style="display:flex; justify-content:space-around; flex-wrap:wrap; gap:15px;">
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#666;">최근 업로드</div>
                    <div style="font-size:14px; color:#4a148c; font-weight:bold;">${meta.lastUploadDate || '-'}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#666;">처리한 주문 건수</div>
                    <div style="font-size:18px; color:#4a148c; font-weight:900;">${(meta.totalProcessedOrders || 0).toLocaleString()}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#666;">분석된 상품 종류</div>
                    <div style="font-size:18px; color:#4a148c; font-weight:900;">${Object.keys(stats).length.toLocaleString()}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#666;">함께 팔린 상품 조합</div>
                    <div style="font-size:18px; color:#4a148c; font-weight:900;">${pairs.length.toLocaleString()}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:#666;">🏆 자주 함께 팔리는 조합</div>
                    <div style="font-size:22px; color:#7b1fa2; font-weight:900;">${trustedPairs.length.toLocaleString()}</div>
                </div>
            </div>
        `;
        document.getElementById('order-analysis-summary').innerHTML = summaryHtml;

        const top30 = trustedPairs.slice(0, 30);
        let html = '';
        if (top30.length === 0) {
            html = '<tr><td colspan="7" style="padding:40px; color:#888;">데이터를 더 누적하면 페어가 생성됩니다.</td></tr>';
        } else {
            // v3.99: 상품 상세 정보 HTML 생성 헬퍼
            const buildProductCell = (code) => {
                const matches = originalData.filter(d => d.code === code);
                if (matches.length === 0) {
                    return `<div style="font-weight:bold; color:#7b1fa2;">${code}</div>` +
                           `<div style="font-size:11px; color:#999; margin-top:2px;">⚠️ 로케이션 없음</div>`;
                }
                const loc = matches[0];
                const name = (loc.name || '').toString().trim();
                const option = (loc.option || '').toString().trim();
                const locId = (loc.id || '').toString().trim();
                const dupBadge = matches.length > 1
                    ? `<span style="display:inline-block; background:#fff3e0; color:#e65100; padding:1px 5px; border-radius:3px; font-size:9px; font-weight:bold; margin-left:4px;" title="같은 상품코드가 ${matches.length}개 자리에 있습니다 (데이터 이상)">⚠️ ${matches.length}자리</span>`
                    : '';
                const optionHtml = option ? `<span style="color:#666; font-weight:normal; font-size:11px; margin-left:4px;">[${option}]</span>` : '';
                const locHtml = locId ? `<div style="font-size:11px; color:#1b5e20; margin-top:2px;">📍 ${locId}${dupBadge}</div>` : `<div style="font-size:11px; color:#999; margin-top:2px;">📍 자리 없음${dupBadge}</div>`;
                const nameHtml = name ? `<div style="font-size:11px; color:#555; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:190px;" title="${name}">${name}</div>` : '';
                return `<div style="font-weight:bold; color:#7b1fa2;">${code}${optionHtml}</div>` + locHtml + nameHtml;
            };
            
            top30.forEach((p, idx) => {
                const locA = originalData.find(d => d.code === p.codeA);
                const locB = originalData.find(d => d.code === p.codeB);
                let distance = (locA && locB && locA.dong === locB.dong && locA.dong !== '') 
                    ? `<span style="color:#2e7d32; font-weight:bold;">같은 동</span>` 
                    : `<span style="color:#d32f2f; font-weight:bold;">다른 동</span>`;
                html += `<tr style="background:${idx % 2 === 0 ? '#ffffff' : '#faf5fc'};">
                    <td style="font-weight:bold; color:#7b1fa2;">${idx+1}</td>
                    <td style="text-align:left; padding:8px 10px;">${buildProductCell(p.codeA)}</td>
                    <td style="text-align:left; padding:8px 10px;">${buildProductCell(p.codeB)}</td>
                    <td style="font-weight:bold; color:#7b1fa2;">${p.count}회</td>
                    <td style="font-weight:bold; color:#e65100;">${p.lift.toFixed(2)}</td>
                    <td style="font-size:11px;">${p.lastDate || '-'}</td><td>${distance}</td></tr>`;
            });
        }
        document.getElementById('order-analysis-tbody').innerHTML = html;
    } catch (e) {
        console.error('리포트 로드 오류:', e);
        document.getElementById('order-analysis-summary').innerHTML = `<div style="color:#d32f2f;">로드 실패: ${e.message}</div>`;
    } finally {
        window.hideLoading();
    }
};

// 누적 데이터 전체 초기화
window.resetOrderAnalysis = async function() {
    if (!confirm('함께 팔리는 상품 분석 데이터를 전체 삭제하시겠습니까?\n\n(주문 데이터, 상품 조합, 통계가 모두 초기화됩니다)')) return;
    if (!confirm('OrderPairsChunks, OrderStatsChunks, ProcessedOrders가 모두 삭제됩니다. 계속하시겠습니까?')) return;
    window.showLoading('🗑️ 누적 데이터 삭제 중...');
    try {
        const colls = [ORDER_PAIRS_COLL, ORDER_STATS_COLL, PROCESSED_ORDERS_COLL];
        for (const collName of colls) {
            const snap = await getDocs(collection(db, collName));
            let batch = writeBatch(db); let bc = 0;
            snap.forEach(d => { batch.delete(d.ref); bc++; if (bc >= 400) { batch.commit(); batch = writeBatch(db); bc = 0; } });
            if (bc > 0) await batch.commit();
        }
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { orderAnalysisMeta: deleteField() }, { merge: true });
        window.hideLoading();
        alert('✅ 누적 데이터가 모두 삭제되었습니다.');
        document.getElementById('order-analysis-modal').style.display = 'none';
        
        // v3.98: 페어 캐시 초기화
        window._cachedOrderPairs = [];
        window._cachedOrderStats = {};
        window._cachedOrderMeta = {};
    } catch (e) {
        window.hideLoading(); console.error('초기화 오류:', e);
        alert('초기화 오류: ' + e.message);
    }
};

async function updateDatabaseB(rows, collectionName, inputElement, silent = false) {
    let label = collectionName === 'ZikjinData' ? '직진배송' : (collectionName === 'WeeklyData' ? '주차별' : '데이터');
    try {
        const querySnapshot = await getDocs(collection(db, collectionName));
        let delBatch = writeBatch(db);
        querySnapshot.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
        
        const validRows = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            let code = (row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['품목코드'] || row['바코드'] || row['상품번호'])?.toString().trim();
            if (code) validRows.push(row); 
        }

        let batch = writeBatch(db); 
        const CHUNK_SIZE = 200;
        let chunkCount = 0;

        for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
            const chunk = validRows.slice(i, i + CHUNK_SIZE);
            const docRef = doc(db, collectionName, `CHUNK_${chunkCount}`);
            batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            chunkCount++;
        }
        
        if (chunkCount > 0) await batch.commit();
        
        if (!silent) alert(`✅ [${label}] 압축 저장 완료!\n총 ${validRows.length}건이 단 ${chunkCount}번의 쓰기로 반영되었습니다.`);
        
    } catch (error) { 
        console.error(`${label} 실패:`, error); 
        if (!silent) alert(`${label} 중 오류가 발생했습니다.`); 
        throw error; 
    } finally { 
        if(inputElement && !silent) inputElement.value = ''; 
        if (!silent) window.hideLoading(); 
    }
}

async function updateDatabaseA(rows, mode = 'daily') {
    const totalRows = rows.length;

    // 🔎 '한 로케이션에 2+ 상품' 충돌 감지 (업로드 행 기준; 저장 시 같은 로케이션은 마지막 행만 남아 충돌이 사라지므로 여기서 포착)
    if (mode === 'daily') {
        try {
            const _locCodes = {};
            rows.forEach(row => {
                const raw = (row['로케이션'] || '').toString().trim();
                if (!raw) return;
                const loc = raw.includes('(') ? raw.split('(')[0].trim() : raw;
                let code = '';
                if (raw.includes('(')) { const af = raw.substring(raw.indexOf('(')); const si = af.indexOf('S'); if (si !== -1) code = af.substring(si).trim(); }
                if (!code) code = (row['상품코드'] || '').toString().trim();
                if (!loc || !code) return;
                (_locCodes[loc] = _locCodes[loc] || new Set()).add(code);
            });
            window.__dupLocations = Object.entries(_locCodes)
                .filter(([, s]) => s.size >= 2)
                .map(([loc, s]) => ({ loc, codes: [...s] }));
            setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { dupLocations: window.__dupLocations, dupLocationsAt: Date.now() }, { merge: true }).catch(() => {});
        } catch (e) { console.warn('[dupLoc] 충돌 감지 실패:', e); }
    }

    try {
        // ★ 모든 행의 키를 합쳐서 전체 헤더 추출 (첫 행에 빈 값이면 키가 누락되는 문제 해결)
        const allHeadersSet = new Set();
        rows.forEach(row => { Object.keys(row).forEach(k => allHeadersSet.add(k)); });
        const allHeaders = [...allHeadersSet];
        const excludeRaw = ['동', 'dong', '위치', 'pos', '상품코드', '로케이션', '상품명', '옵션', '정상재고', '2층창고재고'];
        // 공백제거 버전도 제외 목록에 포함
        const exclude = [...new Set([...excludeRaw, ...excludeRaw.map(h => h.replace(/\s+/g, ''))])];
        
        const customHeaders = allHeaders.filter(h => {
            const clean = h.replace(/\s+/g, '');
            return clean !== '' && 
                   !h.toUpperCase().includes('EMPTY') &&
                   !h.includes('<') && !h.includes('>') && !h.includes('=') &&
                   !exclude.includes(h) &&
                   !exclude.includes(clean);
        });
        
        const newHeaders = [...new Set([...window.excelHeaders, ...customHeaders])];
        const hasNewHeader = customHeaders.some(h => !window.excelHeaders.includes(h));
        
        // ★ 디버그 로그
        console.log('=== [DEBUG] 최신화 ===');
        console.log('allHeaders:', allHeaders.length, '개 →', allHeaders);
        console.log('customHeaders:', customHeaders.length, '개 →', customHeaders);
        
        if (hasNewHeader) {
            await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { excelHeaders: newHeaders }, { merge: true });
            window.excelHeaders = newHeaders;
        }
        
        let batch = writeBatch(db); 
        let updateCount = 0; 
        let skipCount = 0;
        let zoneUpdates = {};
        
        // v4.4: 2F SKU 카운트 (로케이션이 "2F-..." 형태인 행의 고유 상품코드 수)
        const twoFloorCodes = new Set();
        let twoFloorStockSum = 0;
        
        let existingLocMap = {};
        originalData.forEach(d => { existingLocMap[d.id] = d; });
        
        if (mode === 'daily') {
            originalData.forEach(loc => {
                const zoneDocId = getZoneDocId(loc.id);
                if (!zoneUpdates[zoneDocId]) zoneUpdates[zoneDocId] = {};
                
                zoneUpdates[zoneDocId][loc.id] = {
                    dong: loc.dong || '',
                    pos: loc.pos || '',
                    code: '',
                    name: '',
                    option: '',
                    stock: '0',
                    stock2f: '0',
                    reserved: false,
                    reservedAt: 0,
                    reservedBy: '',
                    assignedAt: 0,
                    updatedAt: new Date(),
                    rawDataStr: '{}',
                    rawData: deleteField(),
                    preAssigned: loc.preAssigned || false,
                    preAssignedCode: loc.preAssignedCode || '',
                    preAssignedName: loc.preAssignedName || '',
                    preAssignedQty: loc.preAssignedQty || '',
                    preAssignedAt: loc.preAssignedAt || 0,
                    codeTag: loc.codeTag || '',
                    codeTagAt: loc.codeTagAt || 0
                };
            });
        }
        
        for (let i = 0; i < totalRows; i++) {
            const row = rows[i]; 

            const rawLoc = row['로케이션']?.toString().trim();
            if (rawLoc) {
                // v4.4: 2F 로케이션 감지 ("2F-..." 형태)
                // 예: "2F-S614130 I-49"
                if (rawLoc.toUpperCase().startsWith('2F-')) {
                    // 2F 행: 상품코드 추출
                    // "2F-S614130 I-49" → "S614130"
                    const afterPrefix = rawLoc.substring(3).trim(); // "S614130 I-49"
                    let twoFCode = '';
                    // S로 시작하는 첫 토큰 추출
                    const tokens = afterPrefix.split(/\s+/);
                    for (const tk of tokens) {
                        const trimmed = tk.trim();
                        if (trimmed && trimmed.charAt(0).toUpperCase() === 'S') {
                            twoFCode = trimmed;
                            break;
                        }
                    }
                    // S로 시작하는 토큰이 없으면 row['상품코드'] 사용
                    if (!twoFCode) {
                        twoFCode = (row['상품코드'] || '').toString().trim();
                    }
                    if (twoFCode) {
                        twoFloorCodes.add(twoFCode);
                        // 2F 재고 수량 누적 (정상재고 또는 2층창고재고 컬럼 사용)
                        const stockVal = Number(row['정상재고'] || row['2층창고재고'] || 0);
                        if (!isNaN(stockVal) && stockVal > 0) {
                            twoFloorStockSum += stockVal;
                        }
                    }
                    // 2F 행은 3층 로케이션 시스템에 저장하지 않음 (계속 skip)
                    skipCount++;
                    continue;
                }
                
                let cleanLocId = ''; let extractedCode = '';
                if (rawLoc.includes('(')) {
                    cleanLocId = rawLoc.split('(')[0].trim();
                    const afterParen = rawLoc.substring(rawLoc.indexOf('('));
                    const sIndex = afterParen.indexOf('S');
                    if (sIndex !== -1) extractedCode = afterParen.substring(sIndex).trim();
                } else { cleanLocId = rawLoc; }
                
                if (cleanLocId) { 
                    if (!existingLocMap[cleanLocId]) {
                        // ★ permanent 모드: 낯선 로케이션도 새로 생성 허용
                        if (mode === 'permanent') {
                            existingLocMap[cleanLocId] = { 
                                id: cleanLocId, dong: '', pos: '', code: '', name: '', 
                                option: '', stock: '0', stock2f: '0' 
                            };
                        } else {
                            skipCount++;
                            continue;
                        }
                    }

                    const zoneDocId = getZoneDocId(cleanLocId);
                    if (!zoneUpdates[zoneDocId]) zoneUpdates[zoneDocId] = {};
                    
                    const finalCode = extractedCode || row['상품코드']?.toString().trim() || '';
                    const existingData = existingLocMap[cleanLocId] || {};
                    
                    let cleanRawData = {};
                    customHeaders.forEach(k => {
                        // 엑셀 파싱 키와 customHeader 키 매칭 (공백/특수문자 무시)
                        const normalizeKey = (s) => (s || '').toString().replace(/[\s\u00A0\u200B\uFEFF]/g, '');
                        const normK = normalizeKey(k);
                        
                        // row에서 직접 매칭 시도
                        let rawVal = row[k];
                        if (rawVal === undefined) rawVal = row[normK];
                        
                        // 그래도 없으면 row의 모든 키를 정규화해서 비교
                        if (rawVal === undefined) {
                            for (const rowKey of Object.keys(row)) {
                                if (normalizeKey(rowKey) === normK) {
                                    rawVal = row[rowKey];
                                    break;
                                }
                            }
                        }
                        
                        if(rawVal !== undefined && rawVal !== null && rawVal.toString().trim() !== "") {
                            const strVal = rawVal.toString().trim();
                            const numVal = parseFloat(strVal);
                            if(!isNaN(numVal) && numVal > 40000 && numVal < 60000 && strVal.includes('.')) {
                                cleanRawData[k] = formatExcelDate(numVal);
                            } else if(!isNaN(numVal) && Number.isInteger(numVal) && numVal > 40000 && numVal < 60000) {
                                cleanRawData[k] = formatExcelDate(numVal);
                            } else {
                                cleanRawData[k] = strVal;
                            }
                        }
                    });

                    let updateData = zoneUpdates[zoneDocId][cleanLocId] || { 
                        dong: existingData.dong || '',
                        pos: existingData.pos || '',
                        reserved: false, 
                        reservedAt: 0, 
                        reservedBy: '',
                        assignedAt: 0,
                        preAssigned: existingData.preAssigned || false,
                        preAssignedCode: existingData.preAssignedCode || '',
                        preAssignedName: existingData.preAssignedName || '',
                        preAssignedQty: existingData.preAssignedQty || '',
                        preAssignedAt: existingData.preAssignedAt || 0,
                        codeTag: existingData.codeTag || '',
                        codeTagAt: existingData.codeTagAt || 0
                    };

                    updateData.updatedAt = new Date();
                    updateData.rawDataStr = JSON.stringify(cleanRawData);
                    updateData.rawData = deleteField();
                    
                    if (mode === 'permanent') {
                        updateData.dong = ('동' in row || 'dong' in row) ? (row['동'] || row['dong'] || '').toString().trim() : (existingData.dong || '');
                        updateData.pos = ('위치' in row || 'pos' in row) ? (row['위치'] || row['pos'] || '').toString().trim() : (existingData.pos || '');
                        updateData.code = existingData.code || '';
                        updateData.name = existingData.name || '';
                        updateData.option = existingData.option || '';
                        updateData.stock = existingData.stock || '0';
                        updateData.stock2f = existingData.stock2f || '0';
                        // ★ 칸수 필드 추가 (엑셀에 칸수 컬럼이 있으면 저장, 없으면 기존 값 유지)
                        if ('칸수' in row || 'angleSize' in row) {
                            const rawAngle = (row['칸수'] || row['angleSize'] || '').toString().trim();
                            updateData.angleSize = rawAngle;
                        } else {
                            updateData.angleSize = existingData.angleSize || '';
                        }
                    } else {
                        updateData.code = finalCode || '';
                        updateData.name = row['상품명']?.toString().trim() || '';
                        updateData.option = row['옵션']?.toString().trim() || '';
                        updateData.stock = row['정상재고']?.toString().trim() || '0';
                        updateData.stock2f = row['2층창고재고']?.toString().trim() || '0';
                        
                        if (finalCode && finalCode.trim() !== '') {
                            updateData.preAssigned = false;
                            updateData.preAssignedCode = '';
                            updateData.preAssignedName = '';
                            updateData.preAssignedQty = '';
                            updateData.preAssignedAt = 0;
                        }
                    }
                    
                    zoneUpdates[zoneDocId][cleanLocId] = updateData;
                    updateCount++;
                }
            }
        }
        
        let currentBatchLocCount = 0;
        for (let zoneId in zoneUpdates) {
            const zoneData = zoneUpdates[zoneId];
            
            batch.set(doc(db, LOC_COLLECTION, zoneId), zoneData, { merge: true });
            currentBatchLocCount++;
            
            if (currentBatchLocCount >= 200) { 
                await batch.commit(); 
                batch = writeBatch(db); 
                currentBatchLocCount = 0; 
            }
        }
        if (currentBatchLocCount > 0) {
            await batch.commit();
        }
        
        // v4.4: 2F SKU 데이터 Firestore에 저장 (daily 모드에서만)
        let twoFloorMsgPart = '';
        if (mode === 'daily') {
            try {
                const twoFloorData = {
                    skuCount: twoFloorCodes.size,
                    totalStock: twoFloorStockSum,
                    codes: Array.from(twoFloorCodes), // 디버그/검증용
                    savedAt: new Date(),
                    sourceDate: window._v44_getTodayDateString ? window._v44_getTodayDateString() : new Date().toISOString().slice(0, 10)
                };
                await setDoc(doc(db, 'artifacts', 'team-work-logger-v2', 'locationStock', 'twoFloorLatest'), twoFloorData);
                console.log('[v4.4] 2F SKU 데이터 저장 완료: SKU', twoFloorCodes.size, '개 / 총 재고', twoFloorStockSum);
                twoFloorMsgPart = `\n(2F 상품 ${twoFloorCodes.size}종 / 재고 ${twoFloorStockSum.toLocaleString()}장도 별도 집계됨)`;
                
                // 메모리 캐시 갱신 (대시보드 즉시 반영용)
                window._cached2FloorStock = twoFloorData;
            } catch (e) {
                console.error('[v4.4] 2F SKU 저장 실패:', e);
            }
            
            // v4.4 v2: 재고 스냅샷 저장 (회전율 계산용)
            // 트리거 시점: 일일 최신화 업로드 직후 (마감 트리거 대체)
            // originalData는 batch.commit() 이후 onSnapshot으로 비동기 갱신되므로 잠시 대기
            setTimeout(() => {
                if (typeof window._v44_saveStockSnapshot === 'function') {
                    window._v44_saveStockSnapshot().then(ok => {
                        if (ok) {
                            // 대시보드 보고 있으면 자동 새로고침
                            const dashView = document.getElementById('view-dashboard');
                            if (dashView && dashView.style.display !== 'none' && typeof window._v44_renderDashboard === 'function') {
                                window._v44_renderDashboard();
                            }
                        }
                    });
                }
            }, 2000);  // onSnapshot으로 originalData 반영될 시간 확보
        }
        
        if (mode === 'permanent') {
            alert(`✅ 완료! ${updateCount}개 로케이션의 랙 구조(동/위치) 영구 세팅이 완료되었습니다.`);
        } else {
            let msg = `✅ 스마트 클린 업데이트 완료!\n과거 유령 재고는 완벽히 비워졌고, 엑셀의 최신 데이터 ${updateCount}건만 정확하게 반영되었습니다.`;
            if(skipCount > 0) msg += `\n(※ 기존 도면에 없거나 2F 로케이션 ${skipCount}건은 3층 시스템에서 무시됨)`;
            if(twoFloorMsgPart) msg += twoFloorMsgPart;
            alert(msg);
            
            // v3.97b: 일일 최신화 완료 후 단종 페어 자동 정리 (비동기, alert 차단 안 함)
            setTimeout(() => { window.cleanupDeprecatedPairs().catch(e => console.error('[cleanup] 오류:', e)); }, 100);
        }
        
    } catch (error) { 
        console.error("실패:", error); 
        alert("업데이트 중 오류가 발생했습니다. (콘솔 확인)"); 
    } finally { 
        if(document.getElementById('excel-upload-a')) document.getElementById('excel-upload-a').value = ''; 
        if(document.getElementById('excel-upload-permanent')) document.getElementById('excel-upload-permanent').value = ''; 
        window.hideLoading(); 
    }
}

// ===== v3.97b: 단종 상품 페어 자동 정리 =====
// 호출 시점: 일일 최신화(updateDatabaseA mode='daily') 완료 직후
// 단종 판정 조건 (3개 모두 만족):
//   1. 마지막배송일 30일+ 경과 (빈칸은 제외 = 신규 상품 보호)
//   2. 재고 0
//   3. 입고대기 0
// 동작:
//   - 한쪽이라도 단종이면 OrderPairsChunks의 페어 삭제 (엄격)
//   - 단종 상품의 OrderStatsChunks 단독 통계도 삭제
//   - 결과는 console.log만 (조용히)
//   - 상세 로그는 DeprecatedLog 컬렉션에 저장
window.cleanupDeprecatedPairs = async function() {
    console.log('[cleanup] 단종 페어 정리 시작...');
    
    try {
        // 1. 안전장치: OrderPairsChunks 비어있으면 종료
        const pairsSnap = await getDocs(collection(db, ORDER_PAIRS_COLL));
        if (pairsSnap.empty) {
            console.log('[cleanup] 페어 데이터 없음. 정리 건너뜀.');
            return;
        }
        
        // 2. 마지막배송일 컬럼 존재 확인 (rawData에 한 번이라도 나타나는지)
        const getRawVal = (rd, targetKey) => {
            if (!rd) return '';
            if (rd[targetKey]) return rd[targetKey];
            const norm = targetKey.replace(/[\s\u00A0]/g, '');
            for (const k of Object.keys(rd)) {
                if (k.replace(/[\s\u00A0]/g, '') === norm) return rd[k];
            }
            return '';
        };
        
        let hasLastDeliveryColumn = false;
        for (const loc of originalData) {
            if (getRawVal(loc.rawData, '마지막배송일')) {
                hasLastDeliveryColumn = true;
                break;
            }
        }
        if (!hasLastDeliveryColumn) {
            console.warn('[cleanup] 마지막배송일 컬럼이 데이터에 없음. 잘못된 정리를 방지하기 위해 건너뜀.');
            return;
        }
        
        // 3. incomingTotalByCode 상태 점검 (경고만)
        if (!incomingTotalByCode || Object.keys(incomingTotalByCode).length === 0) {
            console.warn('[cleanup] incomingTotalByCode가 비어있음. 시트 동기화를 먼저 수행하지 않았다면 단종 판정이 부정확할 수 있음.');
        }
        
        // 4. 30일 cutoff 날짜 계산
        const now = new Date();
        const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        
        // 5. 상품코드별로 그룹핑 (마지막배송일, 재고 합계 집계)
        const codeMap = {}; // { code: { lastDelivery, totalStock, locIds: [] } }
        originalData.forEach(loc => {
            const code = (loc.code || '').toString().trim();
            if (!code || code === loc.id) return;
            
            if (!codeMap[code]) codeMap[code] = { lastDelivery: '', totalStock: 0, locIds: [] };
            
            // 마지막배송일: 가장 최근 값 (마지막배송일 우선, 없으면 마지막입고일 fallback)
            let val = getRawVal(loc.rawData, '마지막배송일');
            if (!val) val = getRawVal(loc.rawData, '마지막입고일');
            if (val && val > codeMap[code].lastDelivery) codeMap[code].lastDelivery = val;
            
            codeMap[code].totalStock += Number(loc.stock || 0);
            codeMap[code].locIds.push(loc.id);
        });
        
        // 6. 단종 상품 판정
        const deprecatedSet = new Set();
        const deprecatedDetail = []; // [{code, lastDelivery, totalStock, incomingQty, locIds}]
        
        for (const code in codeMap) {
            const info = codeMap[code];
            
            // 조건 1: 마지막배송일 빈칸 → 신규 상품으로 간주, 제외
            if (!info.lastDelivery) continue;
            
            // 조건 1: 마지막배송일 30일+ 경과
            if (info.lastDelivery >= cutoffStr) continue;
            
            // 조건 2: 재고 0
            if (info.totalStock > 0) continue;
            
            // 조건 3: 입고대기 0
            const incomingQty = Number(incomingTotalByCode[code] || 0);
            if (incomingQty > 0) continue;
            
            // 모두 만족 → 단종으로 판정
            deprecatedSet.add(code);
            deprecatedDetail.push({
                code,
                lastDelivery: info.lastDelivery,
                totalStock: info.totalStock,
                incomingQty,
                locIds: info.locIds.join(', ')
            });
        }

        // ===== v3.97c: 자리 없는 페어 정리 (사각지대 해결) =====
        // 페어 데이터에는 있지만 originalData에 자리 없는 상품 검사
        // 조건: 입고대기 0 AND lastDate(페어 최근 함께 산 날) 30일+ 경과
        const allPairCodes = new Set();
        const codeLastDate = {}; // 상품코드별 페어/통계 lastDate 중 최대값
        
        // 페어 데이터에서 모든 상품코드 + lastDate 수집
        try {
            const pairsSnapForOrphan = await getDocs(collection(db, ORDER_PAIRS_COLL));
            pairsSnapForOrphan.forEach(d => {
                try {
                    const arr = JSON.parse(d.data().dataStr || '[]');
                    arr.forEach(p => {
                        if (p.cA) {
                            allPairCodes.add(p.cA);
                            if (!codeLastDate[p.cA] || (p.d && p.d > codeLastDate[p.cA])) {
                                codeLastDate[p.cA] = p.d || '';
                            }
                        }
                        if (p.cB) {
                            allPairCodes.add(p.cB);
                            if (!codeLastDate[p.cB] || (p.d && p.d > codeLastDate[p.cB])) {
                                codeLastDate[p.cB] = p.d || '';
                            }
                        }
                    });
                } catch (e) {}
            });
            
            const statsSnapForOrphan = await getDocs(collection(db, ORDER_STATS_COLL));
            statsSnapForOrphan.forEach(d => {
                try {
                    const arr = JSON.parse(d.data().dataStr || '[]');
                    arr.forEach(s => {
                        if (s.c) {
                            allPairCodes.add(s.c);
                            if (!codeLastDate[s.c] || (s.d && s.d > codeLastDate[s.c])) {
                                codeLastDate[s.c] = s.d || '';
                            }
                        }
                    });
                } catch (e) {}
            });
        } catch (e) {
            console.warn('[cleanup-v3.97c] 페어/통계 lastDate 수집 실패:', e);
        }
        
        // 자리 없는 상품 = 페어 데이터에 있지만 codeMap(originalData)에 없음
        let orphanCount = 0;
        for (const code of allPairCodes) {
            if (codeMap[code]) continue; // 자리 있는 상품은 위에서 이미 처리됨
            if (deprecatedSet.has(code)) continue; // 이미 단종 판정된 경우 스킵
            
            // 자리 없는 상품의 단종 조건
            const incomingQty = Number(incomingTotalByCode[code] || 0);
            if (incomingQty > 0) continue; // 입고대기 있으면 보호 (재입고 예정)
            
            const lastDate = codeLastDate[code] || '';
            if (!lastDate) continue; // lastDate 없으면 판단 불가, 보호
            if (lastDate >= cutoffStr) continue; // 최근 30일 이내 함께 팔림 = 보호
            
            // 자리 없음 + 입고대기 0 + lastDate 30일+ 경과 → 단종 판정
            deprecatedSet.add(code);
            deprecatedDetail.push({
                code,
                lastDelivery: '(자리 없음)',
                totalStock: 0,
                incomingQty,
                locIds: '(없음, 페어 lastDate: ' + lastDate + ')'
            });
            orphanCount++;
        }
        
        if (orphanCount > 0) {
            console.log(`[cleanup-v3.97c] 자리 없는 단종 상품 ${orphanCount}개 추가 발견`);
        }
        // ===== v3.97c 끝 =====
        
        if (deprecatedSet.size === 0) {
            console.log('[cleanup] 단종 상품 없음. 정리 종료.');
            return;
        }
        
        console.log(`[cleanup] 단종 상품 ${deprecatedSet.size}개 발견:`, [...deprecatedSet]);
        
        // 7. OrderPairsChunks 로드 → 단종 페어 필터링 → 다시 쓰기
        const allPairs = [];
        pairsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(p => allPairs.push(p));
            } catch (e) {}
        });
        
        const survivingPairs = allPairs.filter(p => 
            !deprecatedSet.has(p.cA) && !deprecatedSet.has(p.cB)
        );
        const deletedPairCount = allPairs.length - survivingPairs.length;
        
        // 8. OrderStatsChunks 로드 → 단종 상품 통계 필터링 → 다시 쓰기
        const statsSnap = await getDocs(collection(db, ORDER_STATS_COLL));
        const allStats = [];
        statsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(s => allStats.push(s));
            } catch (e) {}
        });
        
        const survivingStats = allStats.filter(s => !deprecatedSet.has(s.c));
        const deletedStatCount = allStats.length - survivingStats.length;
        
        // 9. 기존 청크 모두 삭제 후 새로 작성 (페어)
        let batch = writeBatch(db);
        let bc = 0;
        pairsSnap.forEach(d => { batch.delete(d.ref); bc++; if (bc >= 400) { batch.commit(); batch = writeBatch(db); bc = 0; } });
        if (bc > 0) await batch.commit();
        
        batch = writeBatch(db);
        bc = 0;
        let chunkIdx = 0;
        for (let i = 0; i < survivingPairs.length; i += CHUNK_SIZE_PAIRS) {
            const chunk = survivingPairs.slice(i, i + CHUNK_SIZE_PAIRS);
            const docRef = doc(db, ORDER_PAIRS_COLL, `CHUNK_${chunkIdx}`);
            batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            chunkIdx++;
            bc++;
            if (bc >= 400) { await batch.commit(); batch = writeBatch(db); bc = 0; }
        }
        if (bc > 0) await batch.commit();
        
        // 10. 기존 청크 모두 삭제 후 새로 작성 (단독 통계)
        batch = writeBatch(db);
        bc = 0;
        statsSnap.forEach(d => { batch.delete(d.ref); bc++; if (bc >= 400) { batch.commit(); batch = writeBatch(db); bc = 0; } });
        if (bc > 0) await batch.commit();
        
        batch = writeBatch(db);
        bc = 0;
        chunkIdx = 0;
        for (let i = 0; i < survivingStats.length; i += CHUNK_SIZE_STATS) {
            const chunk = survivingStats.slice(i, i + CHUNK_SIZE_STATS);
            const docRef = doc(db, ORDER_STATS_COLL, `CHUNK_${chunkIdx}`);
            batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            chunkIdx++;
            bc++;
            if (bc >= 400) { await batch.commit(); batch = writeBatch(db); bc = 0; }
        }
        if (bc > 0) await batch.commit();
        
        // 11. DeprecatedLog 컬렉션에 상세 로그 저장 (날짜별 1문서)
        const logDocId = new Date().toISOString().slice(0, 10) + '_' + Date.now();
        await setDoc(doc(db, 'DeprecatedLog', logDocId), {
            cleanedAt: Date.now(),
            cleanedAtDate: new Date().toISOString().slice(0, 10),
            cutoffDate: cutoffStr,
            deprecatedCount: deprecatedSet.size,
            deletedPairCount,
            deletedStatCount,
            details: JSON.stringify(deprecatedDetail)
        });
        
        // 12. INFO_CONFIG의 orderAnalysisMeta 갱신 (페어/상품 카운트 동기화)
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), {
            orderAnalysisMeta: {
                lastCleanupAt: Date.now(),
                lastCleanupDate: new Date().toISOString().slice(0, 10),
                totalPairs: survivingPairs.length,
                totalCodes: survivingStats.length
            }
        }, { merge: true });
        
        console.log(`[cleanup] 완료: 단종 ${deprecatedSet.size}건 정리, 페어 ${deletedPairCount}개 삭제, 통계 ${deletedStatCount}개 삭제.`);
        console.log(`[cleanup] 상세 로그: DeprecatedLog/${logDocId}`);
        
        // v3.98: 페어 캐시 갱신
        if (typeof window.loadOrderPairsCache === 'function') {
            window.loadOrderPairsCache();
        }
    } catch (e) {
        console.error('[cleanup] 단종 정리 중 오류:', e);
    }
};

// ===== v3.98: 페어 데이터 캐시 로드 (showRecommendation에서 사용) =====
window.loadOrderPairsCache = async function() {
    try {
        const pairsSnap = await getDocs(collection(db, ORDER_PAIRS_COLL));
        const statsSnap = await getDocs(collection(db, ORDER_STATS_COLL));
        
        const pairs = [];
        pairsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(p => pairs.push({ codeA: p.cA, codeB: p.cB, count: p.c, lastDate: p.d }));
            } catch (e) {}
        });
        
        const stats = {};
        statsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(s => { stats[s.c] = { code: s.c, count: s.n, lastDate: s.d }; });
            } catch (e) {}
        });
        
        let meta = {};
        try {
            const cfgSnap = await getDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'));
            if (cfgSnap.exists()) {
                meta = cfgSnap.data().orderAnalysisMeta || {};
            }
        } catch (e) {}
        
        window._cachedOrderPairs = pairs;
        window._cachedOrderStats = stats;
        window._cachedOrderMeta = meta;
        
        console.log(`[v3.98] 페어 캐시 로드 완료: ${pairs.length}개 페어, ${Object.keys(stats).length}개 상품`);
    } catch (e) {
        console.warn('[v3.98] 페어 캐시 로드 실패:', e);
        window._cachedOrderPairs = [];
        window._cachedOrderStats = {};
        window._cachedOrderMeta = {};
    }
};

window.copyLocationToClipboard = async (event, locId) => {
    event.stopPropagation(); 
    
    if (window.isPreAssignMode) {
        window.handleRowClick(event, locId);
        return;
    }
    
    try {
        const zoneDocId = getZoneDocId(locId);
        const docRef = doc(db, LOC_COLLECTION, zoneDocId);
        const snap = await getDoc(docRef);
        
        if (snap.exists() && snap.data()[locId]) {
            const data = snap.data()[locId]; 
            const now = new Date().getTime();
            const isReserved = data.reserved === true; 
            const reserverName = data.reservedBy || '다른 작업자';
            
            if (isReserved && reserverName === currentUserName) {
                if (confirm(`[${locId}] 내가 예약한 자리입니다.\n해제하시겠습니까?`)) {
                    await setDoc(docRef, { [locId]: { reserved: false, reservedAt: 0, reservedBy: '', assignedAt: 0, codeTag: '', codeTagAt: 0, updatedAt: new Date() } }, { merge: true });
                    showToast(`[${locId}] 해제 완료`);
                } else { navigator.clipboard.writeText(locId); showToast(`[${locId}] 복사 완료!`); }
                return;
            }
            
            if (isReserved) {
                if (confirm(`[${locId}]은 현재 [${reserverName}]님이 사용 중입니다.\n강제로 예약을 가져오시겠습니까?`)) {
                    await setDoc(docRef, { [locId]: { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName, codeTag: '당일지정', codeTagAt: now, updatedAt: new Date() } }, { merge: true });
                    navigator.clipboard.writeText(locId); showToast(`[${locId}] 강제 복사 완료!`);
                }
                return; 
            }
            
            if (data.preAssigned) { 
                // 선지정 자리: 예약(복사)만 진행, codeTag는 선지정 유지
                await setDoc(docRef, { [locId]: { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName, updatedAt: new Date() } }, { merge: true });
                navigator.clipboard.writeText(locId).then(() => { showToast(`[${locId}] 복사 및 예약 완료! (선지정 유지)`); });
                return;
            }
            
            await setDoc(docRef, { [locId]: { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName, codeTag: '당일지정', codeTagAt: now, updatedAt: new Date() } }, { merge: true });
            navigator.clipboard.writeText(locId).then(() => { showToast(`[${locId}] 복사 및 예약 완료!`); });
        }
    } catch (error) { alert('예약 처리 오류'); }
};

function showToast(message) {
    const toast = document.getElementById("toast");
    if(toast) { toast.innerText = message; toast.classList.add("show"); setTimeout(() => { toast.classList.remove("show"); }, 1500); }
}

window.addSingleLocationFromSetting = async () => {
    const inputObj = document.getElementById('setting-new-loc'); const newId = inputObj.value.trim().toUpperCase();
    if (!newId) return alert("로케이션 번호를 입력하세요.");
    try {
        const zoneDocId = getZoneDocId(newId);
        const docRef = doc(db, LOC_COLLECTION, zoneDocId); 
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data()[newId]) return alert(`이미 존재합니다.`);
        await setDoc(docRef, { [newId]: { dong: '', pos: '', code: '', name: '', option: '', stock: '0', reserved: false, reservedAt: 0, assignedAt: 0, reservedBy: '', updatedAt: new Date(), rawData: {} } }, { merge: true });
        inputObj.value = ''; alert(`✅ 추가 완료`); 
    } catch (error) { console.error(error); }
};

window.deleteSelectedLocations = async () => {
    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    if (checkedBoxes.length === 0) return alert("삭제할 대상을 선택하세요.");
    if (!confirm(`정말 삭제하시겠습니까?`)) return;
    try {
        let batch = writeBatch(db); let batchCount = 0;
        for (let i = 0; i < checkedBoxes.length; i++) {
            const locId = checkedBoxes[i].value;
            const zoneDocId = getZoneDocId(locId);
            batch.set(doc(db, LOC_COLLECTION, zoneDocId), { [locId]: deleteField() }, { merge: true });
            batchCount++;
            if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        alert(`🗑️ 삭제 완료`); 
    } catch (error) { console.error(error); }
};

window.renderIncomingQueue = function() {
    const container = document.getElementById('incoming-list');
    if(!container) return;
    const filterSource = document.getElementById('filter-source')?.value || 'all';
    const sortType = document.getElementById('sort-incoming')?.value || 'qty-desc';

    let existingLocMap = {}; 
    originalData.forEach(loc => {
        if(loc.preAssigned && loc.preAssignedCode) existingLocMap[loc.preAssignedCode] = true;
        if(loc.code && loc.code !== loc.id) existingLocMap[loc.code] = true;
    });

    let list = [];
    for(let code in incomingData) { list.push(incomingData[code]); }

    // ★ v3.53: 오늘 날짜 (YYYY-MM-DD)
    const _today = new Date().toISOString().slice(0, 10);
    list = list.filter(item => {
        if(filterSource !== 'all' && item.source !== filterSource) return false;
        if(existingLocMap[item['상품코드']]) return false; 
        
        if(!item['표시날짜'] || item['표시날짜'].toString().trim() === '') return false;
        
        const arrivalDate = (item['도착예상일'] || item['표시날짜'] || '').toString().trim();
        if (arrivalDate && arrivalDate < _today) return false;
        
        return true;
    });

    // 추천 자리 미리 배정 (일괄 적용과 동일 순서: 출고예상일 빠른 순 → 미입고수량 많은 순)
    // → 표시 정렬과 무관하게 상품마다 서로 다른 자리, 그리고 실제 일괄적용 결과와 일치
    const recLocMap = {};
    if (typeof window.calcIncomingRecommend === 'function') {
        const _usedRec = new Set();
        const _canon = list.slice().sort((a, b) => {
            const dA = (a['표시날짜'] || '9999-99-99').toString();
            const dB = (b['표시날짜'] || '9999-99-99').toString();
            if (dA !== dB) return dA.localeCompare(dB);
            return Number(b['입고대기수량'] || 0) - Number(a['입고대기수량'] || 0);
        });
        for (const _it of _canon) {
            const _c = _it['상품코드'];
            if (!_c || recLocMap[_c]) continue;
            try {
                const _r = window.calcIncomingRecommend(_c, _usedRec);
                if (_r && _r.loc && _r.loc.id) { _usedRec.add(_r.loc.id); recLocMap[_c] = _r; }
            } catch (_e) { /* 카드는 그대로 표시 */ }
        }
    }

    list.sort((a, b) => {
        if(sortType === 'qty-desc') return Number(b['입고대기수량'] || 0) - Number(a['입고대기수량'] || 0);
        else if(sortType === 'date-asc') {
            let dA = a['표시날짜'] || '9999-99-99'; let dB = b['표시날짜'] || '9999-99-99';
            return dA.localeCompare(dB);
        }
        return 0;
    });

    let html = '';
    list.forEach(item => {
        let code = item['상품코드']; let qty = item['입고대기수량'] || 0;
        let name = item['상품명'] || '';
        let src = item.source || '-';
        let date = src === '제작' ? (item['공장출고예상일'] || item['표시날짜'] || '-') : (item['검수창고도착일'] || item['표시날짜'] || '-');
        let option = item['옵션'] || '';

        // [4단계] 추천 자리 (미리 배정된 맵에서 조회 — 일괄 적용과 동일 결과)
        let recHtml = '';
        const rec = recLocMap[code];
        if (rec && rec.loc && rec.loc.id) {
            const caseLabel = rec.case === 'A'
                ? `<span style="font-size:10px; color:#7b1fa2; font-weight:normal;">(페어 ${rec.partnerCount}개)</span>`
                : `<span style="font-size:10px; color:#777; font-weight:normal;">(우선순위)</span>`;
            recHtml = `<div style="margin-top:6px; padding-top:5px; border-top:1px dashed #ddd; font-size:11px; color:#1976d2;">📍 추천: <b>${rec.loc.id}</b> ${caseLabel}</div>`;
        }
        
        html += `
            <div class="incoming-item" onclick="activatePreAssignMode('${code}', '${name.replace(/'/g, "\\'")}', '${qty}', '${option.replace(/'/g, "\\'")}')">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <div style="font-weight:bold; color:var(--primary); font-size:14px;">${code}</div>
                    <span style="font-size:10px; background:${src==='제작'?'#e3f2fd':'#fbe9e7'}; color:${src==='제작'?'#1976d2':'#d84315'}; padding:2px 5px; border-radius:3px; font-weight:bold;">${src}</span>
                </div>
                <div style="font-size:12px; color:#333; margin-bottom:${option ? '2px' : '6px'};">${name}</div>
                ${option ? `<div style="font-size:11px; color:#777; margin-bottom:6px;">${option}</div>` : ''}
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
                    <span style="color:#555;">${src==='제작'?'출고일':'도착일'}: <b style="color:#d32f2f;">${date}</b></span>
                    <span style="color:#e65100; font-weight:bold; font-size:12px;">대기: ${qty}개</span>
                </div>
                ${recHtml}
            </div>
        `;
    });
    container.innerHTML = html || '<div style="text-align:center; padding:30px; color:#888;">지정이 필요한 상품이 없습니다.</div>';
};

window.activatePreAssignMode = function(code, name, qty, option = '') {
    window.isPreAssignMode = true;
    window.selectedPreAssignItem = { code, name, qty, option };
    document.getElementById('pre-assign-banner-text').innerText = `${code} (${name})`;
    document.getElementById('pre-assign-banner').style.display = 'flex';
    if (window.innerWidth < 1100) document.getElementById('incoming-sidebar').classList.remove('open');
};

window.cancelPreAssignMode = function() {
    window.isPreAssignMode = false;
    window.selectedPreAssignItem = null;
    document.getElementById('pre-assign-banner').style.display = 'none';
};

// =============================
// ★ v3.55: 툴팁 탭 시스템 (설명/메뉴얼 양쪽 편집 + 편집 중 잠금)
// =============================

// 기본 설명 텍스트 캐시 (최초 렌더링 시의 HTML 저장, 복원용)
const _ttDefaults = {};
// 편집 모드 플래그 (true일 때 툴팁 자동 닫힘 차단)
let _ttEditingLock = false;

// 헬퍼: suffix 기반 키로 저장된 값 읽기 (하위 호환 포함)
function _ttGetStored(key, tab) {
    const suffixKey = key + '__' + tab;
    if (customTooltips[suffixKey] !== undefined) return customTooltips[suffixKey];
    // 하위 호환: suffix 없는 키는 메뉴얼로 간주
    if (tab === 'manual' && customTooltips[key] !== undefined) return customTooltips[key];
    return '';
}

// applyCustomTooltips: 초기 1회 세팅용 (탭 구조 주입)
window.applyCustomTooltips = function() {
    document.querySelectorAll('.info-tip[data-tip-key]').forEach(tip => {
        const key = tip.getAttribute('data-tip-key');
        if (!key) return;
        if (key.startsWith('dyn-')) return; // v3.98a-fix2: 동적 콘텐츠 툴팁은 캐싱 안 함
        const content = tip.querySelector('.info-tip-content');
        if (!content) return;
        if (content.querySelector('.tt-tabs')) return;
        if (!_ttDefaults[key]) _ttDefaults[key] = content.innerHTML;
        _ttRenderTabs(tip, key);
    });
};

function _ttRenderTabs(tip, key, activeTab) {
    const content = tip.querySelector('.info-tip-content');
    if (!content) return;
    activeTab = activeTab || 'desc';
    
    // 설명 탭: 사용자 수정본이 있으면 그걸, 없으면 기본값
    const userDesc = _ttGetStored(key, 'desc');
    const descHtml = userDesc ? userDesc : (_ttDefaults[key] || '');
    const isDescCustom = !!userDesc;
    
    // 메뉴얼 탭: 사용자가 추가한 내용
    const manualHtml = (_ttGetStored(key, 'manual') || '').trim();
    
    content.innerHTML = `
        <div class="tt-tabs">
            <button type="button" class="tt-tab-btn ${activeTab==='desc'?'active':''}" data-tab="desc">📖 설명</button>
            <button type="button" class="tt-tab-btn ${activeTab==='manual'?'active':''}" data-tab="manual">📝 메뉴얼</button>
        </div>
        <div class="tt-tab-content tt-tab-desc ${activeTab==='desc'?'':'hidden'}">
            <div class="tt-view-wrap">
                <div class="tt-view-body">${descHtml}</div>
                <div class="tt-btn-row">
                    <button type="button" class="tt-btn-edit" data-target="desc">✏️ 편집</button>
                    ${isDescCustom ? '<button type="button" class="tt-btn-reset" data-target="desc">🔄 기본값 복원</button>' : ''}
                </div>
            </div>
        </div>
        <div class="tt-tab-content tt-tab-manual ${activeTab==='manual'?'':'hidden'}">
            <div class="tt-view-wrap">
                <div class="tt-view-body">${manualHtml ? manualHtml : '<div class="tt-empty">아직 등록된 메뉴얼이 없습니다.<br>아래 ✏️ 편집 버튼으로 추가하세요.</div>'}</div>
                <div class="tt-btn-row">
                    <button type="button" class="tt-btn-edit" data-target="manual">✏️ 편집</button>
                </div>
            </div>
        </div>
    `;
    
    // 탭 버튼 클릭
    content.querySelectorAll('.tt-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_ttEditingLock) return; // 편집 중엔 탭 전환 금지
            const tabName = btn.getAttribute('data-tab');
            content.querySelectorAll('.tt-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
            content.querySelector('.tt-tab-desc').classList.toggle('hidden', tabName !== 'desc');
            content.querySelector('.tt-tab-manual').classList.toggle('hidden', tabName !== 'manual');
        });
    });
    
    // 편집 버튼 (설명/메뉴얼 공용)
    content.querySelectorAll('.tt-btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = btn.getAttribute('data-target');
            _ttShowEditor(tip, key, target);
        });
    });
    
    // 기본값 복원 버튼 (설명 탭만)
    content.querySelectorAll('.tt-btn-reset').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('설명을 기본값으로 복원하시겠습니까?')) return;
            delete customTooltips[key + '__desc'];
            try {
                await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { customTooltips }, { merge: true });
                showToast("🔄 기본값으로 복원되었습니다.");
                _ttRenderTabs(tip, key, 'desc');
            } catch(err) { console.error(err); alert("복원 실패"); }
        });
    });
}

function _ttShowEditor(tip, key, target) {
    // target: 'desc' 또는 'manual'
    const content = tip.querySelector('.info-tip-content');
    const tabBody = content.querySelector(target === 'desc' ? '.tt-tab-desc' : '.tt-tab-manual');
    if (!tabBody) return;
    
    // 편집 모드 활성화 (자동 닫힘 차단)
    _ttEditingLock = true;
    tip.classList.add('tt-editing');
    
    // 현재 값 가져오기 (설명은 사용자본 or 기본값, 메뉴얼은 저장본)
    let currentVal;
    if (target === 'desc') {
        const userDesc = _ttGetStored(key, 'desc');
        currentVal = userDesc ? userDesc : (_ttDefaults[key] || '');
    } else {
        currentVal = _ttGetStored(key, 'manual');
    }
    
    // ★ v3.56: <br> → \n 역변환 (메모장처럼 표시)
    const displayVal = currentVal.replace(/<br\s*\/?>/gi, '\n');
    
    const labelText = target === 'desc' ? '📖 설명 편집' : '📝 메뉴얼 편집';
    
    tabBody.innerHTML = `
        <div class="tt-editor">
            <div class="tt-editor-label">${labelText}</div>
            <div class="tt-toolbar">
                <button type="button" class="tt-tb-btn" data-action="bold" title="굵게">𝐁</button>
                <div class="tt-tb-color-wrap">
                    <button type="button" class="tt-tb-btn" data-action="color-toggle" title="색상">🎨</button>
                    <div class="tt-tb-palette">
                        <button type="button" class="tt-color-swatch" data-color="#ff5252" style="background:#ff5252;" title="빨강"></button>
                        <button type="button" class="tt-color-swatch" data-color="#e65100" style="background:#e65100;" title="주황"></button>
                        <button type="button" class="tt-color-swatch" data-color="#fbc02d" style="background:#fbc02d;" title="노랑"></button>
                        <button type="button" class="tt-color-swatch" data-color="#2e7d32" style="background:#2e7d32;" title="초록"></button>
                        <button type="button" class="tt-color-swatch" data-color="#1976d2" style="background:#1976d2;" title="파랑"></button>
                        <button type="button" class="tt-color-swatch tt-color-none" data-color="" title="색상 제거">✕</button>
                    </div>
                </div>
                <button type="button" class="tt-tb-btn" data-action="hr" title="구분선 삽입">━</button>
            </div>
            <textarea class="tt-editor-textarea" placeholder="메모장처럼 자유롭게 입력하세요.&#10;엔터로 줄바꿈, 위 버튼으로 서식 적용"></textarea>
            <div class="tt-editor-btns">
                <button type="button" class="tt-btn-cancel">❌ 취소</button>
                <button type="button" class="tt-btn-save">💾 저장</button>
            </div>
        </div>
    `;
    
    const textarea = tabBody.querySelector('.tt-editor-textarea');
    textarea.value = displayVal;
    textarea.focus();
    
    // 모든 마우스/키보드 이벤트 전파 차단
    ['click','mousedown','mouseup','mousemove','keydown','keyup'].forEach(ev => {
        textarea.addEventListener(ev, (e) => e.stopPropagation());
    });
    
    // ★ v3.56: 서식 툴바 헬퍼 - 커서 위치 또는 선택 영역에 태그 삽입
    function _ttInsertWrap(openTag, closeTag) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        const selected = val.substring(start, end);
        const before = val.substring(0, start);
        const after = val.substring(end);
        const newText = before + openTag + selected + closeTag + after;
        textarea.value = newText;
        // 선택 영역이 있었으면 그 뒤로 커서, 없으면 태그 사이로
        if (selected) {
            const newPos = start + openTag.length + selected.length + closeTag.length;
            textarea.setSelectionRange(newPos, newPos);
        } else {
            const newPos = start + openTag.length;
            textarea.setSelectionRange(newPos, newPos);
        }
        textarea.focus();
    }
    
    function _ttInsertText(text) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        textarea.value = val.substring(0, start) + text + val.substring(end);
        const newPos = start + text.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
    }
    
    // 서식 버튼 이벤트
    tabBody.querySelectorAll('.tt-tb-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.getAttribute('data-action');
            if (action === 'bold') {
                _ttInsertWrap('<b>', '</b>');
            } else if (action === 'hr') {
                _ttInsertText('<br>━━━━━━━━━<br>');
            } else if (action === 'color-toggle') {
                const palette = tabBody.querySelector('.tt-tb-palette');
                palette.classList.toggle('open');
            }
        });
    });
    
    // 색상 팔레트 클릭
    tabBody.querySelectorAll('.tt-color-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            const color = swatch.getAttribute('data-color');
            if (color) {
                _ttInsertWrap(`<span style="color:${color};">`, '</span>');
            } else {
                // 색상 제거: 선택 영역의 color span 태그만 제거
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const val = textarea.value;
                const selected = val.substring(start, end);
                const cleaned = selected.replace(/<span\s+style="color:[^"]*;?">/gi, '').replace(/<\/span>/gi, '');
                textarea.value = val.substring(0, start) + cleaned + val.substring(end);
                textarea.setSelectionRange(start, start + cleaned.length);
            }
            tabBody.querySelector('.tt-tb-palette').classList.remove('open');
            textarea.focus();
        });
    });
    
    // 팔레트 외부 클릭 시 닫기
    tabBody.addEventListener('click', (e) => {
        if (!e.target.closest('.tt-tb-color-wrap')) {
            const palette = tabBody.querySelector('.tt-tb-palette');
            if (palette) palette.classList.remove('open');
        }
    });
    
    tabBody.querySelector('.tt-btn-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        _ttEditingLock = false;
        tip.classList.remove('tt-editing');
        _ttRenderTabs(tip, key, target);
    });
    
    tabBody.querySelector('.tt-btn-save').addEventListener('click', async (e) => {
        e.stopPropagation();
        // ★ v3.56: \n (엔터) → <br> 자동 변환 후 저장
        const rawVal = textarea.value.trim();
        const newVal = rawVal.replace(/\r?\n/g, '<br>');
        const storeKey = key + '__' + target;
        if (newVal) {
            customTooltips[storeKey] = newVal;
        } else {
            delete customTooltips[storeKey];
        }
        // 하위 호환: 메뉴얼 저장 시 구버전 키도 정리
        if (target === 'manual' && customTooltips[key] !== undefined && customTooltips[key] !== newVal) {
            delete customTooltips[key];
        }
        try {
            await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { customTooltips }, { merge: true });
            showToast(`✅ ${target === 'desc' ? '설명' : '메뉴얼'}이 저장되었습니다.`);
            _ttEditingLock = false;
            tip.classList.remove('tt-editing');
            _ttRenderTabs(tip, key, target);
        } catch(err) { console.error(err); alert("저장 실패"); }
    });
}

// 툴팁 열기/닫기 + 위치 계산
let _ttHideTimer = null;
let _ttCurrentTip = null;

function _ttOpenTip(tip) {
    if (_ttHideTimer) { clearTimeout(_ttHideTimer); _ttHideTimer = null; }
    const key = tip.getAttribute('data-tip-key');
    if (!key) return;
    
    document.querySelectorAll('.info-tip.tip-open').forEach(t => {
        if (t !== tip) {
            // 다른 툴팁이 편집 중이면 닫지 않음
            if (t.classList.contains('tt-editing')) return;
            t.classList.remove('tip-open');
            _ttResetTab(t);
        }
    });
    
    tip.classList.add('tip-open');
    _ttCurrentTip = tip;
    
    const content = tip.querySelector('.info-tip-content');
    if (!content) return;
    
    const r = tip.getBoundingClientRect();
    const cw = content.offsetWidth || 320;
    const ch = content.offsetHeight || 120;
    let x = r.left + r.width / 2 - cw / 2;
    let y = r.top - ch - 10;
    if (y < 8) y = r.bottom + 10;
    if (x < 8) x = 8;
    if (x + cw > window.innerWidth - 8) x = window.innerWidth - cw - 8;

    // v3.97c: 모달 안의 툴팁이면 모달 컨테이너 경계 내로 추가 보정
    const modalContent = tip.closest('.modal-content');
    if (modalContent) {
        const mr = modalContent.getBoundingClientRect();
        if (x < mr.left + 8) x = mr.left + 8;
        if (x + cw > mr.right - 8) x = mr.right - cw - 8;
        // 모달 자체가 cw보다 좁은 경우 보호
        if (x < 8) x = 8;
    }

    content.style.left = x + 'px';
    content.style.top = y + 'px';
}

function _ttResetTab(tip) {
    // 편집 중이면 리셋 금지
    if (_ttEditingLock && tip.classList.contains('tt-editing')) return;
    const content = tip.querySelector('.info-tip-content');
    if (!content) return;
    const key = tip.getAttribute('data-tip-key');
    if (!key) return;
    if (key.startsWith('dyn-')) return; // v3.98a-fix2: 동적 콘텐츠는 리셋하지 않음
    // 설명 탭으로 리셋
    _ttRenderTabs(tip, key, 'desc');
}

function _ttScheduleHide() {
    // 편집 중이면 자동 닫힘 차단
    if (_ttEditingLock) return;
    if (_ttHideTimer) clearTimeout(_ttHideTimer);
    _ttHideTimer = setTimeout(() => {
        if (_ttCurrentTip && !_ttCurrentTip.classList.contains('tt-editing')) {
            _ttCurrentTip.classList.remove('tip-open');
            _ttResetTab(_ttCurrentTip);
            _ttCurrentTip = null;
        }
    }, 300);
}

// 이벤트 바인딩 (v3.80 클릭 토글 방식)
document.addEventListener('click', function(e) {
    const tip = e.target.closest('.info-tip[data-tip-key]');
    const content = e.target.closest('.info-tip-content');

    // 1. ℹ️ 아이콘(또는 툴팁 트리거) 클릭 시 (단, 툴팁 본문 내부 클릭은 제외)
    if (tip && !content) {
        e.stopPropagation(); e.preventDefault(); // 외부 클릭 닫기 방지 + label 등 부모 기본동작 차단
        
        // 초기화 로직 (기존 유지)
        if (!tip.querySelector('.tt-tabs')) {
            const key = tip.getAttribute('data-tip-key');
            // v3.98a-fix2: 동적 콘텐츠 툴팁은 초기화/캐싱 없이 토글만 처리
            if (key && key.startsWith('dyn-')) {
                // 토글 동작으로 바로 이동 (탭 구조 주입 안 함)
            } else {
                if (!_ttDefaults[key]) {
                    const innerContent = tip.querySelector('.info-tip-content');
                    if (innerContent) _ttDefaults[key] = innerContent.innerHTML;
                }
                _ttRenderTabs(tip, key);
            }
        }

        // 토글 동작
        if (tip.classList.contains('tip-open')) {
            if (!_ttEditingLock) { // 편집 중이 아닐 때만 닫기
                tip.classList.remove('tip-open');
                _ttResetTab(tip);
                _ttCurrentTip = null;
            }
        } else {
            _ttOpenTip(tip); // 이 함수가 다른 열린 툴팁을 자동으로 닫음
        }
        return;
    }

    // 2. 툴팁 본문 내부 클릭 시 (편집 등 동작을 위해 아무것도 안 함)
    if (content) return;

    // 3. 그 외 외부 빈 공간 클릭 시 (열려있는 툴팁 닫기)
    document.querySelectorAll('.info-tip.tip-open').forEach(openTip => {
        if (!openTip.classList.contains('tt-editing')) { // 편집 중인 경우 제외
            openTip.classList.remove('tip-open');
            _ttResetTab(openTip);
        }
    });
    _ttCurrentTip = null;
}, true);

// =============================
// 🗺️ 도면 보기 (거리뷰)
// =============================
let currentCorridorIdx = 0;
let svCorridorList = [];
// 도면보기 범례 필터: null | 'empty' | 'content' | 'reserved' | 'preassigned'
let _mapLegendFilter = null;
// 범례 ON 시 모든 구역 표시 모드 (true: 모든 구역 순회, false: currentCorridorIdx 한 구역만)
let _mapShowAllZones = false;

window.updateMapCellSize = function(val) {
    document.getElementById('map-cell-size-label').innerText = val + 'px';
    renderCorridor(currentCorridorIdx);
};

// 도면보기 범례 클릭 → 필터 토글
window.setMapLegendFilter = function(filterType) {
    if (_mapLegendFilter === filterType) {
        _mapLegendFilter = null; // 같은 거 다시 클릭 → 해제
        _mapShowAllZones = false; // 모든 구역 모드도 해제
    } else {
        _mapLegendFilter = filterType;
        _mapShowAllZones = true; // 범례 켜면 모든 구역 표시 모드 진입
    }
    // 범례 UI 활성 표시 업데이트
    const legendMap = {
        'empty': 'map-legend-empty',
        'content': 'map-legend-content',
        'reserved': 'map-legend-reserved',
        'preassigned': 'map-legend-preassigned'
    };
    Object.keys(legendMap).forEach(key => {
        const el = document.getElementById(legendMap[key]);
        if (!el) return;
        if (_mapLegendFilter === key) {
            el.style.outline = '2px solid #3d5afe';
            el.style.outlineOffset = '2px';
            el.style.fontWeight = '900';
        } else {
            el.style.outline = '';
            el.style.outlineOffset = '';
            el.style.fontWeight = '';
        }
    });
    // 도면 재렌더링 (opacity 반영)
    renderCorridor(currentCorridorIdx);
};

window.renderMap = function() {
    const mapBody = document.getElementById('map-body');
    const tabContainer = document.getElementById('map-zone-tabs');

    if (!originalData || originalData.length === 0) {
        mapBody.innerHTML = '<div style="text-align:center;padding:60px;color:#aaa;">⏳ Firebase에서 데이터를 불러오는 중입니다.<br>잠시 후 자동으로 표시됩니다.</div>';
        tabContainer.innerHTML = '';
        return;
    }

    // 구역+동 조합 목록 수집
    // ★구역은 동 없이 단독, 일반구역은 구역+동 조합으로 탭 구성
    svCorridorList = [];

    const zoneSet = new Set();
    originalData.forEach(d => zoneSet.add(d.id.charAt(0).toUpperCase()));
    const zones = [...zoneSet].sort((a, b) => {
        if (a === '★') return -1;
        if (b === '★') return 1;
        return a.localeCompare(b);
    });

    zones.forEach(zone => {
        svCorridorList.push({ zone, label: zone === '★' ? '★★ 구역' : `${zone}구역` });
    });

    // 탭 렌더링
    tabContainer.innerHTML = '';
    svCorridorList.forEach((item, i) => {
        const btn = document.createElement('button');
        btn.id = `sv-tab-${i}`;
        btn.innerText = item.label;
        btn.style.cssText = `padding:6px 14px; border-radius:20px; font-size:13px; font-weight:bold; border:1.5px solid #ccc; background:#f5f5f5; color:#333; cursor:pointer; transition:0.2s;`;
        btn.onclick = () => {
            _mapShowAllZones = false; // 구역 탭 클릭 → 단일 구역 모드로 전환
            currentCorridorIdx = i;
            renderCorridor(i);
            document.querySelectorAll('#map-zone-tabs button').forEach(b => {
                b.style.background = '#f5f5f5'; b.style.color = '#333'; b.style.borderColor = '#ccc';
            });
            btn.style.background = '#3d5afe'; btn.style.color = 'white'; btn.style.borderColor = '#3d5afe';
        };
        tabContainer.appendChild(btn);
    });

    currentCorridorIdx = 0;
    if (svCorridorList.length > 0) document.getElementById('sv-tab-0').click();
};

function renderCorridor(idx) {
    const mapBody = document.getElementById('map-body');
    const cellSize = document.getElementById('map-cell-size') ? Number(document.getElementById('map-cell-size').value) : 54;

    // 셀 공통 함수
    function hasContent(loc) {
        return loc && ((loc.code && loc.code !== loc.id && loc.code.trim() !== '') || (loc.name && loc.name.trim() !== ''));
    }
    // 도면 범례 필터 매칭 검사 (cellStyle 우선순위와 동일: preAssigned > reserved > hasContent > empty)
    function matchesLegendFilter(loc) {
        if (!_mapLegendFilter) return true; // 필터 없음 → 모두 매칭
        if (!loc) return false; // 필터 ON 시 null 셀(격자 placeholder)도 숨김
        if (_mapLegendFilter === 'preassigned') return loc.preAssigned === true;
        if (_mapLegendFilter === 'reserved') return loc.reserved === true && !loc.preAssigned;
        if (_mapLegendFilter === 'content') return hasContent(loc) && !loc.preAssigned && !loc.reserved;
        if (_mapLegendFilter === 'empty') return !hasContent(loc) && !loc.preAssigned && !loc.reserved;
        return true;
    }
    function cellStyle(loc) {
        if (!loc) return 'background:#f0f0f0; border:1px dashed #ddd;';
        let s;
        if (loc.preAssigned) s = 'background:#ffe0b2; border:1.5px solid #fb8c00;';
        else if (loc.reserved) s = 'background:#fff9c4; border:1.5px solid #f9a825;';
        else if (hasContent(loc)) s = 'background:#c8e6c9; border:1.5px solid #66bb6a;';
        else s = 'background:#f0f0f0; border:1px solid #ccc;';
        return s;
    }
    function cellInner(loc) {
        if (!loc) return '';
        const nameText = hasContent(loc) ? (loc.name || loc.code || '') : '';
        const nameColor = hasContent(loc) ? '#1b5e20' : '#999';
        const idFontSize = Math.max(7, Math.floor(cellSize / 8));
        const nameFontSize = Math.max(10, Math.floor(cellSize / 5));
        const maxChars = Math.max(4, Math.floor((cellSize - 6) / (nameFontSize * 0.55)));
        const displayName = nameText.substring(0, maxChars) || '빈칸';
        return `<div style="font-size:${idFontSize}px;color:#bbb;line-height:1.1;">${loc.id}</div>
                <div style="font-size:${nameFontSize}px;font-weight:bold;color:${nameColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:${cellSize - 4}px;text-align:center;line-height:1.3;">${displayName}</div>`;
    }
    function tooltipHtml(loc) {
        if (!loc) return '';
        const isReserved = loc.reserved === true;
        const isPreAssigned = loc.preAssigned === true;
        let status = '빈칸';
        if (isPreAssigned) status = '📦 선지정';
        else if (isReserved) status = `🔒 예약중 (${loc.reservedBy || ''})`;
        else if (hasContent(loc)) status = '✅ 사용중';
        const tipId = 'tip-' + (loc.id || '').replace(/[^a-zA-Z0-9]/g, '_');
        return `<div id="${tipId}" style="position:fixed;background:white;border:1px solid #ccc;border-radius:8px;padding:10px 12px;
            white-space:nowrap;pointer-events:none;font-size:12px;line-height:1.7;
            box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:99999;display:none;" class="sv-tip">
            <div style="font-weight:bold;color:#3d5afe;">${loc.id}</div>
            <div style="color:#555;">${status}</div>
            ${hasContent(loc) ? `<div style="color:#333;"><b>상품명</b>: ${loc.name || '-'}</div>${loc.option ? `<div style="color:#666;"><b>옵션</b>: ${loc.option}</div>` : ''}<div style="color:#1976d2;"><b>재고</b>: ${loc.stock || '0'}개</div>` : ''}
            ${isPreAssigned ? `<div style="color:#bf360c;"><b>선지정코드</b>: ${loc.preAssignedCode || '-'}</div>` : ''}
        </div>`;
    }
    function getCell(locs, pos, num) {
        return locs.find(d => {
            const m = d.id.match(/(\d+)$/);
            return (d.pos || '').toString().trim() === pos && m && parseInt(m[1]) === num;
        }) || null;
    }

    function buildRackSection(locs, numsByPos, posLabels, posKey, cellSize) {
        // 필터 ON 시: 전체 매칭 슬롯 0개면 섹션 통째로 빈 문자열 반환
        if (_mapLegendFilter) {
            const anyMatch = posLabels.some(pos => {
                const posNums = (numsByPos[pos] && numsByPos[pos][posKey]) || [];
                return posNums.some(num => {
                    const loc = getCell(locs, pos, num);
                    return loc && matchesLegendFilter(loc);
                });
            });
            if (!anyMatch) return '';
        }
        let html = `<div style="padding:8px 8px;display:flex;flex-direction:column;gap:4px;">`;
        posLabels.forEach(pos => {
            const posNums = (numsByPos[pos] && numsByPos[pos][posKey]) || [];
            // 필터 ON 시: 이 pos 라인에 매칭 슬롯 0개면 라인 통째로 건너뜀 (pos 라벨도 안 그림)
            if (_mapLegendFilter) {
                const hasMatch = posNums.some(num => {
                    const loc = getCell(locs, pos, num);
                    return loc && matchesLegendFilter(loc);
                });
                if (!hasMatch) return;
            }
            html += `<div style="display:flex;flex-direction:row;align-items:center;gap:3px;">
                <div style="font-size:10px;font-weight:bold;color:#bbb;min-width:18px;text-align:center;">${pos}</div>`;
            posNums.forEach(num => {
                const loc = getCell(locs, pos, num);
                if (!loc) {
                    if (_mapLegendFilter) return; // 필터 ON → null 셀(placeholder)도 숨김 (옆이 당겨옴)
                    html += `<div style="width:${cellSize}px;height:${cellSize + 6}px;${cellStyle(null)}border-radius:4px;"></div>`;
                    return;
                }
                if (!matchesLegendFilter(loc)) return; // 미매칭 셀은 출력 안 함
                const tid = 'tip-' + (loc.id || '').replace(/[^a-zA-Z0-9]/g, '_');
                html += `<div style="position:relative;"
                    onmouseenter="(function(e){var t=document.getElementById('${tid}');if(!t)return;t.style.display='block';var r=e.currentTarget.getBoundingClientRect();var tw=t.offsetWidth||160;var th=t.offsetHeight||100;var x=r.left+r.width/2-tw/2;var y=r.top-th-8;if(y<8)y=r.bottom+8;if(x+tw>window.innerWidth-8)x=window.innerWidth-tw-8;if(x<8)x=8;t.style.left=x+'px';t.style.top=y+'px';})(event)"
                    onmouseleave="(function(){var t=document.getElementById('${tid}');if(t)t.style.display='none';})()">
                    <div style="width:${cellSize}px;height:${cellSize + 6}px;${cellStyle(loc)}border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;padding:3px;transition:transform 0.1s;"
                        onmouseenter="this.style.transform='scale(1.06)'" onmouseleave="this.style.transform='scale(1)'"
                        onclick="window.copyLocationToClipboard(event, '${loc.id}')">
                        ${cellInner(loc)}
                    </div>${tooltipHtml(loc)}</div>`;
            });
            html += '</div>';
        });
        html += '</div>';
        return html;
    }

    let bodyHtml = '';

    // 모든 구역 모드(범례 ON) vs 단일 구역 모드 분기
    const itemsToRender = (_mapShowAllZones && _mapLegendFilter)
        ? svCorridorList
        : (svCorridorList[idx] ? [svCorridorList[idx]] : []);

    itemsToRender.forEach(item => {
        const isStarZone = item.zone === '★';

        if (isStarZone) {
            const allLocs = originalData.filter(d => d.id.charAt(0) === '★')
                .sort((a, b) => parseInt((a.id.match(/\d+$/) || [0])[0]) - parseInt((b.id.match(/\d+$/) || [0])[0]));
            // 필터 ON 시 ★구역에 매칭 슬롯 0개면 통째로 건너뜀
            if (_mapLegendFilter && !allLocs.some(l => matchesLegendFilter(l))) return;
            const half = Math.ceil(allLocs.length / 2);
        const topLocs = allLocs.slice(0, half);
        const botLocs = allLocs.slice(half);

        // ★★구역 cellSize는 슬라이더 값 사용

        function starRow(locs) {
            // 필터 ON 시: 매칭 슬롯 0개면 빈 문자열 반환
            if (_mapLegendFilter && !locs.some(l => matchesLegendFilter(l))) return '';
            const idFontSize = Math.max(7, Math.floor(cellSize / 8));
            const nameFontSize = Math.max(10, Math.floor(cellSize / 5));
            const maxChars = Math.max(4, Math.floor((cellSize - 6) / (nameFontSize * 0.55)));
            let h = `<div style="padding:8px;display:flex;flex-wrap:wrap;gap:3px;">`;
            locs.forEach(loc => {
                if (!matchesLegendFilter(loc)) return; // 미매칭 셀은 출력 안 함
                const tid = 'tip-' + (loc.id || '').replace(/[^a-zA-Z0-9]/g, '_');
                const nameText = hasContent(loc) ? (loc.name || loc.code || '') : '';
                const nameColor = hasContent(loc) ? '#1b5e20' : '#999';
                const displayName = nameText.substring(0, maxChars) || '빈칸';
                h += `<div style="position:relative;"
                    onmouseenter="(function(e){var t=document.getElementById('${tid}');if(!t)return;t.style.display='block';var r=e.currentTarget.getBoundingClientRect();var tw=t.offsetWidth||160;var th=t.offsetHeight||100;var x=r.left+r.width/2-tw/2;var y=r.top-th-8;if(y<8)y=r.bottom+8;if(x+tw>window.innerWidth-8)x=window.innerWidth-tw-8;if(x<8)x=8;t.style.left=x+'px';t.style.top=y+'px';})(event)"
                    onmouseleave="(function(){var t=document.getElementById('${tid}');if(t)t.style.display='none';})()">
                    <div style="width:${cellSize}px;height:${cellSize+6}px;${cellStyle(loc)}border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;padding:3px;transition:transform 0.1s;"
                        onmouseenter="this.style.transform='scale(1.06)'" onmouseleave="this.style.transform='scale(1)'"
                        onclick="window.copyLocationToClipboard(event, '${loc.id}')">
                        <div style="font-size:${idFontSize}px;color:#bbb;line-height:1.1;">${loc.id}</div>
                        <div style="font-size:${nameFontSize}px;font-weight:bold;color:${nameColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:${cellSize-4}px;text-align:center;line-height:1.3;">${displayName}</div>
                    </div>${tooltipHtml(loc)}</div>`;
            });
            h += '</div>';
            return h;
        }

        bodyHtml += `
            <div style="border:1px solid #ddd;border-radius:10px;overflow:hidden;">
                <div style="background:#f4f4f4;padding:6px 16px;font-size:13px;font-weight:bold;color:#3d5afe;border-bottom:1px solid #ddd;">★★ 구역</div>
                ${starRow(topLocs)}
                ${_mapLegendFilter ? '' : `<div style="display:flex;align-items:center;justify-content:center;gap:12px;background:#fafafa;padding:7px 16px;border-top:1px solid #eee;border-bottom:1px solid #eee;">
                    <div style="font-size:11px;color:#ccc;letter-spacing:4px;">← ← ←</div>
                    <div style="font-size:11px;color:#bbb;font-weight:bold;">★★ 통로</div>
                    <div style="font-size:11px;color:#ccc;letter-spacing:4px;">→ → →</div>
                </div>`}
                ${starRow(botLocs)}
            </div>`;
    } else {
        // 일반구역: 동별로 섹션 나눠서 표시
        const dongSet = new Set();
        originalData.forEach(d => {
            if (d.id.charAt(0).toUpperCase() === item.zone && d.dong) {
                dongSet.add((d.dong || '').toString().trim());
            }
        });
        const dongs = [...dongSet].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

        dongs.forEach(dong => {
            const allLocs = originalData.filter(d =>
                d.id.charAt(0).toUpperCase() === item.zone &&
                (d.dong || '').toString().trim() === dong
            );
            // 필터 ON 시 이 동에 매칭 슬롯 0개면 동 통째로 건너뜀
            if (_mapLegendFilter && !allLocs.some(l => matchesLegendFilter(l))) return;

            const posSet = new Set();
            allLocs.forEach(d => { if (d.pos) posSet.add((d.pos || '').toString().trim()); });
            const posLabels = [...posSet].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
            if (posLabels.length === 0) return;

            const leftNumSet = new Set();
            const rightNumSet = new Set();
            const numsByPos = {};

            posLabels.forEach(pos => {
                const posLocs = allLocs.filter(d => (d.pos || '').toString().trim() === pos);
                const nums = posLocs.map(d => {
                    const m = d.id.match(/(\d+)$/);
                    return m ? parseInt(m[1]) : 0;
                }).filter(n => n > 0).sort((a, b) => a - b);
                const posHalf = Math.ceil(nums.length / 2);
                const leftN = nums.slice(0, posHalf);
                const rightN = nums.slice(posHalf);
                numsByPos[pos] = { left: leftN, right: rightN };
                leftN.forEach(n => leftNumSet.add(n));
                rightN.forEach(n => rightNumSet.add(n));
            });

            const leftNums = [...leftNumSet].sort((a, b) => a - b);
            const rightNums = [...rightNumSet].sort((a, b) => a - b);
            const leftLocs = allLocs.filter(d => { const m = d.id.match(/(\d+)$/); return m && leftNumSet.has(parseInt(m[1])); });
            const rightLocs = allLocs.filter(d => { const m = d.id.match(/(\d+)$/); return m && rightNumSet.has(parseInt(m[1])); });

            // cellSize는 슬라이더 값 사용 (구역별 고정)

            bodyHtml += `
                <div style="border:1px solid #ddd;border-radius:10px;overflow:hidden;margin-bottom:12px;">
                    <div style="background:#f4f4f4;padding:5px 16px;border-bottom:1px solid #ddd;">
                        <div style="font-size:13px;font-weight:bold;color:#3d5afe;">${item.zone}구역 ${dong}동</div>
                    </div>
                    ${buildRackSection(leftLocs, numsByPos, posLabels, 'left', cellSize)}
                    ${_mapLegendFilter ? '' : `<div style="display:flex;align-items:center;justify-content:center;gap:12px;background:#fafafa;padding:5px 16px;border-top:1px solid #eee;border-bottom:1px solid #eee;">
                        <div style="font-size:11px;color:#ccc;letter-spacing:4px;">← ← ←</div>
                        <div style="font-size:11px;color:#bbb;font-weight:bold;">${dong}동 통로</div>
                        <div style="font-size:11px;color:#ccc;letter-spacing:4px;">→ → →</div>
                    </div>`}
                    ${buildRackSection(rightLocs, numsByPos, posLabels, 'right', cellSize)}
                </div>`;
        });
    }
    }); // itemsToRender.forEach 닫기

    if (!bodyHtml.trim()) {
        bodyHtml = '<div style="text-align:center;padding:60px;color:#aaa;font-size:14px;">📭 선택한 필터에 매칭되는 자리가 없습니다.</div>';
    }

    mapBody.innerHTML = `
        <div>
            ${bodyHtml}
            <div style="display:flex;gap:12px;padding:10px 0;flex-wrap:wrap;">
                <span style="font-size:11px;color:#555;display:flex;align-items:center;gap:5px;"><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#c8e6c9;border:1px solid #66bb6a;"></span>상품있음</span>
                <span style="font-size:11px;color:#555;display:flex;align-items:center;gap:5px;"><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#f0f0f0;border:1px solid #ccc;"></span>빈칸</span>
                <span style="font-size:11px;color:#555;display:flex;align-items:center;gap:5px;"><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#fff9c4;border:1px solid #f9a825;"></span>예약중</span>
                <span style="font-size:11px;color:#555;display:flex;align-items:center;gap:5px;"><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#ffe0b2;border:1px solid #fb8c00;"></span>선지정</span>
            </div>
        </div>
    `;
}
// ===== v4.3: 추천 갯수 드롭다운 + 우선순위 선택 UI =====
// 변경: 라디오 → 드롭다운, 사용자지정은 prompt() 1회성 (저장 안 함)
//      우선순위 선택 추가 (동 이동 / 위치 이동)
(function setupRecLimitUI() {
    // v4.3: 사용자지정 값은 메모리에만 저장 (localStorage 사용 안 함, 1회성)
    let _customLimitValue = null; // 마지막 사용자지정 값 (페이지 세션 동안 유지)
    let _lastNonCustomMode = '10'; // prompt 취소 시 되돌아갈 직전 값
    
    window._getRecommendLimit = function() {
        const select = document.getElementById('rec-limit-select');
        if (!select) return 10;
        const mode = select.value;
        if (mode === 'custom') {
            if (_customLimitValue && _customLimitValue >= 1) return _customLimitValue;
            return 10;
        }
        return parseInt(mode, 10) || 10;
    };
    
    // v4.3: 단독 추천 우선순위 모드 ('dong' = 동 이동, 'pos' = 위치 이동)
    window._getRecPriorityMode = function() {
        const select = document.getElementById('rec-priority-mode');
        if (!select) return 'dong';
        return select.value || 'dong';
    };
    
    window._initRecLimitUI = function() {
        const select = document.getElementById('rec-limit-select');
        const prioritySelect = document.getElementById('rec-priority-mode');
        const editBtn = document.getElementById('rec-limit-edit-btn');
        if (!select) return;
        
        const panel = document.getElementById('rec-limit-panel');
        if (panel && !panel.dataset.bound) {
            panel.dataset.bound = '1';
            
            // 추천 갯수 드롭다운 change 이벤트
            select.addEventListener('change', () => {
                if (select.value === 'custom') {
                    _promptCustomLimit(select);
                } else {
                    // 일반 옵션 선택: 직전 값 기록 후 재계산
                    _lastNonCustomMode = select.value;
                    updateCustomDisplay();
                    triggerRecalcIfNeeded();
                }
            });
            
            // v4.4 v3: 사용자지정 값 변경 버튼 (사용자지정 선택 시에만 표시됨)
            // 사용자지정으로 N개 적용 후 다른 N개로 바꿀 때 사용
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    _promptCustomLimit(select);
                });
            }
        }
        
        // 우선순위 드롭다운 change 이벤트
        if (prioritySelect && !prioritySelect.dataset.bound) {
            prioritySelect.dataset.bound = '1';
            prioritySelect.addEventListener('change', () => {
                triggerRecalcIfNeeded();
            });
        }
        
        updateCustomDisplay();
    };
    
    // v4.4 v3: 사용자지정 prompt 로직을 별도 함수로 분리
    function _promptCustomLimit(select) {
        const promptDefault = _customLimitValue ? String(_customLimitValue) : '';
        const input = window.prompt('추천 갯수를 입력하세요 (1 이상)', promptDefault);
        
        if (input === null) {
            // 취소: select.value가 'custom'이 아니면 직전 값으로 되돌림
            // (변경 버튼에서 호출된 경우엔 이미 'custom' 상태이므로 그대로 유지)
            if (select.value !== 'custom') {
                select.value = _lastNonCustomMode;
            }
            updateCustomDisplay();
            return; // 재계산 안 함
        }
        
        const num = parseInt(input.trim(), 10);
        if (isNaN(num) || num < 1) {
            alert('올바른 숫자를 입력하세요 (1 이상)');
            if (select.value !== 'custom') {
                select.value = _lastNonCustomMode;
            }
            updateCustomDisplay();
            return;
        }
        
        _customLimitValue = num;
        // select.value는 'custom'으로 유지 (이미 그렇거나, 변경 버튼 경유)
        updateCustomDisplay();
        triggerRecalcIfNeeded();
    }
    
    function updateCustomDisplay() {
        const select = document.getElementById('rec-limit-select');
        const display = document.getElementById('rec-limit-custom-display');
        const numSpan = document.getElementById('rec-limit-custom-num');
        const editBtn = document.getElementById('rec-limit-edit-btn');
        if (!select || !display || !numSpan) return;
        if (select.value === 'custom' && _customLimitValue) {
            display.style.display = 'inline';
            numSpan.textContent = String(_customLimitValue);
            // v4.4 v3: 사용자지정 선택 시 변경 버튼 표시
            if (editBtn) editBtn.style.display = 'inline-block';
        } else {
            display.style.display = 'none';
            // v4.4 v3: 사용자지정 아닐 때 변경 버튼 숨김
            if (editBtn) editBtn.style.display = 'none';
        }
    }
    
    function triggerRecalcIfNeeded() {
        // v4.1: 활성 탭 기준으로 재계산
        const pairTbody = document.getElementById('recommend-tbody');
        const singleTbody = document.getElementById('recommend-single-tbody');
        const pairTab = document.getElementById('rec-tab-pair');
        const singleTab = document.getElementById('rec-tab-single');
        
        // 어떤 탭이 활성화되어 있고 결과가 있는지 확인
        const singleActive = singleTab && singleTab.style.display !== 'none';
        const pairActive = pairTab && pairTab.style.display !== 'none';
        
        if (singleActive && singleTbody && singleTbody.children.length > 0 && typeof window.showSingleRecommendation === 'function') {
            window.showSingleRecommendation();
        } else if (pairActive && pairTbody && pairTbody.children.length > 0 && typeof window.showPairRecommendation === 'function') {
            window.showPairRecommendation();
        }
    }
})();

// ===== v4.1: 단독 추천 기능 =====
window.switchRecTab = function(tabName) {
    const singleTab = document.getElementById('rec-tab-single');
    const pairTab = document.getElementById('rec-tab-pair');
    const singleBtn = document.getElementById('rec-tab-btn-single');
    const pairBtn = document.getElementById('rec-tab-btn-pair');
    if (!singleTab || !pairTab || !singleBtn || !pairBtn) return;
    
    if (tabName === 'single') {
        singleTab.style.display = '';
        pairTab.style.display = 'none';
        singleBtn.style.background = '#4caf50';
        singleBtn.style.color = 'white';
        pairBtn.style.background = '#e0e0e0';
        pairBtn.style.color = '#555';
    } else if (tabName === 'pair') {
        singleTab.style.display = 'none';
        pairTab.style.display = '';
        singleBtn.style.background = '#e0e0e0';
        singleBtn.style.color = '#555';
        pairBtn.style.background = '#4caf50';
        pairBtn.style.color = 'white';
    }
};

window.runActiveRecommendation = function() {
    // 활성 탭에 맞는 계산 실행
    const singleTab = document.getElementById('rec-tab-single');
    const singleActive = singleTab && singleTab.style.display !== 'none';
    if (singleActive) {
        window.showSingleRecommendation();
    } else {
        window.showPairRecommendation();
    }
};

// 1. [v4.2-fix1] showSingleRecommendation 함수 수정 부분
window.showSingleRecommendation = function() {
    window.showLoading("📦 단독 추천을 계산 중입니다...");
    
    setTimeout(() => {
        try {
            window.currentSingleRecommendations = [];
            
            // ===== 1. 점수 계산 (페어 추천과 동일한 정규화 방식) =====
            const allCodes = new Set(
                originalData
                    .filter(d => d.code && d.code.trim() !== '' && d.code !== d.id)
                    .filter(d => !(incomingTotalByCode[d.code.trim()] > 0))
                    .map(d => d.code.trim())
            );
            
            let maxZQty = 0;
            let maxWQty = 0;
            let maxTrend = 0;
            let itemDataList = [];
            
            allCodes.forEach(code => {
                let zItem = zikjinData[code] || {};
                let wItem = weeklyData[code] || {};
                let locItem = originalData.find(d => d.code === code);
                let name = (locItem && locItem.name) || zItem['상품명'] || wItem['상품명'] || '알 수 없음';
                let zQty = Number(zItem['수량'] || 0);
                let wQty = Number(wItem['기간배송수량'] || wItem['기간발주수량'] || 0);
                let trendVal = 0;
                let dates = Object.keys(wItem).filter(k => /^20\d{6}$/.test(k)).sort();
                if (dates.length >= 6) {
                    let recent3 = dates.slice(-3).reduce((sum, d) => sum + Number(wItem[d] || 0), 0);
                    let prev3 = dates.slice(-6, -3).reduce((sum, d) => sum + Number(wItem[d] || 0), 0);
                    trendVal = Math.max(0, recent3 - prev3);
                }
                if (zQty > maxZQty) maxZQty = zQty;
                if (wQty > maxWQty) maxWQty = wQty;
                if (trendVal > maxTrend) maxTrend = trendVal;
                itemDataList.push({ code, name, zQty, wQty, trendVal });
            });
            
            const scoredItems = [];
            itemDataList.forEach(item => {
                let zScore = maxZQty > 0 ? (item.zQty / maxZQty) * 100 : 0;
                let wScore = maxWQty > 0 ? (item.wQty / maxWQty) * 100 : 0;
                let tScore = maxTrend > 0 ? (item.trendVal / maxTrend) * 100 : 0;
                let finalScore = (zScore * (window.recommendRatios.zikjin / 100)) + (wScore * (window.recommendRatios.weekly / 100)) + (tScore * (window.recommendRatios.trend / 100));
                
                if (finalScore > 0) {
                    const currentLocs = originalData.filter(d => d.code === item.code).map(d => d.id);
                    scoredItems.push({
                        code: item.code,
                        name: item.name,
                        score: finalScore,
                        currentLocs: currentLocs,
                        // v3.94 결과 양식 복원: 점수 내역(툴팁용)
                        zContrib: zScore * (window.recommendRatios.zikjin / 100),
                        wContrib: wScore * (window.recommendRatios.weekly / 100),
                        tContrib: tScore * (window.recommendRatios.trend / 100),
                        zQty: item.zQty, wQty: item.wQty, trendVal: item.trendVal
                    });
                }
            });
            scoredItems.sort((a, b) => b.score - a.score);
            
            // ===== 2. 빈 자리 준비 =====
            let emptyLocs = originalData.filter(d => {
                const hasContent = (d.code && d.code !== d.id && d.code.trim() !== "") || (d.name && d.name.trim() !== "");
                if (hasContent || d.preAssigned) return false;
                const excludeCombos = window.recommendPriorities.excludeCombos || [];
                if (excludeCombos.length > 0) {
                    const prefix = (d.id || '').charAt(0).toUpperCase();
                    const dong = (d.dong || '').toString().trim();
                    const combo = `${prefix}-${dong}`;
                    if (excludeCombos.includes(combo)) return false;
                }
                return true;
            });
            
            // ===== 3. 헬퍼: 등급/동/위치 순위 =====
            const getZoneRank = (locId) => {
                const prefix = (locId || '').charAt(0).toUpperCase();
                const zones = window.recommendPriorities.zones || {};
                for (let i = 0; i <= 3; i++) {
                    if (zones[i] && zones[i].includes(prefix)) return i;
                }
                return 99;
            };
            const getDongRank = (dong) => {
                const str = (dong || '').toString().trim();
                const idx = window.recommendPriorities.dongs.indexOf(str);
                return idx !== -1 ? idx : 99;
            };
            const getPosRank = (pos) => {
                const str = (pos || '').toString().trim();
                const idx = window.recommendPriorities.poses.indexOf(str);
                return idx !== -1 ? idx : 99;
            };
            
            // ===== 4. 빈 자리 정렬: 동 > 위치 > 구역 (사전순) =====
            emptyLocs.sort((a, b) => {
                const dRankA = getDongRank(a.dong);
                const dRankB = getDongRank(b.dong);
                if (dRankA !== dRankB) return dRankA - dRankB;
                const pRankA = getPosRank(a.pos);
                const pRankB = getPosRank(b.pos);
                if (pRankA !== pRankB) return pRankA - pRankB;
                return getZoneRank(a.id) - getZoneRank(b.id);
            });
            console.log('[v4.1] 단독 추천: 빈 자리 총', emptyLocs.length, '개 / 점수 있는 상품', scoredItems.length, '개');
            
            // ===== 5. 갯수 제한 =====
            const limitVal = (typeof window._getRecommendLimit === 'function') ? window._getRecommendLimit() : 10;
            
            // ===== 6. 점수 1위부터 순서대로 자리 배정 =====
            const tbody = document.getElementById('recommend-single-tbody');
            let html = '';
            let matchCount = 0;
            let skipNoCurrentLoc = 0;
            let skipNoBetterSlot = 0;
            const usedEmptyKeys = new Set();
            
            // v4.3: 우선순위 모드 ('dong' = 동 이동, 'pos' = 위치 이동)
            const priorityMode = (typeof window._getRecPriorityMode === 'function') ? window._getRecPriorityMode() : 'dong';
            
            // v4.3: isBetterSlot을 우선순위 모드에 따라 분기
            //   - 'dong' 모드: 새 자리 동이 현재보다 앞 동이어야만 더 좋은 자리 (같은 동은 제외)
            //   - 'pos'  모드: 같은 동 내에서 새 위치가 현재보다 앞 위치여야만 더 좋은 자리
            //                  (동 이동 제외, 같은 위치에서 구역만 변경되는 것도 제외)
            const isBetterSlot = (slotInfo, currentInfo) => {
                if (priorityMode === 'pos') {
                    // 위치 이동 모드: 같은 동 + 더 앞 위치만
                    if (slotInfo.dongRank !== currentInfo.dongRank) return false; // 동 다르면 제외
                    return slotInfo.posRank < currentInfo.posRank; // 위치만 비교 (같은 위치/구역만 다른 경우 제외)
                }
                // 'dong' 모드 (기본): 더 앞 동만
                return slotInfo.dongRank < currentInfo.dongRank;
            };
            
            const getLocInfo = (locId) => {
                const locData = originalData.find(d => d.id === locId);
                if (!locData) return null;
                return {
                    id: locId,
                    dongRank: getDongRank(locData.dong),
                    posRank: getPosRank(locData.pos),
                    zoneRank: getZoneRank(locId),
                    dong: (locData.dong || '').toString().trim()
                };
            };
            const getEmptyLocInfo = (eLoc) => {
                return {
                    id: eLoc.id,
                    dongRank: getDongRank(eLoc.dong),
                    posRank: getPosRank(eLoc.pos),
                    zoneRank: getZoneRank(eLoc.id),
                    dong: (eLoc.dong || '').toString().trim()
                };
            };
            
            const getOptionByCode = (code) => {
                const locData = originalData.find(d => d.code === code);
                return (locData && locData.option) ? locData.option : '';
            };
            
            for (let i = 0; i < scoredItems.length; i++) {
                if (limitVal > 0 && matchCount >= limitVal) break;
                
                const item = scoredItems[i];
                
                const currentLocId = item.currentLocs && item.currentLocs[0];
                if (!currentLocId) {
                    skipNoCurrentLoc++;
                    continue;
                }
                const currentInfo = getLocInfo(currentLocId);
                if (!currentInfo) {
                    skipNoCurrentLoc++;
                    continue;
                }
                
                let foundSlot = null;
                for (let j = 0; j < emptyLocs.length; j++) {
                    const eLoc = emptyLocs[j];
                    if (usedEmptyKeys.has(eLoc.id)) continue;
                    const slotInfo = getEmptyLocInfo(eLoc);
                    if (isBetterSlot(slotInfo, currentInfo)) {
                        foundSlot = eLoc;
                        break;
                    }
                }
                
                if (!foundSlot) {
                    skipNoBetterSlot++;
                    continue;
                }
                
                const option = getOptionByCode(item.code);
                const rowBg = matchCount % 2 === 0 ? '#ffffff' : '#fafafa';
                
                // v3.94 결과 양식: 이동수량(정상재고-2층재고) + 방향 뱃지 + 점수 툴팁
                let _ts = 0, _ts2 = 0;
                originalData.forEach(d => { if (d.code === item.code) { _ts += Number(d.stock || 0); _ts2 += Number(d.stock2f || 0); } });
                const moveQty = _ts - _ts2;
                const moveQtyDisplay = moveQty > 0
                    ? `<span style="color:#e65100; font-weight:900; font-size:13px;">${moveQty.toLocaleString()}</span><span style="font-size:9px; color:#888; margin-left:1px;">개</span>`
                    : `<span style="color:#bbb; font-size:11px;">-</span>`;
                const _badge = (bg, fg, label) => `<span style="display:inline-block; background:${bg}; color:${fg}; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:bold; vertical-align:middle;">${label}</span>`;
                const _slot = getEmptyLocInfo(foundSlot);
                let moveBadge;
                if (!currentLocId) moveBadge = _badge('#e3f2fd', '#1565c0', '✨신규');
                else if (_slot.dongRank < currentInfo.dongRank || (_slot.dongRank === currentInfo.dongRank && _slot.posRank < currentInfo.posRank)) moveBadge = _badge('#ffebee', '#b71c1c', '🔺전진');
                else moveBadge = _badge('#f5f5f5', '#616161', '➖수평');
                const scoreTip = `<span class="info-tip" data-tip-key="sr-score-${item.code}" style="margin-left:2px;">i<span class="info-tip-content">📊 <b>${item.code}</b> 점수 내역<br>━━━━━━━━━━━━━<br>• 직진배송: ${(item.zContrib||0).toFixed(1)}점 <span style="color:#90a4ae;">(원수량 ${Number(item.zQty||0).toLocaleString()})</span><br>• 주차별: ${(item.wContrib||0).toFixed(1)}점 <span style="color:#90a4ae;">(원수량 ${Number(item.wQty||0).toLocaleString()})</span><br>• 상승세: ${(item.tContrib||0).toFixed(1)}점 <span style="color:#90a4ae;">(증가분 ${Number(item.trendVal||0).toLocaleString()})</span><br>━━━━━━━━━━━━━<br><b>합계: ${item.score.toFixed(1)}점</b><br><br>💡 반영 비율: 직진 ${window.recommendRatios.zikjin}% / 주차 ${window.recommendRatios.weekly}% / 상승세 ${window.recommendRatios.trend}%</span></span>`;

                html += `
                    <tr style="background:${rowBg}; line-height:1.3;">
                        <td style="color:var(--primary); font-weight:900; font-size:12px; padding:5px 8px; white-space:nowrap;">${matchCount + 1}위 <span style="font-size:10px; color:#e65100; font-weight:bold;">(${item.score.toFixed(1)}${scoreTip})</span></td>
                        <td style="font-weight:bold; color:#1a237e; font-size:11px; padding:5px 8px; white-space:nowrap;">${item.code}</td>
                        <td style="text-align:left; font-size:12px; font-weight:600; color:#212121; padding:5px 10px;">${item.name}${option ? `<span style="color:#90a4ae; font-size:10px; margin-left:6px;">(${option})</span>` : ''}</td>
                        <td style="text-align:center; padding:5px 6px; white-space:nowrap;">${moveQtyDisplay}</td>
                        <td style="color:#555; font-size:11px; padding:5px 8px; white-space:nowrap;">${currentInfo.id} <span style="color:#999;">${currentInfo.dong}동</span></td>
                        <td style="background:#f1f8e9; padding:5px 10px; text-align:center; white-space:nowrap;">
                            <span style="color:#1b5e20; font-weight:900; font-size:13px;">${foundSlot.id}</span>
                            <span style="font-size:10px; color:#777; margin-left:4px;">${(foundSlot.dong || '').toString().trim()}동·${(foundSlot.pos || '').toString().trim()}위치</span>
                            <span style="margin-left:6px;">${moveBadge}</span>
                        </td>
                    </tr>
                `;
                
                usedEmptyKeys.add(foundSlot.id);
                
                // v4.2-fix1: 페어 추천에서 사용할 정보 추가 저장
                const slotInfo = getEmptyLocInfo(foundSlot);
                window.currentSingleRecommendations.push({
                    currentLocs: currentInfo.id,
                    targetLoc: foundSlot.id,
                    name: item.name,
                    option: option,
                    code: item.code,
                    // v4.2-fix1 추가 필드
                    score: item.score,
                    currentInfo: currentInfo,
                    targetInfo: slotInfo
                });
                
                matchCount++;
            }
            
            // v4.2-fix1: 페어 추천에서 사용할 추가 데이터 보관
            window._lastSingleRecContext = {
                emptyLocs: emptyLocs,
                usedEmptyKeys: new Set(usedEmptyKeys),
                getZoneRank: getZoneRank,
                getDongRank: getDongRank,
                getPosRank: getPosRank,
                getEmptyLocInfo: getEmptyLocInfo
            };
            
            console.log('[v4.1] 단독 추천 종료: 성공', matchCount, '개 / 건너뜀(현재자리없음)', skipNoCurrentLoc, '개 / 건너뜀(이미최적)', skipNoBetterSlot, '개 / 엑셀 데이터', window.currentSingleRecommendations.length, '개');
            
            if (matchCount === 0) {
                html += '<tr><td colspan="6" style="padding:40px; text-align:center; color:#666;">표시할 추천이 없습니다.<br>(모든 상품이 이미 최적 자리에 있거나, 더 좋은 빈 자리가 없습니다)</td></tr>';
            }
            
            tbody.innerHTML = html;
            window.hideLoading();
            document.getElementById('recommend-modal').style.display = 'flex';
            
        } catch (err) {
            console.error('[v4.1] showSingleRecommendation 에러:', err);
            window.hideLoading();
            alert('단독 추천 계산 중 오류가 발생했습니다. 콘솔(F12)을 확인해주세요.');
        }
    }, 500);
};

// ===== v4.2-fix1: 페어 추천 (단독 추천 기반, 자리 재배정 포함) =====
// 알고리즘:
//   1. 단독 추천 결과(currentSingleRecommendations)와 컨텍스트(_lastSingleRecContext) 사용
//   2. 단독 추천이 없으면 안내 메시지 후 종료
//   3. 페어 데이터 로드 (lift >= 2.0, count >= 5, 상위 5개 partner)
//   4. 단독 추천 결과를 1위부터 순회하며 페어 묶기 (weight 높은 partner 우선)
//   5. 자리 재배정:
//      - 더 위 순위 상품(base) = 단독 추천 자리 그대로 유지
//      - 파트너 = base 근처(같은 동, 같은 구역 우선)로 끌어옴
//      - 파트너의 원래 단독 자리는 비워짐 (페어 탭 표시 전용)
//      - 근처 빈 자리 없으면 페어 매칭 포기
//   6. 자리 변동 없는 페어(케이스 A) = 표시 안 함
window.showPairRecommendation = function() {
    window.showLoading("🔗 페어 추천을 계산 중입니다...");
    
    setTimeout(() => {
        try {
            window.currentRecommendations = [];
            
            // ===== 1. 단독 추천 결과 확인 =====
            const singleRecs = window.currentSingleRecommendations || [];
            const ctx = window._lastSingleRecContext || null;
            
            if (singleRecs.length === 0 || !ctx) {
                window.hideLoading();
                const tbody = document.getElementById('recommend-tbody');
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="5" style="padding:40px; text-align:center; color:#666;">먼저 단독 추천을 실행해주세요.<br>(페어 추천은 단독 추천 결과를 기반으로 동작합니다)</td></tr>';
                }
                document.getElementById('recommend-modal').style.display = 'flex';
                console.warn('[v4.2-fix1] 단독 추천 결과 없음 또는 컨텍스트 없음');
                return;
            }
            
            console.log('[v4.2-fix1] 페어 추천 시작: 단독 추천 결과', singleRecs.length, '개');
            
            // ===== 2. 페어 데이터 준비 (신뢰 페어만 추출) =====
            const pairMap = {};
            let pairDataReady = false;
            
            try {
                if (window._cachedOrderPairs && window._cachedOrderStats && window._cachedOrderMeta) {
                    const pairs = window._cachedOrderPairs;
                    const stats = window._cachedOrderStats;
                    const meta = window._cachedOrderMeta;
                    const N = meta.totalProcessedOrders || 1;
                    
                    pairs.forEach(p => {
                        const cA = (stats[p.codeA] || {}).count || 0;
                        const cB = (stats[p.codeB] || {}).count || 0;
                        if (cA === 0 || cB === 0) return;
                        const lift = (p.count * N) / (cA * cB);
                        if (p.count < 5 || lift < 2.0) return;
                        const weight = lift * p.count;
                        if (!pairMap[p.codeA]) pairMap[p.codeA] = [];
                        if (!pairMap[p.codeB]) pairMap[p.codeB] = [];
                        pairMap[p.codeA].push({ partner: p.codeB, weight: weight });
                        pairMap[p.codeB].push({ partner: p.codeA, weight: weight });
                    });
                    
                    for (const code in pairMap) {
                        pairMap[code].sort((a, b) => b.weight - a.weight);
                        pairMap[code] = pairMap[code].slice(0, 5);
                    }
                    pairDataReady = true;
                    console.log('[v4.2-fix1] 페어 데이터 로드 완료: pairMap 상품 수 =', Object.keys(pairMap).length);
                }
            } catch (e) {
                console.warn('[v4.2-fix1] 페어 데이터 캐시 사용 실패:', e);
            }
            
            if (!pairDataReady) {
                window.hideLoading();
                const tbody = document.getElementById('recommend-tbody');
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="5" style="padding:40px; text-align:center; color:#666;">페어 데이터가 준비되지 않았습니다.<br>(주문 데이터를 업로드하거나 페어 분석을 먼저 실행해주세요)</td></tr>';
                }
                document.getElementById('recommend-modal').style.display = 'flex';
                return;
            }
            
            // ===== 3. 단독 추천 결과를 빠르게 조회하기 위한 맵 =====
            const singleByCode = {};
            singleRecs.forEach((s, idx) => {
                singleByCode[s.code] = Object.assign({}, s, { singleRank: idx });
            });
            
            // ===== 4. 페어 묶기 (단독 추천 결과 안에서) =====
            const matchedPairs = []; // [{ baseItem, partnerItem, partnerNewSlot }]
            const usedCodes = new Set();
            const usedNewSlots = new Set(); // 페어 재배정으로 사용된 자리 (중복 방지)
            
            for (let i = 0; i < singleRecs.length; i++) {
                const base = singleRecs[i];
                if (usedCodes.has(base.code)) continue;
                
                const partners = pairMap[base.code] || [];
                if (partners.length === 0) continue;
                
                // partner를 weight 높은 순으로 검색 (pairMap이 이미 정렬됨)
                let foundPartner = null;
                for (let p = 0; p < partners.length; p++) {
                    const partnerCode = partners[p].partner;
                    if (usedCodes.has(partnerCode)) continue;
                    if (!singleByCode[partnerCode]) continue; // 단독 추천 결과 안에 없으면 제외
                    foundPartner = singleByCode[partnerCode];
                    break;
                }
                
                if (!foundPartner) continue;
                
                // ===== 5. 자리 재배정: 파트너를 base 근처로 끌어옴 =====
                // base의 단독 추천 자리 정보
                const baseTargetInfo = base.targetInfo;
                if (!baseTargetInfo) continue; // 안전장치
                
                const baseDong = baseTargetInfo.dong;
                const baseZone = (base.targetLoc || '').charAt(0).toUpperCase();
                const basePosRank = baseTargetInfo.posRank;
                
                // 점유된 자리 집합 구성:
                // - 단독 추천에서 쓰인 모든 자리 (단, 파트너 자신의 자리는 비워짐)
                // - 이미 페어로 재배정된 자리들
                // - base 자신의 자리도 점유 중
                const occupiedKeys = new Set(ctx.usedEmptyKeys);
                occupiedKeys.delete(foundPartner.targetLoc); // 파트너의 단독 자리는 비워짐
                usedNewSlots.forEach(k => occupiedKeys.add(k));
                occupiedKeys.add(base.targetLoc); // base 자신의 자리는 점유 유지
                
                // 같은 동의 빈 자리 후보 (점유 안 된 것만)
                const sameDongSlots = ctx.emptyLocs.filter(eLoc => {
                    if (occupiedKeys.has(eLoc.id)) return false;
                    const eDong = (eLoc.dong || '').toString().trim();
                    return eDong === baseDong;
                });
                
                if (sameDongSlots.length === 0) {
                    // 근처 빈 자리 없음 → 페어 매칭 포기
                    continue;
                }
                
                // 우선순위: 같은 동 + 같은 구역 우선, 그 다음 같은 동의 다른 구역
                const sameZoneInSameDong = sameDongSlots.filter(eLoc => {
                    return (eLoc.id || '').charAt(0).toUpperCase() === baseZone;
                });
                const otherZoneInSameDong = sameDongSlots.filter(eLoc => {
                    return (eLoc.id || '').charAt(0).toUpperCase() !== baseZone;
                });
                
                // 각 그룹 안에서 위치(pos)가 base와 가까운 순으로 정렬
                const posDistSort = (a, b) => {
                    const aDist = Math.abs(ctx.getPosRank(a.pos) - basePosRank);
                    const bDist = Math.abs(ctx.getPosRank(b.pos) - basePosRank);
                    return aDist - bDist;
                };
                sameZoneInSameDong.sort(posDistSort);
                otherZoneInSameDong.sort(posDistSort);
                
                const candidateOrder = sameZoneInSameDong.concat(otherZoneInSameDong);
                const partnerNewSlot = candidateOrder[0]; // 가장 가까운 빈 자리
                
                if (!partnerNewSlot) continue; // 안전장치
                
                // ===== 6. 케이스 A 제외: 자리 변동 없으면 표시 안 함 =====
                // 파트너의 단독 추천 자리와 새 자리가 같으면 변동 없음 (케이스 A)
                if (partnerNewSlot.id === foundPartner.targetLoc) {
                    // 변동 없음 → 페어 추천에서 제외
                    continue;
                }
                
                matchedPairs.push({
                    baseItem: base,
                    partnerItem: foundPartner,
                    partnerNewSlot: partnerNewSlot
                });
                
                usedCodes.add(base.code);
                usedCodes.add(foundPartner.code);
                usedNewSlots.add(partnerNewSlot.id);
            }
            
            console.log('[v4.2-fix1] 페어 매칭 완료:', matchedPairs.length, '쌍');
            
            // ===== 7. 화면 출력 =====
            const tbody = document.getElementById('recommend-tbody');
            let html = '';
            
            for (let i = 0; i < matchedPairs.length; i++) {
                const mp = matchedPairs[i];
                const itemA = mp.baseItem;       // 더 위 순위, 자리 유지
                const itemB = mp.partnerItem;     // 파트너, 자리 재배정됨
                
                // A는 단독 추천 자리 그대로, B는 새로 재배정된 자리
                const slotA_id = itemA.targetLoc;
                const slotA_dong = (itemA.targetInfo && itemA.targetInfo.dong) || '';
                const slotB_id = mp.partnerNewSlot.id;
                const slotB_dong = (mp.partnerNewSlot.dong || '').toString().trim();
                
                const aCurrentLoc = itemA.currentLocs || '-';
                const bCurrentLoc = itemB.currentLocs || '-';
                const rowBg = i % 2 === 0 ? '#ffffff' : '#fafafa';
                
                html += `
                    <tr style="background:${rowBg};">
                        <td style="text-align:center; color:var(--primary); font-weight:900; font-size:13px; padding:5px 6px;">${i + 1}</td>
                        <td style="padding:5px 8px; font-size:12px; line-height:1.35;">
                            <span style="font-weight:bold; color:#1976d2;">${itemA.code}</span>
                            <span style="color:#333;"> · ${itemA.name}</span>
                            ${itemA.option ? `<span style="color:#999; font-size:11px;"> (${itemA.option})</span>` : ''}
                            <span style="color:#777; font-size:11px;"> · 현재 ${aCurrentLoc}</span>
                        </td>
                        <td style="text-align:center; padding:5px 6px; background:#e8f5e9; white-space:nowrap;">
                            <span style="font-weight:bold; color:#2e7d32; font-size:12px;">${slotA_id}</span>
                            <span style="font-size:10px; color:#777;"> ${slotA_dong}동</span>
                        </td>
                        <td style="padding:5px 8px; font-size:12px; line-height:1.35;">
                            <span style="font-weight:bold; color:#1976d2;">${itemB.code}</span>
                            <span style="color:#333;"> · ${itemB.name}</span>
                            ${itemB.option ? `<span style="color:#999; font-size:11px;"> (${itemB.option})</span>` : ''}
                            <span style="color:#777; font-size:11px;"> · 현재 ${bCurrentLoc}</span>
                        </td>
                        <td style="text-align:center; padding:5px 6px; background:#e8f5e9; white-space:nowrap;">
                            <span style="font-weight:bold; color:#2e7d32; font-size:12px;">${slotB_id}</span>
                            <span style="font-size:10px; color:#777;"> ${slotB_dong}동</span>
                        </td>
                    </tr>
                `;
                
                // 엑셀 데이터 저장
                window.currentRecommendations.push({
                    currentLocs: aCurrentLoc,
                    targetLoc: slotA_id,
                    name: itemA.name,
                    option: itemA.option,
                    code: itemA.code
                });
                window.currentRecommendations.push({
                    currentLocs: bCurrentLoc,
                    targetLoc: slotB_id,
                    name: itemB.name,
                    option: itemB.option,
                    code: itemB.code
                });
            }
            
            console.log('[v4.2-fix1] 페어 추천 종료: 표시', matchedPairs.length, '쌍 / 엑셀 데이터', window.currentRecommendations.length, '개');
            
            if (matchedPairs.length === 0) {
                html = '<tr><td colspan="5" style="padding:40px; text-align:center; color:#666;">표시할 페어 쌍이 없습니다.<br>(단독 추천 결과 안에 페어로 묶일 상품이 없거나, 근처에 빈 자리가 부족합니다)</td></tr>';
            }
            
            if (tbody) tbody.innerHTML = html;
            window.hideLoading();
            document.getElementById('recommend-modal').style.display = 'flex';
            
        } catch (err) {
            console.error('[v4.2-fix1] showPairRecommendation 에러:', err);
            window.hideLoading();
            alert('페어 추천 계산 중 오류가 발생했습니다. 콘솔(F12)을 확인해주세요.');
        }
    }, 500);
};
// ====================================================================
// ===== v4.4: 종합 대시보드 + 전일 재고 스냅샷 (메인 시스템 연동) =====
// ====================================================================
// 알고리즘:
//   1. 메인 시스템의 artifacts/team-work-logger-v2/history 컬렉션 감시
//   2. 새 문서(YYYY-MM-DD) 추가 = 업무 마감 발생 → 재고 스냅샷 저장
//   3. 페이지 로드 시 사후 보정: 마지막 history 날짜 vs 저장된 재고 날짜 비교
//      - 다르면 마감 후 미저장 상태 → 현재 시점에 사후 저장
//   4. 저장 구조: artifacts/team-work-logger-v2/locationStock/latest
//      { current: {...}, previous: {...} } 형태로 직전 1개만 유지
//   5. 종합 대시보드 탭: 사용률 팝업 내용 + SKU + 재고회전율 통합
(function v44Module() {
    // ===== 유틸: 오늘 날짜 문자열 (메인 시스템과 동일 KST 보정 방식) =====
    window._v44_getTodayDateString = function() {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const localDate = new Date(now - offset);
        return localDate.toISOString().slice(0, 10);
    };
    
    // ===== 현재 재고 집계 =====
    // 3층은 originalData에서 stock 합산, 2F는 캐시된 데이터에서 가져옴
    window._v44_calculateCurrentStock = function() {
        let stock3F = 0;
        const codes3F = new Set();
        // v4.4 추가: 2층 창고재고 SKU (stock2f > 0인 셀의 고유 상품코드)
        const codes2층 = new Set();
        try {
            (originalData || []).forEach(loc => {
                const s = Number(loc.stock || 0);
                if (!isNaN(s) && s > 0) stock3F += s;
                const c = (loc.code || '').toString().trim();
                if (c && c !== loc.id) codes3F.add(c);
                // 2층창고재고 값이 0이 아닌 셀의 상품코드 모음
                const s2 = Number(loc.stock2f || 0);
                if (!isNaN(s2) && s2 > 0 && c && c !== loc.id) {
                    codes2층.add(c);
                }
            });
        } catch (e) {
            console.warn('[v4.4] 3층 재고 집계 오류:', e);
        }
        
        const cached2F = window._cached2FloorStock || {};
        const stock2F = Number(cached2F.totalStock || 0);
        const sku2F = Number(cached2F.skuCount || 0);
        
        return {
            stock3F: stock3F,
            stock2F: stock2F,
            sku3F: codes3F.size,
            sku2F: sku2F,
            sku2층: codes2층.size, // v4.4 추가: 2층 창고재고 SKU
            date: window._v44_getTodayDateString()
        };
    };
    
    // ===== 2F 캐시 로드 =====
    window._v44_load2FloorCache = async function() {
        try {
            const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'locationStock', 'twoFloorLatest');
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                window._cached2FloorStock = snap.data();
                console.log('[v4.4] 2F 캐시 로드 완료: SKU', window._cached2FloorStock.skuCount, '개');
            } else {
                window._cached2FloorStock = { skuCount: 0, totalStock: 0 };
                console.log('[v4.4] 2F 캐시 없음 (첫 적용)');
            }
        } catch (e) {
            console.warn('[v4.4] 2F 캐시 로드 실패:', e);
            window._cached2FloorStock = { skuCount: 0, totalStock: 0 };
        }
    };
    
    // ===== 재고 스냅샷 로드 =====
    window._v44_loadStockSnapshot = async function() {
        try {
            const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'locationStock', 'latest');
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                window._cachedStockSnapshot = snap.data();
                console.log('[v4.4] 재고 스냅샷 로드: current.date =', (window._cachedStockSnapshot.current || {}).date, '/ previous.date =', (window._cachedStockSnapshot.previous || {}).date);
            } else {
                window._cachedStockSnapshot = { current: null, previous: null };
                console.log('[v4.4] 재고 스냅샷 없음 (첫 적용)');
            }
        } catch (e) {
            console.warn('[v4.4] 재고 스냅샷 로드 실패:', e);
            window._cachedStockSnapshot = { current: null, previous: null };
        }
    };
    
    // ===== 재고 스냅샷 저장 (v4.4 v2: 일일 최신화 업로드 시 호출) =====
    // 변경 이유: 마감 시점 트리거 → 일일 최신화 트리거로 변경
    //   - 마감 시점은 그날의 originalData 변동이 없을 수 있어 회전율 0% 문제 발생
    //   - 일일 최신화는 실제 새 재고 데이터가 들어오는 시점이라 의미 있음
    // 흐름:
    //   - current.date < 오늘 → 새 영업일 시작: 이전 current를 previous로 이동, 새 current 저장
    //   - current.date == 오늘 → 당일 내 업데이트: previous 유지, current만 덮어쓰기
    //   - current 없음 → 첫 적용: current만 저장
    window._v44_saveStockSnapshot = async function() {
        const newCurrent = window._v44_calculateCurrentStock();
        const today = window._v44_getTodayDateString();
        newCurrent.date = today;
        newCurrent.savedAt = new Date();
        
        const existing = window._cachedStockSnapshot || { current: null, previous: null };
        const oldCurrent = existing.current;
        const oldCurrentDate = oldCurrent?.date || '';
        
        let newPrevious;
        let logMode;
        if (oldCurrentDate && oldCurrentDate < today) {
            // 새 영업일 시작 → 어제 마지막 값을 previous로 이동
            newPrevious = oldCurrent;
            logMode = `새 영업일 시작 (이전 current[${oldCurrentDate}] → previous로 이동)`;
        } else if (oldCurrentDate === today) {
            // 당일 내 업데이트 → previous 그대로, current만 갱신
            newPrevious = existing.previous || null;
            logMode = `당일 내 갱신 (previous 유지)`;
        } else {
            // 첫 적용 (current 없음)
            newPrevious = existing.previous || null;
            logMode = `첫 저장`;
        }
        
        const newSnapshot = {
            current: newCurrent,
            previous: newPrevious
        };
        
        try {
            const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'locationStock', 'latest');
            await setDoc(docRef, newSnapshot);
            window._cachedStockSnapshot = newSnapshot;
            console.log(`[v4.4] 재고 스냅샷 저장 완료: ${logMode} / 3층 ${newCurrent.stock3F} / 2층 ${newCurrent.stock2F}`);
            return true;
        } catch (e) {
            console.error('[v4.4] 재고 스냅샷 저장 실패:', e);
            return false;
        }
    };
    
    // ===== v4.4 v2: history 리스너 제거됨 =====
    // 이전 v4.4: 메인 시스템의 history 컬렉션 onSnapshot 감지 → 마감 시점에 재고 저장
    // 변경 이유: 마감 시점 originalData가 그날 일일 최신화 결과와 같으면 회전율 0% 문제
    // 새 방식: 일일 최신화 업로드 시점에 저장 (updateDatabaseA 함수가 _v44_saveStockSnapshot 직접 호출)
    // 사용자 운영 패턴상 마감 후 일일 최신화 없음 → 의미 있는 회전율 자연스럽게 나옴
    window._v44_setupHistoryListener = function() {
        console.log('[v4.4] history 리스너는 사용하지 않음 (일일 최신화 업로드 트리거 방식)');
    };
    
    // ===== v4.4 v2: 사후 보정 제거됨 =====
    // 이전 v4.4: 페이지 로드 시 history 최신 문서 vs 저장된 재고 날짜 비교 → 사후 저장
    // 변경 이유: history 리스너 제거에 따라 사후 보정 불필요
    // 일일 최신화 업로드가 명시적 트리거이므로 사후 보정 개념 자체가 없음
    window._v44_postLoadCheck = async function() {
        // No-op
    };
    
    // ===== 재고회전율 계산 =====
    // 산출식: (전일 - 오늘) / 전일 × 100 (음수도 그대로 표시)
    window._v44_calculateTurnover = function() {
        const snap = window._cachedStockSnapshot || {};
        const current = snap.current;
        const previous = snap.previous;
        
        // 데이터 부족
        if (!current || !previous) {
            return {
                sufficient: false,
                message: '데이터 부족 (다음 일일 최신화 후 계산 가능)'
            };
        }
        
        // v4.4 v2: 부호 반전. 증가=양수, 감소=음수
        // 산출식: (current - previous) / previous × 100
        const calc = (prev, curr) => {
            if (!prev || prev === 0) return null; // 0 나누기 방지
            return ((curr - prev) / prev) * 100;
        };
        
        const rate3F = calc(previous.stock3F || 0, current.stock3F || 0);
        const rate2F = calc(previous.stock2F || 0, current.stock2F || 0);
        const prevTotal = (previous.stock3F || 0) + (previous.stock2F || 0);
        const currTotal = (current.stock3F || 0) + (current.stock2F || 0);
        const rateAll = calc(prevTotal, currTotal);
        
        return {
            sufficient: true,
            previousDate: previous.date || previous.triggerDate,
            currentDate: current.date || current.triggerDate,
            rate3F: rate3F,
            rate2F: rate2F,
            rateAll: rateAll,
            previousStock3F: previous.stock3F,
            previousStock2F: previous.stock2F,
            currentStock3F: current.stock3F,
            currentStock2F: current.stock2F
        };
    };
    
    // ===== 대시보드 렌더링 =====
    window._v44_renderDashboard = function() {
        const container = document.getElementById('dashboard-content');
        if (!container) return;
        
        // 1. 요약 카드용 데이터
        const currentStock = window._v44_calculateCurrentStock();
        const turnover = window._v44_calculateTurnover();
        
        // 당일지정수량 / 선지정수량 (기존 사용률 팝업과 동일 계산)
        let codeTagCount = 0;
        let preAssignCount = 0;
        try {
            (originalData || []).forEach(loc => {
                if (loc.codeTag && loc.codeTag.trim() !== '') codeTagCount++;
                if (loc.preAssigned) preAssignCount++;
            });
        } catch (e) {}
        
        const sku3F = currentStock.sku3F;
        const sku2F = currentStock.sku2F;
        const sku2층 = currentStock.sku2층 || 0; // v4.4: 2층 창고재고 SKU
        // v4.4: 총 SKU = 3층 SKU + 2층 SKU (2F SKU는 별도 표시)
        const skuTotal = sku3F + sku2층;
        
        // 카드 렌더링 헬퍼
        const card = (icon, title, value, sub, color) => {
            return `<div style="background:white; border:1px solid #e0e0e0; border-radius:8px; padding:12px 16px; min-width:140px; flex:1; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-size:11px; color:#888; font-weight:bold; margin-bottom:4px;">${icon} ${title}</div>
                <div style="font-size:22px; font-weight:900; color:${color || '#333'};">${value}</div>
                ${sub ? `<div style="font-size:11px; color:#999; margin-top:3px;">${sub}</div>` : ''}
            </div>`;
        };
        
        const formatRate = (rate) => {
            if (rate === null || rate === undefined) return '-';
            const sign = rate > 0 ? '+' : '';
            const color = rate > 0 ? '#e65100' : (rate < 0 ? '#1976d2' : '#666');
            return `<span style="color:${color};">${sign}${rate.toFixed(1)}%</span>`;
        };
        
        // 첫째 줄: 지정 + SKU
        // v4.4 v3: 2F SKU 카드 삭제 - 순서 = 당일지정 / 선지정 / 3층 SKU / 2층 SKU / 총 SKU
        let cardsRow1 = '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">';
        cardsRow1 += card('📌', '당일지정수량', codeTagCount.toLocaleString());
        cardsRow1 += card('🔒', '선지정수량', preAssignCount.toLocaleString());
        cardsRow1 += card('📦', '3층 SKU', sku3F.toLocaleString(), '고유 상품코드');
        cardsRow1 += card('🏬', '2층 SKU', sku2층.toLocaleString(), '2층창고재고 보유');
        cardsRow1 += card('🎯', '총 SKU', skuTotal.toLocaleString(), '3층 + 2층');
        cardsRow1 += '</div>';
        
        // 둘째 줄: 재고회전율
        // v4.4 v3: 재고회전율(2F) 삭제 - 3층 + 합산만 표시
        let cardsRow2 = '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:18px;">';
        if (!turnover.sufficient) {
            cardsRow2 += `<div style="background:#fff8e1; border:1px solid #ffd54f; border-radius:8px; padding:12px 16px; flex:1; font-size:12px; color:#a36800;">
                ⚠️ ${turnover.message}<br>
                <span style="font-size:11px; color:#999;">일일 최신화 업로드를 2영업일 이상 반복하면 회전율이 계산됩니다</span>
            </div>`;
        } else {
            // v4.4 v2: 날짜+수량을 두 줄로 표시
            const sub3F = `${turnover.previousDate}: ${(turnover.previousStock3F || 0).toLocaleString()}<br>${turnover.currentDate}: ${(turnover.currentStock3F || 0).toLocaleString()}`;
            const prevTotal = (turnover.previousStock3F || 0) + (turnover.previousStock2F || 0);
            const currTotal = (turnover.currentStock3F || 0) + (turnover.currentStock2F || 0);
            const subAll = `${turnover.previousDate}: ${prevTotal.toLocaleString()}<br>${turnover.currentDate}: ${currTotal.toLocaleString()}`;
            cardsRow2 += card('🔄', '재고회전율 (3층)', formatRate(turnover.rate3F), sub3F);
            cardsRow2 += card('🔄', '재고회전율 (합산)', formatRate(turnover.rateAll), subAll);
        }
        cardsRow2 += '</div>';
        
        // 2. 기존 사용률 데이터 통합 (3층 + 2층)
        // 기존 calculateAndRenderUsage 결과를 가져오기 위해 임시로 popup div 사용
        // → 더 깔끔하게 직접 계산
        const usage3FHtml = window._v44_renderUsage3F();
        const usage2FHtml = window._v44_renderUsage2F();
        
        const sectionTitle = (text) => `<div style="font-size:14px; font-weight:bold; color:var(--primary); margin:12px 0 8px 0; padding-bottom:4px; border-bottom:2px solid #e0e0e0;">${text}</div>`;
        
        container.innerHTML = `
            <div style="padding: 8px 12px;">
                ${sectionTitle('📊 요약 정보')}
                ${cardsRow1}
                ${cardsRow2}
                
                ${sectionTitle('🏢 3층 로케이션 사용률')}
                <div style="margin-bottom:18px;">${usage3FHtml}</div>
                
                ${sectionTitle('🏬 2층 창고 사용률')}
                <div>${usage2FHtml}</div>
            </div>
        `;
    };
    
    // ===== 3층 사용률 렌더링 (기존 calculateAndRenderUsage의 3F 부분 재사용) =====
    window._v44_renderUsage3F = function() {
        // 기존 사용률 팝업과 동일한 계산 로직을 임시로 호출
        // → 가장 간단: 기존 함수를 호출 후 그 결과 HTML을 추출
        // 그러나 popup div는 별도 영역이므로, 여기서는 임시로 hidden div 사용
        const tempDiv = document.createElement('div');
        tempDiv.id = '_v44_temp_usage';
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        
        const prevTab = window.currentUsageTab;
        window.currentUsageTab = '3F';
        
        // 기존 사용률 함수가 usage-popup에 출력하므로 임시로 그 div를 대체
        const popupEl = document.getElementById('usage-popup');
        const fakePopup = document.createElement('div');
        fakePopup.id = 'usage-popup';
        if (popupEl && popupEl.parentNode) {
            popupEl.id = '_v44_real_popup';
        }
        tempDiv.appendChild(fakePopup);
        
        let html = '';
        try {
            window.calculateAndRenderUsage();
            // 첫 줄(탭 버튼)은 제거
            const inner = fakePopup.innerHTML;
            // 탭 버튼 div를 제거하기 위해 첫 </div> 이후만 사용
            const firstDivEnd = inner.indexOf('</div>');
            if (firstDivEnd >= 0) {
                html = inner.substring(firstDivEnd + 6);
            } else {
                html = inner;
            }
        } catch (e) {
            console.warn('[v4.4] 3층 사용률 렌더링 실패:', e);
            html = '<div style="padding:20px; text-align:center; color:#999;">사용률 정보를 불러올 수 없습니다.</div>';
        }
        
        // 원복
        window.currentUsageTab = prevTab;
        if (document.getElementById('_v44_real_popup')) {
            document.getElementById('_v44_real_popup').id = 'usage-popup';
        }
        tempDiv.remove();
        
        return html;
    };
    
    // ===== 2층 사용률 렌더링 (기존 함수 재사용) =====
    window._v44_renderUsage2F = function() {
        const tempDiv = document.createElement('div');
        tempDiv.id = '_v44_temp_usage2';
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        
        const prevTab = window.currentUsageTab;
        window.currentUsageTab = '2F';
        
        const popupEl = document.getElementById('usage-popup');
        const fakePopup = document.createElement('div');
        fakePopup.id = 'usage-popup';
        if (popupEl && popupEl.parentNode) {
            popupEl.id = '_v44_real_popup2';
        }
        tempDiv.appendChild(fakePopup);
        
        let html = '';
        try {
            window.calculateAndRenderUsage();
            const inner = fakePopup.innerHTML;
            const firstDivEnd = inner.indexOf('</div>');
            if (firstDivEnd >= 0) {
                html = inner.substring(firstDivEnd + 6);
            } else {
                html = inner;
            }
        } catch (e) {
            console.warn('[v4.4] 2F 사용률 렌더링 실패:', e);
            html = '<div style="padding:20px; text-align:center; color:#999;">2F 사용률 정보를 불러올 수 없습니다.</div>';
        }
        
        window.currentUsageTab = prevTab;
        if (document.getElementById('_v44_real_popup2')) {
            document.getElementById('_v44_real_popup2').id = 'usage-popup';
        }
        tempDiv.remove();
        
        return html;
    };
    
    // ===== 초기화 (페이지 로드 후 호출됨) =====
    window._v44_init = async function() {
        try {
            console.log('[v4.4] 초기화 시작');
            // 1. 2F 캐시 + 재고 스냅샷 로드
            await window._v44_load2FloorCache();
            await window._v44_loadStockSnapshot();
            
            // 2. 사후 보정 체크
            await window._v44_postLoadCheck();
            
            // 3. history 리스너 설정 (이후 업무 마감 자동 감지)
            window._v44_setupHistoryListener();
            
            console.log('[v4.4] 초기화 완료');
            // 재고 회전율은 스냅샷 로드 후에 계산 가능 → 로케이션 대시보드가 떠 있으면 즉시 갱신
            const __locdashEl = document.getElementById('view-locdash');
            if (__locdashEl && __locdashEl.style.display !== 'none' && typeof window.renderLocationDashboard === 'function') {
                window.renderLocationDashboard();
            }
        } catch (e) {
            console.warn('[v4.4] 초기화 오류:', e);
        }
    };
})();

// ════════════════════════════════════════════════════════════
// 📍 [병합] 로케이션 현황 대시보드 (배포본 v3.94에서 이식)
//    별도 탭 'view-locdash'에서 렌더. v44 종합 대시보드와 독립.
// ════════════════════════════════════════════════════════════

// ============================================================
// 📊 로케이션 현황 대시보드
// ============================================================

// 마지막출고.배송일(배송일/출고일 중 최신) + 직진/주차별 출고 활동을 함께 고려한 분류 헬퍼.
// 일반배송 기록만 보면 직진배송으로 나간 물건이 데드로 잘못 잡힘 → 두 데이터를 합산.
function __dashInferDelivery(code, locs) {
    let lastDelivery = '';
    let hasStock = false;
    let hasRecentActivity = false;

    locs.forEach(loc => {
        if (Number(loc.stock || 0) > 0) hasStock = true;
        const val = __getLastMoveDate(loc.rawData || {});
        if (val && val > lastDelivery) lastDelivery = val;
    });

    // weeklyData YYYYMMDD 키 중 출고수량 > 0 인 가장 최근 날짜를 후보로
    if (code && weeklyData && weeklyData[code]) {
        let maxKey = '';
        for (const wk of Object.keys(weeklyData[code])) {
            if (/^20\d{6}$/.test(wk) && Number(weeklyData[code][wk] || 0) > 0) {
                if (wk > maxKey) maxKey = wk;
            }
        }
        if (maxKey) {
            const ymd = maxKey.slice(0, 4) + '-' + maxKey.slice(4, 6) + '-' + maxKey.slice(6, 8);
            if (ymd > lastDelivery) lastDelivery = ymd;
        }
    }

    // 직진배송 데이터 — 정확한 날짜는 모르지만 활동 사실은 확인 가능
    if (code && zikjinData && zikjinData[code] && Number(zikjinData[code]['수량'] || 0) > 0) {
        hasRecentActivity = true;
    }

    return { lastDelivery, hasStock, hasRecentActivity };
}

// 구역·동별 데드스톡 표의 정렬 상태 (key: dead|zone|dong|used|w1|m1|m3|m6plus|none, dir: 'asc'|'desc')
let __dashZdSort = { key: 'dead', dir: 'desc' };

// 구역 우선순위 (낮을수록 먼저). ★ → A → B → … → Z 외 나머지는 99.
function __zoneRank(z) {
    if (!z) return 99;
    if (z === '★') return -1;
    const code = z.charCodeAt(0);
    if (code >= 65 && code <= 90) return code - 65; // A=0, B=1, ...
    return 99;
}
// 동 정렬용 — 숫자 추출 후 비교. '미지정'은 항상 맨 뒤.
function __dongKey(d) {
    if (!d || d === '미지정') return Number.POSITIVE_INFINITY;
    const m = String(d).match(/-?\d+(\.\d+)?/);
    if (m) return Number(m[0]);
    return Number.POSITIVE_INFINITY - 1; // 숫자 없으면 거의 끝
}

function __dashSortRows(rows) {
    const { key, dir } = __dashZdSort;
    const mul = dir === 'asc' ? 1 : -1;
    const cmpStr = (a, b) => String(a).localeCompare(String(b)) * mul;
    const cmpNum = (a, b) => (a - b) * mul;
    rows.sort((a, b) => {
        switch (key) {
            case 'zone': {
                const z = __zoneRank(a.zone) - __zoneRank(b.zone);
                if (z !== 0) return z * mul;
                // 동일 구역 내 동 보조 정렬은 항상 오름차순
                const d = __dongKey(a.dong) - __dongKey(b.dong);
                if (d !== 0) return d;
                return cmpStr(a.dong, b.dong);
            }
            case 'dong': {
                const d = __dongKey(a.dong) - __dongKey(b.dong);
                if (d !== 0) return d * mul;
                // 동일 동 내 구역 보조 정렬은 항상 오름차순
                const z = __zoneRank(a.zone) - __zoneRank(b.zone);
                if (z !== 0) return z;
                return cmpStr(a.zone, b.zone);
            }
            case 'used':   return cmpNum(a.usedCount, b.usedCount);
            case 'w1':     return cmpNum(a.w1, b.w1);
            case 'm1':     return cmpNum(a.m1, b.m1);
            case 'm3':     return cmpNum(a.m3, b.m3);
            case 'm6plus': return cmpNum(a.m6plus, b.m6plus);
            case 'y1plus': return cmpNum(a.y1plus, b.y1plus);
            case 'none':   return cmpNum(a.none, b.none);
            case 'dead':
            default:       return cmpNum(a.deadRate, b.deadRate) || cmpNum(a.m6plus, b.m6plus);
        }
    });
}

// 헤더 클릭 핸들러 — 같은 키면 dir 토글, 다른 키면 그 키 + desc(zone/dong은 asc).
window.__dashZdSortBy = function (key) {
    if (__dashZdSort.key === key) {
        __dashZdSort.dir = __dashZdSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        __dashZdSort.key = key;
        // 이름 정렬은 asc, 숫자 정렬은 desc 기본
        __dashZdSort.dir = (key === 'zone' || key === 'dong') ? 'asc' : 'desc';
    }
    if (typeof window.renderLocationDashboard === 'function') window.renderLocationDashboard();
};

// 헤더 화살표 HTML 생성
function __dashSortArrow(key) {
    if (__dashZdSort.key !== key) return '<span style="color:#cfd8dc; font-size:10px;">↕</span>';
    return __dashZdSort.dir === 'asc'
        ? '<span style="color:var(--primary); font-size:11px;">▲</span>'
        : '<span style="color:var(--primary); font-size:11px;">▼</span>';
}

// 분류 헬퍼: 마지막배송일 + 직진 활동 여부 → bucket 키 반환.
// 직진 활동이 있으면 3개월/6개월+/기록없음을 1개월로 끌어올려 데드에서 제외.
function __dashClassifyDelivery(info, todayMs) {
    const MS_DAY = 24 * 60 * 60 * 1000;
    if (!info.lastDelivery) return info.hasRecentActivity ? '1개월' : '기록없음';
    const d = new Date(info.lastDelivery);
    if (isNaN(d.getTime())) return info.hasRecentActivity ? '1개월' : '기록없음';
    const diff = (todayMs - d.getTime()) / MS_DAY;
    if (diff <= 7) return '1주';
    if (diff <= 31) return '1개월';
    if (diff <= 93) return info.hasRecentActivity ? '1개월' : '3개월';
    if (diff <= 365) return info.hasRecentActivity ? '1개월' : '6개월+';
    return info.hasRecentActivity ? '1개월' : '1년+';
}

window.renderLocationDashboard = function () {
    if (!originalData || originalData.length === 0) {
        const kpiRow = document.getElementById('dash-kpi-row');
        if (kpiRow) kpiRow.innerHTML = '<div class="dash-kpi-card" style="grid-column:1/-1;"><div class="kpi-body"><div class="kpi-title">데이터 없음</div><div class="kpi-sub">먼저 일일 최신화 엑셀을 업로드해주세요.</div></div></div>';
        return;
    }

    // 3F만 (K로 시작하는 2F 제외) — 사용률 팝업 로직과 동일
    const locs3F = originalData.filter(d => (d.id || '').charAt(0).toUpperCase() !== 'K');
    const total = locs3F.length;

    const isUsed = (loc) =>
        (loc.code && String(loc.code).trim() !== '' && loc.code !== loc.id) ||
        (loc.name && String(loc.name).trim() !== '');

    // ---- 집계 ----
    const codeToLocs = new Map();          // 상품코드 → [loc, ...]
    const zoneStats = {};                  // 구역 → {total, used}
    let used = 0, preAssigned = 0, todayReserved = 0, registeredStockSum = 0;

    locs3F.forEach(loc => {
        const u = isUsed(loc);
        if (u) used++;
        if (loc.codeTag === '선지정') preAssigned++;
        if (loc.codeTag === '당일지정') todayReserved++;

        const zone = (loc.id || '').charAt(0).toUpperCase() || '?';
        if (!zoneStats[zone]) zoneStats[zone] = { total: 0, used: 0 };
        zoneStats[zone].total++;
        if (u) zoneStats[zone].used++;

        if (u && loc.code) {
            const c = String(loc.code).trim();
            if (!codeToLocs.has(c)) codeToLocs.set(c, []);
            codeToLocs.get(c).push(loc);
            registeredStockSum += Number(loc.stock || 0) || 0;
        }
    });

    const uniqueCodes = codeToLocs.size;
    const multiLocCodes = [...codeToLocs.entries()].filter(([, arr]) => arr.length >= 2);
    const empty = total - used;
    const usageRate = total > 0 ? (used / total * 100) : 0;

    // 입고대기
    const incomingCodes = Object.keys(incomingTotalByCode || {}).filter(c => (incomingTotalByCode[c] || 0) > 0);
    const incomingQtyTotal = incomingCodes.reduce((a, c) => a + (incomingTotalByCode[c] || 0), 0);

    // 마지막배송일 분포 (정상재고 있는 상품만, 상품코드 기준)
    const todayMs = new Date().setHours(0, 0, 0, 0);
    const MS_DAY = 24 * 60 * 60 * 1000;
    const buckets = { '1주': 0, '1개월': 0, '3개월': 0, '6개월+': 0, '1년+': 0, '기록없음': 0 };
    const bucketsQty = { '1주': 0, '1개월': 0, '3개월': 0, '6개월+': 0, '1년+': 0, '기록없음': 0 };
    codeToLocs.forEach((arr, code) => {
        const __info = __dashInferDelivery(code, arr);
        if (!__info.hasStock) return;
        const __bucketKey = __dashClassifyDelivery(__info, todayMs);
        buckets[__bucketKey]++;
        bucketsQty[__bucketKey] += arr.reduce((s, l) => s + (Number(l.stock || 0) || 0), 0);
        return;
        // (이하 옛 코드는 도달 불가 — 안전상 보존)
        let lastDelivery = '';
        let hasStock = false;
        arr.forEach(loc => {
            if (Number(loc.stock || 0) > 0) hasStock = true;
            const rd = loc.rawData || {};
            let val = rd['마지막배송일'] || rd['마지막입고일'] || '';
            if (!val) {
                // 공백/유니코드 변형 처리
                for (const k of Object.keys(rd)) {
                    const norm = k.replace(/[\s ]/g, '');
                    if (norm === '마지막배송일' || norm === '마지막입고일') { val = rd[k]; break; }
                }
            }
            if (val && val > lastDelivery) lastDelivery = val;
        });
        if (!hasStock) return;
        if (!lastDelivery) { buckets['기록없음']++; return; }
        // lastDelivery는 'YYYY-MM-DD' 또는 'YYYY.MM.DD' 형태로 추정 — 표준 Date 파싱 시도
        const d = new Date(String(lastDelivery).replace(/\./g, '-'));
        if (isNaN(d.getTime())) { buckets['기록없음']++; return; }
        const diff = (todayMs - d.getTime()) / MS_DAY;
        if (diff <= 7) buckets['1주']++;
        else if (diff <= 31) buckets['1개월']++;
        else if (diff <= 93) buckets['3개월']++;
        else buckets['6개월+']++;
    });

    // 데드 스톡 (3개월+) 후보 수 = 3개월 + 6개월+ + 1년+
    const deadStockCount = buckets['3개월'] + buckets['6개월+'] + buckets['1년+'];
    const deadStockQty = bucketsQty['3개월'] + bucketsQty['6개월+'] + bucketsQty['1년+'];

    // 빈 슬롯 비중 높은 동 Top 3
    const dongEmptyStats = {};
    locs3F.forEach(loc => {
        const dong = (loc.dong || '').toString().trim();
        if (!dong) return;
        if (!dongEmptyStats[dong]) dongEmptyStats[dong] = { total: 0, empty: 0 };
        dongEmptyStats[dong].total++;
        if (!isUsed(loc)) dongEmptyStats[dong].empty++;
    });
    const topEmptyDongs = Object.entries(dongEmptyStats)
        .filter(([, s]) => s.total >= 10)
        .map(([d, s]) => ({ dong: d, empty: s.empty, total: s.total, rate: s.empty / s.total }))
        .sort((a, b) => b.rate - a.rate)
        .slice(0, 3);

    // 추천 건수 (계산된 경우만 표시 — 없으면 '계산 필요')
    const recCount = Array.isArray(window.currentRecommendations) ? window.currentRecommendations.length : 0;

    // ---- 재고 회전율 (v4.4 스냅샷 기반: 전일 대비 재고 증감률) ----
    const __turnover = (typeof window._v44_calculateTurnover === 'function')
        ? window._v44_calculateTurnover() : { sufficient: false };
    const __fmtRate = (rate) => {
        if (rate === null || rate === undefined) return '-';
        const sign = rate > 0 ? '+' : '';
        const color = rate > 0 ? '#e65100' : (rate < 0 ? '#1976d2' : '#666');
        return `<span style="color:${color};">${sign}${rate.toFixed(1)}%</span>`;
    };

    // ---- KPI 카드 렌더 ----
    const donutSvg = (rate) => {
        const r = 22, c = 2 * Math.PI * r;
        const dash = c * (rate / 100);
        const color = rate >= 80 ? '#ef5350' : rate >= 50 ? '#3d5afe' : '#66bb6a';
        return `<svg class="kpi-donut" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="${r}" fill="none" stroke="#eceff1" stroke-width="7"/>
            <circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="7"
                stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}"
                transform="rotate(-90 28 28)" stroke-linecap="round"/>
            <text x="28" y="32" text-anchor="middle">${rate.toFixed(0)}%</text>
        </svg>`;
    };

    const kpiHtml = `
        <div class="dash-kpi-card">
            ${donutSvg(usageRate)}
            <div class="kpi-body">
                <div class="kpi-title">전체 사용률 (3F)</div>
                <div class="kpi-value">${usageRate.toFixed(1)}%</div>
                <div class="kpi-sub">${used.toLocaleString()} / ${total.toLocaleString()} 칸</div>
            </div>
        </div>
        <div class="dash-kpi-card" style="cursor:pointer;" onclick="window.__dashGoToList('empty')" title="클릭: 데이터 리스트에서 빈 자리만 보기 (지정·작업 가능)"
            onmouseover="this.style.boxShadow='0 2px 10px rgba(61,90,254,0.25)';" onmouseout="this.style.boxShadow='';">
            <div class="kpi-icon green">🟢</div>
            <div class="kpi-body">
                <div class="kpi-title">빈 자리 <span style="font-size:11px; color:#90a4ae;">▸</span></div>
                <div class="kpi-value">${empty.toLocaleString()}</div>
                <div class="kpi-sub">전체 대비 ${total > 0 ? (empty / total * 100).toFixed(1) : 0}%</div>
            </div>
        </div>
        <div class="dash-kpi-card">
            <div class="kpi-icon blue">📦</div>
            <div class="kpi-body">
                <div class="kpi-title">등록 상품 (고유)</div>
                <div class="kpi-value">${uniqueCodes.toLocaleString()}<span style="font-size:13px; color:#90a4ae; font-weight:bold;"> 종</span></div>
                <div class="kpi-sub">총 재고 ${registeredStockSum.toLocaleString()}개 · 평균 ${uniqueCodes > 0 ? (used / uniqueCodes).toFixed(1) : 0} 칸/상품</div>
            </div>
        </div>
        <div class="dash-kpi-card" style="cursor:pointer;" onclick="window.__dashShowLocList('preassigned')" title="클릭: 선지정/당일지정 리스트 보기"
            onmouseover="this.style.boxShadow='0 2px 10px rgba(230,81,0,0.25)';" onmouseout="this.style.boxShadow='';">
            <div class="kpi-icon amber">📌</div>
            <div class="kpi-body">
                <div class="kpi-title">선지정 / 당일지정 <span style="font-size:11px; color:#90a4ae;">▸</span></div>
                <div class="kpi-value">${preAssigned} <span style="font-size:14px; color:#90a4ae; font-weight:bold;">/ ${todayReserved}</span></div>
                <div class="kpi-sub">미입고 찜 ${preAssigned}건, 오늘 작업 ${todayReserved}건</div>
            </div>
        </div>
        <div class="dash-kpi-card">
            <div class="kpi-icon red">📥</div>
            <div class="kpi-body">
                <div class="kpi-title">입고 대기</div>
                <div class="kpi-value">${incomingCodes.length}<span style="font-size:14px; color:#90a4ae; font-weight:bold;"> 종</span></div>
                <div class="kpi-sub">총 ${incomingQtyTotal.toLocaleString()} 개 미입고</div>
            </div>
        </div>
    `;
    document.getElementById('dash-kpi-row').innerHTML = kpiHtml;

    // ---- 구역별 사용률 ----
    const sortedZones = Object.keys(zoneStats).sort((a, b) => (a === '★' ? -1 : (b === '★' ? 1 : a.localeCompare(b))));
    const zoneBars = sortedZones.map(z => {
        const s = zoneStats[z];
        const rate = s.total > 0 ? (s.used / s.total * 100) : 0;
        return `<div class="zone-bar-row">
            <div class="zb-label">${z} 구역</div>
            <div class="zb-track"><div class="zb-fill" style="width:${rate.toFixed(1)}%;"></div></div>
            <div class="zb-text">${s.used} / ${s.total} (${rate.toFixed(1)}%)</div>
        </div>`;
    }).join('');
    document.getElementById('dash-zone-bars').innerHTML = zoneBars || '<div style="color:#90a4ae; font-size:12px;">데이터 없음</div>';

    // ---- 마지막배송일 분포 ----
    const totalForBuckets = Object.values(buckets).reduce((a, b) => a + b, 0);
    const bucketDef = [
        { key: '1주', cls: '' },
        { key: '1개월', cls: '' },
        { key: '3개월', cls: 'warn' },
        { key: '6개월+', cls: 'danger' },
        { key: '1년+', cls: 'danger' },
        { key: '기록없음', cls: 'gray' }
    ];
    const deliveryBars = bucketDef.map(b => {
        const v = buckets[b.key];
        const rate = totalForBuckets > 0 ? (v / totalForBuckets * 100) : 0;
        const cursor = v > 0 ? 'cursor:pointer;' : '';
        const clickAttr = v > 0 ? `onclick="window.__dashShowBucketList('${b.key}')"` : '';
        return `<div class="zone-bar-row" style="${cursor} transition: background 0.15s;" ${clickAttr}
                    onmouseover="if(${v})this.style.background='#f5f7ff';"
                    onmouseout="this.style.background='';"
                    title="${v > 0 ? '클릭: 이 기간 상품 리스트 보기' : ''}">
            <div class="zb-label">${b.key}</div>
            <div class="zb-track"><div class="zb-fill ${b.cls}" style="width:${rate.toFixed(1)}%;"></div></div>
            <div class="zb-text">${v.toLocaleString()} 종 (${rate.toFixed(1)}%)</div>
        </div>`;
    }).join('');
    document.getElementById('dash-delivery-bars').innerHTML = deliveryBars;

    // ---- 인사이트 카드 ----
    const insightHtml = `
        <div class="insight-card">
            <h4>🔄 재고 회전</h4>
            ${__turnover.sufficient
                ? `<div class="ins-big">${((__turnover.currentStock3F || 0) + (__turnover.currentStock2F || 0)).toLocaleString()}<span style="font-size:13px; color:#90a4ae; font-weight:bold;"> 개</span> <span style="font-size:15px;">${__fmtRate(__turnover.rateAll)}</span></div>
                   <div class="ins-desc">3층 ${(__turnover.currentStock3F || 0).toLocaleString()}개 ${__fmtRate(__turnover.rate3F)} (전일 대비) · ${__turnover.previousDate} → ${__turnover.currentDate}</div>`
                : `<div class="ins-big" style="font-size:18px; color:#a36800;">데이터 부족</div>
                   <div class="ins-desc">일일 최신화 2회 이상 누적 시 계산됩니다.</div>`}
        </div>
        <div class="insight-card">
            <h4>🔁 다중 위치 상품</h4>
            <div class="ins-big" ${multiLocCodes.length > 0 ? `style="cursor:pointer; transition: color 0.15s;" onclick="window.__dashShowLocList('multiloc')" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color=''" title="전체 다중 위치 상품 리스트 보기"` : ''}>
                ${multiLocCodes.length}<span style="font-size:13px; color:#90a4ae; font-weight:bold;"> 종</span>
                ${multiLocCodes.length > 0 ? '<span style="font-size:11px; color:#90a4ae; font-weight:normal; margin-left:4px;">▸</span>' : ''}
            </div>
            <div class="ins-desc">한 상품코드가 2곳 이상 분산된 상품. 통합하면 빈 슬롯이 늘어납니다. <span style="color:#90a4ae;">(숫자 클릭: 전체 리스트)</span></div>
            <div class="ins-list">
                ${multiLocCodes.slice(0, 5).map(([c, arr]) =>
                    `<div><span class="pill">${arr.length}곳</span> ${c}</div>`
                ).join('') || '<div style="color:#90a4ae;">없음</div>'}
            </div>
            <div style="margin-top:8px; padding-top:8px; border-top:1px dashed #e0e0e0; font-size:12px;">
                <span style="color:#37474f; font-weight:700;">⚠️ 한 자리 2+ 상품</span>
                <span ${(window.__dupLocations || []).length > 0 ? `style="cursor:pointer; color:#c62828; font-weight:900; margin-left:4px;" onclick="window.__dashShowLocList('duploc')" title="중복 지정된 로케이션 보기"` : 'style="color:#90a4ae; margin-left:4px;"'}>${(window.__dupLocations || []).length}건${(window.__dupLocations || []).length > 0 ? ' ▸' : ''}</span>
                <div style="color:#90a4ae; font-size:11px; margin-top:2px;">최근 데이터 최신화에서 같은 로케이션에 다른 상품이 들어온 경우</div>
            </div>
        </div>
        <div class="insight-card">
            <h4>💤 데드 스톡 후보</h4>
            <div class="ins-big" ${deadStockCount > 0 ? `style="cursor:pointer; transition: color 0.15s;" onclick="window.__dashShowBucketList('dead-all')" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color=''" title="전체 데드스톡 합계 리스트 보기"` : ''}>
                ${deadStockCount}<span style="font-size:13px; color:#90a4ae; font-weight:bold;"> 종</span>
                <span style="font-size:14px; color:#90a4ae; font-weight:bold;"> / ${deadStockQty.toLocaleString()}개</span>
                ${deadStockCount > 0 ? '<span style="font-size:11px; color:#90a4ae; font-weight:normal; margin-left:4px;">▸</span>' : ''}
            </div>
            <div class="ins-list">
                <span class="pill" style="cursor:pointer; background:#fff8e1; color:#e65100;" onclick="window.__dashShowBucketList('3개월')" title="3개월 경과 상품 보기">3개월: ${buckets['3개월']}종 / ${bucketsQty['3개월'].toLocaleString()}개</span>
                <span class="pill" style="cursor:pointer; background:#ffebee; color:#c62828;" onclick="window.__dashShowBucketList('6개월+')" title="6개월~1년 경과 상품 보기">6개월+: ${buckets['6개월+']}종 / ${bucketsQty['6개월+'].toLocaleString()}개</span>
                <span class="pill" style="cursor:pointer; background:#fce4ec; color:#880e4f;" onclick="window.__dashShowBucketList('1년+')" title="1년 이상 경과 상품 보기">1년+: ${buckets['1년+']}종 / ${bucketsQty['1년+'].toLocaleString()}개</span>
            </div>
        </div>
        <div class="insight-card">
            <h4>🏚️ 빈 자리 많은 동 Top 3</h4>
            ${topEmptyDongs.length > 0 ? `
                <div class="ins-list" style="margin-top: 4px;">
                    ${topEmptyDongs.map(d => `
                        <div style="display:flex; align-items:center; gap:8px; padding:4px 0;">
                            <span class="pill" style="background:#fff3e0; color:#e65100;">${d.dong}동</span>
                            <span style="color:#37474f; font-weight:bold;">${d.empty}/${d.total}</span>
                            <span style="color:#90a4ae;">(${(d.rate * 100).toFixed(0)}%)</span>
                        </div>
                    `).join('')}
                </div>
            ` : '<div style="color:#90a4ae; font-size:12px; margin-top: 8px;">동 데이터가 부족합니다.</div>'}
        </div>
    `;
    document.getElementById('dash-insight-row').innerHTML = insightHtml;

    // ---- 빠른 작업 ----
    const actionsHtml = `
        <button class="dash-action-btn act-orange" onclick="window.toggleIncomingSidebar()">
            📦 입고대기 패널 <span class="badge">${incomingCodes.length}건</span>
        </button>
        <button class="dash-action-btn act-green" onclick="window.openRecommendModal && window.openRecommendModal()">
            💡 변경 추천 ${recCount > 0 ? `<span class="badge">${recCount}건</span>` : ''}
        </button>
        <button class="dash-action-btn act-purple" onclick="document.getElementById('modal-2f').style.display='flex'; window.calc2FList && window.calc2FList();">
            📭 빈칸확보
        </button>
    `;
    document.getElementById('dash-actions').innerHTML = actionsHtml;

    // ---- 구역·동별 데드스톡 분석 ----
    renderZoneDongDeadStock(locs3F, isUsed);

    // ---- 데이터 신선도 ----
    const zikjinKeys = Object.keys(zikjinData || {}).length;
    const weeklyKeys = Object.keys(weeklyData || {}).length;
    const freshHtml = `
        <div>📅 <b>오늘:</b> ${new Date().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        <div>📂 <b>직진배송 데이터:</b> ${zikjinKeys > 0 ? zikjinKeys.toLocaleString() + '건' : '<span style="color:#c62828;">미업로드</span>'}</div>
        <div>📂 <b>주차별 데이터:</b> ${weeklyKeys > 0 ? weeklyKeys.toLocaleString() + '건' : '<span style="color:#c62828;">미업로드</span>'}</div>
        <div>📦 <b>입고대기 종 수:</b> ${incomingCodes.length.toLocaleString()}</div>
        <div>🗄️ <b>등록 로케이션:</b> ${originalData.length.toLocaleString()}칸 (3F: ${total.toLocaleString()}, 그 외: ${(originalData.length - total).toLocaleString()})</div>
    `;
    document.getElementById('dash-freshness').innerHTML = freshHtml;
};

// 구역·동별 데드스톡 집계 + 테이블 렌더
function renderZoneDongDeadStock(locs3F, isUsed) {
    const tbody = document.getElementById('dash-zonedong-tbody');
    const thead = document.getElementById('dash-zonedong-thead');
    const summary = document.getElementById('dash-zonedong-summary');
    if (!tbody) return;

    // 정렬 헤더 렌더
    if (thead) {
        const A = __dashSortArrow;
        const sortKey = __dashZdSort.key;
        const cellBase = 'padding:8px; border:1px solid #e0e6ed; cursor:pointer; user-select:none;';
        const isActive = (k) => sortKey === k;
        const hl = (k, baseBg) => isActive(k) ? 'background:#e3f2fd;' : (baseBg ? `background:${baseBg};` : '');
        const zoneSubActive = sortKey === 'zone';
        const dongSubActive = sortKey === 'dong';
        thead.innerHTML = `
            <tr style="background:#f4f4f4;">
                <th style="${cellBase} ${(zoneSubActive||dongSubActive)?'background:#e3f2fd;':''}" title="구역 또는 동 기준 정렬">
                    <div style="display:flex; gap:6px; justify-content:center; align-items:center;">
                        <span onclick="window.__dashZdSortBy('zone')" style="cursor:pointer; padding:2px 6px; border-radius:4px; ${zoneSubActive?'background:white; color:var(--primary); font-weight:900;':'color:#37474f;'}">
                            구역 ${A('zone')}
                        </span>
                        <span style="color:#cfd8dc;">|</span>
                        <span onclick="window.__dashZdSortBy('dong')" style="cursor:pointer; padding:2px 6px; border-radius:4px; ${dongSubActive?'background:white; color:var(--primary); font-weight:900;':'color:#37474f;'}">
                            동 ${A('dong')}
                        </span>
                    </div>
                </th>
                <th style="${cellBase} ${hl('used')}" onclick="window.__dashZdSortBy('used')">사용중 ${A('used')}</th>
                <th style="${cellBase} ${hl('w1', '#e8f5e9')}" onclick="window.__dashZdSortBy('w1')">1주 ${A('w1')}</th>
                <th style="${cellBase} ${hl('m1', '#f1f8e9')}" onclick="window.__dashZdSortBy('m1')">1개월 ${A('m1')}</th>
                <th style="${cellBase} ${hl('m3', '#fff8e1')}" onclick="window.__dashZdSortBy('m3')">3개월 ${A('m3')}</th>
                <th style="${cellBase} ${hl('m6plus', '#ffebee')}" onclick="window.__dashZdSortBy('m6plus')">6개월+ ${A('m6plus')}</th>
                <th style="${cellBase} ${hl('y1plus', '#fce4ec')}" onclick="window.__dashZdSortBy('y1plus')">1년+ ${A('y1plus')}</th>
                <th style="${cellBase} ${hl('none', '#eceff1')}" onclick="window.__dashZdSortBy('none')">기록없음 ${A('none')}</th>
                <th style="${cellBase} ${hl('dead')} min-width: 180px;" onclick="window.__dashZdSortBy('dead')">데드율 (3개월+) ${A('dead')}</th>
            </tr>
        `;
    }

    const includeNone = !!document.getElementById('dash-zd-include-none')?.checked;
    const minSlots = Math.max(0, Number(document.getElementById('dash-zd-min-slots')?.value || 10));

    const todayMs = new Date().setHours(0, 0, 0, 0);
    const MS_DAY = 24 * 60 * 60 * 1000;

    // (zone, dong) → 상품코드 Map → bucket
    const groupMap = new Map(); // key 'A-1' → { codeMap: Map<code,locs[]>, zone, dong }

    locs3F.forEach(loc => {
        if (!isUsed(loc)) return;
        const code = String(loc.code || '').trim();
        if (!code) return;
        const zone = (loc.id || '').charAt(0).toUpperCase() || '?';
        const dong = String(loc.dong || '').trim() || '미지정';
        const key = `${zone}-${dong}`;
        if (!groupMap.has(key)) groupMap.set(key, { zone, dong, codeMap: new Map() });
        const grp = groupMap.get(key);
        if (!grp.codeMap.has(code)) grp.codeMap.set(code, []);
        grp.codeMap.get(code).push(loc);
    });

    // 상품코드 단위로 bucket 분류 (전체 차트와 동일한 방법)
    const lastDeliveryOfCode = (locs) => {
        let lastDelivery = '';
        let hasStock = false;
        locs.forEach(loc => {
            if (Number(loc.stock || 0) > 0) hasStock = true;
            const rd = loc.rawData || {};
            let val = rd['마지막배송일'] || rd['마지막입고일'] || '';
            if (!val) {
                for (const k of Object.keys(rd)) {
                    const norm = k.replace(/[\s ]/g, '');
                    if (norm === '마지막배송일' || norm === '마지막입고일') { val = rd[k]; break; }
                }
            }
            if (val && val > lastDelivery) lastDelivery = val;
        });
        return { lastDelivery, hasStock };
    };

    const rows = [];
    groupMap.forEach(grp => {
        let usedCount = 0, w1 = 0, m1 = 0, m3 = 0, m6plus = 0, y1plus = 0, none = 0;
        grp.codeMap.forEach((arr, code) => {
            // 🛡️ 직진/주차 출고 활동 보강 헬퍼 사용 (전체 차트와 동일)
            const info = __dashInferDelivery(code, arr);
            if (!info.hasStock) return;
            usedCount++;
            const cat = __dashClassifyDelivery(info, todayMs);
            if (cat === '1주') w1++;
            else if (cat === '1개월') m1++;
            else if (cat === '3개월') m3++;
            else if (cat === '6개월+') m6plus++;
            else if (cat === '1년+') y1plus++;
            else none++;
            return;
            // (이하 구버전 로직 — 안전상 보존, 도달 불가)
            const { lastDelivery, hasStock } = lastDeliveryOfCode(arr);
            if (!hasStock) return;
            usedCount++;
            if (!lastDelivery) { none++; return; }
            const d = new Date(String(lastDelivery).replace(/\./g, '-'));
            if (isNaN(d.getTime())) { none++; return; }
            const diff = (todayMs - d.getTime()) / MS_DAY;
            if (diff <= 7) w1++;
            else if (diff <= 31) m1++;
            else if (diff <= 93) m3++;
            else m6plus++;
        });
        if (usedCount < minSlots) return;
        const deadBase = includeNone ? (m3 + m6plus + y1plus + none) : (m3 + m6plus + y1plus);
        const deadRate = usedCount > 0 ? (deadBase / usedCount * 100) : 0;
        rows.push({ ...grp, usedCount, w1, m1, m3, m6plus, y1plus, none, deadRate });
    });

    __dashSortRows(rows);

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding:20px; color:#90a4ae;">조건에 맞는 구역-동이 없습니다. (최소 사용 슬롯 ${minSlots} 기준)</td></tr>`;
        if (summary) summary.innerHTML = '';
        return;
    }

    const cellFmt = (v) => v > 0 ? v.toLocaleString() : '<span style="color:#cfd8dc;">·</span>';
    // 데드율 내림차순 정렬일 때만 1~3위 강조 (다른 정렬에선 의미 없으므로 끔)
    const isDefaultDeadSort = __dashZdSort.key === 'dead' && __dashZdSort.dir === 'desc';
    const html = rows.map((r, idx) => {
        const barColor = r.deadRate >= 50 ? '#c62828' : r.deadRate >= 30 ? '#ef6c00' : r.deadRate >= 15 ? '#fbc02d' : '#66bb6a';
        const showRank = isDefaultDeadSort && idx < 3;
        const rankBadge = showRank ? `<span style="display:inline-block; background:${idx===0?'#c62828':idx===1?'#ef6c00':'#fbc02d'}; color:white; font-weight:900; font-size:10px; padding:2px 6px; border-radius:10px; margin-right:6px;">${idx+1}위</span>` : '';
        // 클릭 셀 빌더 (값 > 0 이고 bucket 있을 때만 클릭 가능)
        const clickCell = (bucket, value, baseStyle) => {
            if (value > 0) {
                const safeZ = String(r.zone).replace(/'/g, "\\'");
                const safeD = String(r.dong).replace(/'/g, "\\'");
                return `<td style="${baseStyle} cursor:pointer;" onclick="window.__dashShowBucketList('${bucket}','${safeZ}','${safeD}')" title="${r.zone}-${r.dong} ${bucket} 상품 보기" onmouseover="this.style.background='#eef1ff';" onmouseout="this.style.background='';">${cellFmt(value)}</td>`;
            }
            return `<td style="${baseStyle}">${cellFmt(value)}</td>`;
        };
        return `
        <tr style="${showRank ? 'background: #fff3e0;' : ''}">
            <td style="padding:8px; border:1px solid #e0e6ed; font-weight:bold; text-align:left;">${rankBadge}${r.zone} 구역 - ${r.dong} 동</td>
            <td style="padding:8px; border:1px solid #e0e6ed;">${r.usedCount.toLocaleString()}</td>
            ${clickCell('1주', r.w1, 'padding:8px; border:1px solid #e0e6ed; color:#2e7d32;')}
            ${clickCell('1개월', r.m1, 'padding:8px; border:1px solid #e0e6ed; color:#558b2f;')}
            ${clickCell('3개월', r.m3, 'padding:8px; border:1px solid #e0e6ed; color:#ef6c00; font-weight:bold;')}
            ${clickCell('6개월+', r.m6plus, 'padding:8px; border:1px solid #e0e6ed; color:#c62828; font-weight:bold;')}
            ${clickCell('1년+', r.y1plus, 'padding:8px; border:1px solid #e0e6ed; color:#880e4f; font-weight:bold; background:#fce4ec;')}
            ${clickCell('기록없음', r.none, 'padding:8px; border:1px solid #e0e6ed; color:#78909c;')}
            <td style="padding:8px; border:1px solid #e0e6ed;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="flex:1; background:#eceff1; height:14px; border-radius:7px; overflow:hidden;">
                        <div style="height:100%; width:${r.deadRate.toFixed(1)}%; background:${barColor}; transition: width 0.4s;"></div>
                    </div>
                    <span style="font-weight:bold; color:${barColor}; min-width: 42px; text-align:right;">${r.deadRate.toFixed(1)}%</span>
                </div>
            </td>
        </tr>`;
    }).join('');
    tbody.innerHTML = html;

    // 요약: 가중 평균 / 최악 / 최상
    const totalUsed = rows.reduce((a, r) => a + r.usedCount, 0);
    const totalDead = rows.reduce((a, r) => a + (includeNone ? r.m3 + r.m6plus + r.y1plus + r.none : r.m3 + r.m6plus + r.y1plus), 0);
    const avgRate = totalUsed > 0 ? (totalDead / totalUsed * 100) : 0;
    const worst = rows[0];
    const best = rows[rows.length - 1];
    if (summary) {
        summary.innerHTML = `
            📊 표시된 ${rows.length}개 구역-동의 평균 데드율: <b style="color:#37474f;">${avgRate.toFixed(1)}%</b>
            &nbsp;|&nbsp; 최악: <b style="color:#c62828;">${worst.zone}-${worst.dong}동 (${worst.deadRate.toFixed(1)}%)</b>
            &nbsp;|&nbsp; 최상: <b style="color:#2e7d32;">${best.zone}-${best.dong}동 (${best.deadRate.toFixed(1)}%)</b>
            ${includeNone ? ' &nbsp;<span style="color:#90a4ae;">(기록없음 포함)</span>' : ''}
        `;
    }
}

// ============================================================
// 📅 bucket 클릭 → 상품 리스트 모달
// ============================================================
let __dashLastBucketList = []; // 엑셀 다운로드용 캐시

window.__dashShowBucketList = function (bucket, zoneFilter, dongFilter) {
    const modal = document.getElementById('dash-bucket-modal');
    const titleEl = document.getElementById('dash-bucket-title');
    const metaEl = document.getElementById('dash-bucket-meta');
    const tbody = document.getElementById('dash-bucket-tbody');
    if (!modal || !tbody) return;

    // 3F만, isUsed (코드+name) 인 로케이션만
    const locs3F = originalData.filter(d => (d.id || '').charAt(0).toUpperCase() !== 'K');
    const isUsed = (loc) =>
        (loc.code && String(loc.code).trim() !== '' && loc.code !== loc.id) ||
        (loc.name && String(loc.name).trim() !== '');

    // zone/dong 필터 적용 후 상품코드 단위 그룹화
    const codeMap = new Map();
    locs3F.forEach(loc => {
        if (!isUsed(loc)) return;
        const zone = (loc.id || '').charAt(0).toUpperCase() || '?';
        const dong = String(loc.dong || '').trim() || '미지정';
        if (zoneFilter && zone !== zoneFilter) return;
        if (dongFilter && dong !== dongFilter) return;
        const code = String(loc.code || '').trim();
        if (!code) return;
        if (!codeMap.has(code)) codeMap.set(code, []);
        codeMap.get(code).push(loc);
    });

    const todayMs = new Date().setHours(0, 0, 0, 0);
    // bucket이 'dead-all'이면 데드스톡 3종(3개월/6개월+/1년+)을 모두 포함.
    const DEAD_SET = new Set(['3개월', '6개월+', '1년+']);
    const isDeadAll = bucket === 'dead-all';
    const items = [];
    codeMap.forEach((arr, code) => {
        const info = __dashInferDelivery(code, arr);
        if (!info.hasStock) return;
        const cat = __dashClassifyDelivery(info, todayMs);
        if (isDeadAll) {
            if (!DEAD_SET.has(cat)) return;
        } else if (cat !== bucket) return;

        // 대표 정보 — 같은 코드여도 위치 여러 곳이면 모두 노출
        const rep = arr[0] || {};
        const name = rep.name || (zikjinData[code]?.['상품명']) || (weeklyData[code]?.['상품명']) || '';
        const option = rep.option || '';
        const locsStr = arr.map(l => l.id).join(', ');
        const totalStock = arr.reduce((a, l) => a + Number(l.stock || 0), 0);
        const totalStock2f = arr.reduce((a, l) => a + Number(l.stock2f || 0), 0);
        items.push({
            code, name, option,
            locsStr,
            stock: totalStock,
            stock2f: totalStock2f,
            lastDelivery: info.lastDelivery || '',
            hasRecentActivity: info.hasRecentActivity,
            cat
        });
    });

    // 정렬: 마지막배송일 오래된 순 (기록없음 맨 위)
    items.sort((a, b) => {
        if (!a.lastDelivery && !b.lastDelivery) return 0;
        if (!a.lastDelivery) return -1;
        if (!b.lastDelivery) return 1;
        return a.lastDelivery.localeCompare(b.lastDelivery);
    });

    __dashLastBucketList = { bucket, zoneFilter, dongFilter, items };

    // 헤더 텍스트
    const scopeLabel = (zoneFilter || dongFilter)
        ? `${zoneFilter || '전체구역'} - ${dongFilter || '전체동'} `
        : '전체 ';
    const displayBucket = isDeadAll ? '데드스톡 후보 합계' : bucket;
    if (titleEl) {
        titleEl.querySelector('span').textContent = `📅 ${scopeLabel}[${displayBucket}] 상품 리스트 (${items.length}종)`;
    }
    if (metaEl) {
        const desc = isDeadAll
            ? '3개월 / 6개월+ / 1년+ 합계 — 우선 정리/이동 대상'
            : ({
                '1주': '최근 1주일 내 출고된 상품 (회전 양호)',
                '1개월': '최근 1개월 내 출고된 상품',
                '3개월': '1~3개월 내 마지막 출고 — 데드 후보',
                '6개월+': '3~12개월 내 마지막 출고 — 데드',
                '1년+': '1년 이상 출고 없는 재고 — 우선 정리 대상',
                '기록없음': '마지막출고.배송일 기록이 없는 상품'
            }[bucket] || '');
        metaEl.textContent = desc;
    }

    // dead-all 모드일 때 분류 컬럼 추가
    const thead = document.querySelector('#dash-bucket-modal thead tr');
    if (thead) {
        // 기존 분류 컬럼이 있으면 제거
        const oldCatTh = thead.querySelector('th[data-cat-col]');
        if (oldCatTh) oldCatTh.remove();
        if (isDeadAll) {
            const th = document.createElement('th');
            th.setAttribute('data-cat-col', '1');
            th.style.borderTop = 'none';
            th.textContent = '분류';
            thead.insertBefore(th, thead.children[thead.children.length - 2]); // 마지막배송일 앞
        }
    }

    if (items.length === 0) {
        const colCount = isDeadAll ? 9 : 8;
        tbody.innerHTML = `<tr><td colspan="${colCount}" style="padding:30px; text-align:center; color:#90a4ae;">해당 조건에 맞는 상품이 없습니다.</td></tr>`;
    } else {
        const catBadge = (cat) => {
            const colors = {
                '3개월': 'background:#fff8e1; color:#ef6c00;',
                '6개월+': 'background:#ffebee; color:#c62828;',
                '1년+': 'background:#fce4ec; color:#880e4f;'
            };
            return `<span style="${colors[cat] || 'background:#eceff1; color:#37474f;'} padding:2px 8px; border-radius:10px; font-size:11px; font-weight:bold;">${cat}</span>`;
        };
        tbody.innerHTML = items.map(it => `
            <tr>
                <td style="font-family:monospace; font-size:11px;">${it.code}</td>
                <td style="text-align:left; padding-left:8px;">${it.name || '<span style=\"color:#cfd8dc;\">-</span>'}</td>
                <td>${it.option || '<span style=\"color:#cfd8dc;\">-</span>'}</td>
                <td style="font-family:monospace; font-size:11px;">${it.locsStr}</td>
                <td style="font-weight:bold;">${it.stock.toLocaleString()}</td>
                <td style="color:#607d8b;">${it.stock2f > 0 ? it.stock2f.toLocaleString() : '<span style=\"color:#cfd8dc;\">·</span>'}</td>
                ${isDeadAll ? `<td>${catBadge(it.cat)}</td>` : ''}
                <td>${it.lastDelivery || '<span style=\"color:#c62828;\">기록없음</span>'}</td>
                <td>${it.hasRecentActivity ? '<span style="background:#e8f5e9; color:#2e7d32; padding:2px 6px; border-radius:8px; font-size:10px; font-weight:bold;">직진 활동</span>' : '<span style=\"color:#cfd8dc;\">·</span>'}</td>
            </tr>
        `).join('');
    }

    modal.style.display = 'flex';
};

// ============================================================
// 📍 KPI 카드 클릭 → 상세 리스트 모달 (빈자리 / 선지정·당일지정 / 다중위치)
// ============================================================
window.__dashShowLocList = function (type) {
    const modal = document.getElementById('dash-loc-modal');
    const titleEl = document.getElementById('dash-loc-title');
    const metaEl = document.getElementById('dash-loc-meta');
    const thead = document.getElementById('dash-loc-thead');
    const tbody = document.getElementById('dash-loc-tbody');
    if (!modal || !tbody || !thead) return;

    const locs3F = originalData.filter(d => (d.id || '').charAt(0).toUpperCase() !== 'K');
    const isUsed = (loc) =>
        (loc.code && String(loc.code).trim() !== '' && loc.code !== loc.id) ||
        (loc.name && String(loc.name).trim() !== '');
    const setTitle = (t) => { if (titleEl) titleEl.querySelector('span').textContent = t; };
    const th = (cols) => `<tr>${cols.map(c => `<th style="border-top:none; font-size:12px;${c.w ? `width:${c.w};` : ''}">${c.t}</th>`).join('')}</tr>`;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    if (type === 'empty') {
        const rows = locs3F.filter(l => !isUsed(l)).sort((a, b) => (a.id || '').localeCompare(b.id || ''));
        setTitle(`🟢 빈 자리 리스트 (${rows.length}칸)`);
        if (metaEl) metaEl.textContent = '현재 비어 있는 3층 로케이션 — 입고/이동 배치에 사용 가능';
        thead.innerHTML = th([{ t: '로케이션', w: '130px' }, { t: '구역', w: '80px' }, { t: '동', w: '80px' }, { t: '위치' }]);
        tbody.innerHTML = rows.length ? rows.map(l => `<tr>
            <td style="font-family:monospace; font-weight:bold;">${l.id}</td>
            <td>${(l.id || '').charAt(0).toUpperCase() || '-'}</td>
            <td>${String(l.dong || '').trim() || '-'}</td>
            <td>${String(l.pos || '').trim() || '-'}</td></tr>`).join('')
            : `<tr><td colspan="4" style="padding:30px; text-align:center; color:#90a4ae;">빈 자리가 없습니다.</td></tr>`;
    } else if (type === 'preassigned') {
        const rows = locs3F.filter(l => l.codeTag === '선지정' || l.codeTag === '당일지정')
            .sort((a, b) => (a.codeTag || '').localeCompare(b.codeTag || '') || (a.id || '').localeCompare(b.id || ''));
        setTitle(`📌 선지정 / 당일지정 리스트 (${rows.length}건)`);
        if (metaEl) metaEl.textContent = '선지정(미입고 찜) · 당일지정(오늘 작업) 상태인 로케이션';
        thead.innerHTML = th([{ t: '로케이션', w: '130px' }, { t: '구분', w: '90px' }, { t: '상품코드', w: '120px' }, { t: '상품명' }, { t: '동', w: '70px' }]);
        const tagBadge = (tag) => tag === '선지정'
            ? '<span style="background:#fff3e0; color:#e65100; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:bold;">선지정</span>'
            : '<span style="background:#e3f2fd; color:#1565c0; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:bold;">당일지정</span>';
        tbody.innerHTML = rows.length ? rows.map(l => `<tr>
            <td style="font-family:monospace; font-weight:bold;">${l.id}</td>
            <td>${tagBadge(l.codeTag)}</td>
            <td style="font-family:monospace; font-size:11px;">${l.preAssignedCode || l.code || '-'}</td>
            <td style="text-align:left; padding-left:8px;">${l.name || '-'}</td>
            <td>${String(l.dong || '').trim() || '-'}</td></tr>`).join('')
            : `<tr><td colspan="5" style="padding:30px; text-align:center; color:#90a4ae;">선지정/당일지정 항목이 없습니다.</td></tr>`;
    } else if (type === 'multiloc') {
        const codeMap = new Map();
        locs3F.forEach(l => {
            if (!isUsed(l) || !l.code) return;
            const c = String(l.code).trim();
            if (!codeMap.has(c)) codeMap.set(c, []);
            codeMap.get(c).push(l);
        });
        const rows = [...codeMap.entries()].filter(([, arr]) => arr.length >= 2)
            .map(([code, arr]) => ({
                code, name: arr[0].name || '',
                locs: arr.map(l => l.id).join(', '),
                count: arr.length,
                stock: arr.reduce((a, l) => a + Number(l.stock || 0), 0)
            }))
            .sort((a, b) => b.count - a.count || b.stock - a.stock);
        setTitle(`🔁 다중 위치 상품 (${rows.length}종)`);
        if (metaEl) metaEl.textContent = '한 상품코드가 2곳 이상에 분산된 상품 — 통합 시 빈 슬롯 확보 가능';
        thead.innerHTML = th([{ t: '상품코드', w: '120px' }, { t: '상품명' }, { t: '분산 위치' }, { t: '칸수', w: '70px' }, { t: '정상재고', w: '90px' }]);
        tbody.innerHTML = rows.length ? rows.map(r => `<tr>
            <td style="font-family:monospace; font-size:11px; font-weight:bold; color:#1976d2;">${r.code}</td>
            <td style="text-align:left; padding-left:8px;">${r.name || '-'}</td>
            <td style="font-family:monospace; font-size:11px;">${r.locs}</td>
            <td style="font-weight:bold;">${r.count}곳</td>
            <td>${r.stock.toLocaleString()}</td></tr>`).join('')
            : `<tr><td colspan="5" style="padding:30px; text-align:center; color:#90a4ae;">다중 위치 상품이 없습니다.</td></tr>`;
    } else if (type === 'duploc') {
        const dups = window.__dupLocations || [];
        setTitle(`⚠️ 한 로케이션 2+ 상품 (${dups.length}건)`);
        if (metaEl) metaEl.textContent = '최근 데이터 최신화 시 같은 로케이션에 서로 다른 상품코드가 들어온 경우 — 저장 시 마지막 행만 남으므로 원본 엑셀을 확인하세요.';
        thead.innerHTML = th([{ t: '로케이션', w: '160px' }, { t: '지정된 상품코드들' }, { t: '개수', w: '70px' }]);
        tbody.innerHTML = dups.length ? dups.map(d => `<tr>
            <td style="font-family:monospace; font-weight:bold;">${esc(d.loc)}</td>
            <td style="text-align:left; padding-left:8px; font-family:monospace; font-size:11px;">${esc((d.codes || []).join(', '))}</td>
            <td style="font-weight:bold; color:#c62828;">${(d.codes || []).length}</td></tr>`).join('')
            : `<tr><td colspan="3" style="padding:30px; text-align:center; color:#90a4ae;">중복 지정된 로케이션이 없습니다.</td></tr>`;
    } else {
        return;
    }

    modal.style.display = 'flex';
};

// 엑셀 다운로드 (XLSX는 페이지에 이미 로드됨)
window.__dashDownloadBucketExcel = function () {
    if (!__dashLastBucketList || !__dashLastBucketList.items || __dashLastBucketList.items.length === 0) {
        alert('다운로드할 데이터가 없습니다.');
        return;
    }
    const { bucket, zoneFilter, dongFilter, items } = __dashLastBucketList;
    const sheetData = items.map(it => ({
        '상품코드': it.code,
        '상품명': it.name,
        '옵션': it.option,
        '현재위치': it.locsStr,
        '정상재고': it.stock,
        '2층재고': it.stock2f,
        '마지막출고.배송일': it.lastDelivery || '',
        '직진활동': it.hasRecentActivity ? 'O' : ''
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    const scope = (zoneFilter || 'ALL') + '_' + (dongFilter || 'ALL');
    const sheetName = `${bucket}_${scope}`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const fname = `데드스톡_${bucket}_${scope}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fname);
};
