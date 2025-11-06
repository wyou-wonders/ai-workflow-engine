// --- IMPROVEMENT ---
// 이 파일의 내용은 백엔드로 이전되었습니다.
// findModelByKey 함수는 서버에서 받아온 동적 모델 목록을 사용하도록 수정됩니다.
import { getState } from "../state.js";

export function findModelByKey(key) {
  if (!key || !key.includes("__")) return null;

  const { llmModels } = getState();
  if (Object.keys(llmModels).length === 0) return null;

  const [providerName, modelId] = key.split("__");

  const providerKey = Object.keys(llmModels).find(
    (p) => p.toLowerCase() === providerName.toLowerCase(),
  );

  if (!providerKey) return null;

  const models = llmModels[providerKey];
  const model = models.find((m) => m.modelId === modelId);

  if (model) {
    return { ...model, provider: providerKey };
  }

  return null;
}
