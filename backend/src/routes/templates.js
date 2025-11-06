const express = require('express')
const { db } = require('../config/database')
const logger = require('../utils/logger')
const { protect, adminOnly } = require('../middleware/authMiddleware')
const router = express.Router()

// PostgreSQL의 JSONB 타입은 자동으로 JSON으로 파싱될 수 있지만,
// 만약을 위해 파싱 로직을 유지합니다.
const parseConfig = (row) => {
  if (typeof row.config === 'string') {
    try {
      return { ...row, config: JSON.parse(row.config) }
    } catch (e) {
      logger.error('Failed to parse template config', { templateId: row.id })
      return row // 파싱 실패 시 원본 반환
    }
  }
  return row
}

router.get('/', protect, async (req, res) => {
  const { role, userId } = req.user
  let query
  const params = []

  if (role === 'master' || role === 'admin') {
    query = 'SELECT * FROM templates ORDER BY name'
  } else {
    query = 'SELECT t.* FROM templates t JOIN user_template_permissions utp ON t.id = utp.template_id WHERE utp.user_id = $1 ORDER BY t.name'
    params.push(userId)
  }

  try {
    const result = await db.query(query, params)
    res.json(result.rows.map(parseConfig))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/:id', protect, adminOnly, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM templates WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Template not found' })
    }
    res.json(parseConfig(result.rows[0]))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', protect, adminOnly, async (req, res) => {
  const { name, config } = req.body
  try {
    const result = await db.query(
      'INSERT INTO templates (name, config, created_by) VALUES ($1, $2, $3) RETURNING id',
      [name, config, req.user.userId]
    )
    logger.info('Template created', { user: req.user.username, templateName: name })
    res.status(201).json({ id: result.rows[0].id, name, config })
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(400).json({ message: 'Template name already exists' })
    }
    res.status(500).json({ message: err.message })
  }
})

router.put('/:id', protect, adminOnly, async (req, res) => {
  const { name, config } = req.body
  try {
    await db.query(
      'UPDATE templates SET name = $1, config = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [name, config, req.params.id]
    )
    logger.info('Template updated', { user: req.user.username, templateName: name })
    res.json({ message: 'Template updated successfully' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.delete('/:id', protect, adminOnly, async (req, res) => {
  const client = await db.pool.connect() // Using pool for transaction
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM user_template_permissions WHERE template_id = $1', [req.params.id])
    await client.query('DELETE FROM templates WHERE id = $1', [req.params.id])
    await client.query('COMMIT')
    logger.info('Template deleted', { user: req.user.username, templateId: req.params.id })
    res.json({ message: 'Template and associated permissions deleted successfully' })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ message: err.message })
  } finally {
    client.release()
  }
})

module.exports = router