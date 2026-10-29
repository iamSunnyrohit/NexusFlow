import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8)
    return res.status(400).json({ error: 'Email and a password of 8+ characters are required' });
  if (await User.findOne({ email: email.toLowerCase() }))
    return res.status(409).json({ error: 'Email already registered' });
  const isFirst = (await User.countDocuments()) === 0;
  const user = await User.create({
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role: isFirst ? 'admin' : 'editor',
  });
  res.status(201).json({ token: signToken(user), user: { id: user._id, email: user.email, role: user.role } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: (email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash)))
    return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: signToken(user), user: { id: user._id, email: user.email, role: user.role } });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
