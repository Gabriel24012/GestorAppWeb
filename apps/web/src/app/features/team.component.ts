import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import type { CapturerMember } from '../core/models';
import { apiErrorMessage } from '../core/api-errors';

const teamLabels: Record<string, string> = {
  full_name: 'nombre completo',
  email: 'correo',
  placeholder_name: 'nombre para identificar'
};

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="page-title">
      <h1>{{auth.profile()?.role === 'admin' ? 'Gestión de equipo' : 'Agregar capturador'}}</h1>
      @if (auth.profile()?.role === 'gestor') {<a routerLink="/gestor/capturadores">Volver a capturadores</a>}
    </div>

    @if (auth.profile()?.role === 'admin') {
      <section class="card">
        <h2>{{editingManagerId() ? 'Editar Gestor' : 'Nuevo Gestor'}}</h2>
        <form [formGroup]="adminForm" (ngSubmit)="editingManagerId() ? saveManager() : createManagerLink()">
          @if(editingManagerId()) {
            <label>Nombre completo<input formControlName="full_name" [disabled]="creatingManager()">@if(issue(adminForm, 'full_name')){<small class="field-error">{{issue(adminForm, 'full_name')}}</small>}</label>
            <label>Correo<input type="email" formControlName="email" disabled></label>
          } @else {
            <label>Nombre para identificar gestor<input formControlName="placeholder_name" [disabled]="creatingManager()">@if(issue(adminForm, 'placeholder_name')){<small class="field-error">{{issue(adminForm, 'placeholder_name')}}</small>}</label>
            <label>Correo del gestor (opcional)<input type="email" formControlName="email" [disabled]="creatingManager()">@if(issue(adminForm, 'email')){<small class="field-error">{{issue(adminForm, 'email')}}</small>}</label>
          }
          @if (editingManagerId() && showIssue(adminForm, 'full_name')) {<p class="form-hint">Completa: {{missingText(adminForm, ['full_name'])}}</p>}
          @if (!editingManagerId() && showIssue(adminForm, 'placeholder_name')) {<p class="form-hint">Completa: {{missingText(adminForm, ['placeholder_name'])}}</p>}
          @if(creatingManager()) {<div class="request-placeholder"><span class="skeleton-line"></span><span class="skeleton-line skeleton-short"></span></div>}
          <div class="form-actions">
            <button [disabled]="creatingManager()">{{creatingManager() ? 'Guardando...' : editingManagerId() ? 'Guardar cambios' : adminForm.controls.email.value ? 'Enviar invitación por correo' : 'Crear invitación sin correo'}}</button>
            @if(editingManagerId()) {<button type="button" class="secondary" (click)="cancelManagerEdit()">Cancelar</button>}
          </div>
        </form>
        @if (generatedLink()) {
          <div class="copy-box">
            <input [value]="generatedLink()" readonly>
            <button type="button" class="secondary" (click)="copy(generatedLink())">Copiar link</button>
          </div>
        }
      </section>
    } @else {
      <section class="card">
        <h2>Nuevo Capturador</h2>
        <form [formGroup]="inviteForm" (ngSubmit)="createInviteLink()">
          <label>Nombre para identificar capturador<input formControlName="placeholder_name" [disabled]="creatingInvite()">@if(issue(inviteForm, 'placeholder_name')){<small class="field-error">{{issue(inviteForm, 'placeholder_name')}}</small>}</label>
          <label>Correo del capturador (opcional)<input type="email" formControlName="email" [disabled]="creatingInvite()">@if(issue(inviteForm, 'email')){<small class="field-error">{{issue(inviteForm, 'email')}}</small>}</label>
          @if (showIssue(inviteForm, 'placeholder_name')) {<p class="form-hint">Completa: {{missingText(inviteForm, ['placeholder_name'])}}</p>}
          @if(creatingInvite()) {<div class="request-placeholder"><span class="skeleton-line"></span><span class="skeleton-line skeleton-short"></span></div>}
          <button [disabled]="creatingInvite()">{{creatingInvite() ? 'Guardando...' : inviteForm.controls.email.value ? 'Enviar invitación por correo' : 'Crear invitación sin correo'}}</button>
        </form>
        @if (generatedLink()) {
          <div class="copy-box">
            <input [value]="generatedLink()" readonly>
            <button type="button" class="secondary" (click)="copy(generatedLink())">Copiar link</button>
          </div>
        }
      </section>
    }

    @if (message()) {<p class="success">{{message()}}</p>}
    @if (error()) {<p class="error">{{error()}}</p>}

    <section class="card">
      <h2>Miembros</h2>
      <table>
        <thead><tr><th>Identificador</th><th>Nombre real</th><th>Correo</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          @if(membersLoading()) {
            @for(row of [1,2,3]; track row) {
              <tr class="skeleton-table-row">@for(cell of [1,2,3,4,5]; track cell) {<td><span class="skeleton-line"></span></td>}</tr>
            }
          } @else {
            @for(item of members(); track item.id) {
              <tr>
                <td>{{item.placeholder_name || item.full_name || '-'}}</td>
                <td>@if(item.kind === 'profile') {<div class="member-identity">@if(item.profile_image) {<img class="member-avatar" [src]="item.profile_image" [alt]="'Foto de ' + item.full_name">} @else {<span class="member-avatar-fallback">{{initials(item.full_name || item.placeholder_name || '')}}</span>}<strong>{{item.full_name || item.placeholder_name}}</strong></div>} @else {-}</td>
                <td>{{item.email || '-'}}</td>
                <td>{{item.status_label}} @if(item.kind === 'profile'){<small>{{item.email_verified ? 'Correo verificado' : 'Verificación pendiente'}}</small>}</td>
                <td>
                  @if(auth.profile()?.role === 'admin' && item.kind === 'profile') {
                    <div class="row-actions"><button class="secondary action-button" (click)="editManager(item)">Editar</button><button class="danger action-button" (click)="deleteManager(item)">Eliminar</button></div>
                  } @else if(auth.profile()?.role === 'admin' && item.kind === 'invite') {
                    <div class="row-actions"><button (click)="resendPendingEmail(item.id, 'manager')" [disabled]="copyingInviteId() === item.id || !item.email">Reenviar correo</button><button class="secondary action-button" (click)="generatePendingLink(item.id, 'manager')" [disabled]="copyingInviteId() === item.id">Generar link</button></div>
                  } @else if(item.kind === 'invite') {
                    <div class="row-actions"><button (click)="resendPendingEmail(item.id, 'capturer')" [disabled]="copyingInviteId() === item.id || !item.email">Reenviar correo</button><button class="secondary action-button" (click)="generatePendingLink(item.id, 'capturer')" [disabled]="copyingInviteId() === item.id">Generar link</button></div>
                  }
                </td>
              </tr>
            } @empty { <tr><td colspan="5">No hay miembros registrados.</td></tr> }
          }
        </tbody>
      </table>
    </section>
  `
})
export class TeamComponent implements OnInit {
  readonly auth = inject(AuthService);
  private api = inject(ApiService);

  members = signal<CapturerMember[]>([]);
  generatedLink = signal('');
  message = signal('');
  error = signal('');
  membersLoading = signal(true);
  creatingManager = signal(false);
  creatingInvite = signal(false);
  copyingInviteId = signal('');
  editingManagerId = signal('');

  initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'; }

  inviteForm = new FormGroup({
    placeholder_name: new FormControl('', { nonNullable: true, validators: Validators.required }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.email] })
  });

  adminForm = new FormGroup({
    full_name: new FormControl('', { nonNullable: true, validators: Validators.required }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.email] }),
    placeholder_name: new FormControl('', { nonNullable: true, validators: Validators.required })
  });

  ngOnInit() {
    this.load();
  }

  load() {
    this.membersLoading.set(true);
    this.api.get<{data: CapturerMember[]}>(this.auth.profile()?.role === 'admin' ? '/gestores' : '/capturadores').pipe(finalize(() => this.membersLoading.set(false))).subscribe({
      next: (response) => this.members.set(response.data),
      error: (e) => this.error.set(apiErrorMessage(e, teamLabels))
    });
  }

  saveManager() {
    if (this.adminForm.controls.full_name.invalid) {
      this.adminForm.controls.full_name.markAsTouched();
      this.error.set('Revisa los campos marcados antes de enviar la invitación.');
      return;
    }
    this.creatingManager.set(true);
    this.error.set('');
    const request = this.editingManagerId()
      ? this.api.patch(`/gestores/${this.editingManagerId()}`, { full_name: this.adminForm.getRawValue().full_name })
      : this.api.post('/gestores', this.adminForm.getRawValue());
    request.pipe(finalize(() => this.creatingManager.set(false))).subscribe({
      next: () => {
        this.error.set('');
        this.message.set(this.editingManagerId() ? 'Gestor actualizado correctamente.' : 'Invitación enviada correctamente.');
        this.editingManagerId.set('');
        this.adminForm.controls.email.enable();
        this.adminForm.reset();
        this.load();
      },
      error: (e) => this.error.set(apiErrorMessage(e, teamLabels))
    });
  }

  createManagerLink() {
    const control = this.adminForm.controls.placeholder_name;
    if (control.invalid || this.adminForm.controls.email.invalid) {
      control.markAsTouched();
      this.adminForm.controls.email.markAsTouched();
      this.error.set('Escribe un nombre para identificar al gestor. El correo es opcional.');
      return;
    }
    this.creatingManager.set(true);
    this.error.set('');
    this.api.post<{data: InviteResponse}>('/admin/manager-invite-links', {
      placeholder_name: control.value,
      email: this.adminForm.controls.email.value
    }).pipe(finalize(() => this.creatingManager.set(false))).subscribe({
      next: (response) => {
        this.generatedLink.set(response.data.link);
        this.message.set(inviteMessage(response.data, 'Invitacion enviada por correo.'));
        this.adminForm.reset();
        this.load();
      },
      error: (e) => this.error.set(apiErrorMessage(e, teamLabels))
    });
  }

  editManager(item: CapturerMember) {
    this.editingManagerId.set(item.id);
    this.adminForm.reset({ full_name: item.full_name || '', email: item.email || '' });
    this.adminForm.controls.email.disable();
  }

  cancelManagerEdit() {
    this.editingManagerId.set('');
    this.adminForm.controls.email.enable();
    this.adminForm.reset();
  }

  deleteManager(item: CapturerMember) {
    if (!window.confirm(`¿Borrar permanentemente al gestor ${item.full_name || item.email}? La acción no se puede deshacer. Si tiene miembros o registros asociados, la API bloqueará el borrado y explicará por qué.`)) return;
    this.api.delete(`/gestores/${item.id}`).subscribe({
      next: () => {
        this.message.set('Gestor eliminado permanentemente.');
        this.load();
      },
      error: (e) => this.error.set(apiErrorMessage(e, teamLabels))
    });
  }

  createInviteLink() {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      this.error.set('Escribe un nombre para identificar al capturador.');
      return;
    }
    this.creatingInvite.set(true);
    this.error.set('');
    this.api.post<{data: InviteResponse}>('/capturadores/invite-links', this.inviteForm.getRawValue()).pipe(finalize(() => this.creatingInvite.set(false))).subscribe({
      next: (response) => {
        this.error.set('');
        this.generatedLink.set(response.data.link);
        this.message.set(inviteMessage(response.data, 'Invitacion enviada por correo.'));
        this.inviteForm.reset();
        this.load();
      },
      error: (e) => this.error.set(apiErrorMessage(e, teamLabels))
    });
  }

  generatePendingLink(id: string, role: 'manager' | 'capturer') {
    this.copyingInviteId.set(id);
    this.error.set('');
    const base = role === 'manager' ? '/admin/manager-invites' : '/capturadores';
    this.api.post<{data: InviteResponse}>(`${base}/${id}/resend-or-copy`, {}).pipe(finalize(() => this.copyingInviteId.set(''))).subscribe({
      next: (response) => {
        this.generatedLink.set(response.data.link);
        this.copy(response.data.link);
        this.message.set('Enlace nuevo generado y copiado. El enlace anterior dejó de ser válido.');
      },
      error: (e) => this.error.set(apiErrorMessage(e, teamLabels))
    });
  }

  resendPendingEmail(id: string, role: 'manager' | 'capturer') {
    this.copyingInviteId.set(id);
    this.error.set('');
    const base = role === 'manager' ? '/admin/manager-invites' : '/capturadores';
    this.api.post<{data: InviteEmailResponse}>(`${base}/${id}/resend-email`, {}).pipe(finalize(() => this.copyingInviteId.set(''))).subscribe({
      next: (response) => {
        this.message.set(response.data.email_sent ? 'Correo de invitación reenviado.' : response.data.warning || 'Resend no pudo enviar el correo. Revisa la consola de la API.');
      },
      error: (e) => this.error.set(apiErrorMessage(e, teamLabels))
    });
  }

  copy(value: string) {
    void navigator.clipboard?.writeText(value);
  }

  issue(form: FormGroup, field: string) {
    const control = form.get(field);
    if (!control?.invalid || (!control.touched && !control.dirty)) return '';
    if (control.errors?.['required']) return `${teamLabels[field]} es obligatorio.`;
    if (control.errors?.['email']) return 'Escribe un correo valido.';
    return `Revisa ${teamLabels[field] ?? field}.`;
  }

  showIssue(form: FormGroup, field: string) {
    const control = form.get(field);
    return !!control?.invalid && (control.touched || control.dirty);
  }

  missingText(form: FormGroup, fields: string[]) {
    return fields
      .filter((field) => form.get(field)?.invalid)
      .map((field) => capitalize(teamLabels[field] ?? field))
      .join(', ');
  }
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

type InviteResponse = { link: string; email_sent?: boolean; warning?: string | null };
type InviteEmailResponse = { email_sent: boolean; warning?: string | null };

function inviteMessage(data: InviteResponse, successText: string) {
  if (data.email_sent === false) return `Invitación creada. ${data.warning || 'Copia y comparte el enlace.'}`;
  return successText;
}
