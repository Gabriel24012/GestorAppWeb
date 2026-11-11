import { env } from '../config/env.js';

type InviteEmailInput = {
  to: string;
  inviterName: string;
  inviteeLabel: string;
  role: 'gestor' | 'capturador';
  link: string;
};

export async function sendTeamInviteEmail(input: InviteEmailInput) {
  if (!env.RESEND_API_KEY) {
    throw new EmailDeliveryError('Configura RESEND_API_KEY para enviar invitaciones por correo.');
  }

  const roleLabel = input.role === 'gestor' ? 'gestor' : 'capturador';
  const subject = `Invitacion para unirte como ${roleLabel}`;
  const text = [
    `Hola ${input.inviteeLabel},`,
    '',
    `${input.inviterName} te invito al equipo de Gestion de Captura como ${roleLabel}.`,
    'Abre este enlace para crear tu cuenta:',
    input.link,
    '',
    'Si no esperabas esta invitacion, puedes ignorar este correo.'
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <p>Hola ${escapeHtml(input.inviteeLabel)},</p>
      <p><strong>${escapeHtml(input.inviterName)}</strong> te invito al equipo de Gestion de Captura como ${roleLabel}.</p>
      <p><a href="${escapeAttribute(input.link)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px">Crear cuenta</a></p>
      <p>Si el boton no abre, copia este enlace:</p>
      <p><a href="${escapeAttribute(input.link)}">${escapeHtml(input.link)}</a></p>
      <p style="color:#6b7280;font-size:13px">Si no esperabas esta invitacion, puedes ignorar este correo.</p>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'gestion-captura-web/0.1.0'
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [input.to],
      subject,
      html,
      text
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new EmailDeliveryError(`Resend no pudo enviar el correo (${response.status}): ${resendErrorMessage(detail)}`);
  }
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

function resendErrorMessage(detail: string) {
  try {
    const parsed = JSON.parse(detail) as { message?: string };
    return parsed.message || detail;
  } catch {
    return detail;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => htmlEscapes[char] ?? char);
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};
