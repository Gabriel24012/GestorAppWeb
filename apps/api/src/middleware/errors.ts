import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Recurso no encontrado.' });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) return res.status(422).json({ error: 'Revisa los campos marcados.', details: error.flatten() });
  if (isKnownDatabaseError(error)) return res.status(error.status).json({ error: error.message, field: error.field });
  if (isHttpError(error)) return res.status(error.status).json({ error: error.message, field: error.field });
  console.error(error);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

function isHttpError(error: unknown): error is { status: number; message: string; field?: string } {
  if (!error || typeof error !== 'object') return false;
  const raw = error as { status?: number; message?: string };
  return typeof raw.status === 'number' && raw.status >= 400 && raw.status < 600 && typeof raw.message === 'string';
}

function isKnownDatabaseError(error: unknown): error is { status: number; message: string; field?: string } {
  if (!error || typeof error !== 'object') return false;
  const raw = error as { code?: string; message?: string; status?: number; field?: string };
  const message = String(raw.message ?? '').toLowerCase();

  if (raw.code === '23505' || message.includes('duplicate key')) {
    if (message.includes('profiles_email_key') || message.includes('users_email') || message.includes('email')) {
      Object.assign(raw, { status: 409, message: 'Ese correo ya esta registrado. Usa otro correo o inicia sesion.', field: 'email' });
      return true;
    }
    if (message.includes('records_electoral_key_key') || message.includes('electoral_key')) {
      Object.assign(raw, { status: 409, message: 'La clave electoral ya existe en otro registro.', field: 'electoral_key' });
      return true;
    }
    Object.assign(raw, { status: 409, message: 'Ya existe un registro con esos datos.' });
    return true;
  }

  if (message.includes('already been registered') || message.includes('already registered') || message.includes('user already')) {
    Object.assign(raw, { status: 409, message: 'Ese correo ya esta registrado. Usa otro correo o inicia sesion.', field: 'email' });
    return true;
  }

  if (message.includes('password')) {
    Object.assign(raw, { status: 422, message: 'La contrasena no cumple los requisitos minimos.', field: 'password' });
    return true;
  }

  return false;
}
