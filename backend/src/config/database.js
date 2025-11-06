// backend/src/config/database.js

// sqlite3 대신 'pg' (PostgreSQL) 드라이버를 사용합니다.
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const logger = require('../utils/logger')

/**
 * PostgreSQL 연결 설정
 * - Vercel 환경: SSL 연결 필수 (VERCEL 환경 변수 존재)
 * - 로컬 개발 환경: SSL 비활성화 (로컬 PostgreSQL은 SSL 미지원 가능)
 * - POSTGRES_URL에 sslmode 파라미터가 있으면 그에 따름
 */
const getSslConfig = () => {
  // Vercel 환경인지 확인 (Vercel은 자동으로 VERCEL=1을 설정)
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV

  // POSTGRES_URL에 sslmode 파라미터가 있는지 확인
  const postgresUrl = process.env.POSTGRES_URL || ''
  const hasSslMode = postgresUrl.includes('sslmode=')

  // sslmode 파라미터가 있으면 그대로 사용 (URL에 포함된 설정 우선)
  if (hasSslMode) {
    return undefined // URL의 sslmode 파라미터를 사용
  }

  // Vercel 환경이면 SSL 활성화
  if (isVercel) {
    return {
      rejectUnauthorized: false // Vercel의 자체 서명 인증서 허용
    }
  }

  // 로컬 개발 환경에서는 SSL 비활성화
  return false
}

/**
 * PostgreSQL 연결 풀 생성
 * Vercel 환경에서는 POSTGRES_URL 환경 변수가 자동으로 주입됩니다.
 * 로컬 개발 환경에서는 .env 파일에 POSTGRES_URL을 설정해야 합니다.
 */
if (!process.env.POSTGRES_URL) {
  logger.warn('POSTGRES_URL 환경 변수가 설정되지 않았습니다. 데이터베이스 연결이 실패할 수 있습니다.')
  logger.warn('로컬 개발: .env 파일에 POSTGRES_URL을 설정하세요.')
  logger.warn('Vercel 배포: 프로젝트 설정 > Environment Variables에서 POSTGRES_URL을 추가하세요.')
}

// Vercel이 자동으로 환경 변수를 주입해 줍니다.
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  // 환경에 따라 SSL 설정 적용
  ssl: getSslConfig(),
  // 서버리스 환경에서 연결 풀 최적화
  // 최대 연결 수를 제한하여 Cold Start 시간 단축
  max: 10, // 최대 10개의 연결
  idleTimeoutMillis: 30000, // 30초 동안 사용되지 않으면 연결 종료
  connectionTimeoutMillis: 10000 // 10초 내 연결 실패 시 타임아웃
})

// 연결 풀 이벤트 리스너 (디버깅 및 모니터링용)
pool.on('connect', (client) => {
  logger.debug('새로운 PostgreSQL 클라이언트 연결됨')
})

pool.on('error', (err, client) => {
  logger.error('PostgreSQL 연결 풀 오류', { error: err.message, stack: err.stack })
})

// 연결 테스트 함수
const testConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW() as current_time')
    logger.info('PostgreSQL 연결 성공', { 
      currentTime: result.rows[0].current_time,
      environment: process.env.VERCEL ? 'Vercel' : 'Local'
    })
    return true
  } catch (error) {
    logger.error('PostgreSQL 연결 테스트 실패', { 
      error: error.message,
      hint: process.env.POSTGRES_URL ? 'POSTGRES_URL이 설정되어 있지만 연결에 실패했습니다.' : 'POSTGRES_URL 환경 변수를 확인하세요.'
    })
    return false
  }
}

const db = {
  query: (text, params) => pool.query(text, params)
}

const initDb = async () => {
  try {
    // 먼저 연결 테스트
    const connectionOk = await testConnection()
    if (!connectionOk) {
      throw new Error('PostgreSQL 연결에 실패했습니다. POSTGRES_URL 환경 변수를 확인하세요.')
    }

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

module.exports = { db, pool, initDb, closeDb, testConnection };