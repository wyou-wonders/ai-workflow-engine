const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { db } = require('../config/database')
const logger = require('../utils/logger')
const { protect } = require('../middleware/authMiddleware')
const { addToBlacklist } = require('../utils/jwtBlacklist')
const router = express.Router()

// PostgreSQL & async/await 방식으로 수정된 /register
router.post('/register', async (req, res) => {
  const { username, password } = req.body
  const role = 'user'
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' })
  }

  const salt = bcrypt.genSaltSync(10)
  const passwordHash = bcrypt.hashSync(password, salt)

  try {
    const result = await db.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username',
      [username, passwordHash, role]
    )
    const newUser = result.rows[0]
    logger.info('User registered successfully', { userId: newUser.id, username: newUser.username })
    res.status(201).json({ id: newUser.id, username: newUser.username })
  } catch (err) {
    logger.warn('User registration failed', { username, error: err.message })
    if (err.code === '23505') { // PostgreSQL unique constraint violation
      return res.status(400).json({ message: 'Username already exists' })
    }
    res.status(500).json({ message: 'Server error during registration' })
  }
})

// PostgreSQL & async/await 방식으로 수정된 /login
router.post('/login', async (req, res) => {
  const { username, password } = req.body
  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username])
    const user = result.rows[0]

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      logger.warn('Login failed for user', { username })
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    const token = jwt.sign(
        { userId: user.id, role: user.role, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    )
    logger.info('Login successful', { username, role: user.role })
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role }
    })
  } catch (err) {
    logger.error('Login error', { username, error: err.message })
    res.status(500).json({ message: 'Server error during login' })
  }
})

// 로그아웃 로직 (기존과 동일)
router.post('/logout', protect, (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1]
    addToBlacklist(token)
    logger.info('User logged out and token blacklisted', { username: req.user.username })
    res.status(200).json({ message: 'Logged out successfully' })
  } catch (error) {
    logger.error('Error during logout', { username: req.user.username, error: error.message })
    res.status(500).json({ message: 'Logout failed' })
  }
})

// PostgreSQL & async/await 방식으로 수정된 /verify
router.get('/verify', protect, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, role FROM users WHERE id = $1', [req.user.userId])
    const user = result.rows[0]
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    res.json({ user })
  } catch (err) {
    logger.error('Verify token error', { userId: req.user.userId, error: err.message })
    res.status(500).json({ message: 'Server error' })
  }
})

module.exports = router