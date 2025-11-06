import { apiCall } from "./api.js";
import { setState, getState, getInitialState } from "./state.js";
import { renderApp } from "./ui/common.js";
import { fetchInitialUserData } from "./ui/user.js";

// --- FIX ---
// 이 함수는 이제 UI를 전혀 제어하지 않습니다.
// 성공 시 데이터 처리만 하고, 실패 시 apiCall이 던진 에러를 그대로 전파합니다.
export async function handleLogin(username, password) {
  const data = await apiCall(
    "/auth/login",
    { method: "POST", body: { username, password } },
    true,
  );
  if (data && data.token) {
    localStorage.setItem("authToken", data.token);
    setState({ token: data.token, user: data.user });
    await fetchInitialUserData();
  }
}

// --- FIX ---
// 이 함수도 UI를 제어하지 않습니다.
// 성공 시 데이터를 반환하고, 실패 시 에러를 전파합니다.
export async function handleRegister(username, password) {
  const data = await apiCall(
    "/auth/register",
    { method: "POST", body: { username, password } },
    true,
  );
  if (data) {
    return { success: true, username: data.username };
  }
  return { success: false };
}

export async function handleLogout() {
  try {
    await apiCall("/auth/logout", { method: "POST" });
  } catch (error) {
    console.error("Failed to blacklist token on server:", error.message);
  } finally {
    localStorage.removeItem("authToken");

    const loggedOutState = getInitialState();
    loggedOutState.ui.isLoading = false;
    setState(loggedOutState);

    renderApp();
  }
}

export async function initializeAuth() {
  const token = localStorage.getItem("authToken");
  if (!token) {
    return false;
  }

  getState().token = token;

  try {
    const data = await apiCall("/auth/verify");
    if (data && data.user) {
      setState({ token, user: data.user });
      return true;
    }
    await handleLogout();
    return false;
  } catch (error) {
    await handleLogout();
    return false;
  }
}
