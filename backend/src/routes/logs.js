const express = require('express')
const { db } = require('../config/database')
const logger = require('../utils/logger')
const { protect, masterOnly } = require('../middleware/authMiddleware')
const router = express.Router()

// 프론트엔드에서 발생한 오류를 받아 DB에 저장하는 API (PostgreSQL 문법으로 수정)
router.post('/error', protect, async (req, res) => {
  const { userId, username } = req.user
  const { action_type: actionType, workflow_id: workflowId, step_index: stepIndex, error_message: errorMessage, context } = req.body

  const sql = 'INSERT INTO error_logs (user_id, username, action_type, workflow_id, step_index, error_message, context) VALUES ($1, $2, $3, $4, $5, $6, $7)'
  const params = [userId, username, actionType, workflowId, stepIndex, errorMessage, context]

  try {
    await db.query(sql, params)
    res.status(201).json({ message: 'Error logged successfully.' })
  } catch (err) {
    logger.error('Failed to log error to DB', { error: err.message, user: username })
    return res.status(500).json({ message: 'Error logging failed.' })
  }
})

// 오류 로그 조회 (PostgreSQL 문법으로 수정)
router.get('/errors', protect, masterOnly, async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1
  const limit = parseInt(req.query.limit, 10) || 20
  const offset = (page - 1) * limit

  try {
    const countSql = 'SELECT COUNT(*) as total FROM error_logs'
    const dataSql = 'SELECT * FROM error_logs ORDER BY timestamp DESC LIMIT $1 OFFSET $2'

    const totalResult = await db.query(countSql)
    const total = parseInt(totalResult.rows[0].total, 10)

    const dataResult = await db.query(dataSql, [limit, offset])
    const logs = dataResult.rows

    res.json({
      logs,
      total,
      page,
      limit
    })
  } catch (err) {
    logger.error('Failed to fetch error logs from DB', { error: err.message })
    return res.status(500).json({ message: 'Failed to fetch error logs.' })
  }
})

// LLM 로그 목록 조회 (PostgreSQL 문법으로 수정)
router.get('/llm', protect, masterOnly, async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1
  const limit = parseInt(req.query.limit, 10) || 20
  const offset = (page - 1) * limit

  try {
    const countSql = 'SELECT COUNT(*) as total FROM llm_logs'
    const dataSql = 'SELECT id, timestamp, username, template_name, step_index, provider, model_id, is_success FROM llm_logs ORDER BY timestamp DESC LIMIT $1 OFFSET $2'

    const totalResult = await db.query(countSql)
    const total = parseInt(totalResult.rows[0].total, 10)

    const dataResult = await db.query(dataSql, [limit, offset])
    const logs = dataResult.rows

    res.json({
      logs,
      total,
      page,
      limit
    })
  } catch (err) {
    logger.error('Failed to fetch LLM logs from DB', { error: err.message })
    return res.status(500).json({ message: 'Failed to fetch LLM logs.' })
  }
})

// LLM 로그 상세 조회 (PostgreSQL 문법으로 수정)
router.get('/llm/:id', protect, masterOnly, async (req, res) => {
  const sql = `
        SELECT provider, model_id, request_payload, response_payload, error_message, is_success 
        FROM llm_logs 
        WHERE id = $1`

  try {
    const result = await db.query(sql, [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Log not found.' })
    }
    const row = result.rows[0]

    // PostgreSQL의 JSONB 타입은 자동으로 객체로 파싱됩니다.
    res.json({
      provider: row.provider,
      model_id: row.model_id,
      request_payload: row.request_payload,
      response_payload: row.response_payload,
      error_message: row.error_message,
      is_success: row.is_success
    })
  } catch (e) {
    logger.error('Failed to fetch or parse LLM log detail from DB', { error: e.message, logId: req.params.id })
    res.status(500).json({ message: 'Failed to fetch LLM log detail.' })
  }
})

module.exports = router