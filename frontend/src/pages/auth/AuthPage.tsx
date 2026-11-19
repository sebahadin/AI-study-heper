import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { api, ApiError, errorMessage } from '../../services/api';
import type { FieldErrors } from '../../types';
import { ErrorBanner, Field } from '../../components/Feedback';
import { OrbitScene } from '../../components/OrbitScene';
import { Icon } from '../../components/Icon';

export function AuthPage({ register = false }: { register?: boolean }) {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const from = location.state?.from;
  const destination = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';
  if (user) { return <Navigate to={destination} replace />; }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setFields({});
    if (register && values.password !== values.confirmPassword) { setFields({ confirmPassword: 'Passwords must match.' }); return; }
    setBusy(true);
    try {
      if (register) {
        const result = await api<{ message: string }>('/auth/register', { method: 'POST', body: values });
        navigate('/login', { state: { message: result.message }, replace: true });
      } else {
        await login(values.username, values.password);
        navigate(destination, { replace: true });
      }
    } catch (reason) { setError(errorMessage(reason)); if (reason instanceof ApiError) { setFields(reason.fields); } }
    finally { setBusy(false); }
  }
  return <div className="auth-screen">
    <section className="auth-story"><span className="eyebrow">A little curiosity goes a long way</span><h1>Less scattered.<br /><em>More inspired.</em></h1><p>A home for your books, your ideas,<br />and everything you’re figuring out.</p><OrbitScene variant="auth" /><div className="auth-benefits"><span><Icon name="book" size={17} />Collect your references</span><span><Icon name="note" size={17} />Make room for ideas</span><span><Icon name="cards" size={17} />Practice what matters</span></div></section>
    <section className="auth-card" aria-labelledby="auth-title"><div className="auth-form-heading"><span className="auth-welcome-icon"><Icon name={register ? 'spark' : 'book'} size={25} /></span><h2 id="auth-title">{register ? 'Create your account' : 'Welcome back'}</h2><p>{register ? 'Your next chapter starts with a little space to learn.' : 'Pick up where your curiosity left off.'}</p></div>
      {!register && location.state?.message && <p className="success-message" role="status">{location.state.message}</p>}
      <form className="form-container auth-form" onSubmit={submit}>
        <ErrorBanner message={error} />
        <Field label="Username" name="username" error={fields.username}><input id="username" name="username" autoComplete="username" placeholder="Your username" required minLength={register ? 3 : undefined} value={values.username} onChange={(e) => setValues({ ...values, username: e.target.value })} /></Field>
        {register && <Field label="Email" name="email" error={fields.email}><input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} /></Field>}
        <Field label="Password" name="password" error={fields.password}><input id="password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'At least 6 characters' : 'Your password'} required minLength={register ? 6 : undefined} value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} /></Field>
        {register && <Field label="Confirm password" name="confirmPassword" error={fields.confirmPassword}><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" placeholder="Once more, just to be sure" required value={values.confirmPassword} onChange={(e) => setValues({ ...values, confirmPassword: e.target.value })} /></Field>}
        <button className="btn primary auth-submit" disabled={busy} type="submit">{busy ? 'Please wait…' : register ? 'Create account' : 'Log in'}</button>
      </form>
      <p className="auth-alternate">{register ? 'Already have an account? ' : 'New to Classmate? '}<Link to={register ? '/login' : '/register'}>{register ? 'Log in' : 'Register'}</Link></p>
      <div className="auth-card-footer"><span />Your personal space to make progress.</div>
    </section>
  </div>;
}
