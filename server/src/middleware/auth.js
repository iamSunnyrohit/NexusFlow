import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const signToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role, email: user.email }, config.jwtSecret, {
    expiresIn: '12h',
  });

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const rank = { viewer: 1, editor: 2, admin: 3 };
export const requireRole = (min) => (req, res, next) =>
  rank[req.user?.role] >= rank[min] ? next() : res.status(403).json({ error: 'Forbidden' });
