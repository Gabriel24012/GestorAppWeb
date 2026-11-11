type ErrorObject = Record<string, unknown>;

export function apiErrorMessage(error: unknown, labels: Record<string, string> = {}) {
  const { body, status } = unpack(error);
  const direct = firstString(body['detail']) || firstString(body['message']) || firstString(body['error']);
  if (direct) return direct;

  const fieldMessages = Object.entries(body)
    .filter(([key]) => !['code', 'status', 'non_field_errors'].includes(key))
    .flatMap(([field, value]) => messages(value).map((message) => `${labels[field] ?? humanize(field)}: ${message}`));
  if (fieldMessages.length) return fieldMessages.join('. ');
  const nonField = messages(body['non_field_errors']);
  if (nonField.length) return nonField.join('. ');
  return statusMessage(status);
}

function unpack(error: unknown): { body: ErrorObject; status: number } {
  if (typeof error === 'string') return { body: { detail: error }, status: 0 };
  if (!error || typeof error !== 'object') return { body: {}, status: 0 };
  const http = error as { error?: unknown; status?: number; message?: string };
  let raw = http.error;
  if (raw instanceof Error) raw = { detail: raw.message };
  if (typeof raw === 'string') raw = { detail: raw };
  if (Array.isArray(raw)) raw = { detail: raw.map(String).join('. ') };
  if (!raw || typeof raw !== 'object') raw = {};
  const body = raw as ErrorObject;
  if (!Object.keys(body).length && http.message && http.message !== '[object Object]') body['detail'] = http.message;
  return { body, status: Number(http.status) || 0 };
}

function firstString(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  const nested = messages(value);
  return nested[0] ?? '';
}

function messages(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(messages);
  if (value && typeof value === 'object') {
    const obj = value as ErrorObject;
    return Object.entries(obj).flatMap(([key, item]) => messages(item).map((message) => `${key}: ${message}`));
  }
  return [];
}

function humanize(field: string) {
  return field.replaceAll('_', ' ');
}

function statusMessage(status: number) {
  if (status === 0) return 'No se pudo conectar con la API. Comprueba que el servidor esté iniciado y que la dirección sea correcta.';
  if (status === 401) return 'Tu sesión venció o no es válida. Inicia sesión de nuevo.';
  if (status === 403) return 'No tienes permiso para realizar esta acción.';
  if (status === 404) return 'No se encontró el recurso. Puede que ya no exista o que la invitación haya sido usada.';
  if (status === 409) return 'La acción entra en conflicto con un dato existente. Revisa si el correo ya está registrado o tiene una invitación pendiente.';
  if (status === 429) return 'Se hicieron demasiadas solicitudes. Espera un momento e inténtalo de nuevo.';
  if (status >= 500) return `La API encontró un error interno (HTTP ${status}). Revisa los registros del servidor.`;
  if (status) return `La API rechazó la solicitud (HTTP ${status}) sin indicar el motivo.`;
  return 'La acción falló y no se recibió un motivo desde la API.';
}
