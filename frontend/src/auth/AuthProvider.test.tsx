import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { AuthProvider } from './AuthProvider';

const account = { _id: 'student-one', username: 'student', email: 'student@example.com' };
function mount(path: string) { return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>); }
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Please log in.' }), { status: 401 })));
});
describe('authentication and protected pages', () => {
  it('sends an unauthenticated visitor to login, then restores their requested page', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = String(input);
      if (path === '/api/auth/me') { return new Response('{}', { status: 401 }); }
      if (path === '/api/auth/login') { return new Response(JSON.stringify({ user: account }), { status: 200 }); }
      return new Response(JSON.stringify({ books: [] }), { status: 200 });
    });
    const user = userEvent.setup();
    mount('/notes/add');
    await user.type(await screen.findByLabelText('Username'), 'student');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Add a note' })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ credentials: 'same-origin', method: 'POST' }));
  });
  it('restores an existing cookie session and clears it on logout', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = String(input);
      if (path === '/api/auth/logout') { return new Response(null, { status: 204 }); }
      return new Response(JSON.stringify(path === '/api/auth/me' ? { user: account } : { books: [], notes: [], flashcardsCount: 0 }), { status: 200 });
    });
    const user = userEvent.setup();
    mount('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Logout' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });
  it('keeps registration values and shows password mismatch feedback', async () => {
    const user = userEvent.setup();
    mount('/register');
    await user.type(await screen.findByLabelText('Username'), 'student');
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords must match.');
    expect(screen.getByLabelText('Username')).toHaveValue('student');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/auth/register')).toBe(false);
  });
});
