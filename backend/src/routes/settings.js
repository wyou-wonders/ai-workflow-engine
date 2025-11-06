const express = require('express')
const { db } = require('../config/database')
const logger = require('../utils/logger')
const { invalidateCache } = require('../utils/apiKeyCache')
const { protect, adminOnly } = require('../middleware/authMiddleware')
// const fs = require('fs') // Vercel에서는 파일 시스템 사용 불가
const router = express.Router()

const API_KEYS = ['openai_api_key', 'google_api_key', 'anthropic_api_key']

// Get API keys (masked)
router.get('/keys', protect, adminOnly, async (req, res) => {
  try {
    const keyPlaceholders = API_KEYS.map((_, i) => `$${i + 1}`).join(',')
    const result = await db.query(`SELECT key, value FROM settings WHERE key IN (${keyPlaceholders})`, API_KEYS)

    const settings = result.rows.reduce((acc, row) => {
      acc[row.key] = row.value ? `****${row.value.slice(-4)}` : ''
      return acc
    }, {})

    API_KEYS.forEach(key => {
      if (!settings[key]) {
        settings[key] = ''
      }
    })
    res.json(settings)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// Update API keys
router.put('/keys', protect, adminOnly, async (req, res) => {
  const keysToUpdate = API_KEYS
    .filter(key => req.body[key] && typeof req.body[key] === 'string')
    .map(key => ({ key, value: req.body[key] }))

  if (keysToUpdate.length === 0) {
    return res.status(400).json({ message: 'No valid API keys provided to update.' })
  }

  try {
    // "INSERT ... ON CONFLICT ... DO UPDATE" is a clean way to handle upserts in PostgreSQL
    const updatePromises = keysToUpdate.map(({ key, value }) => {
      const query = `
        INSERT INTO settings (key, value) VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = $2
      `
      return db.query(query, [key, value])
    })

    await Promise.all(updatePromises)

    invalidateCache()
    logger.info('API keys updated', { user: req.user.username })
    res.json({ message: 'API keys saved successfully' })
  } catch (err) {
    logger.error('Failed to update API keys', { user: req.user.username, error: err.message })
    return res.status(500).json({ message: err.message })
  }
})

// Get logs from file system - This is disabled for Vercel
router.get('/logs', protect, adminOnly, (req, res) => {
  // Vercel의 서버리스 환경에서는 영구적인 파일 시스템이 없습니다.
  // 따라서 파일에서 로그를 읽는 기능은 작동하지 않습니다.
  // 로그는 Vercel 대시보드의 'Logs' 탭에서 확인해야 합니다.
  res.status(404).json({ message: 'File-based logging is not available in this environment. Please check Vercel Logs.' })
})

module.exports = router