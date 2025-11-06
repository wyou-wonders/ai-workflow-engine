const express = require('express')
const https = require('https')
const { getApiKeys } = require('../utils/apiKeyCache')
const { protect } = require('../middleware/authMiddleware')
const logger = require('../utils/logger')
const { db } = require('../config/database')
const router = express.Router()

// PostgreSQL 문법 및 camelCase 스타일에 맞게 수정
const logLlmInteraction = async (logData) => {
  const {
    userId, username, workflowId, templateName, stepIndex, provider, modelId,
    requestPayload, responsePayload, isSuccess, errorMessage
  } = logData

  const sql = `
    INSERT INTO llm_logs (user_id, username, workflow_id, template_name, step_index, provider, model_id, request_payload, response_payload, is_success, error_message)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `
  const params = [
    userId, username, workflowId, templateName, stepIndex, provider, modelId,
    requestPayload, responsePayload, isSuccess, errorMessage || null
  ]

  try {
    await db.query(sql, params)
  } catch (err) {
    logger.error('Failed to log LLM interaction to DB', { error: err.message, username })
  }
}

router.post('/proxy', protect, async (req, res) => {
  // 요청 body의 snake_case 변수들을 camelCase로 받도록 수정
  const {
    provider, modelId, body: requestBody, globalInstruction, apiConfig,
    workflow_id: workflowId,
    template_name: templateName,
    step_index: stepIndex,
    promptDetails
  } = req.body

  const { userId, username } = req.user

  if (!apiConfig || !apiConfig.path) {
    return res.status(400).json({ message: 'API configuration is missing or invalid.' })
  }

  try {
    const apiKeys = await getApiKeys()
    const apiKey = apiKeys[`${provider.toLowerCase()}_api_key`]

    if (!apiKey) {
      return res.status(400).json({ message: `${provider} API key is not set.` })
    }

    let options = {}
    let finalBody = {}

    const useStreaming = apiConfig.stream !== false

    switch (provider) {
      case 'OpenAI': {
        options = { hostname: 'api.openai.com', path: apiConfig.path, method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } }
        const messages = globalInstruction ? [{ role: 'system', content: globalInstruction }, ...requestBody.messages] : requestBody.messages
        finalBody = { model: modelId, messages, stream: useStreaming }
        break
      }
      case 'Google': {
        let googlePath = `${apiConfig.path.replace('{modelId}', modelId)}?key=${apiKey}`
        if (useStreaming) {
          googlePath += '&alt=sse'
        }
        options = { hostname: 'generativelanguage.googleapis.com', path: googlePath, method: 'POST', headers: { 'Content-Type': 'application/json' } }

        const contents = requestBody.messages.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }))

        finalBody = { contents }
        if (globalInstruction) finalBody.system_instruction = { parts: [{ text: globalInstruction }] }
        break
      }
      case 'Anthropic': {
        options = { hostname: 'api.anthropic.com', path: apiConfig.path, method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } }
        finalBody = {
          model: modelId,
          max_tokens: 4096,
          messages: requestBody.messages,
          stream: useStreaming
        }
        if (globalInstruction) finalBody.system = globalInstruction
        break
      }
      default:
        return res.status(400).json({ message: `Unsupported provider: ${provider}` })
    }

    const comprehensiveRequestPayload = {
      provider,
      modelId,
      promptDetails: {
        systemInstruction: globalInstruction || '',
        ...promptDetails
      },
      finalApiBody: finalBody
    }

    const proxyReq = https.request(options, (proxyRes) => {
      if (useStreaming) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      } else {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
      }
      res.statusCode = proxyRes.statusCode

      const responseChunks = []
      proxyRes.on('data', (chunk) => {
        responseChunks.push(chunk)
        if (useStreaming) {
          res.write(chunk)
        }
      })

      proxyRes.on('end', async () => {
        const fullResponse = Buffer.concat(responseChunks).toString('utf8')
        const isSuccess = proxyRes.statusCode >= 200 && proxyRes.statusCode < 300

        await logLlmInteraction({
          userId,
          username,
          workflowId,
          templateName,
          stepIndex,
          provider,
          modelId,
          requestPayload: comprehensiveRequestPayload,
          responsePayload: fullResponse,
          isSuccess,
          errorMessage: isSuccess ? null : `HTTP Status ${proxyRes.statusCode}`
        })

        if (useStreaming) {
          res.end()
        } else {
          res.send(fullResponse)
        }
      })
    })

    proxyReq.on('error', async (e) => {
      logger.error('LLM proxy request error', { provider, modelId, error: e.message })
      await logLlmInteraction({
        userId,
        username,
        workflowId,
        templateName,
        stepIndex,
        provider,
        modelId,
        requestPayload: comprehensiveRequestPayload,
        responsePayload: null,
        isSuccess: false,
        errorMessage: e.message
      })
      if (!res.headersSent) {
        res.status(500).json({ message: 'LLM proxy request failed.' })
      }
    })

    proxyReq.write(JSON.stringify(finalBody))
    proxyReq.end()
  } catch (error) {
    logger.error('Error in LLM proxy setup', { provider, modelId, error: error.message, stack: error.stack })
    // Catch 블록에서도 로그를 기록하도록 추가
    await logLlmInteraction({
      userId,
      username,
      workflowId,
      templateName,
      stepIndex,
      provider,
      modelId: modelId || 'N/A',
      requestPayload: req.body, // 에러 발생 시점의 원본 요청 기록
      responsePayload: null,
      isSuccess: false,
      errorMessage: error.message
    })
    if (!res.headersSent) {
      res.status(500).json({ message: 'An internal error occurred in the proxy.' })
    }
  }
})

module.exports = router