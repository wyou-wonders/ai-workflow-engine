// backend/src/server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
// 1. closeDb는 Vercel 환경에서 직접 호출할 필요가 없어졌으므로 제거합니다.
const { initDb } = require('./config/database');
const logger = require('./utils/logger');
const winston = require('winston');
const onFinished = require('on-finished');

if (!process.env.JWT_SECRET) {
  logger.error('FATAL ERROR: JWT_SECRET is not defined.');
  process.exit(1);
}

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
const requestLogger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'requests.log' }),
    // Vercel CLI에 로그를 출력하기 위해 콘솔 전송 추가
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json() // JSON 형식으로 출력하여 Vercel에서 파싱하기 용이하게 함
        )
    })
  ],
});

const app = express();

app.use(cors());
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
// initDb()가 완료된 후 app 객체를 export 하는 비동기 함수를 만듭니다.
const startServer = async () => {
  // initDb()가 Promise를 반환하므로 await으로 기다립니다.
  await initDb();
  return app;
};

// 로컬 개발 환경(NODE_ENV가 'production'이 아닐 때)에서만 직접 서버를 실행합니다.
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  startServer().then((app) => {
    app.listen(PORT, () => {
      logger.info(`Backend server is running on http://localhost:${PORT}`);
    });
  });
}

// Vercel이 이 부분을 가져가서 서버를 실행합니다.
module.exports = startServer();