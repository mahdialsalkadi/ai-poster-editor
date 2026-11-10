import { useState, type FormEvent } from 'react';
import type { AuthUser } from '@poster/contracts';
import { useI18n } from '../i18n.js';
import { login, logout } from '../editor/api.js';
import { Button, Field, IconButton, TextInput, Spinner } from './controls.js';

export type AccountDialogProps = {
  user: AuthUser | null;
  onClose: () => void;
  onSignedIn: (user: AuthUser) => void;
  onSignedOut: () => void;
};

export function AccountDialog({ user, onClose, onSignedIn, onSignedOut }: AccountDialogProps) {
  const { t } = useI18n();
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
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('account')}>
      <div className="modal-panel auth-panel">
        <header className="modal-header">
          <h2>{user ? t('account') : t('signIn')}</h2>
          <IconButton icon="close" label={t('closeAccount')} onClick={onClose} disabled={busy} />
        </header>
        <div className="modal-body">
          {user ? (
            <div className="auth-session">
              <p className="auth-identity" dir="ltr">
                {user.email ?? user.id}
              </p>
              <p className="auth-note">
                {user.method === 'public' ? t('publicServerNote') : t('accountUsageNote')}
              </p>
              {user.method !== 'public' ? (
                <Button variant="danger" full onClick={() => void signOut()} disabled={busy}>
                  {busy ? <Spinner size={14} /> : null}
                  {t('signOut')}
                </Button>
              ) : null}
            </div>
          ) : (
            <form className="auth-form" onSubmit={(event) => void submit(event)}>
              <p className="auth-note">{t('supabaseNote')}</p>
              <Field label={t('email')}>
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
              <Field label={t('password')}>
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
                {t('enter')}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
