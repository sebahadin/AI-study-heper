import mongoose from 'mongoose';

export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export function requireAuth(req, res, next) {
  if (!req.isAuthenticated?.() || !req.user) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  next();
}

export function validateId(req, _res, next, value) {
  if (!mongoose.isObjectIdOrHexString(value)) {
    return next(new HttpError(400, 'Invalid record ID.'));
  }
  next();
}

export function text(body, field, required = true) {
  const value = body?.[field];
  if (value !== undefined && typeof value !== 'string') {
    throw new HttpError(400, 'Check the highlighted fields.', { [field]: 'Enter text.' });
  }
  const cleaned = (value || '').trim();
  if (required && !cleaned) {
    throw new HttpError(400, 'Check the highlighted fields.', { [field]: 'This field is required.' });
  }
  return cleaned;
}

export function publicUser(user) {
  return { _id: String(user._id), username: user.username, email: user.email };
}

export function errorHandler(err, _req, res, _next) {
  if (err.code === 11000) {
    return res.status(409).json({ error: 'Username or email already exists.' });
  }
  if (err.name === 'ValidationError') {
    const fields = Object.fromEntries(Object.entries(err.errors).map(([key, value]) => [key, value.message]));
    return res.status(400).json({ error: 'Check the highlighted fields.', fields });
  }
  const status = err.status || (err.name === 'CastError' ? 400 : 500);
  if (status >= 500) {
    console.error(err);
  }
  return res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message, ...(err.fields && { fields: err.fields }) });
}
