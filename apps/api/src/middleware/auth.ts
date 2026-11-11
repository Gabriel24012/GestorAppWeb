import type { NextFunction, Request, Response } from 'express';
import { serviceDb, userDb } from '../lib/supabase.js';
import type { AppRole, AuthContext, Profile } from '../types.js';

declare global { namespace Express { interface Request { auth?: AuthContext; } } }

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Token de acceso requerido.' });
  const db = userDb(token);
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Token inválido o expirado.' });
  const { data: profile, error: profileError } = await serviceDb.from('profiles').select('id,email,full_name,role,parent_user_id,is_active,onboarding_completed_at').eq('id', user.id).single<Profile>();
  if (profileError || !profile) return res.status(403).json({ error: 'Cuenta sin perfil asignado.' });
  req.auth = { user, profile, db };
  next();
}

export function authorize(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'No autenticado.' });
    if (!req.auth.profile.is_active) return res.status(403).json({ error: 'Completa la creación de tu cuenta para continuar.' });
    if (!roles.includes(req.auth.profile.role)) return res.status(403).json({ error: 'No tienes permisos para esta operación.' });
    next();
  };
}
