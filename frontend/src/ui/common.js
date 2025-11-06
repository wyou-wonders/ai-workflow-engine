import { getState, setState } from "../state.js";
import { renderAuthView, attachAuthEventListeners } from "./auth.js";
import { renderUserView, attachUserEventListeners } from "./user.js";
import {
  renderAdminView,
  attachAdminEventListeners,
  fetchAdminData,
} from "./admin.js";
import { handleLogout } from "../auth.js";
import * as icons from "./icons.js";

const appContainer = document.getElementById("app");

export function renderApp() {
  const scrollContainer =
    document.querySelector("#document-view, #admin-main-section") || window;
  const previousScrollTop = scrollContainer.scrollTop;

  const { token, user, isUserMode, ui } = getState();

  if (ui.isLoading) {
    appContainer.innerHTML = renderLoadingSpinner();
    icons.create();
    return;
  }

  if (!token || !user) {
    appContainer.innerHTML = renderAuthView();
    attachAuthEventListeners();
    icons.create();
    return;
  }

  const isAdmin = user && (user.role === "admin" || user.role === "master");
  appContainer.innerHTML = `
        <div id="app-container" class="flex h-screen w-full">
            ${isUserMode ? renderUserView() : isAdmin ? renderAdminView() : renderAccessDenied()}
        </div>
    `;

  attachViewEventListeners();
  attachGlobalEventListeners();

  icons.create();

  const newScrollContainer = document.querySelector(
    "#document-view, #admin-main-section",
  );
  if (newScrollContainer) {
    newScrollContainer.scrollTop = previousScrollTop;
  }
}

function renderLoadingSpinner() {
  return `<div class="flex items-center justify-center h-screen w-full">
                <i data-lucide="loader-2" class="w-12 h-12 animate-spin text-primary"></i>
            </div>`;
}

function renderAccessDenied() {
  return `<div class="w-full h-full flex flex-col items-center justify-center bg-background">
        <h1 class="text-2xl font-bold">Access Denied</h1>
        <p class="text-info">You do not have permission to view this page.</p>
        <button id="mode-toggle-btn" class="btn btn-primary mt-4">
             <i data-lucide="arrow-left" class="w-4 h-4"></i>
             <span>사용자 모드로 돌아가기</span>
        </button>
    </div>`;
}

function attachViewEventListeners() {
  const { isUserMode } = getState();
  const container = document.getElementById("app-container");
  if (!container) return;

  if (isUserMode) {
    attachUserEventListeners(container);
  } else {
    attachAdminEventListeners(container);
  }
}

export function attachGlobalEventListeners() {
  const container = document.getElementById("app-container");
  if (!container) return;

  const logoutBtn = document.getElementById("logout-btn");
  const modeToggleBtn = document.getElementById("mode-toggle-btn");

  if (logoutBtn) {
    logoutBtn.onclick = null;
    logoutBtn.onclick = handleLogout;
  }

  if (modeToggleBtn) {
    modeToggleBtn.onclick = null;
    modeToggleBtn.onclick = async () => {
      const { isUserMode, user } = getState();
      const isAdmin = user && (user.role === "admin" || user.role === "master");
      if (isUserMode && !isAdmin) {
        alert("관리자 권한이 없습니다.");
        return;
      }

      const newMode = !isUserMode;

      if (newMode === false) {
        // --- FIX ---
        // 1. 로딩 상태를 먼저 설정하여 로딩 화면을 표시합니다.
        setState({ ui: { isLoading: true } });
        // 2. 비동기 데이터 로딩을 기다립니다.
        await fetchAdminData();
        // 3. 데이터 로딩이 끝나면, 모드 전환과 로딩 해제 상태를 함께 업데이트합니다.
        setState({ isUserMode: newMode, ui: { isLoading: false } });
      } else {
        // 사용자 모드로 돌아갈 때는 별도의 데이터 로딩이 없으므로 바로 상태를 변경합니다.
        setState({ isUserMode: newMode });
      }
    };
  }
}
