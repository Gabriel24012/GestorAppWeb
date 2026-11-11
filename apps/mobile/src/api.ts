import * as SecureStore from 'expo-secure-store';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:8000/api/v1').replace(/\/$/, '');
const ACCESS = 'access';
const REFRESH = 'refresh';

export type Profile = { id: string; email: string; full_name: string; role: 'admin' | 'gestor' | 'capturador'; email_verified?: boolean; profile_image?: string };
export type ApiEnvelope<T> = { data: T; meta?: { page: number; limit: number; total: number } };

export async function api<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const access = authenticated ? await SecureStore.getItemAsync(ACCESS) : null;
  const send = (token: string | null) => fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }
  });
  let response = await send(access);
  if (response.status === 401 && authenticated) {
    const refresh = await SecureStore.getItemAsync(REFRESH);
    if (refresh) {
      const renewed = await fetch(`${API_URL}/auth/token/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh }) });
      if (renewed.ok) {
        const tokens = await renewed.json();
        await SecureStore.setItemAsync(ACCESS, tokens.access);
        if (tokens.refresh) await SecureStore.setItemAsync(REFRESH, tokens.refresh);
        response = await send(tokens.access);
      }
    }
  }
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(formatApiError(body, response.status));
  return body as T;
}

function formatApiError(body: any, status: number) {
  const detail = body?.detail ?? body?.message ?? body?.error;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object') {
    const nested = Object.values(detail).flatMap(value => Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string');
    if (nested.length) return nested.join('. ');
  }
  if (body && typeof body === 'object') {
    const fields = Object.entries(body)
      .filter(([key]) => !['code', 'status', 'non_field_errors'].includes(key))
      .flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).filter(item => typeof item === 'string').map(item => `${fieldLabel(key)}: ${item}`));
    if (fields.length) return fields.join('. ');
    const nonField = body.non_field_errors;
    if (Array.isArray(nonField) && nonField.length) return nonField.join('. ');
  }
  if (status === 401) return 'Tu sesión venció o no es válida. Inicia sesión de nuevo.';
  if (status === 403) return 'No tienes permiso para realizar esta acción.';
  if (status === 404) return 'No se encontró el recurso. Puede que la invitación ya no exista o haya sido usada.';
  if (status === 409) return 'El dato entra en conflicto con otro existente. Revisa si el correo ya está registrado o tiene una invitación pendiente.';
  if (status === 429) return 'Se hicieron demasiadas solicitudes. Espera un momento e inténtalo de nuevo.';
  if (status >= 500) return `La API encontró un error interno (HTTP ${status}). Revisa los registros del servidor.`;
  return `La API rechazó la solicitud (HTTP ${status}) sin indicar el motivo.`;
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = { email: 'Correo', password: 'Contraseña', full_name: 'Nombre completo', placeholder_name: 'Nombre para identificar', manager_id: 'Gestor' };
  return labels[field] || field.replaceAll('_', ' ');
}

export async function login(email: string, password: string) {
  const result = await api<{ access: string; refresh: string; user: Profile }>('/auth/token', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
  await SecureStore.setItemAsync(ACCESS, result.access);
  await SecureStore.setItemAsync(REFRESH, result.refresh);
  return result.user;
}

export async function logout() { await SecureStore.deleteItemAsync(ACCESS); await SecureStore.deleteItemAsync(REFRESH); }
export async function currentUser() { return (await api<ApiEnvelope<Profile>>('/auth/me')).data; }
const PREFS = 'preferences';
export async function getPreferences() {
  try { const value = (await api<ApiEnvelope<{theme:'light'|'dark';font_size:'small'|'normal'|'large';language:'es'|'en'}>>('/preferences')).data; await SecureStore.setItemAsync(PREFS, JSON.stringify(value)); return value; }
  catch { const cached = await SecureStore.getItemAsync(PREFS); return cached ? JSON.parse(cached) : {theme:'light' as const,font_size:'normal' as const,language:'es' as const}; }
}
export async function savePreferences(value: {theme:'light'|'dark';font_size:'small'|'normal'|'large';language:'es'|'en'}) { await SecureStore.setItemAsync(PREFS, JSON.stringify(value)); return (await api<ApiEnvelope<typeof value>>('/preferences', { method:'PATCH', body:JSON.stringify(value) })).data; }
export async function uploadProfileImage(uri: string) { const form = new FormData(); form.append('image', { uri, name: `profile-${Date.now()}.jpg`, type: 'image/jpeg' } as any); return (await api<ApiEnvelope<{profile_image:string}>>('/profile/image', { method:'POST', body:form })).data.profile_image; }
