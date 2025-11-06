// backend/src/config/database.js

// sqlite3 대신 'pg' (PostgreSQL) 드라이버를 사용합니다.
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const logger = require('../utils/logger')

// Vercel이 자동으로 환경 변수를 주입해 줍니다.
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  // Vercel 환경에서는 SSL이 필요합니다.
  ssl: {
    rejectUnauthorized: false
  }
})

const db = {
  query: (text, params) => pool.query(text, params)
}

const initDb = async () => {
  try {
    const tableCreationQueries = [
            `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP)`,
            `CREATE TABLE IF NOT EXISTS templates (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, config JSONB NOT NULL, created_by INTEGER, updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL)`,
            `CREATE TABLE IF NOT EXISTS workflows (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT, template_snapshot JSONB NOT NULL, execution_context JSONB NOT NULL, is_bookmarked BOOLEAN DEFAULT false, bookmark_title TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE)`,
            `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
            `CREATE TABLE IF NOT EXISTS user_template_permissions (user_id INTEGER NOT NULL, template_id INTEGER NOT NULL, PRIMARY KEY (user_id, template_id), FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE, FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE CASCADE)`,
            `CREATE TABLE IF NOT EXISTS error_logs (id SERIAL PRIMARY KEY, user_id INTEGER, username TEXT, timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, action_type TEXT, workflow_id INTEGER, step_index INTEGER, error_message TEXT, context JSONB, FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL)`,
            `CREATE TABLE IF NOT EXISTS llm_logs (id SERIAL PRIMARY KEY, timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, user_id INTEGER, username TEXT, workflow_id INTEGER, template_name TEXT, step_index INTEGER, provider TEXT, model_id TEXT, request_payload JSONB, response_payload TEXT, is_success BOOLEAN, error_message TEXT, FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL)`
    ]

    for (const query of tableCreationQueries) {
      await db.query(query)
    }
    logger.info('Tables checked/created successfully in PostgreSQL.')

    const masterUsername = 'master'
    const masterPassword = process.env.MASTER_PASSWORD || 'masterpassword'

    let res = await db.query("SELECT * FROM users WHERE role = 'master'")
    if (res.rows.length === 0) {
      const salt = bcrypt.genSaltSync(10)
      const passwordHash = bcrypt.hashSync(masterPassword, salt)
      await db.query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)', [masterUsername, passwordHash, 'master'])
      logger.info('Master account created successfully.')
    }

    res = await db.query('SELECT COUNT(*) as count FROM templates')
    if (parseInt(res.rows[0].count, 10) === 0) {
      logger.info('No templates found. Creating sample templates...')
      const sampleTemplates = [
        {
          name: '연속 대화형 시장 조사 보고서',
          config: {
            model: 'OpenAI__gpt-4o',
            globalInstruction: '당신은 뛰어난 시장 분석가입니다. 사용자와 대화하며 단계별로 시장 조사 보고서를 완성해 나갑니다. 이전 대화의 맥락을 완벽하게 파악하여 답변해주세요.',
            steps: [
              {
                name: '1. 조사 대상 및 범위 설정',
                instruction: '조사하고 싶은 시장이나 제품에 대해 알려주세요. 보고서의 주요 목적은 무엇인가요?',
                prompt: '사용자가 요청한 조사 대상과 목적을 바탕으로, 보고서의 목차와 서론을 작성해주세요. [현재 단계 사용자 입력]'
              },
              {
                name: '2. 데이터 분석 및 시사점 도출',
                instruction: '관련 뉴스 기사, 통계 데이터, 또는 분석하고 싶은 자료를 입력해주세요.',
                prompt: '제공된 자료를 분석하고, 이전 대화에서 논의한 보고서의 목적에 맞춰 핵심적인 시사점을 3가지 이상 도출해주세요. [현재 단계 사용자 입력]'
              },
              {
                name: '3. 최종 결론 및 전략 제안',
                instruction: '지금까지의 분석 내용을 바탕으로 어떤 결론을 내리고 싶으신가요? 또는 어떤 전략을 제안하고 싶으신가요?',
                prompt: '지금까지의 모든 대화 내용을 종합하여, 사용자의 마지막 요청에 맞춰 보고서의 최종 결론 및 전략 제안 부분을 작성해주세요. [현재 단계 사용자 입력]'
              }
            ]
          }
        }
      ]

      const masterUser = await db.query("SELECT id FROM users WHERE role = 'master'")
      const masterId = masterUser.rows.length > 0 ? masterUser.rows[0].id : 1

      for (const t of sampleTemplates) {
        await db.query('INSERT INTO templates (name, config, created_by) VALUES ($1, $2, $3)', [t.name, t.config, masterId])
      }
      logger.info('Sample templates created successfully.')
    }
  } catch (err) {
    logger.error('Database initialization error', { error: err.stack })
    process.exit(1)
  }
}

const closeDb = async () => {
  await pool.end()
  logger.info('Database pool has ended.')
}

module.exports = { db, pool, initDb, closeDb };