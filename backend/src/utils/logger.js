const winston = require('winston');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../activity.log');

// --- REFACTOR HIGHLIGHT ---
// 기존의 동기적인 fs.appendFileSync 대신 비동기 로깅을 지원하는 Winston 라이브러리를 사용합니다.
// 이를 통해 로그 파일 작성 시 발생할 수 있는 I/O 블로킹을 방지하여 서버 성능을 향상시킵니다.
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    // 1. 파일 로깅 (로컬 개발 환경 및 로그 보관용)
    new winston.transports.File({
      filename: LOG_FILE,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          // context 객체를 포함한 로그를 예쁘게 출력
          const contextString = Object.keys(meta).length
            ? JSON.stringify(meta)
            : '';
          return `[${timestamp}] [${level.toUpperCase()}] ${message} ${contextString}`;
        })
      ),
    }),
    // 2. 콘솔 로깅 (Vercel CLI 및 실시간 디버깅용으로 항상 활성화)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const contextString = Object.keys(meta).length
            ? JSON.stringify(meta)
            : '';
          return `[${timestamp}] ${level}: ${message} ${contextString}`;
        })
      ),
    })
  ],
});

module.exports = logger;