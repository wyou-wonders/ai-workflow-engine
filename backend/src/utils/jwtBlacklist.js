// --- IMPROVEMENT ---
// JWT 토큰을 무효화하기 위한 인메모리 블랙리스트입니다.
// 프로덕션 환경에서는 이 부분을 Redis와 같은 외부 저장소로 교체하여
// 여러 서버 인스턴스 간에 블랙리스트를 공유하도록 확장할 수 있습니다.

const tokenBlacklist = new Set();

/**
 * 토큰을 블랙리스트에 추가합니다.
 * @param {string} token - 무효화할 JWT 토큰
 */
const addToBlacklist = (token) => {
  tokenBlacklist.add(token);
};

/**
 * 주어진 토큰이 블랙리스트에 있는지 확인합니다.
 * @param {string} token - 확인할 JWT 토큰
 * @returns {boolean} 블랙리스트에 있으면 true, 아니면 false
 */
const isBlacklisted = (token) => {
  return tokenBlacklist.has(token);
};

module.exports = { addToBlacklist, isBlacklisted };
