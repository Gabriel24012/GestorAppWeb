import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import type { Profile } from './models';

const ACCESS_KEY = 'gestion-captura-access';
const REFRESH_KEY = 'gestion-captura-refresh';
const EXPIRES_KEY = 'gestion-captura-session-expires-at';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_WARNING_MS = 10 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly profile = signal<Profile | null>(null);
  readonly ready = signal(false);
  readonly sessionWarningVisible = signal(false);
  readonly sessionExpiresAt = signal<number | null>(null);
  private warningTimer: ReturnType<typeof setTimeout> | null = null;
  private expirationTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor() { void this.restore(); }

  async restore() {
    const token = localStorage.getItem(ACCESS_KEY);
    if (!token) { this.clearSessionState(); this.ready.set(true); return; }
    try {
      const response = await this.request('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Sesión vencida');
      const result = await response.json();
      this.profile.set(result.data);
      this.startSessionWindow();
    } catch {
      const refreshed = await this.refreshTokens();
      if (refreshed) {
        try {
          const response = await this.request('/auth/me', { headers: { Authorization: `Bearer ${localStorage.getItem(ACCESS_KEY)}` } });
          if (!response.ok) throw new Error('Sesión vencida');
          this.profile.set((await response.json()).data);
          this.startSessionWindow();
        } catch { this.clearSessionState(); }
      } else this.clearSessionState();
    } finally { this.ready.set(true); }
  }

  async signIn(email: string, password: string) {
    const response = await this.request('/auth/token', { method: 'POST', body: JSON.stringify({ email, password }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail === 'email_not_verified' ? 'email_not_verified' : data.detail || 'Credenciales incorrectas');
    localStorage.setItem(ACCESS_KEY, data.access);
    localStorage.setItem(REFRESH_KEY, data.refresh);
    this.profile.set(data.user);
    this.startSessionWindow();
    this.ready.set(true);
  }

  async signOut() { this.clearSessionState(); }
  async accessToken() { return localStorage.getItem(ACCESS_KEY); }
  async refreshAccessToken() {
    if (!this.refreshing) this.refreshing = this.refreshTokens().finally(() => this.refreshing = null);
    return this.refreshing;
  }

  async extendSession() {
    if (!await this.refreshAccessToken()) { await this.signOut(); return false; }
    this.startSessionWindow();
    await this.restore();
    return !!this.profile();
  }

  sessionMinutesRemaining() {
    const expiresAt = this.sessionExpiresAt();
    return expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000)) : 0;
  }

  private async refreshTokens() {
    const refresh = localStorage.getItem(REFRESH_KEY);
    if (!refresh) return false;
    try {
      const response = await this.request('/auth/token/refresh', { method: 'POST', body: JSON.stringify({ refresh }) });
      if (!response.ok) return false;
      const data = await response.json();
      localStorage.setItem(ACCESS_KEY, data.access);
      if (data.refresh) localStorage.setItem(REFRESH_KEY, data.refresh);
      return true;
    } catch { return false; }
  }

  private request(path: string, init: RequestInit = {}) {
    return fetch(`${environment.apiUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  }

  private startSessionWindow() {
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    localStorage.setItem(EXPIRES_KEY, String(expiresAt));
    this.sessionExpiresAt.set(expiresAt);
    this.sessionWarningVisible.set(false);
    if (this.warningTimer) clearTimeout(this.warningTimer);
    if (this.expirationTimer) clearTimeout(this.expirationTimer);
    this.warningTimer = setTimeout(() => this.sessionWarningVisible.set(true), Math.max(0, expiresAt - Date.now() - SESSION_WARNING_MS));
    this.expirationTimer = setTimeout(() => void this.signOut(), Math.max(0, expiresAt - Date.now()));
  }

  private clearSessionState() {
    if (this.warningTimer) clearTimeout(this.warningTimer);
    if (this.expirationTimer) clearTimeout(this.expirationTimer);
    this.warningTimer = null; this.expirationTimer = null;
    localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(REFRESH_KEY); localStorage.removeItem(EXPIRES_KEY);
    this.profile.set(null); this.sessionExpiresAt.set(null); this.sessionWarningVisible.set(false);
  }
}
