// --- IMPROVEMENT ---
// LLM 모델 목록을 프론트엔드에 하드코딩하는 대신, 백엔드에서 API를 통해 제공합니다.
// 이를 통해 프론트엔드 재배포 없이 모델 목록을 유연하게 관리할 수 있습니다.
const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const router = express.Router();

const LLM_MODELS = {
  OpenAI: [
    {
      key: 'openai-gpt-5',
      name: 'GPT-5',
      modelId: 'gpt-5',
      description: '복잡한 코딩 및 에이전트 작업용 최강력 모델',
      api: {
        path: '/v1/chat/completions',
        bodyType: 'messages',
        stream: false,
      },
    },
    {
      key: 'openai-gpt-5-mini',
      name: 'GPT-5 Mini',
      modelId: 'gpt-5-mini',
      description: '빠르고 비용 효율적인 일반 작업 최적화 모델',
      api: { path: '/v1/chat/completions', bodyType: 'messages' },
    },
    {
      key: 'openai-gpt-5-nano',
      name: 'GPT-5 Nano',
      modelId: 'gpt-5-nano',
      description: '간단한 작업, 대량 처리를 위한 최고 속도/최저 비용 모델',
      api: { path: '/v1/chat/completions', bodyType: 'messages' },
    },
    {
      key: 'openai-gpt-4-1',
      name: 'GPT-4.1',
      modelId: 'gpt-4.1',
      description: '콘텐츠 분석, 글쓰기 등 지능적인 비추론 작업',
      api: { path: '/v1/chat/completions', bodyType: 'messages' },
    },
    {
      key: 'openai-gpt-4-1-mini',
      name: 'GPT-4.1 Mini',
      modelId: 'gpt-4.1-mini',
      description: '간단한 질문-답변, 분류 등 소형 작업 최적화',
      api: { path: '/v1/chat/completions', bodyType: 'messages' },
    },
    {
      key: 'openai-gpt-4o',
      name: 'GPT-4o',
      modelId: 'gpt-4o',
      description: '고성능 멀티모달 모델 (기존)',
      api: { path: '/v1/chat/completions', bodyType: 'messages' },
    },
    {
      key: 'openai-o3',
      name: 'o3 (Reasoning)',
      modelId: 'o3',
      description: '깊은 사고와 장시간 추론이 필요한 복잡한 문제 해결',
      api: { path: '/v1/chat/completions', bodyType: 'messages' },
    },
    {
      key: 'openai-o3-mini',
      name: 'o3 Mini (Reasoning)',
      modelId: 'o3-mini',
      description: '빠르고 비용 효율적인 소형 추론 작업',
      api: { path: '/v1/chat/completions', bodyType: 'messages' },
    },
  ],
  Google: [
    {
      key: 'google-gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      modelId: 'gemini-2.5-pro',
      description: '최고 성능, 복잡한 문제 해결',
      api: {
        path: '/v1beta/models/{modelId}:streamGenerateContent',
        bodyType: 'google',
      },
    },
    {
      key: 'google-gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      modelId: 'gemini-2.5-flash',
      description: '비용 효율적, 적응형 thinking',
      api: {
        path: '/v1beta/models/{modelId}:streamGenerateContent',
        bodyType: 'google',
      },
    },
    {
      key: 'google-gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      modelId: 'gemini-2.0-flash',
      description: '차세대 기능, 실시간 스트리밍',
      api: {
        path: '/v1beta/models/{modelId}:streamGenerateContent',
        bodyType: 'google',
      },
    },
  ],
  Anthropic: [
    {
      key: 'anthropic-claude-opus-4-1',
      name: 'Claude Opus 4.1',
      modelId: 'claude-opus-4-1-20250805',
      description: '최고 성능, 복잡한 사고',
      api: { path: '/v1/messages', bodyType: 'anthropic' },
    },
    {
      key: 'anthropic-claude-sonnet-4',
      name: 'Claude Sonnet 4',
      modelId: 'claude-sonnet-4-20250514',
      description: '성능과 비용의 균형',
      api: { path: '/v1/messages', bodyType: 'anthropic' },
    },
  ],
};

router.get('/', protect, (req, res) => {
  res.json(LLM_MODELS);
});

module.exports = router;
