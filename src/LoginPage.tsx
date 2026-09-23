import { useState } from 'react';
import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react';
import { api, type AuthUser } from './api';
import { BrandLockup } from './Brand';

export function LoginPage({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await api<{ user: AuthUser }>('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }),
      });
      onLogin(response.user);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="login-page"><div className="login-art"><BrandLockup inverse /><div className="login-art-copy"><div className="login-orbit"><Sparkles size={42} /></div><span className="eyebrow">КАРЬЕРА · НАВЫКИ · ВОЗМОЖНОСТИ</span><h1>Ваш следующий шаг начинается здесь<span className="heading-dot">.</span></h1><p>Одна траектория, понятные рекомендации и видимый прогресс.</p></div><span className="login-art-footer">Halyk Career Quest · HackAlem AI</span></div><main className="login-main"><form className="login-card" onSubmit={submit}><div className="login-lock"><LockKeyhole size={23} /></div><span className="eyebrow">ДОБРО ПОЖАЛОВАТЬ</span><h2>Войти в Halyk Career Quest</h2><p>Карьерный навигатор сотрудников. Используйте свой логин или email и пароль.</p><label>Логин или email<input autoComplete="username" autoFocus required value={login} onChange={event => setLogin(event.target.value)} placeholder="name@company.kz" /></label><label>Пароль<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Введите пароль" /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="button primary" disabled={busy}>{busy ? 'Проверяем...' : 'Войти'} <ArrowRight size={18} /></button><small>Демо-аккаунты указаны в README проекта.</small></form></main></div>;
}
