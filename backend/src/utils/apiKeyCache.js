const { db } = require('../config/database');
const logger = require('./logger');

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const getApiKeys = async () => {
  const now = Date.now();
  if (cache.has('apiKeys') && cache.get('apiKeys').expiry > now) {
    return cache.get('apiKeys').value;
  }

  return new Promise((resolve, reject) => {
    db.all('SELECT key, value FROM settings', [], (err, rows) => {
      if (err) {
        logger.error('Failed to retrieve API keys from DB.', {
          error: err.message,
        });
        return reject(new Error('Failed to retrieve API keys.'));
      }
      const apiKeys = rows.reduce(
        (acc, row) => ({ ...acc, [row.key]: row.value }),
        {}
      );
      cache.set('apiKeys', {
        value: apiKeys,
        expiry: now + CACHE_TTL_MS,
      });
      logger.info('API keys loaded from DB and cached.');
      resolve(apiKeys);
    });
  });
};

const invalidateCache = () => {
  cache.delete('apiKeys');
  logger.info('API key cache invalidated.');
};

module.exports = { getApiKeys, invalidateCache };
