import { expect } from 'chai';
import { registerUser } from '../../src/routes/auth.mjs';

const body = { username: 'student1', email: 'student@example.com', password: 'super-secret', confirmPassword: 'super-secret' };
const makeRes = () => ({ code: 200, data: null, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } });
describe('registerUser JSON API', () => {
  it('rejects mismatched passwords before accessing the database', async () => {
    const res = makeRes();
    await registerUser({ body: { ...body, confirmPassword: 'different' } }, res, { UserModel: {} });
    expect(res.code).to.equal(400);
    expect(res.data.fields.confirmPassword).to.equal('Passwords must match.');
  });
  it('rejects a duplicate username or email', async () => {
    const res = makeRes();
    await registerUser({ body }, res, { UserModel: { findOne: async () => ({ _id: 'exists' }) } });
    expect(res.code).to.equal(409);
  });
  it('hashes the password and returns JSON without credentials', async () => {
    const res = makeRes();
    let created;
    await registerUser({ body }, res, {
      UserModel: { findOne: async () => null, create: async (value) => { created = value; } },
      bcryptLib: { hash: async (password, cost) => { expect(password).to.equal(body.password); expect(cost).to.equal(10); return 'hashed-password'; } },
    });
    expect(res.code).to.equal(201);
    expect(created.password).to.equal('hashed-password');
    expect(res.data).to.deep.equal({ message: 'Account created successfully! Please log in.' });
  });
  it('rejects malformed inputs before database access', async () => {
    for (const changes of [{ username: { $ne: null } }, { email: 'invalid' }, { password: 'tiny' }]) {
      const res = makeRes();
      await registerUser({ body: { ...body, ...changes } }, res, { UserModel: {} });
      expect(res.code).to.equal(400);
    }
  });
});
