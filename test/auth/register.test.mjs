import { expect } from 'chai';
import { registerUser } from '../../src/routes/auth.mjs';

const makeReq = (bodyOverrides = {}) => ({
  body: {
    username: 'student1',
    email: 'student@example.com',
    password: 'super-secret',
    confirmPassword: 'super-secret',
    ...bodyOverrides,
  },
});

const makeRes = () => {
  const res = {
    view: null,
    data: null,
    render(view, data) {
      this.view = view;
      this.data = data;
    },
  };
  return res;
};

describe('registerUser', () => {
  it('rejects when passwords do not match', async () => {
    const req = makeReq({ confirmPassword: 'mismatch' });
    const res = makeRes();

    await registerUser(req, res, {
      UserModel: { findOne: async () => null, create: async () => null },
      bcryptLib: { hash: async () => 'irrelevant' },
    });

    expect(res.view).to.equal('auth/register');
    expect(res.data).to.deep.equal({ error: 'Passwords do not match' });
  });

  it('rejects when username or email already exists', async () => {
    const req = makeReq();
    const res = makeRes();
    const findOneSpy = [];

    await registerUser(req, res, {
      UserModel: {
        findOne: async (query) => {
          findOneSpy.push(query);
          return { id: 'existing-user' };
        },
      },
      bcryptLib: { hash: async () => 'irrelevant' },
    });

    expect(findOneSpy).to.have.lengthOf(1);
    expect(res.view).to.equal('auth/register');
    expect(res.data).to.deep.equal({ error: 'Username or email already exists' });
  });

  it('creates a new user and renders login on success', async () => {
    const req = makeReq();
    const res = makeRes();
    const createdPayloads = [];
    const bcryptCalls = [];

    await registerUser(req, res, {
      UserModel: {
        findOne: async () => null,
        create: async (payload) => createdPayloads.push(payload),
      },
      bcryptLib: {
        hash: async (password, rounds) => {
          bcryptCalls.push({ password, rounds });
          return 'hashed-value';
        },
      },
    });

    expect(bcryptCalls).to.deep.equal([{ password: 'super-secret', rounds: 10 }]);
    expect(createdPayloads).to.deep.equal([
      { username: 'student1', email: 'student@example.com', password: 'hashed-value' },
    ]);
    expect(res.view).to.equal('auth/login');
    expect(res.data).to.deep.equal({
      success: 'Account created successfully! Please log in.',
    });
  });
});
