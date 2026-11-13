// === js/listeners-auth.js ===
// 설명: 로그인/로그아웃 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202611131354';
import * as State from './state.js?v=202611131354';
import { showToast } from './utils.js?v=202611131354';
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { terminate, clearIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { clearLocalCaches, FIRESTORE_CLEAR_FAILED_MSG } from './lib/local-caches.js?v=202611131354';

export function setupAuthListeners() {

    if (DOM.loginForm) {
        DOM.loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (DOM.loginSubmitBtn) DOM.loginSubmitBtn.disabled = true;
            if (DOM.loginButtonText) DOM.loginButtonText.classList.add('hidden');
            if (DOM.loginButtonSpinner) DOM.loginButtonSpinner.classList.remove('hidden');
            if (DOM.loginErrorMsg) DOM.loginErrorMsg.classList.add('hidden');

            const email = DOM.loginEmailInput.value;
            const password = DOM.loginPasswordInput.value;

            try {
                await signInWithEmailAndPassword(State.auth, email, password);
                if (DOM.loginPasswordInput) DOM.loginPasswordInput.value = '';
            } catch (error) {
                console.error('Login error:', error.code, error.message);
                if (DOM.loginErrorMsg) {
                    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                        DOM.loginErrorMsg.textContent = '이메일 또는 비밀번호가 잘못되었습니다.';
                    } else {
                        DOM.loginErrorMsg.textContent = `로그인 오류: ${error.code}`;
                    }
                    DOM.loginErrorMsg.classList.remove('hidden');
                }
            } finally {
                if (DOM.loginSubmitBtn) DOM.loginSubmitBtn.disabled = false;
                if (DOM.loginButtonText) DOM.loginButtonText.classList.remove('hidden');
                if (DOM.loginButtonSpinner) DOM.loginButtonSpinner.classList.add('hidden');
            }
        });
    }

    // 로그아웃 — 로그아웃한 뒤 이 브라우저에 남는 업무 자료 사본(이력 캐시·Firestore 오프라인 사본 등)을 지우고
    // 페이지를 새로 연다(js/lib/local-caches.js — Firestore 를 닫으므로 새로 열어야 다음 로그인이 된다).
    const doLogout = async () => {
        try {
            await signOut(State.auth);
        } catch (error) {
            console.error('Logout error:', error);
            showToast('로그아웃 중 오류가 발생했습니다.', true);
            return;
        }
        let res = null;
        try { res = await clearLocalCaches({ db: State.db, firestore: { terminate, clearIndexedDbPersistence } }); }
        catch (e) { /* clearLocalCaches 는 던지지 않는다 — 혹시 몰라 */ }
        if (res && res.firestore === 'failed') alert(FIRESTORE_CLEAR_FAILED_MSG);   // 다른 탭이 사본을 쥐고 있어 못 지움
        location.reload();
    };
    if (DOM.logoutBtn) DOM.logoutBtn.addEventListener('click', doLogout);
    if (DOM.logoutBtnMobile) DOM.logoutBtnMobile.addEventListener('click', doLogout);
}