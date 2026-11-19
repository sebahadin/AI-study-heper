import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function Loading({ message = 'Loading…' }: { message?: string }) {
  return <div role="status" className="loading-state"><span className="loading-orbit" /><p>{message}</p></div>;
}
export function ErrorBanner({ message }: { message?: string }) {
  return message ? <p role="alert" className="error-message">{message}</p> : null;
}
export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return <section className="section load-error"><span className="empty-state-icon"><Icon name="note" /></span><ErrorBanner message={message} /><button className="btn secondary" onClick={retry}>Try again</button></section>;
}
export function Field({ label, name, error, children }: { label: string; name: string; error?: string; children: ReactNode }) {
  return <div className="field"><label htmlFor={name}>{label}</label>{children}{error && <p role="alert" className="form-error">{error}</p>}</div>;
}
