import { z } from 'zod';

const requiredText = (max: number, label = 'Este campo') => z.string()
  .trim()
  .min(1, `${label} es obligatorio.`)
  .max(max, `${label} no puede tener mas de ${max} caracteres.`);
const optionalText = (max: number, label = 'Este campo') => z.string()
  .trim()
  .max(max, `${label} no puede tener mas de ${max} caracteres.`)
  .optional()
  .nullable()
  .transform((v) => v || null);
const optionalPattern = (pattern: RegExp, message: string) => z.string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => v || null)
  .refine((v) => v === null || pattern.test(v), message);
const dateInputPattern = /^(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})$/;
const birthDateSchema = z.string()
  .trim()
  .regex(dateInputPattern, 'Usa el calendario para elegir una fecha valida.')
  .refine(isReasonableBirthDate, 'La fecha de nacimiento debe estar entre hoy y hace 120 anos.');

export const idParam = z.object({ id: z.string().uuid('Identificador invalido.') });
export const inviteTokenParam = z.object({ token: z.string().trim().min(24, 'El enlace esta incompleto.').max(256, 'El enlace no es valido.') });

const personSchema = z.object({
  first_name: requiredText(80, 'Nombre'),
  paternal_surname: requiredText(80, 'Apellido paterno'),
  maternal_surname: optionalText(80, 'Apellido materno'),
  address: requiredText(250, 'Domicilio'),
  exterior_number: optionalText(20, 'No. EXT'),
  neighborhood: optionalText(120, 'Fraccionamiento'),
  district: optionalText(120, 'Distrito'),
  postal_code: optionalPattern(/^\d{5}$/, 'C.P. debe tener 5 digitos.'),
  birth_date: birthDateSchema,
  phone: z.string().regex(/^\d{10}$/, 'El telefono debe tener 10 digitos.'),
  electoral_key: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{18}$/, 'La clave electoral debe contener 18 caracteres alfanumericos.'),
  observations: optionalText(2000, 'Observaciones')
});

export const recordSchema = personSchema;
export const recordPatchSchema = personSchema.partial().extend({ status: z.enum(['active', 'voided']).optional() }).refine((v) => Object.keys(v).length > 0, 'Envia al menos un cambio.');

export const inviteLinkSchema = z.object({
  placeholder_name: requiredText(120, 'Nombre para identificar'),
  email: z.string().trim().email('Escribe un correo valido.').max(255, 'Correo no puede tener mas de 255 caracteres.')
});

export const completeInviteSchema = z.object({
  full_name: requiredText(120, 'Nombre completo'),
  email: z.string().trim().email('Escribe un correo valido.').max(255, 'Correo no puede tener mas de 255 caracteres.'),
  password: z.string().min(8, 'La contrasena debe tener al menos 8 caracteres.').max(128, 'La contrasena no puede tener mas de 128 caracteres.')
});

export const accountSchema = z.object({
  email: z.string().trim().email('Escribe un correo valido.').max(255, 'Correo no puede tener mas de 255 caracteres.'),
  full_name: requiredText(120, 'Nombre completo'),
  manager_id: z.string().uuid('Gestor invalido.').optional()
});
export const accountPatchSchema = z.object({
  full_name: requiredText(120, 'Nombre completo').optional(),
  is_active: z.boolean().optional()
}).refine((v) => Object.keys(v).length > 0, 'Envia al menos un cambio.');

export const managerRecordFiltersSchema = z.object({
  q: z.string().trim().min(1).optional(),
  capturer_id: z.string().uuid('Capturador invalido.').optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inicial invalida.').optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha final invalida.').optional(),
  address: z.string().trim().min(1).optional(),
  district: z.string().trim().min(1).optional(),
  neighborhood: z.string().trim().min(1).optional(),
  postal_code: z.string().trim().regex(/^\d{5}$/, 'C.P. invalido.').optional(),
  section_code: z.string().trim().min(1).optional(),
  status: z.enum(['active', 'voided']).optional(),
  leadership_name: z.string().trim().min(1).optional()
});

const goalBaseSchema = z.object({
  capturer_id: z.preprocess((value) => value === '' || value === undefined ? null : value, z.string().uuid('Capturador invalido.').nullable()),
  period_type: z.enum(['daily', 'weekly', 'monthly']),
  target_count: z.coerce.number().int().min(1, 'La meta debe ser mayor a cero.').max(100000, 'La meta es demasiado alta.'),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inicial invalida.'),
  ends_on: z.preprocess((value) => value === '' || value === undefined ? undefined : value, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha final invalida.').optional())
});

export const goalSchema = goalBaseSchema.refine((value) => !value.ends_on || value.ends_on >= value.starts_on, 'La fecha final no puede ser anterior al inicio.');

export const goalPatchSchema = goalBaseSchema.partial()
  .refine((v) => Object.keys(v).length > 0, 'Envia al menos un cambio.')
  .refine((value) => !value.starts_on || !value.ends_on || value.ends_on >= value.starts_on, 'La fecha final no puede ser anterior al inicio.');

export function toIsoDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [day, month, year] = value.split('/');
  return `${year}-${month}-${day}`;
}

function isReasonableBirthDate(value: string) {
  const iso = toIsoDate(value);
  const parsed = parseIsoDate(iso);
  if (!parsed) return false;
  const today = todayIsoDate();
  const min = addYears(today, -120);
  return iso >= min && iso <= today;
}

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function todayIsoDate() {
  const today = new Date();
  return `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
}

function addYears(isoDate: string, years: number) {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return isoDate;
  return `${parsed.year + years}-${pad2(parsed.month)}-${pad2(parsed.day)}`;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}
