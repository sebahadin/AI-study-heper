import express from 'express';
import bcrypt from 'bcrypt';
import passport from '../auth.mjs';
import { User } from '../db.mjs';
import { HttpError, errorHandler, publicUser, requireAuth, text } from '../http.mjs';

export async function registerUser(req, res, deps = {}) {
  const { UserModel = User, bcryptLib = bcrypt } = deps;
  try {
    const username = text(req.body, 'username');
    const email = text(req.body, 'email');
    const { password, confirmPassword } = req.body;
    if (username.length < 3) {
      throw new HttpError(400, 'Check the highlighted fields.', { username: 'Use at least 3 characters.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'Check the highlighted fields.', { email: 'Enter a valid email address.' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      throw new HttpError(400, 'Check the highlighted fields.', { password: 'Use at least 6 characters.' });
    }
    if (password !== confirmPassword) {
      throw new HttpError(400, 'Passwords do not match', { confirmPassword: 'Passwords must match.' });
    }
    const existingUser = await UserModel.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      throw new HttpError(409, 'Username or email already exists');
    }
    const hashedPassword = await bcryptLib.hash(password, 10);
    await UserModel.create({ username, email, password: hashedPassword });
    return res.status(201).json({ message: 'Account created successfully! Please log in.' });
  } catch (err) {
    return errorHandler(err, req, res);
  }
}

const router = express.Router();
router.post('/register', (req, res) => registerUser(req, res));
router.post('/login', (req, res, next) => {
  req.body.username = text(req.body, 'username');
  if (typeof req.body.password !== 'string' || !req.body.password) {
    throw new HttpError(400, 'Enter your password.', { password: 'This field is required.' });
  }
  passport.authenticate('local', (err, user) => {
    if (err) { return next(err); }
    if (!user) { return res.status(401).json({ error: 'Incorrect username or password.' }); }
    req.logIn(user, (loginError) => {
      if (loginError) { return next(loginError); }
      req.session.save((saveError) => {
        if (saveError) { return next(saveError); }
        res.json({ user: publicUser(user) });
      });
    });
  })(req, res, next);
});
router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
router.post('/logout', requireAuth, (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err); }
    req.session.destroy((destroyError) => {
      if (destroyError) { return next(destroyError); }
      res.clearCookie('classmate.sid', { path: '/' });
      res.status(204).end();
    });
  });
});
export default router;
