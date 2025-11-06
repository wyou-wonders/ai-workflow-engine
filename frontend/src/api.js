import { handleLogout } from "./auth.js";
import { getState } from "./state.js";

// --- FIX ---
// 인증 에러를 식별하기 위한 커스텀 에러 클래스
export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

const API_BASE_URL = "/api";

async function apiCall(endpoint, options = {}, isAuthCall = false) {
  const { token } = getState();
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(API_BASE_URL + endpoint, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : null,
    });

    // --- FIX ---
    // 401 에러 발생 시 handleLogout()을 직접 호출하는 대신 AuthError를 throw 합니다.
    // isAuthCall은 로그인 실패(잘못된 비밀번호 등)와 세션 만료를 구분하기 위해 여전히 필요합니다.
    if (response.status === 401 && !isAuthCall) {
      // isAuthCall이 false인 경우(즉, 로그인 시도가 아닌 일반 API 호출)에 401이 발생하면
      // 이는 세션 만료를 의미하므로 AuthError를 발생시킵니다.
      throw new AuthError("세션이 만료되었습니다. 다시 로그인해주세요.");
    }

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        throw new Error(
          response.statusText || `HTTP 에러! 상태 코드: ${response.status}`,
        );
      }
      const err = new Error(
        errorData.message || `HTTP 에러! 상태 코드: ${response.status}`,
      );
      err.cause = errorData;
      throw err;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch (error) {
    // 이미 AuthError인 경우, 그대로 다시 throw하여 상위에서 처리하도록 합니다.
    if (error instanceof AuthError) {
      throw error;
    }
    // 그 외 네트워크 에러 등
    console.error("API 호출 오류:", {
      endpoint,
      errorMessage: error.message,
      errorCause: error.cause,
    });
    throw error;
  }
}

async function apiCallStream(endpoint, options, onChunk, onEnd, onError) {
  const { token } = getState();
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(API_BASE_URL + endpoint, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : null,
    });

    if (response.status === 401) {
      // 스트리밍 호출에서도 세션 만료 시 AuthError를 발생시킵니다.
      throw new AuthError("세션이 만료되었습니다. 다시 로그인해주세요.");
    }

    if (!response.ok) {
      const errorBody = await response.json();
      throw new Error(errorBody.message || response.statusText);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      onChunk(chunk);
    }
    onEnd();
  } catch (error) {
    // --- FIX ---
    // AuthError가 발생하면 handleLogout을 호출합니다.
    if (error instanceof AuthError) {
      handleLogout();
    }
    onError(error);
  }
}

// 이 함수들은 apiCall을 사용하므로 자동으로 새로운 에러 처리 로직이 적용됩니다.
export const getUserPermissions = (userId) =>
  apiCall(`/users/${userId}/permissions`);
export const updateUserRole = (userId, role) =>
  apiCall(`/users/${userId}/role`, { method: "PUT", body: { role } });
export const updateUserPermissions = (userId, templateIds) =>
  apiCall(`/users/${userId}/permissions`, {
    method: "PUT",
    body: { templateIds },
  });

export { apiCall, apiCallStream };
