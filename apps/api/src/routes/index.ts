import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { serviceDb } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { EmailDeliveryError, sendTeamInviteEmail } from '../lib/email.js';
import { accountPatchSchema, accountSchema, completeInviteSchema, goalPatchSchema, goalSchema, idParam, inviteLinkSchema, inviteTokenParam, managerRecordFiltersSchema, recordPatchSchema, recordSchema, toIsoDate } from '../lib/validation.js';

const router = Router();

router.get('/invites/:token', async (req, res, next) => {
  try {
    const { token } = inviteTokenParam.parse(req.params);
    const hash = tokenHash(token);
    const { data: managerInvite, error: managerInviteError } = await serviceDb
      .from('manager_invites')
      .select('id,placeholder_name,status,admin:profiles!manager_invites_admin_id_fkey(full_name)')
      .eq('token_hash', hash)
      .maybeSingle();
    if (managerInviteError) throw managerInviteError;
    if (managerInvite?.status === 'pending') {
      res.json({ data: { role: 'gestor', placeholder_name: managerInvite.placeholder_name, manager_name: (managerInvite.admin as any)?.full_name ?? null } });
      return;
    }

    const { data, error } = await serviceDb
      .from('capturer_invites')
      .select('id,placeholder_name,status,manager:profiles!capturer_invites_manager_id_fkey(full_name)')
      .eq('token_hash', hash)
      .single();
    if (error || !data || data.status !== 'pending') return res.status(404).json({ error: 'El enlace no es valido o ya fue usado.' });
    res.json({ data: { role: 'capturador', placeholder_name: data.placeholder_name, manager_name: (data.manager as any)?.full_name ?? null } });
  } catch (e) { next(e); }
});

router.post('/invites/:token/complete', async (req, res, next) => {
  try {
    const { token } = inviteTokenParam.parse(req.params);
    const body = completeInviteSchema.parse(req.body);
    const hash = tokenHash(token);
    const { data: managerInvite, error: managerInviteError } = await serviceDb.from('manager_invites').select('*').eq('token_hash', hash).maybeSingle();
    if (managerInviteError) throw managerInviteError;
    if (managerInvite?.status === 'pending') {
      const { data: created, error: createError } = await serviceDb.auth.admin.createUser({
        email: body.email.toLowerCase(),
        password: body.password,
        email_confirm: true,
        user_metadata: { full_name: body.full_name }
      });
      if (createError || !created.user) {
        if (String(createError?.message ?? '').toLowerCase().includes('already')) return res.status(409).json({ error: 'Ese correo ya esta registrado. Usa otro correo o inicia sesion.', field: 'email' });
        throw createError ?? new Error('No se pudo crear el usuario.');
      }
      const { data: profile, error: profileError } = await serviceDb.from('profiles').insert({
        id: created.user.id,
        email: body.email.toLowerCase(),
        full_name: body.full_name,
        role: 'gestor',
        parent_user_id: managerInvite.admin_id,
        is_active: true,
        onboarding_completed_at: new Date().toISOString()
      }).select('id,email,full_name,role,parent_user_id,is_active,onboarding_completed_at').single();
      if (profileError) {
        await serviceDb.auth.admin.deleteUser(created.user.id);
        throw profileError;
      }
      const { error: updateError } = await serviceDb.from('manager_invites').update({
        status: 'used',
        used_by_user_id: created.user.id,
        used_at: new Date().toISOString()
      }).eq('id', managerInvite.id).eq('status', 'pending');
      if (updateError) throw updateError;
      await audit(created.user.id, 'profile', created.user.id, 'complete_manager_invite');
      res.status(201).json({ data: profile });
      return;
    }

    const { data: invite, error: inviteError } = await serviceDb.from('capturer_invites').select('*').eq('token_hash', hash).single();
    if (inviteError || !invite || invite.status !== 'pending') return res.status(404).json({ error: 'El enlace no es valido o ya fue usado.' });

    const { data: created, error: createError } = await serviceDb.auth.admin.createUser({
      email: body.email.toLowerCase(),
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: body.full_name }
    });
    if (createError || !created.user) {
      if (String(createError?.message ?? '').toLowerCase().includes('already')) return res.status(409).json({ error: 'Ese correo ya esta registrado. Usa otro correo o inicia sesion.', field: 'email' });
      throw createError ?? new Error('No se pudo crear el usuario.');
    }

    const { data: profile, error: profileError } = await serviceDb.from('profiles').insert({
      id: created.user.id,
      email: body.email.toLowerCase(),
      full_name: body.full_name,
      role: 'capturador',
      parent_user_id: invite.manager_id,
      is_active: true,
      onboarding_completed_at: new Date().toISOString()
    }).select('id,email,full_name,role,parent_user_id,is_active,onboarding_completed_at').single();
    if (profileError) {
      await serviceDb.auth.admin.deleteUser(created.user.id);
      throw profileError;
    }

    const { error: updateError } = await serviceDb.from('capturer_invites').update({
      status: 'used',
      used_by_user_id: created.user.id,
      used_at: new Date().toISOString()
    }).eq('id', invite.id).eq('status', 'pending');
    if (updateError) throw updateError;

    await audit(created.user.id, 'profile', created.user.id, 'complete_invite');
    res.status(201).json({ data: profile });
  } catch (e) { next(e); }
});

router.use(authenticate);

router.get('/auth/me', (req, res) => res.json({ data: req.auth!.profile }));
router.post('/auth/complete-onboarding', async (req, res, next) => {
  try {
    const { data, error } = await serviceDb.from('profiles')
      .update({ is_active: true, onboarding_completed_at: new Date().toISOString() })
      .eq('id', req.auth!.profile.id)
      .select('id,email,full_name,role,parent_user_id,is_active,onboarding_completed_at')
      .single();
    if (error) throw error;
    await audit(req.auth!.profile.id, 'profile', req.auth!.profile.id, 'complete_onboarding');
    res.json({ data });
  } catch (e) { next(e); }
});

router.get('/gestores', authorize('admin'), async (_req, res, next) => {
  try {
    const [{ data, error }, { data: invites, error: invitesError }] = await Promise.all([
      serviceDb.from('profiles').select('*').eq('role', 'gestor').order('full_name'),
      serviceDb.from('manager_invites').select('id,placeholder_name,recipient_email,status,created_at,used_at').eq('status', 'pending').order('created_at', { ascending: false })
    ]);
    if (error) throw error;
    if (invitesError) throw invitesError;
    res.json({ data: [
      ...(data ?? []).map((item) => ({ ...item, kind: 'profile', status_label: item.is_active ? 'Activo' : 'Inactivo' })),
      ...(invites ?? []).map((item) => ({ id: item.id, kind: 'invite', placeholder_name: item.placeholder_name, email: item.recipient_email, status_label: 'Pendiente', created_at: item.created_at }))
    ] });
  } catch (e) { next(e); }
});

router.get('/admin/managers', authorize('admin'), async (_req, res, next) => {
  try {
    res.json({ data: await adminManagerRows() });
  } catch (e) { next(e); }
});

router.get('/admin/managers/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    res.json({ data: await adminManagerDetail(id) });
  } catch (e) { next(e); }
});

router.get('/admin/record-filter-options', authorize('admin'), async (req, res, next) => {
  try {
    res.json({ data: await recordFilterOptions() });
  } catch (e) { next(e); }
});

router.get('/admin/records', authorize('admin'), async (req, res, next) => {
  try {
    const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
    const limit = z.coerce.number().int().min(1).max(100).default(25).parse(req.query.limit);
    const filters = managerRecordFiltersSchema.extend({ manager_id: z.string().uuid('Gestor invalido.').optional() }).parse(req.query);
    let query = adminRecordsQuery();
    if (filters.manager_id) query = query.eq('manager_id', filters.manager_id);
    query = applyManagerRecordFilters(query, filters);
    const { data, error, count } = await query.order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1);
    if (error) throw error;
    res.json({ data, meta: { page, limit, total: count ?? 0 } });
  } catch (e) { next(e); }
});

router.post('/admin/manager-invite-links', authorize('admin'), async (req, res, next) => {
  try {
    const body = inviteLinkSchema.parse(req.body);
    const token = randomBytes(32).toString('base64url');
    const { data, error } = await serviceDb.from('manager_invites').insert({
      token_hash: tokenHash(token),
      admin_id: req.auth!.profile.id,
      placeholder_name: body.placeholder_name,
      recipient_email: body.email.toLowerCase()
    }).select('id,placeholder_name,recipient_email,status,created_at').single();
    if (error) throw error;
    const link = inviteLink(token);
    const emailWarning = await sendInviteEmailOrWarning({
      to: data.recipient_email,
      inviterName: req.auth!.profile.full_name,
      inviteeLabel: data.placeholder_name,
      role: 'gestor',
      link
    });
    await audit(req.auth!.profile.id, 'manager_invites', data.id, 'create_manager_invite_link');
    res.status(201).json({ data: { ...data, link, email_sent: !emailWarning, warning: emailWarning } });
  } catch (e) { next(e); }
});

router.post('/admin/manager-invites/:id/resend-or-copy', authorize('admin'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const token = randomBytes(32).toString('base64url');
    const { data, error } = await serviceDb.from('manager_invites')
      .update({ token_hash: tokenHash(token) })
      .eq('id', id)
      .eq('admin_id', req.auth!.profile.id)
      .eq('status', 'pending')
      .select('id,placeholder_name,recipient_email,status')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Invitacion pendiente no encontrada.' });
    if (!data.recipient_email) return res.status(422).json({ error: 'Esta invitacion no tiene correo destino. Genera una nueva invitacion con correo.' });
    const link = inviteLink(token);
    const emailWarning = await sendInviteEmailOrWarning({
      to: data.recipient_email,
      inviterName: req.auth!.profile.full_name,
      inviteeLabel: data.placeholder_name,
      role: 'gestor',
      link
    });
    await audit(req.auth!.profile.id, 'manager_invites', id, 'regenerate_manager_invite_link');
    res.json({ data: { ...data, link, email_sent: !emailWarning, warning: emailWarning } });
  } catch (e) { next(e); }
});

router.post('/admin/manager-goals', authorize('admin'), async (req, res, next) => {
  try {
    const body = goalSchema.parse(req.body);
    if (!body.capturer_id) return res.status(422).json({ error: 'Selecciona un gestor.' });
    if (!body.ends_on) return res.status(422).json({ error: 'La fecha final es obligatoria.' });
    await assertManagerExists(body.capturer_id);
    if (body.ends_on < body.starts_on) return res.status(422).json({ error: 'La fecha final no puede ser anterior al inicio.' });
    const { data: existing, error: existingError } = await serviceDb
      .from('capturer_goals')
      .select('id')
      .eq('manager_id', body.capturer_id)
      .is('capturer_id', null)
      .eq('status', 'active')
      .is('archived_at', null)
      .limit(1);
    if (existingError) throw existingError;
    if (existing?.length) return res.status(409).json({ error: 'Este gestor ya tiene una meta principal activa. Modifica o elimina la meta existente.' });
    const period = goalPeriod(body.period_type, body.starts_on, body.ends_on);
    const { data, error } = await serviceDb
      .from('capturer_goals')
      .insert({ manager_id: body.capturer_id, capturer_id: null, period_type: body.period_type, target_count: body.target_count, starts_on: period.starts_on, ends_on: period.ends_on, created_by_role: 'admin' })
      .select('*')
      .single();
    if (error) throw error;
    await audit(req.auth!.profile.id, 'capturer_goals', data.id, 'admin_create_manager_goal');
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

router.patch('/admin/manager-goals/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const body = goalPatchSchema.parse(req.body);
    if (!body.ends_on) return res.status(422).json({ error: 'La fecha final es obligatoria.' });
    const { data: current, error: currentError } = await serviceDb.from('capturer_goals').select('*').eq('id', id).is('capturer_id', null).single();
    if (currentError) throw currentError;
    await assertManagerExists(current.manager_id);
    const period = goalPeriod(body.period_type ?? current.period_type, body.starts_on ?? current.starts_on, body.ends_on);
    if (period.ends_on < period.starts_on) return res.status(422).json({ error: 'La fecha final no puede ser anterior al inicio.' });
    const { data, error } = await serviceDb
      .from('capturer_goals')
      .update({
        period_type: body.period_type ?? current.period_type,
        target_count: body.target_count ?? current.target_count,
        starts_on: period.starts_on,
        ends_on: period.ends_on
      })
      .eq('id', id)
      .is('capturer_id', null)
      .select('*')
      .single();
    if (error) throw error;
    await audit(req.auth!.profile.id, 'capturer_goals', id, 'admin_update_manager_goal');
    res.json({ data });
  } catch (e) { next(e); }
});

router.delete('/admin/manager-goals/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const { error } = await serviceDb.from('capturer_goals').delete().eq('id', id).is('capturer_id', null);
    if (error) throw error;
    await audit(req.auth!.profile.id, 'capturer_goals', id, 'admin_delete_manager_goal');
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post('/gestores', authorize('admin'), async (req, res, next) => {
  try {
    const body = accountSchema.parse(req.body);
    const actor = req.auth!.profile;
    const { data: invited, error: inviteError } = await serviceDb.auth.admin.inviteUserByEmail(body.email, { redirectTo: `${env.APP_URL}/auth/confirm` });
    if (inviteError || !invited.user) throw inviteError ?? new Error('No se pudo invitar al usuario.');
    const { data, error } = await serviceDb.from('profiles').insert({ id: invited.user.id, email: body.email.toLowerCase(), full_name: body.full_name, role: 'gestor', parent_user_id: actor.id, is_active: false }).select().single();
    if (error) throw error;
    await audit(actor.id, 'profile', data.id, 'invite_gestor');
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

router.patch('/gestores/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const body = accountPatchSchema.parse(req.body);
    const { data, error } = await serviceDb.from('profiles').update(body).eq('id', id).eq('role', 'gestor').select().single();
    if (error) throw error;
    await audit(req.auth!.profile.id, 'profile', id, 'update_gestor');
    res.json({ data });
  } catch (e) { next(e); }
});

router.delete('/gestores/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    if (id === req.auth!.profile.id) return res.status(422).json({ error: 'No puedes eliminar tu propio usuario.' });
    const { data, error } = await serviceDb
      .from('profiles')
      .update({ is_active: false })
      .eq('id', id)
      .eq('role', 'gestor')
      .select('id,email,full_name,role,is_active')
      .single();
    if (error) throw error;
    await audit(req.auth!.profile.id, 'profile', id, 'delete_gestor');
    res.json({ data });
  } catch (e) { next(e); }
});

router.post('/gestores/:id/resend-invitation', authorize('admin'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const { data, error } = await serviceDb.from('profiles').select('email,onboarding_completed_at').eq('id', id).eq('role', 'gestor').single();
    if (error) throw error;
    if (data.onboarding_completed_at) return res.status(422).json({ error: 'La cuenta ya fue creada.' });
    await sendActivationLink(data.email);
    await audit(req.auth!.profile.id, 'profile', id, 'resend_invitation');
    res.status(204).end();
  } catch (e) { next(e); }
});

router.get('/capturadores', authorize('admin', 'gestor'), async (req, res, next) => {
  try {
    const actor = req.auth!.profile;
    let capturersQuery = serviceDb.from('profiles').select('id,email,full_name,is_active,onboarding_completed_at,parent_user_id,created_at').eq('role', 'capturador').order('full_name');
    let invitesQuery = serviceDb.from('capturer_invites').select('id,placeholder_name,recipient_email,status,used_by_user_id,created_at,used_at,manager_id').eq('status', 'pending').order('created_at', { ascending: false });
    if (actor.role === 'gestor') {
      capturersQuery = capturersQuery.eq('parent_user_id', actor.id);
      invitesQuery = invitesQuery.eq('manager_id', actor.id);
    }
    const [{ data: capturers, error: capturersError }, { data: invites, error: invitesError }] = await Promise.all([capturersQuery, invitesQuery]);
    if (capturersError) throw capturersError;
    if (invitesError) throw invitesError;
    res.json({ data: [
      ...(capturers ?? []).map((item) => ({ ...item, kind: 'profile', status_label: item.onboarding_completed_at ? 'Perfil completo' : 'Pendiente' })),
      ...(invites ?? []).map((item) => ({ id: item.id, kind: 'invite', placeholder_name: item.placeholder_name, email: item.recipient_email, status_label: 'Pendiente', created_at: item.created_at }))
    ] });
  } catch (e) { next(e); }
});

router.post('/capturadores/invite-links', authorize('gestor'), async (req, res, next) => {
  try {
    const body = inviteLinkSchema.parse(req.body);
    const token = randomBytes(32).toString('base64url');
    const { data, error } = await serviceDb.from('capturer_invites').insert({
      token_hash: tokenHash(token),
      manager_id: req.auth!.profile.id,
      placeholder_name: body.placeholder_name,
      recipient_email: body.email.toLowerCase()
    }).select('id,placeholder_name,recipient_email,status,created_at').single();
    if (error) throw error;
    const link = inviteLink(token);
    const emailWarning = await sendInviteEmailOrWarning({
      to: data.recipient_email,
      inviterName: req.auth!.profile.full_name,
      inviteeLabel: data.placeholder_name,
      role: 'capturador',
      link
    });
    await audit(req.auth!.profile.id, 'capturer_invites', data.id, 'create_invite_link');
    res.status(201).json({ data: { ...data, link, email_sent: !emailWarning, warning: emailWarning } });
  } catch (e) { next(e); }
});

router.post('/capturadores/:id/resend-or-copy', authorize('gestor'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const token = randomBytes(32).toString('base64url');
    const { data, error } = await serviceDb.from('capturer_invites')
      .update({ token_hash: tokenHash(token) })
      .eq('id', id)
      .eq('manager_id', req.auth!.profile.id)
      .eq('status', 'pending')
      .select('id,placeholder_name,recipient_email,status')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Invitacion pendiente no encontrada.' });
    if (!data.recipient_email) return res.status(422).json({ error: 'Esta invitacion no tiene correo destino. Genera una nueva invitacion con correo.' });
    const link = inviteLink(token);
    const emailWarning = await sendInviteEmailOrWarning({
      to: data.recipient_email,
      inviterName: req.auth!.profile.full_name,
      inviteeLabel: data.placeholder_name,
      role: 'capturador',
      link
    });
    await audit(req.auth!.profile.id, 'capturer_invites', id, 'regenerate_invite_link');
    res.json({ data: { ...data, link, email_sent: !emailWarning, warning: emailWarning } });
  } catch (e) { next(e); }
});

router.patch('/capturadores/:id', authorize('admin', 'gestor'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const body = accountPatchSchema.parse(req.body);
    const actor = req.auth!.profile;
    let query = serviceDb.from('profiles').update(body).eq('id', id).eq('role', 'capturador');
    if (actor.role === 'gestor') query = query.eq('parent_user_id', actor.id);
    const { data, error } = await query.select().single();
    if (error) throw error;
    await audit(actor.id, 'profile', id, 'update_capturador');
    res.json({ data });
  } catch (e) { next(e); }
});

router.get('/capture-context', authorize('capturador'), async (req, res, next) => {
  try {
    const { data, error } = await serviceDb.from('profiles').select('id,full_name').eq('id', req.auth!.profile.parent_user_id).eq('role', 'gestor').single();
    if (error) throw error;
    res.json({ data: { manager_id: data.id, leadership_name: data.full_name } });
  } catch (e) { next(e); }
});

router.get('/records', async (req, res, next) => {
  try {
    const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
    const limit = z.coerce.number().int().min(1).max(100).default(25).parse(req.query.limit);
    const filters = z.object({ q: z.string().trim().min(1).optional() }).parse(req.query);
    let query = req.auth!.db.from('records').select('*', { count: 'exact' });
    if (filters.q) query = applyRecordSearch(query, filters.q);
    const { data, error, count } = await query.order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1);
    if (error) throw error;
    res.json({ data, meta: { page, limit, total: count ?? 0 } });
  } catch (e) { next(e); }
});

router.get('/record-suggestions', authorize('capturador', 'gestor', 'admin'), async (req, res, next) => {
  try {
    const params = z.object({
      field: z.enum(['address', 'neighborhood', 'district', 'postal_code']),
      q: z.string().trim().min(2).max(80)
    }).parse(req.query);
    const { data, error } = await req.auth!.db
      .from('records')
      .select(params.field)
      .eq('status', 'active')
      .ilike(params.field, `%${params.q.replace(/[,%]/g, ' ')}%`)
      .limit(25);
    if (error) throw error;
    const suggestions = [...new Set((data ?? [])
      .map((row) => String((row as Record<string, unknown>)[params.field] ?? '').trim())
      .filter(Boolean))]
      .slice(0, 12);
    res.json({ data: suggestions });
  } catch (e) { next(e); }
});

router.post('/records', authorize('capturador'), async (req, res, next) => {
  try {
    const body = recordSchema.parse(req.body);
    const captureSessionId = await ensureDefaultCaptureSession(req.auth!.profile);
    const payload = { ...body, capture_session_id: captureSessionId, birth_date: toIsoDate(body.birth_date) };
    await assertNoDuplicateRecordFields(payload);
    const { data, error } = await req.auth!.db.from('records').insert(payload).select().single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

router.patch('/records/:id', authorize('capturador', 'gestor', 'admin'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const raw = recordPatchSchema.parse(req.body);
    const body = raw.birth_date ? { ...raw, birth_date: toIsoDate(raw.birth_date) } : raw;
    const actor = req.auth!.profile;
    const { data: current, error: currentError } = await serviceDb.from('records').select('id,capturer_id,manager_id').eq('id', id).single();
    if (currentError || !current) return res.status(404).json({ error: 'Registro no encontrado.' });
    if (actor.role === 'capturador' && current.capturer_id !== actor.id) return res.status(403).json({ error: 'No puedes editar este registro.' });
    if (actor.role === 'gestor' && current.manager_id !== actor.id) return res.status(403).json({ error: 'No puedes editar este registro.' });
    await assertNoDuplicateRecordFields(body, id);
    const { data, error } = await serviceDb.from('records').update(body).eq('id', id).select().single();
    if (error) throw error;
    res.json({ data });
  } catch (e) { next(e); }
});

router.delete('/records/:id', authorize('capturador', 'admin'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const actor = req.auth!.profile;
    const { data: record, error: recordError } = await serviceDb.from('records').select('id,capturer_id').eq('id', id).single();
    if (recordError || !record) return res.status(404).json({ error: 'Registro no encontrado.' });
    if (actor.role === 'capturador' && record.capturer_id !== actor.id) return res.status(403).json({ error: 'No puedes eliminar este registro.' });
    const { error: versionsError } = await serviceDb.from('record_versions').delete().eq('record_id', id);
    if (versionsError) throw versionsError;
    const { error } = await serviceDb.from('records').delete().eq('id', id);
    if (error) throw error;
    await audit(actor.id, 'records', id, 'delete_record');
    res.status(204).end();
  } catch (e) { next(e); }
});

router.get('/dashboard/admin', authorize('admin'), async (_req, res, next) => {
  try {
    const [{ count: records }, { count: managers }] = await Promise.all([
      serviceDb.from('records').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      serviceDb.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'gestor')
    ]);
    const { data: performance, error } = await serviceDb.from('profiles').select('id,full_name').eq('role', 'gestor').order('full_name');
    if (error) throw error;
    res.json({ data: { total_records: records ?? 0, total_gestores: managers ?? 0, performance } });
  } catch (e) { next(e); }
});

router.get('/dashboard/gestor', authorize('gestor'), async (req, res, next) => {
  try {
    res.json({ data: await managerOverview(req.auth!.profile.id) });
  } catch (e) { next(e); }
});

router.get('/manager/capturers', authorize('gestor'), async (req, res, next) => {
  try {
    res.json({ data: await managerCapturerRows(req.auth!.profile.id) });
  } catch (e) { next(e); }
});

router.get('/manager/capturers/:id', authorize('gestor'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const managerId = req.auth!.profile.id;
    const { data: capturer, error } = await serviceDb
      .from('profiles')
      .select('id,email,full_name,is_active,onboarding_completed_at,created_at')
      .eq('id', id)
      .eq('role', 'capturador')
      .eq('parent_user_id', managerId)
      .maybeSingle();
    if (error) throw error;

    if (!capturer) {
      const { data: invite, error: inviteError } = await serviceDb
        .from('capturer_invites')
        .select('id,placeholder_name,recipient_email,status,created_at,used_at')
        .eq('id', id)
        .eq('manager_id', managerId)
        .maybeSingle();
      if (inviteError) throw inviteError;
      if (!invite) return res.status(404).json({ error: 'Capturador no encontrado.' });
      res.json({ data: { kind: 'invite', invite, total_records: 0, recent_records: [], top_zones: [], current_goal: null, can_resend_invite: invite.status === 'pending' } });
      return;
    }

    const [{ count: total }, { data: recent, error: recentError }, { data: records, error: recordsError }, activeGoals, teamGoals] = await Promise.all([
      serviceDb.from('records').select('*', { count: 'exact', head: true }).eq('manager_id', managerId).eq('capturer_id', id).eq('status', 'active'),
      serviceDb.from('records').select('id,first_name,paternal_surname,maternal_surname,phone,electoral_key,neighborhood,district,created_at,status').eq('manager_id', managerId).eq('capturer_id', id).order('created_at', { ascending: false }).limit(10),
      serviceDb.from('records').select('id,neighborhood,district,created_at').eq('manager_id', managerId).eq('capturer_id', id).eq('status', 'active'),
      currentGoals(managerId, id),
      currentTeamGoals(managerId)
    ]);
    if (recentError) throw recentError;
    if (recordsError) throw recordsError;
    const goals = activeGoals.map((goal) => ({ ...goal, progress: goalProgress(goal, localDateString(), records ?? []) }));
    const teamGoal = teamGoals[0] ?? null;
    res.json({
      data: {
        kind: 'profile',
        capturer,
        total_records: total ?? 0,
        recent_records: recent ?? [],
        top_zones: topZones(records ?? []),
        current_goal: goals[0] ?? null,
        team_goal: teamGoal ? { ...teamGoal, progress: goalProgress(teamGoal, localDateString(), records ?? []) } : null,
        goals,
        can_resend_invite: !capturer.onboarding_completed_at
      }
    });
  } catch (e) { next(e); }
});

router.get('/manager/goals', authorize('gestor'), async (req, res, next) => {
  try {
    const managerId = req.auth!.profile.id;
    const [{ data: goals, error }, { data: records, error: recordsError }] = await Promise.all([
      serviceDb
      .from('capturer_goals')
      .select('*,capturer:profiles!capturer_goals_capturer_id_fkey(id,full_name,email,is_active)')
      .eq('manager_id', managerId)
      .order('created_at', { ascending: false }),
      serviceDb.from('records').select('id,capturer_id,created_at').eq('manager_id', managerId).eq('status', 'active')
    ]);
    if (error) throw error;
    if (recordsError) throw recordsError;
    const today = localDateString();
    const rows = (goals ?? []).map((goal) => {
      const normalizedGoal = normalizeGoalPeriod(goal);
      return { ...normalizedGoal, progress: goalProgress(normalizedGoal, today, goalRecords(normalizedGoal, records ?? [])) };
    });
    res.json({ data: { active: rows.filter((goal) => goal.status === 'active' && !goal.archived_at), history: rows.filter((goal) => goal.status !== 'active' || goal.archived_at) } });
  } catch (e) { next(e); }
});

router.post('/manager/goals', authorize('gestor'), async (req, res, next) => {
  try {
    const managerId = req.auth!.profile.id;
    const body = goalSchema.parse(req.body);
    if (body.capturer_id) await assertManagerOwnsCapturer(managerId, body.capturer_id);
    const period = goalPeriod(body.period_type, body.starts_on, body.ends_on);
    let archiveQuery = serviceDb
      .from('capturer_goals')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('manager_id', managerId)
      .eq('period_type', body.period_type)
      .eq('status', 'active')
      .is('archived_at', null);
    archiveQuery = body.capturer_id ? archiveQuery.eq('capturer_id', body.capturer_id) : archiveQuery.is('capturer_id', null);
    const { error: archiveError } = await archiveQuery;
    if (archiveError) throw archiveError;
    const { data, error } = await serviceDb
      .from('capturer_goals')
      .insert({ ...body, manager_id: managerId, starts_on: period.starts_on, ends_on: period.ends_on })
      .select('*')
      .single();
    if (error) throw error;
    await audit(managerId, 'capturer_goals', data.id, 'create_goal');
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

router.patch('/manager/goals/:id', authorize('gestor'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const managerId = req.auth!.profile.id;
    const body = goalPatchSchema.parse(req.body);
    const { data: current, error: currentError } = await serviceDb.from('capturer_goals').select('*').eq('id', id).eq('manager_id', managerId).single();
    if (currentError) throw currentError;
    const nextGoal = {
      capturer_id: 'capturer_id' in body ? body.capturer_id : current.capturer_id,
      period_type: body.period_type ?? current.period_type,
      target_count: body.target_count ?? current.target_count,
      starts_on: body.starts_on ?? current.starts_on,
      ends_on: 'ends_on' in body ? body.ends_on : current.ends_on
    };
    if (nextGoal.capturer_id) await assertManagerOwnsCapturer(managerId, nextGoal.capturer_id);
    const period = goalPeriod(nextGoal.period_type, nextGoal.starts_on, nextGoal.ends_on ?? undefined);
    let archiveQuery = serviceDb
      .from('capturer_goals')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('manager_id', managerId)
      .eq('period_type', nextGoal.period_type)
      .eq('status', 'active')
      .is('archived_at', null);
    archiveQuery = nextGoal.capturer_id ? archiveQuery.eq('capturer_id', nextGoal.capturer_id) : archiveQuery.is('capturer_id', null);
    const { error: archiveError } = await archiveQuery;
    if (archiveError) throw archiveError;
    const { data, error } = await serviceDb
      .from('capturer_goals')
      .insert({ ...nextGoal, manager_id: managerId, starts_on: period.starts_on, ends_on: period.ends_on })
      .select('*')
      .single();
    if (error) throw error;
    await audit(managerId, 'capturer_goals', data.id, 'update_goal');
    res.json({ data });
  } catch (e) { next(e); }
});

router.delete('/manager/goals/:id', authorize('gestor'), async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const { error } = await serviceDb.from('capturer_goals').delete().eq('id', id).eq('manager_id', req.auth!.profile.id);
    if (error) throw error;
    await audit(req.auth!.profile.id, 'capturer_goals', id, 'delete_goal');
    res.status(204).end();
  } catch (e) { next(e); }
});

router.get('/manager/record-filter-options', authorize('gestor'), async (req, res, next) => {
  try {
    res.json({ data: await managerRecordFilterOptions(req.auth!.profile.id) });
  } catch (e) { next(e); }
});

router.get('/manager/records', authorize('gestor'), async (req, res, next) => {
  try {
    const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
    const limit = z.coerce.number().int().min(1).max(100).default(25).parse(req.query.limit);
    const filters = managerRecordFiltersSchema.parse(req.query);
    let query = managerRecordsQuery(req.auth!.profile.id);
    query = applyManagerRecordFilters(query, filters);
    const { data, error, count } = await query.order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1);
    if (error) throw error;
    res.json({ data, meta: { page, limit, total: count ?? 0 } });
  } catch (e) { next(e); }
});

router.post('/manager/demo-records', authorize('gestor'), async (req, res, next) => {
  try {
    ensureDemoDataEnabled();
    const body = z.object({ count: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.body ?? {});
    const result = await createDemoRecords(req.auth!.profile.id, body.count);
    await audit(req.auth!.profile.id, 'records', null, 'create_demo_records');
    res.status(201).json({ data: result });
  } catch (e) { next(e); }
});

router.delete('/manager/demo-records', authorize('gestor'), async (req, res, next) => {
  try {
    ensureDemoDataEnabled();
    const result = await deleteDemoRecords(req.auth!.profile.id);
    await audit(req.auth!.profile.id, 'records', null, 'delete_demo_records');
    res.json({ data: result });
  } catch (e) { next(e); }
});

router.get('/exports/records', authorize('admin', 'gestor', 'capturador'), async (req, res, next) => {
  try {
    const format = z.enum(['csv', 'xlsx']).default('csv').parse(req.query.format);
    const filters = managerRecordFiltersSchema.extend({ manager_id: z.string().uuid('Gestor invalido.').optional() }).parse(req.query);
    const db = req.auth!.profile.role === 'capturador' ? req.auth!.db : serviceDb;
    let query = db.from('records').select('id,leadership_name,section_code,first_name,paternal_surname,maternal_surname,address,exterior_number,neighborhood,district,postal_code,birth_date,phone,electoral_key,observations,status,created_at,manager_id,capturer_id,capturer:profiles!records_capturer_id_fkey(full_name,email)');
    if (req.auth!.profile.role === 'admin' && filters.manager_id) query = query.eq('manager_id', filters.manager_id);
    if (req.auth!.profile.role === 'gestor') query = query.eq('manager_id', req.auth!.profile.id);
    if (req.auth!.profile.role === 'capturador') query = query.eq('capturer_id', req.auth!.profile.id);
    query = applyManagerRecordFilters(query, filters);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    await audit(req.auth!.profile.id, 'records', null, `export_${format}`);
    const rows = (data ?? []).map(exportRecordRow);
    if (format === 'csv') { res.type('text/csv').attachment('registros.csv').send(toCsv(rows)); return; }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Registros');
    sheet.columns = Object.keys(rows[0] ?? { id: '' }).map((key) => ({ header: key, key }));
    sheet.addRows(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.attachment('registros.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
});

async function audit(actorId: string, entity: string, entityId: string | null, action: string) {
  await serviceDb.from('audit_events').insert({ actor_id: actorId, entity, entity_id: entityId, action });
}

async function ensureDefaultCaptureSession(profile: { id: string; parent_user_id: string | null }) {
  const { data: existing, error: existingError } = await serviceDb
    .from('capture_sessions')
    .select('id')
    .eq('capturer_id', profile.id)
    .eq('status', 'open')
    .eq('section_code', 'GENERAL')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return existing.id as string;

  if (!profile.parent_user_id) throw new Error('Capturador sin gestor asignado.');
  const { data: manager, error: managerError } = await serviceDb
    .from('profiles')
    .select('id,full_name')
    .eq('id', profile.parent_user_id)
    .eq('role', 'gestor')
    .single();
  if (managerError || !manager) throw managerError ?? new Error('Gestor responsable invalido.');

  const { data: created, error: createError } = await serviceDb
    .from('capture_sessions')
    .insert({
      capturer_id: profile.id,
      manager_id: manager.id,
      leadership_name: manager.full_name,
      section_code: 'GENERAL'
    })
    .select('id')
    .single();
  if (createError) throw createError;
  return created.id as string;
}

async function sendActivationLink(email: string) {
  const { error } = await serviceDb.auth.resetPasswordForEmail(email, { redirectTo: `${env.APP_URL}/auth/confirm` });
  if (error) throw error;
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function inviteLink(token: string) {
  return `${env.APP_URL}/auth/invite/${token}`;
}

async function sendInviteEmailOrWarning(input: Parameters<typeof sendTeamInviteEmail>[0]) {
  try {
    await sendTeamInviteEmail(input);
    return null;
  } catch (error) {
    if (error instanceof EmailDeliveryError) return error.message;
    throw error;
  }
}

type ManagerRecordFilters = z.infer<typeof managerRecordFiltersSchema>;
type GoalPeriodType = 'daily' | 'weekly' | 'monthly';
const demoMarker = '[DEMO-GESTOR]';

function ensureDemoDataEnabled() {
  if (env.ENABLE_DEMO_DATA) return;
  const err = new Error('Los datos demo estan desactivados. Agrega ENABLE_DEMO_DATA=true en .env para usar esta herramienta.');
  Object.assign(err, { status: 403 });
  throw err;
}

async function createDemoRecords(managerId: string, count: number) {
  const { data: capturers, error: capturersError } = await serviceDb
    .from('profiles')
    .select('id,full_name')
    .eq('parent_user_id', managerId)
    .eq('role', 'capturador')
    .eq('is_active', true)
    .order('full_name');
  if (capturersError) throw capturersError;
  if (!capturers?.length) {
    const err = new Error('Necesitas al menos un capturador activo para generar registros demo.');
    Object.assign(err, { status: 422 });
    throw err;
  }

  const now = Date.now();
  const batchId = randomUUID().replace(/-/g, '').toUpperCase();
  const sessionRows = capturers.map((capturer, index) => ({
    capturer_id: capturer.id,
    manager_id: managerId,
    leadership_name: `DEMO ${capturer.full_name}`,
    section_code: `D-${String(index + 1).padStart(3, '0')}`
  }));
  const { data: sessions, error: sessionsError } = await serviceDb
    .from('capture_sessions')
    .insert(sessionRows)
    .select('id,capturer_id,manager_id,leadership_name,section_code');
  if (sessionsError) throw sessionsError;
  if (!sessions?.length) throw new Error('No se pudieron crear sesiones demo.');

  const firstNames = ['Ana', 'Luis', 'Maria', 'Jose', 'Carmen', 'Miguel', 'Sofia', 'Jorge', 'Laura', 'Daniel'];
  const paternalSurnames = ['Garcia', 'Hernandez', 'Martinez', 'Lopez', 'Gonzalez', 'Perez', 'Sanchez', 'Ramirez', 'Torres', 'Flores'];
  const maternalSurnames = ['Cruz', 'Morales', 'Reyes', 'Vargas', 'Castillo', 'Ortiz', 'Rojas', 'Mendoza', 'Aguilar', 'Nunez'];
  const neighborhoods = ['Centro', 'Las Palmas', 'San Miguel', 'El Mirador', 'La Esperanza', 'Jardines'];
  const districts = ['Norte', 'Sur', 'Este', 'Oeste', 'Centro'];
  const records = Array.from({ length: count }, (_, index) => {
    const session = sessions[index % sessions.length];
    const unique = `${batchId.slice(0, 10)}${String(index).padStart(4, '0')}`;
    const phoneSeed = Number(batchId.replace(/\D/g, '').padEnd(6, '7').slice(0, 6));
    const phoneSuffix = String((phoneSeed * 1000 + index) % 100000000).padStart(8, '0');
    const daysAgo = index % 45;
    return {
      capture_session_id: session.id,
      capturer_id: session.capturer_id,
      manager_id: managerId,
      leadership_name: session.leadership_name,
      section_code: session.section_code,
      first_name: firstNames[index % firstNames.length],
      paternal_surname: paternalSurnames[index % paternalSurnames.length],
      maternal_surname: maternalSurnames[index % maternalSurnames.length],
      address: `Calle Demo ${index + 1}`,
      exterior_number: String(100 + index),
      neighborhood: neighborhoods[index % neighborhoods.length],
      district: districts[index % districts.length],
      postal_code: String(64000 + (index % 900)).padStart(5, '0'),
      birth_date: demoBirthDate(index),
      phone: demoPhone(phoneSuffix),
      electoral_key: demoElectoralKey(unique),
      observations: `${demoMarker} Registro generado para pruebas de gestor.`,
      created_at: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString()
    };
  });
  const { error: recordsError } = await serviceDb.from('records').insert(records);
  if (recordsError) throw recordsError;
  return { created: records.length, marker: demoMarker };
}

async function deleteDemoRecords(managerId: string) {
  const { data: records, error: recordsError } = await serviceDb
    .from('records')
    .select('id')
    .eq('manager_id', managerId)
    .ilike('observations', `%${demoMarker}%`);
  if (recordsError) throw recordsError;
  const ids = (records ?? []).map((record) => record.id);
  if (!ids.length) return { deleted: 0, marker: demoMarker };
  const { error: versionsError } = await serviceDb.from('record_versions').delete().in('record_id', ids);
  if (versionsError) throw versionsError;
  const { error: deleteError } = await serviceDb.from('records').delete().in('id', ids).eq('manager_id', managerId);
  if (deleteError) throw deleteError;
  return { deleted: ids.length, marker: demoMarker };
}

async function managerRecordFilterOptions(managerId: string) {
  return recordFilterOptions(managerId);
}

async function recordFilterOptions(managerId?: string) {
  let query = serviceDb
    .from('records')
    .select('address,district,neighborhood,postal_code');
  if (managerId) query = query.eq('manager_id', managerId);
  const { data, error } = await query;
  if (error) throw error;
  return {
    addresses: distinctSorted((data ?? []).map((record) => record.address)),
    districts: distinctSorted((data ?? []).map((record) => record.district)),
    neighborhoods: distinctSorted((data ?? []).map((record) => record.neighborhood)),
    postal_codes: distinctSorted((data ?? []).map((record) => record.postal_code))
  };
}

function distinctSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
}

function demoBirthDate(index: number) {
  const year = 1965 + (index % 35);
  const month = String((index % 12) + 1).padStart(2, '0');
  const day = String((index % 27) + 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function demoPhone(value: string) {
  return `55${value}`.slice(0, 10);
}

function demoElectoralKey(value: string) {
  return `DEMO${value}ABCDEFGH`.slice(0, 18).padEnd(18, '0');
}

async function adminManagerRows() {
  const [{ data: managers, error: managersError }, { data: capturers, error: capturersError }, { data: records, error: recordsError }, { data: goals, error: goalsError }] = await Promise.all([
    serviceDb.from('profiles').select('id,email,full_name,is_active,onboarding_completed_at,created_at').eq('role', 'gestor').order('full_name'),
    serviceDb.from('profiles').select('id,parent_user_id,is_active').eq('role', 'capturador'),
    serviceDb.from('records').select('id,manager_id,created_at,status').eq('status', 'active'),
    serviceDb.from('capturer_goals').select('id,manager_id,capturer_id,period_type,target_count,starts_on,ends_on,status,archived_at,created_by_role,created_at').eq('status', 'active').is('archived_at', null)
  ]);
  if (managersError) throw managersError;
  if (capturersError) throw capturersError;
  if (recordsError) throw recordsError;
  if (goalsError) throw goalsError;
  return (managers ?? []).map((manager) => {
    const managerCapturers = (capturers ?? []).filter((item) => item.parent_user_id === manager.id);
    const managerRecords = (records ?? []).filter((item) => item.manager_id === manager.id);
    const activeGoals = (goals ?? [])
      .filter((item) => item.manager_id === manager.id && !item.capturer_id)
      .map((goal) => ({ ...goal, progress: goalProgress(goal, localDateString(), managerRecords) }))
      .sort((a, b) => Number(b.created_by_role === 'admin') - Number(a.created_by_role === 'admin') || String(b.created_at).localeCompare(String(a.created_at)));
    return {
      ...manager,
      total_capturadores: managerCapturers.length,
      capturadores_activos: managerCapturers.filter((item) => item.is_active).length,
      total_records: managerRecords.length,
      active_goals: activeGoals.length,
      active_goals_list: activeGoals,
      main_goal: activeGoals[0] ?? null,
      last_activity_at: managerRecords.map((item) => item.created_at).sort().at(-1) ?? null
    };
  });
}

async function adminManagerDetail(managerId: string) {
  const [{ data: manager, error: managerError }, { data: capturers, error: capturersError }, { data: records, error: recordsError }, { data: goals, error: goalsError }] = await Promise.all([
    serviceDb.from('profiles').select('id,email,full_name,is_active,onboarding_completed_at,created_at').eq('id', managerId).eq('role', 'gestor').single(),
    serviceDb.from('profiles').select('id,email,full_name,is_active,onboarding_completed_at,created_at').eq('parent_user_id', managerId).eq('role', 'capturador'),
    serviceDb.from('records').select('id,capturer_id,first_name,paternal_surname,phone,neighborhood,district,created_at,status').eq('manager_id', managerId).eq('status', 'active'),
    serviceDb.from('capturer_goals').select('id,capturer_id,period_type,target_count,starts_on,ends_on,status,archived_at,created_by_role,created_at').eq('manager_id', managerId).eq('status', 'active').is('archived_at', null)
  ]);
  if (managerError) throw managerError;
  if (capturersError) throw capturersError;
  if (recordsError) throw recordsError;
  if (goalsError) throw goalsError;
  const rows = records ?? [];
  const ranking = (capturers ?? []).map((capturer) => {
    const capturerRecords = rows.filter((record) => record.capturer_id === capturer.id);
    return {
      ...capturer,
      total_records: capturerRecords.length,
      last_record_at: capturerRecords.map((record) => record.created_at).sort().at(-1) ?? null
    };
  }).sort((a, b) => b.total_records - a.total_records);
  return {
    manager,
    total_records: rows.length,
    total_capturadores: capturers?.length ?? 0,
    active_goals: (goals ?? []).filter((goal) => !goal.capturer_id).length,
    active_goals_list: (goals ?? []).filter((goal) => !goal.capturer_id).map((goal) => ({ ...goal, progress: goalProgress(goal, localDateString(), rows) })),
    ranking,
    top_zones: topZones(rows),
    recent_records: [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10)
  };
}

function adminRecordsQuery() {
  return serviceDb
    .from('records')
    .select('id,leadership_name,section_code,first_name,paternal_surname,maternal_surname,address,exterior_number,neighborhood,district,postal_code,birth_date,phone,electoral_key,observations,status,created_at,manager_id,capturer_id,manager:profiles!records_manager_id_fkey(full_name,email),capturer:profiles!records_capturer_id_fkey(full_name,email)', { count: 'exact' });
}

function managerRecordsQuery(managerId: string) {
  return serviceDb
    .from('records')
    .select('id,leadership_name,section_code,first_name,paternal_surname,maternal_surname,address,exterior_number,neighborhood,district,postal_code,birth_date,phone,electoral_key,observations,status,created_at,manager_id,capturer_id,capturer:profiles!records_capturer_id_fkey(full_name,email)', { count: 'exact' })
    .eq('manager_id', managerId);
}

function applyManagerRecordFilters<T extends {
  eq: (field: string, value: string) => T;
  gte: (field: string, value: string) => T;
  lte: (field: string, value: string) => T;
  or: (filters: string) => T;
}>(query: T, filters: ManagerRecordFilters) {
  let next = query;
  if (filters.q) next = applyManagerRecordSearch(next, filters.q);
  if (filters.capturer_id) next = next.eq('capturer_id', filters.capturer_id);
  if (filters.date_from) next = next.gte('created_at', zonedDateTimeToUtc(filters.date_from, 0, 0, 0).toISOString());
  if (filters.date_to) next = next.lte('created_at', zonedDateTimeToUtc(addDays(filters.date_to, 1), 0, 0, 0).toISOString());
  if (filters.address) next = next.eq('address', filters.address);
  if (filters.district) next = next.eq('district', filters.district);
  if (filters.neighborhood) next = next.eq('neighborhood', filters.neighborhood);
  if (filters.postal_code) next = next.eq('postal_code', filters.postal_code);
  if (filters.section_code) next = next.eq('section_code', filters.section_code.toUpperCase());
  if (filters.status) next = next.eq('status', filters.status);
  if (filters.leadership_name) next = next.eq('leadership_name', filters.leadership_name.toUpperCase());
  return next;
}

async function assertNoDuplicateRecordFields(values: { phone?: string | null; electoral_key?: string | null }, currentId?: string) {
  const filters: string[] = [];
  if (values.phone) filters.push(`phone.eq.${values.phone}`);
  if (values.electoral_key) filters.push(`electoral_key.eq.${values.electoral_key}`);
  if (!filters.length) return;
  let query = serviceDb.from('records').select('id,phone,electoral_key').or(filters.join(',')).limit(1);
  if (currentId) query = query.neq('id', currentId);
  const { data, error } = await query;
  if (error) throw error;
  const duplicate = data?.[0];
  if (!duplicate) return;
  if (values.phone && duplicate.phone === values.phone) {
    const err = new Error('El telefono ya existe en otro registro.');
    Object.assign(err, { status: 409, field: 'phone' });
    throw err;
  }
  if (values.electoral_key && duplicate.electoral_key === values.electoral_key) {
    const err = new Error('La clave electoral ya existe en otro registro.');
    Object.assign(err, { status: 409, field: 'electoral_key' });
    throw err;
  }
}

async function managerOverview(managerId: string) {
  const [{ data: capturers, error: capturersError }, { data: records, error: recordsError }, goals] = await Promise.all([
    serviceDb.from('profiles').select('id,full_name,is_active,onboarding_completed_at').eq('parent_user_id', managerId).eq('role', 'capturador'),
    serviceDb.from('records').select('id,capturer_id,created_at,status,neighborhood,district').eq('manager_id', managerId).eq('status', 'active'),
    currentGoals(managerId)
  ]);
  if (capturersError) throw capturersError;
  if (recordsError) throw recordsError;
  const rows = records ?? [];
  const ranges = recordDateRanges();
  const teamGoals = goals.filter((goal) => !goal.capturer_id);
  const adminGoal = teamGoals.find((goal) => goal.created_by_role === 'admin') ?? null;
  const ownTeamGoal = teamGoals.find((goal) => goal.created_by_role !== 'admin') ?? null;
  const ranking = (capturers ?? []).map((capturer) => {
    const capturerRecords = rows.filter((record) => record.capturer_id === capturer.id);
    const last = capturerRecords.map((record) => record.created_at).sort().at(-1) ?? null;
    return {
      id: capturer.id,
      full_name: capturer.full_name,
      total_records: capturerRecords.length,
      last_record_at: last,
      current_goal: goals.find((goal) => goal.capturer_id === capturer.id) ?? null
    };
  }).sort((a, b) => b.total_records - a.total_records);
  return {
    total_records: rows.length,
    total_capturadores: (capturers ?? []).filter((item) => item.is_active).length,
    records_today: rows.filter((record) => inRange(record.created_at, ranges.today)).length,
    records_week: rows.filter((record) => inRange(record.created_at, ranges.week)).length,
    records_month: rows.filter((record) => inRange(record.created_at, ranges.month)).length,
    admin_goal: adminGoal ? { ...adminGoal, progress: goalProgress(adminGoal, localDateString(), goalRecords(adminGoal, rows)) } : null,
    team_goal: ownTeamGoal ? { ...ownTeamGoal, progress: goalProgress(ownTeamGoal, localDateString(), goalRecords(ownTeamGoal, rows)) } : null,
    top_zones: topZones(rows),
    ranking,
    inactive_alerts: ranking.filter((item) => !item.last_record_at || new Date(item.last_record_at) < ranges.inactiveSince)
  };
}

async function managerCapturerRows(managerId: string) {
  const [{ data: capturers, error: capturersError }, { data: invites, error: invitesError }, { data: records, error: recordsError }, goals] = await Promise.all([
    serviceDb.from('profiles').select('id,email,full_name,is_active,onboarding_completed_at,created_at').eq('parent_user_id', managerId).eq('role', 'capturador').order('full_name'),
    serviceDb.from('capturer_invites').select('id,placeholder_name,recipient_email,status,created_at,used_at').eq('manager_id', managerId).eq('status', 'pending').order('created_at', { ascending: false }),
    serviceDb.from('records').select('id,capturer_id,created_at,status').eq('manager_id', managerId).eq('status', 'active'),
    currentGoals(managerId)
  ]);
  if (capturersError) throw capturersError;
  if (invitesError) throw invitesError;
  if (recordsError) throw recordsError;
  const ranges = recordDateRanges();
  const rows = records ?? [];
  return [
    ...(capturers ?? []).map((capturer) => {
      const capturerRecords = rows.filter((record) => record.capturer_id === capturer.id);
      const goal = goals.find((item) => item.capturer_id === capturer.id) ?? null;
      return {
        kind: 'profile',
        ...capturer,
        status_label: capturer.is_active ? 'Activo' : 'Inactivo',
        total_records: capturerRecords.length,
        records_today: capturerRecords.filter((record) => inRange(record.created_at, ranges.today)).length,
        records_week: capturerRecords.filter((record) => inRange(record.created_at, ranges.week)).length,
        current_goal: goal,
        progress: goal ? goalProgress(goal, localDateString(), capturerRecords) : null
      };
    }),
    ...(invites ?? []).map((invite) => ({
      kind: 'invite',
      id: invite.id,
      placeholder_name: invite.placeholder_name,
      email: invite.recipient_email,
      status_label: 'Pendiente',
      created_at: invite.created_at,
      total_records: 0,
      records_today: 0,
      records_week: 0,
      current_goal: null,
      progress: null
    }))
  ];
}

async function currentGoals(managerId: string, capturerId?: string) {
  let query = serviceDb.from('capturer_goals').select('*').eq('manager_id', managerId).eq('status', 'active').is('archived_at', null).order('created_at', { ascending: false });
  if (capturerId) query = query.eq('capturer_id', capturerId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(normalizeGoalPeriod);
}

async function currentTeamGoals(managerId: string) {
  const { data, error } = await serviceDb
    .from('capturer_goals')
    .select('*')
    .eq('manager_id', managerId)
    .eq('status', 'active')
    .is('archived_at', null)
    .is('capturer_id', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalizeGoalPeriod);
}

async function assertManagerOwnsCapturer(managerId: string, capturerId: string) {
  const { data, error } = await serviceDb.from('profiles').select('id').eq('id', capturerId).eq('role', 'capturador').eq('parent_user_id', managerId).single();
  if (error || !data) {
    const err = new Error('Capturador no encontrado en tu equipo.');
    Object.assign(err, { status: 404 });
    throw err;
  }
}

async function assertManagerExists(managerId: string) {
  const { data, error } = await serviceDb.from('profiles').select('id').eq('id', managerId).eq('role', 'gestor').single();
  if (error || !data) {
    const err = new Error('Gestor no encontrado.');
    Object.assign(err, { status: 404 });
    throw err;
  }
}

function goalProgress(goal: any, today: string, records: { created_at: string }[] = []) {
  const count = records.filter((record) => {
    const recordDate = localDateString(new Date(record.created_at));
    return recordDate >= goal.starts_on && recordDate <= goal.ends_on;
  }).length;
  const percentage = goal.target_count > 0 ? Math.round((count / goal.target_count) * 100) : 0;
  const status = percentage >= 100 ? 'superado' : today > goal.ends_on ? 'bajo' : percentage >= 70 ? 'en progreso' : 'bajo';
  return { count, target: goal.target_count, percentage, status };
}

function goalRecords(goal: any, records: { capturer_id?: string | null; created_at: string }[]) {
  return goal.capturer_id ? records.filter((record) => record.capturer_id === goal.capturer_id) : records;
}

function normalizeGoalPeriod(goal: any) {
  return goal;
}

function goalPeriod(periodType: GoalPeriodType, startsOn: string, endsOn?: string) {
  if (endsOn) return { starts_on: startsOn, ends_on: endsOn };
  if (periodType === 'weekly') {
    const day = localDayOfWeek(startsOn);
    const starts_on = addDays(startsOn, 1 - day);
    return { starts_on, ends_on: addDays(starts_on, 6) };
  }
  if (periodType === 'monthly') {
    const starts_on = `${startsOn.slice(0, 8)}01`;
    return { starts_on, ends_on: addDays(addDays(starts_on, daysInMonth(starts_on)), -1) };
  }
  return { starts_on: startsOn, ends_on: startsOn };
}

function daysInMonth(value: string) {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function recordDateRanges() {
  const today = localDateString();
  const parts = today.split('-').map(Number);
  const localNoon = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
  const day = localNoon.getUTCDay() || 7;
  const weekStart = addDays(today, 1 - day);
  const monthStart = `${today.slice(0, 8)}01`;
  return {
    today: { start: zonedDateTimeToUtc(today, 0, 0, 0), end: zonedDateTimeToUtc(addDays(today, 1), 0, 0, 0) },
    week: { start: zonedDateTimeToUtc(weekStart, 0, 0, 0), end: zonedDateTimeToUtc(addDays(today, 1), 0, 0, 0) },
    month: { start: zonedDateTimeToUtc(monthStart, 0, 0, 0), end: zonedDateTimeToUtc(addDays(today, 1), 0, 0, 0) },
    inactiveSince: zonedDateTimeToUtc(addDays(today, -7), 0, 0, 0)
  };
}

function inRange(value: string, range: { start: Date; end: Date }) {
  const date = new Date(value);
  return date >= range.start && date < range.end;
}

function localDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function zonedDateTimeToUtc(date: string, hour: number, minute: number, second: number) {
  const [year, month, day] = date.split('-').map(Number);
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  for (let i = 0; i < 2; i += 1) {
    const parts = zonedParts(utc);
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    utc = new Date(utc.getTime() + desired - actual);
  }
  return utc;
}

function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function localDayOfWeek(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay() || 7;
}

function topZones(records: { neighborhood?: string | null; district?: string | null }[]) {
  const map = new Map<string, { zone: string; total: number }>();
  for (const record of records) {
    const zone = [record.neighborhood, record.district].filter(Boolean).join(' / ') || 'Sin zona';
    map.set(zone, { zone, total: (map.get(zone)?.total ?? 0) + 1 });
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
}

function exportRecordRow(row: any) {
  return {
    id: row.id,
    capturador: row.capturer?.full_name ?? '',
    liderazgo: row.leadership_name,
    nombre: [row.first_name, row.paternal_surname, row.maternal_surname].filter(Boolean).join(' '),
    domicilio: row.address,
    numero_exterior: row.exterior_number,
    fraccionamiento: row.neighborhood,
    distrito: row.district,
    codigo_postal: row.postal_code,
    fecha_nacimiento: row.birth_date,
    telefono: row.phone,
    clave_electoral: row.electoral_key,
    observaciones: row.observations,
    creado: row.created_at
  };
}

type SearchableQuery<T> = { or: (filters: string) => T };

function searchTokens(value: string) {
  return value.trim().replace(/[,%]/g, ' ').replace(/\s+/g, ' ').split(' ').filter(Boolean);
}

function applyTokenizedSearch<T extends SearchableQuery<T>>(query: T, value: string, fields: string[]) {
  return searchTokens(value).reduce((nextQuery, token) => {
    const filters = fields.map((field) => `${field}.ilike.%${token}%`).join(',');
    return nextQuery.or(filters);
  }, query);
}

function applyRecordSearch<T extends SearchableQuery<T>>(query: T, value: string) {
  const fields = ['first_name', 'paternal_surname', 'maternal_surname', 'phone', 'electoral_key', 'address', 'neighborhood', 'district', 'postal_code', 'leadership_name', 'section_code'];
  return applyTokenizedSearch(query, value, fields);
}

function applyManagerRecordSearch<T extends SearchableQuery<T>>(query: T, value: string) {
  const fields = ['first_name', 'paternal_surname', 'maternal_surname', 'phone', 'electoral_key', 'address', 'neighborhood', 'district', 'postal_code'];
  return applyTokenizedSearch(query, value, fields);
}

function toCsv(rows: Record<string, unknown>[]) {
  const keys = Object.keys(rows[0] ?? {});
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [keys.join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join('\r\n');
}

export default router;
