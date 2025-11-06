const jwt = require('jsonwebtoken');
const { isBlacklisted } = require('../utils/jwtBlacklist'); // --- IMPROVEMENT ---

const protect = (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // --- IMPROVEMENT ---
      // 토큰이 블랙리스트에 있는지 확인합니다.
      if (isBlacklisted(token)) {
        return res
          .status(401)
          .json({ message: 'Not authorized, token has been invalidated' });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  } else {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'master')) {
    next();
  } else {
    res
      .status(403)
      .json({ message: 'Admin or Master resource. Access denied.' });
  }
};

const masterOnly = (req, res, next) => {
  if (req.user && req.user.role === 'master') {
    next();
  } else {
    res.status(403).json({ message: 'Master resource. Access denied.' });
  }
};

module.exports = { protect, adminOnly, masterOnly };
