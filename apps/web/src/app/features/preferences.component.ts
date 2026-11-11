import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { apiErrorMessage } from '../core/api-errors';

type Preferences = { theme: 'light' | 'dark'; font_size: 'small' | 'normal' | 'large'; language: 'es' | 'en' };

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `<section class="card"><h1>Configuración</h1><p>Preferencias sincronizadas con tu cuenta.</p><p>Correo: {{auth.profile()?.email_verified ? 'verificado' : 'pendiente de verificación'}}</p>@if(!auth.profile()?.email_verified){<button class="secondary" (click)="resendVerification()">Reenviar verificación</button>}<label>Tema<select [(ngModel)]="value.theme" (ngModelChange)="save()"><option value="light">Claro</option><option value="dark">Oscuro</option></select></label><label>Tamaño de texto<select [(ngModel)]="value.font_size" (ngModelChange)="save()"><option value="small">Pequeño</option><option value="normal">Normal</option><option value="large">Grande</option></select></label><label>Idioma<select [(ngModel)]="value.language" (ngModelChange)="save()"><option value="es">Español</option><option value="en">English</option></select></label><h2>Foto de perfil</h2>@if(auth.profile()?.profile_image){<img class="profile-photo" [src]="auth.profile()?.profile_image" alt="Foto de perfil">}<label>Subir imagen (JPEG, PNG o WebP, máximo 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" (change)="upload($event)"></label>@if(auth.profile()?.profile_image){<button class="secondary" (click)="removePhoto()">Eliminar foto</button>}@if(message()){<p class="success">{{message()}}</p>}@if(error()){<p class="error">{{error()}}</p>}</section>`
})
export class PreferencesComponent {
  readonly auth = inject(AuthService);
  private api = inject(ApiService);
  readonly message = signal('');
  readonly error = signal('');
  value: Preferences = { theme: 'light', font_size: 'normal', language: 'es' };
  constructor() {
    try { const cached = localStorage.getItem('gc-preferences'); if (cached) { this.value = JSON.parse(cached); this.apply(); } } catch {}
    this.api.get<{data: Preferences}>('/preferences').subscribe(({data}) => { this.value = data; this.apply(); });
  }
  save() { this.apply(); this.api.patch('/preferences', this.value).subscribe(); }
  apply() { document.documentElement.dataset['theme'] = this.value.theme; document.documentElement.dataset['fontSize'] = this.value.font_size; document.documentElement.lang = this.value.language; localStorage.setItem('gc-preferences', JSON.stringify(this.value)); }
  upload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    const form = new FormData(); form.append('image', file);
    this.message.set(''); this.error.set('');
    this.api.upload<{data: {profile_image: string}}>('/profile/image', form).subscribe({next: ({data}) => { this.auth.profile.update(p => p ? {...p, profile_image: data.profile_image} : p); this.message.set('Foto actualizada.'); }, error: e => this.error.set(apiErrorMessage(e))});
  }
  removePhoto() { this.message.set(''); this.error.set(''); this.api.delete('/profile/image').subscribe({next: () => { this.auth.profile.update(p => p ? {...p, profile_image: ''} : p); this.message.set('Foto eliminada.'); }, error: e => this.error.set(apiErrorMessage(e))}); }
  resendVerification() { this.api.post('/auth/resend-verification', {email:this.auth.profile()?.email}).subscribe(() => this.message.set('Si la cuenta requiere verificación, enviamos un enlace al correo registrado.')); }
}
