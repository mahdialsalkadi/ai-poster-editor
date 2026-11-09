import { useState, type FormEvent } from 'react';
import type { AuthUser } from '@poster/contracts';
import { login, logout } from '../editor/api.js';
import { Button, Field, IconButton, TextInput, Spinner } from './controls.js';

export type AccountDialogProps = {
  user: AuthUser | null;
  onClose: () => void;
  onSignedIn: (user: AuthUser) => void;
  onSignedOut: () => void;
};

export function AccountDialog({ user, onClose, onSignedIn, onSignedOut }: AccountDialogProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || email.trim().length === 0 || password.length === 0) return;
    setBusy(true);
    setError(null);
    const result = await login(email.trim(), password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setPassword('');
    onSignedIn(result.data.user);
  };

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await logout();
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onSignedOut();
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="الحساب">
      <div className="modal-panel auth-panel">
        <header className="modal-header">
          <h2>{user ? 'الحساب' : 'تسجيل الدخول'}</h2>
          <IconButton icon="close" label="إغلاق الحساب" onClick={onClose} disabled={busy} />
        </header>
        <div className="modal-body">
          {user ? (
            <div className="auth-session">
              <p className="auth-identity" dir="ltr">
                {user.email ?? user.id}
              </p>
              <p className="auth-note">
                {user.method === 'public'
                  ? 'هذا الخادم يعمل دون تسجيل دخول؛ لا حاجة إلى حساب.'
                  : 'طلبات الذكاء الاصطناعي والتصدير مرتبطة بهذا الحساب وتُحتسب ضمن حدّه.'}
              </p>
              {user.method !== 'public' ? (
                <Button variant="danger" full onClick={() => void signOut()} disabled={busy}>
                  {busy ? <Spinner size={14} /> : null}
                  تسجيل الخروج
                </Button>
              ) : null}
            </div>
          ) : (
            <form className="auth-form" onSubmit={(event) => void submit(event)}>
              <p className="auth-note">
                سجّل الدخول بحساب Supabase لاستخدام الذكاء الاصطناعي والتصدير على خادم محمي.
              </p>
              <Field label="البريد الإلكتروني">
                <TextInput
                  value={email}
                  onChange={setEmail}
                  type="email"
                  autoComplete="email"
                  dir="ltr"
                  disabled={busy}
                  required
                />
              </Field>
              <Field label="كلمة المرور">
                <TextInput
                  value={password}
                  onChange={setPassword}
                  type="password"
                  autoComplete="current-password"
                  dir="ltr"
                  disabled={busy}
                  required
                />
              </Field>
              {error ? (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                variant="primary"
                type="submit"
                full
                disabled={busy || email.trim().length === 0 || password.length === 0}
              >
                {busy ? <Spinner size={14} /> : null}
                دخول
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
