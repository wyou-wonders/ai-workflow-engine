const express = require('express')
const { db } = require('../config/database')
const logger = require('../utils/logger')
const { protect } = require('../middleware/authMiddleware')
const router = express.Router()

// PostgreSQL의 JSONB 타입은 자동으로 객체로 파싱됩니다.
const parseJsonFields = (row) => row

router.get('/bookmarked', protect, async (req, res) => {
  const sql = `
    SELECT id, bookmark_title, updated_at 
    FROM workflows 
    WHERE user_id = $1 AND is_bookmarked = true 
    ORDER BY updated_at DESC
  `
  try {
    const result = await db.query(sql, [req.user.userId])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/', protect, async (req, res) => {
  try {
    const result = await db.query('SELECT id, title, updated_at FROM workflows WHERE user_id = $1 ORDER BY updated_at DESC', [req.user.userId])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/:id', protect, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM workflows WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId])
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Workflow not found or access denied' })
    }
    res.json(parseJsonFields(result.rows[0]))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', protect, async (req, res) => {
  const { title, template_snapshot: templateSnapshot } = req.body

  const initialContext = {
    currentStepIndex: 0,
    summary: '',
    results: templateSnapshot.config.steps.map(() => ({
      content: '',
      mode: 'view',
      status: 'pending',
      userInput: ''
    }))
  }

  try {
    const result = await db.query(
      'INSERT INTO workflows (user_id, title, template_snapshot, execution_context) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.user.userId, title, templateSnapshot, initialContext]
    )
    const newWorkflowId = result.rows[0].id
    logger.info('Workflow created', { user: req.user.username, workflowId: newWorkflowId, templateName: templateSnapshot.name })
    res.status(201).json({ id: newWorkflowId, execution_context: initialContext })
  } catch (err) {
    logger.error('Workflow creation failed', { user: req.user.username, error: err.message })
    return res.status(500).json({ message: err.message })
  }
})

router.put('/:id', protect, async (req, res) => {
  const { execution_context: executionContext } = req.body
  try {
    const result = await db.query(
      'UPDATE workflows SET execution_context = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3',
      [executionContext, req.params.id, req.user.userId]
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Workflow not found or access denied' })
    }
    res.json({ message: 'Workflow updated successfully' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.put('/:id/bookmark', protect, async (req, res) => {
  const { bookmark_title: bookmarkTitle } = req.body
  if (!bookmarkTitle) {
    return res.status(400).json({ message: 'Bookmark title is required' })
  }
  const sql = `
    UPDATE workflows 
    SET is_bookmarked = true, bookmark_title = $1, updated_at = CURRENT_TIMESTAMP 
    WHERE id = $2 AND user_id = $3
  `
  try {
    const result = await db.query(sql, [bookmarkTitle, req.params.id, req.user.userId])
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Workflow not found or access denied' })
    }
    logger.info('Workflow bookmarked', { user: req.user.username, workflowId: req.params.id, title: bookmarkTitle })
    res.json({ message: 'Workflow bookmarked successfully' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.delete('/:id/bookmark', protect, async (req, res) => {
  const sql = `
    UPDATE workflows 
    SET is_bookmarked = false, bookmark_title = NULL, updated_at = CURRENT_TIMESTAMP 
    WHERE id = $1 AND user_id = $2
  `
  try {
    const result = await db.query(sql, [req.params.id, req.user.userId])
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Workflow not found or access denied' })
    }
    logger.info('Workflow unbookmarked', { user: req.user.username, workflowId: req.params.id })
    res.json({ message: 'Bookmark removed successfully' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router