const express = require('express')
const { db, pool } = require('../config/database') // pool import 추가
const logger = require('../utils/logger')
const { protect, adminOnly, masterOnly } = require('../middleware/authMiddleware')
const router = express.Router()

// Get all users (except master)
router.get('/', protect, masterOnly, async (req, res) => {
  try {
    const result = await db.query("SELECT id, username, role, created_at FROM users WHERE role != 'master'")
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.delete('/:id', protect, masterOnly, async (req, res) => {
  const targetUserId = req.params.id

  if (req.user.userId === Number(targetUserId)) {
    return res.status(400).json({ message: '자기 자신의 계정은 삭제할 수 없습니다.' })
  }

  try {
    const result = await db.query('DELETE FROM users WHERE id = $1 AND role != \'master\'', [targetUserId])
    if (result.rowCount === 0) {
      return res.status(404).json({ message: '사용자를 찾을 수 없거나 마스터 계정입니다.' })
    }
    logger.info('User deleted successfully', { admin: req.user.username, targetUserId })
    res.json({ message: '사용자가 성공적으로 삭제되었습니다.' })
  } catch (err) {
    logger.error('Failed to delete user', { admin: req.user.username, targetUserId, error: err.message })
    return res.status(500).json({ message: err.message })
  }
})

router.put('/:id/role', protect, masterOnly, async (req, res) => {
  const { role } = req.body
  const targetUserId = req.params.id

  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role' })
  }
  if (req.user.userId === Number(targetUserId)) {
    return res.status(400).json({ message: 'Cannot change your own role.' })
  }

  try {
    const result = await db.query('UPDATE users SET role = $1 WHERE id = $2 AND role != \'master\'', [role, targetUserId])
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found or is a master user.' })
    }
    logger.info('User role updated', { admin: req.user.username, targetUserId, newRole: role })
    res.json({ message: 'User role updated successfully' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// Get a user's template permissions
router.get('/:id/permissions', protect, adminOnly, async (req, res) => {
  try {
    const result = await db.query('SELECT template_id FROM user_template_permissions WHERE user_id = $1', [req.params.id])
    res.json(result.rows.map(r => r.template_id))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// Update a user's template permissions using a transaction
router.put('/:id/permissions', protect, adminOnly, async (req, res) => {
  const userId = req.params.id
  const { templateIds } = req.body

  if (!Array.isArray(templateIds)) {
    return res.status(400).json({ message: 'templateIds must be an array.' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM user_template_permissions WHERE user_id = $1', [userId])

    if (templateIds.length > 0) {
      const insertPromises = templateIds.map(templateId => {
        const query = 'INSERT INTO user_template_permissions (user_id, template_id) VALUES ($1, $2)'
        return client.query(query, [userId, templateId])
      })
      await Promise.all(insertPromises)
    }

    await client.query('COMMIT')
    logger.info('User permissions updated', { admin: req.user.username, userId, templateIds })
    res.json({ message: 'Permissions updated successfully' })
  } catch (err) {
    await client.query('ROLLBACK')
    logger.error('Failed to update user permissions', { admin: req.user.username, userId, error: err.message })
    res.status(500).json({ message: 'Failed to update permissions.' })
  } finally {
    client.release()
  }
})

module.exports = router