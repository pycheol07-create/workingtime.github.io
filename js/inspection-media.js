// === js/inspection-media.js ===
// 검수 사진: 문서에 Base64 를 쌓지 않고 Firebase Storage(inspection/images/날짜/...)에 올려 URL 만 저장한다.
//   (상품 문서 1MB 한도를 넘으면 그 상품은 저장이 영구히 실패했다)
//   경로·메타데이터에 상품명·사람 정보를 넣지 않는다 — 경로 모양은 js/lib/insp-flow.js inspPhotoPath.
import * as DOM from './dom-elements.js?v=202610221642';
import { showToast, getTodayDateString } from './utils.js?v=202610221642';
import { searchProductHistory } from './inspection-logic.js?v=202610221642';
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { connectStorageEmulatorIfEnabled } from './firebase-emulator.js?v=202610221642';
import { inspPhotoPath } from './lib/insp-flow.js?v=202610221642';

export let html5QrCode = null;
export let manualImageBase64 = null;

let existingPhoto = null;     // 불러온 기록의 사진(URL 또는 옛 Base64)
let newPhotoBlob = null;      // 이번에 고른 사진(800px JPEG)
let newPhotoUrl = null;       // 새 사진을 올린 뒤 받은 주소 — 저장 재시도 때 다시 올리지 않게
let newPhotoUpload = null;    // 올리는 중인 Promise(두 번 눌러도 한 번만)
let previewObjectUrl = null;
let photoEpoch = 0;           // 상품 회차 — 바뀌면 읽는 중이던 사진은 끝나도 버린다
let pendingPhoto = null;      // 읽고 줄이는 중(FileReader·디코딩)인 사진 { epoch }

/** 지금 상품의 사진을 읽고 줄이는 중인가 — 그동안 저장 버튼을 막는다(js/inspection-logic.js). */
export const isPhotoBusy = () => !!(pendingPhoto && pendingPhoto.epoch === photoEpoch);

const emitPhotoBusy = () => {
    document.dispatchEvent(new CustomEvent('insp:photo-busy', { detail: { busy: isPhotoBusy() } }));
};

/** 상품이 바뀌었다 — 읽는 중이던 사진은 끝나도 붙이지 않는다. */
export const bumpPhotoEpoch = () => {
    photoEpoch++;
    emitPhotoBusy();
};

const revokePreviewUrl = () => {
    if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
};

const showPreview = (src) => {
    if (!DOM.inspImagePreviewBox) return;
    if (src) {
        DOM.inspImagePreviewBox.classList.remove('hidden');
        if (DOM.inspImagePreviewImg) DOM.inspImagePreviewImg.src = src;
    } else {
        DOM.inspImagePreviewBox.classList.add('hidden');
    }
};

const forgetNewPhoto = () => {
    newPhotoBlob = null;
    newPhotoUrl = null;
    newPhotoUpload = null;
    revokePreviewUrl();
};

/** 불러온 기록의 사진을 지금 사진으로 둔다(URL 또는 옛 Base64, 없으면 null). 미리보기도 맞춘다. */
export const setExistingPhoto = (src) => {
    bumpPhotoEpoch();
    forgetNewPhoto();
    existingPhoto = src || null;
    showPreview(existingPhoto);
};

/** data URL → Blob (수동 사전등록 사진 등). */
export const dataUrlToBlob = (dataUrl) => {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
    if (!m) throw Object.assign(new Error('사진 형식을 읽을 수 없습니다.'), { code: 'insp/bad-data-url' });
    const type = m[1] || 'application/octet-stream';
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type });
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
};

let inspStorage = null;
const getInspStorage = () => {
    if (inspStorage) return inspStorage;
    const s = getStorage(getApp());
    connectStorageEmulatorIfEnabled(s);   // 에뮬레이터(?emu=1)면 첫 업로드 전에 붙인다. 실패하면 던져서 운영으로 안 올린다
    inspStorage = s;
    return s;
};

/** 검수 사진 한 장을 Storage 에 올리고 내려받기 주소를 돌려준다. 실패하면 SDK 오류(err.code 포함)를 그대로 던진다. */
export const uploadInspectionPhoto = async (blob) => {
    if (!blob) throw Object.assign(new Error('올릴 사진이 없습니다.'), { code: 'insp/no-photo' });
    const storage = getInspStorage();
    const rand = Math.random().toString(36).slice(2, 10);
    const photoRef = ref(storage, inspPhotoPath(getTodayDateString(), Date.now(), rand));
    await uploadBytes(photoRef, blob, { contentType: 'image/jpeg' });
    return await getDownloadURL(photoRef);
};

/** 저장 직전에 부른다. 사진 없음 → null, 불러온 사진 → 그 값, 새 사진 → 올린 주소(한 번만 올림). */
export const resolvePhotoForSave = async () => {
    if (!newPhotoBlob) return existingPhoto || null;
    if (newPhotoUrl) return newPhotoUrl;
    const blob = newPhotoBlob;
    if (!newPhotoUpload) {
        const p = uploadInspectionPhoto(blob);
        newPhotoUpload = p;
        p.then(url => { if (newPhotoBlob === blob) newPhotoUrl = url; })
         .catch(() => { if (newPhotoUpload === p) newPhotoUpload = null; });   // 실패하면 다음 저장 때 다시 올린다
    }
    return await newPhotoUpload;
};

/** 새로 고른 사진만 버리고 불러온 사진은 남긴다. */
export const dropNewPhoto = () => {
    forgetNewPhoto();
    showPreview(existingPhoto);
    if (DOM.inspImageInput) DOM.inspImageInput.value = '';
};

export const toggleScanner = () => {
    if (DOM.inspScannerContainer.classList.contains('hidden')) {
        DOM.inspScannerContainer.classList.remove('hidden');
        startScanner();
    } else {
        stopScanner();
        DOM.inspScannerContainer.classList.add('hidden');
    }
};

// 바코드 스캐너 라이브러리는 대시보드에서 처음 스캐너를 열 때 받는다(2026-10-22 — 예전엔 index.html 이 버전 미고정으로 매번 읽음).
// 버전 고정 + SRI. 올릴 때는 받은 파일로 sha384 를 다시 계산한다. (scan.html 도 같은 2.3.8)
const QR_LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
const QR_LIB_SRI = 'sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+';
let qrLibP = null;
const loadQrLib = () => {
    if (window.Html5Qrcode) return Promise.resolve(window.Html5Qrcode);
    if (qrLibP) return qrLibP;
    qrLibP = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = QR_LIB_URL;
        s.integrity = QR_LIB_SRI;
        s.crossOrigin = 'anonymous';
        s.referrerPolicy = 'no-referrer';
        s.onload = () => window.Html5Qrcode ? resolve(window.Html5Qrcode) : reject(new Error('Html5Qrcode 없음'));
        s.onerror = () => { qrLibP = null; s.remove(); reject(new Error('html5-qrcode 를 불러오지 못함')); };
        document.head.appendChild(s);
    });
    return qrLibP;
};

let scannerLoading = false;
const startScanner = async () => {
    if (html5QrCode || scannerLoading) return;
    scannerLoading = true;
    try {
        await loadQrLib();
    } catch (e) {
        console.error(e);
        showToast("스캐너 도구를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 눌러 주세요.", true);
        if (DOM.inspScannerContainer) DOM.inspScannerContainer.classList.add('hidden');
        return;
    } finally {
        scannerLoading = false;
    }
    // 받는 사이 스캐너를 닫았으면 켜지 않는다
    if (html5QrCode || !DOM.inspScannerContainer || DOM.inspScannerContainer.classList.contains('hidden')) return;
    html5QrCode = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess)
    .catch(err => {
        console.error("Error starting scanner", err);
        showToast("카메라를 시작할 수 없습니다.", true);
        if(DOM.inspScannerContainer) DOM.inspScannerContainer.classList.add('hidden');
    });
};

const stopScanner = () => {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            html5QrCode = null;
        }).catch(err => console.error("Failed to stop scanner", err));
    }
};

const onScanSuccess = (decodedText, decodedResult) => {
    showToast(`바코드 인식: ${decodedText}`);
    stopScanner(); 
    if(DOM.inspScannerContainer) DOM.inspScannerContainer.classList.add('hidden');
    if(DOM.inspProductNameInput) DOM.inspProductNameInput.value = decodedText;
    searchProductHistory();
};

export const handleImageSelect = (file) => {
    if (!file) return;
    const token = { epoch: photoEpoch };
    pendingPhoto = token;
    emitPhotoBusy();
    const finish = () => {
        if (pendingPhoto === token) pendingPhoto = null;
        emitPhotoBusy();
    };
    const fail = () => {
        const stale = token.epoch !== photoEpoch;
        finish();
        if (!stale) showToast('사진을 읽지 못했습니다. 다시 골라 주세요.', true);
    };
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = (e) => {
        const img = new Image();
        img.onerror = fail;
        img.onload = () => {
            if (token.epoch !== photoEpoch || pendingPhoto !== token) { finish(); return; }   // 그새 상품이 바뀌었거나 다른 사진을 골랐다
            try {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                let width = img.width;
                let height = img.height;
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                forgetNewPhoto();
                newPhotoBlob = dataUrlToBlob(dataUrl);
                previewObjectUrl = URL.createObjectURL(newPhotoBlob);
                showPreview(previewObjectUrl);
            } catch (err) {
                console.error('사진 처리 실패', err);
                showToast('사진을 읽지 못했습니다. 다시 골라 주세요.', true);
            } finally {
                finish();
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

export const clearImageState = () => {
    bumpPhotoEpoch();
    forgetNewPhoto();
    existingPhoto = null;
    showPreview(null);
    if (DOM.inspImageInput) DOM.inspImageInput.value = '';
};

export const handleManualImageSelect = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            manualImageBase64 = canvas.toDataURL('image/jpeg', 0.7); 
            
            const previewContainer = document.getElementById('manual-insp-image-preview-container');
            const previewImg = document.getElementById('manual-insp-image-preview');
            if (previewContainer && previewImg) {
                previewContainer.classList.remove('hidden');
                previewImg.src = manualImageBase64;
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

export const clearManualImageState = () => {
    manualImageBase64 = null;
    const previewContainer = document.getElementById('manual-insp-image-preview-container');
    const input = document.getElementById('manual-insp-image');
    if (previewContainer) previewContainer.classList.add('hidden');
    if (input) input.value = '';
};