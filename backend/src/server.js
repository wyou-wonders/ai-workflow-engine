// backend/src/server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
// 1. closeDb는 Vercel 환경에서 직접 호출할 필요가 없어졌으므로 제거합니다.
const { initDb } = require('./config/database');
const logger = require('./utils/logger');
const winston = require('winston');
const onFinished = require('on-finished');

// Vercel 서버리스 환경에서 unhandled rejection을 처리
// 이렇게 하면 Promise rejection이 발생해도 함수가 정상적으로 종료됩니다.
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
  // Vercel 환경에서는 process.exit()를 호출하지 않습니다.
  // 대신 로그만 남기고 계속 진행합니다.
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
  // Vercel 환경에서는 process.exit()를 호출하지 않습니다.
  // 대신 로그만 남기고 계속 진행합니다.
});

// if (!process.env.JWT_SECRET) {
//   logger.error('FATAL ERROR: JWT_SECRET is not defined.');
//   process.exit(1);
// }

// 민감 정보 마스킹 함수 (기존 코드와 동일)
const sanitizeBody = (body) => {
  if (!body) return null;
  const sanitized = { ...body };
  const sensitiveKeys = [
    'password',
    'token',
    'apiKey',
    'jwt',
    'secret',
    'master_password',
  ];
  for (const key in sanitized) {
    if (sensitiveKeys.some((sKey) => key.toLowerCase().includes(sKey))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  return sanitized;
};

// 요청 로거 (수정된 코드)
// Vercel 서버리스 환경에서는 파일 시스템이 읽기 전용이므로 파일 로깅 제거
const requestLogger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // Vercel 환경에서는 파일 로깅이 불가능하므로 콘솔만 사용
    // 로컬 개발 환경에서도 콘솔 로그로 충분하며, Vercel에서는 자동으로 로그 수집됨
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json() // JSON 형식으로 출력하여 Vercel에서 파싱하기 용이하게 함
      )
    })
  ],
});

const app = express();

// CORS 설정 - Vercel 환경을 포함한 모든 origin 허용
// credentials: true는 쿠키나 인증 헤더를 포함한 요청을 허용합니다
app.use(cors({
  origin: true, // 모든 origin 허용 (프로덕션에서는 특정 도메인으로 제한 가능)
  credentials: true, // 인증 정보 포함 요청 허용
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// OPTIONS 요청에 대한 명시적 처리 (Preflight 요청)
app.options('*', cors());

app.use(express.json());

// 로깅 미들웨어 (기존 코드와 동일)
app.use((req, res, next) => {
  const start = Date.now();

  onFinished(res, () => {
    const duration = Date.now() - start;
    requestLogger.info({
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      headers: req.headers,
      body: sanitizeBody(req.body),
    });
  });

  next();
});

// API 라우트 설정 (기존 코드와 동일)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/workflows', require('./routes/workflows'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/llm', require('./routes/llm'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/models', require('./routes/models'));

// 에러 핸들러 (기존 코드와 동일)
app.use((err, req, res, next) => {
  logger.error('Unhandled application error', {
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ message: '서버 내부 오류가 발생했습니다.' });
});

// 2. Vercel 배포를 위한 수정 부분
// 데이터베이스 초기화를 한 번만 수행하기 위한 Promise 캐시
// 이 패턴은 "Lazy Initialization with Caching"이라고 불립니다.
let dbInitPromise = null;

/**
 * 데이터베이스 초기화를 보장하는 함수
 * 여러 요청이 동시에 들어와도 초기화는 한 번만 수행됩니다.
 * @returns {Promise<void>} 초기화 완료를 나타내는 Promise
 */
const ensureDbInitialized = async () => {
  // 이미 초기화가 진행 중이거나 완료된 경우, 기존 Promise를 재사용
  if (!dbInitPromise) {
    dbInitPromise = initDb().catch((error) => {
      // 초기화 실패 시 캐시를 초기화하여 재시도 가능하게 함
      dbInitPromise = null;
      logger.error('Database initialization failed', { error: error.message });
      throw error;
    });
  }
  return dbInitPromise;
};

// Vercel 서버리스 환경을 위한 비동기 핸들러
// Vercel은 이 함수를 각 요청마다 호출하며, Express 앱으로 요청을 전달합니다.
const vercelHandler = async (req, res) => {
  try {
    // 첫 요청 시 데이터베이스 초기화를 보장
    await ensureDbInitialized();

    // Express 앱이 요청을 처리
    // Express는 비동기 미들웨어를 자동으로 처리하므로 직접 호출하면 됩니다.
    app(req, res);
  } catch (error) {
    // 데이터베이스 초기화 실패 시 에러 응답
    logger.error('Handler initialization error', {
      error: error.message,
      stack: error.stack,
      url: req.originalUrl,
      method: req.method
    });
    if (!res.headersSent) {
      res.status(500).json({
        message: '서버 초기화 중 오류가 발생했습니다.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        hint: '데이터베이스 연결을 확인하세요. POSTGRES_URL 환경 변수가 설정되어 있는지 확인하세요.'
      });
    }
  }
};

// 로컬 개발 환경(NODE_ENV가 'production'이 아닐 때)에서만 직접 서버를 실행합니다.
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  ensureDbInitialized()
    .then(() => {
      app.listen(PORT, () => {
        logger.info(`Backend server is running on http://localhost:${PORT}`);
      });
    })
    .catch((error) => {
      logger.error('Failed to start server', { error: error.message });
      process.exit(1);
    });
}

// Vercel이 이 부분을 가져가서 서버를 실행합니다.
// Vercel의 @vercel/node는 이 함수를 각 요청마다 호출합니다.
module.exports = vercelHandler;