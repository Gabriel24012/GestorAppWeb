import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiService } from '../core/api.service';
import type { CapturerGoal, GoalPeriod, ManagerCapturerRow, ManagerOverview, ManagerRecordsResponse, RecordItem } from '../core/models';
import { apiErrorMessage } from '../core/api-errors';

const periodLabels: Record<GoalPeriod, string> = { daily: 'Diaria', weekly: 'Semanal', monthly: 'Mensual' };
const managerRecordsStateKey = 'manager-records-state-v1';
const adminGoalSeenKey = 'manager-admin-goal-seen-v1';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="page-title"><h1>Panel del Gestor</h1><a routerLink="/gestor/registros">Ver registros</a></div>
    @if(loading()) {
      <div class="stats manager-stats skeleton-stats">
        @for(item of [1,2,3]; track item) {
          <article><span class="skeleton-line skeleton-number"></span><span class="skeleton-line"></span></article>
        }
      </div>
      <section class="split-grid">
        @for(item of [1,2,3]; track item) {
          <article class="card skeleton-card">
            <span class="skeleton-line skeleton-title"></span>
            <span class="skeleton-line"></span>
            <span class="skeleton-line"></span>
            <span class="skeleton-line skeleton-short"></span>
          </article>
        }
      </section>
    } @else if(data(); as d) {
      @if(adminGoalNotice(); as goal) {
        <section class="card admin-goal-notice">
          <div>
            <strong>Meta asignada por administrador</strong>
            <p>Se te asignó una meta {{periodLabel(goal.period_type)}} de {{goal.target_count}} registros con vigencia del {{dateText(goal.starts_on)}} al {{dateText(goal.ends_on)}}.</p>
          </div>
          <button type="button" class="secondary" (click)="dismissAdminGoalNotice(goal.id)">Entendido</button>
        </section>
      }
      <div class="stats manager-stats">
        <article><strong>{{d.total_records}}</strong><span>Registros del equipo</span></article>
        <article class="period-summary">
          <strong>{{d.records_today}}</strong>
          <span>Capturados hoy</span>
          <div>
            <small>Semana: {{d.records_week}}</small>
            <small>Mes: {{d.records_month}}</small>
          </div>
        </article>
      </div>

      <section class="manager-goal-grid">
        <article class="card goal-summary-card admin-goal-card">
          <span class="goal-pill admin-goal">Admin</span>
          <h2>Meta del administrador</h2>
          @if(d.admin_goal?.progress; as progress) {
            <strong>{{progress.count}} / {{progress.target}}</strong>
            <span>{{periodLabel(d.admin_goal!.period_type)}} - {{dateText(d.admin_goal!.starts_on)}} a {{dateText(d.admin_goal!.ends_on)}}</span>
            <div class="progress"><span [style.width.%]="barWidth(progress.percentage)"></span></div>
            <small>{{progress.percentage}}% - {{progress.status}}</small>
          } @else {
            <p class="muted">Sin meta asignada por administrador.</p>
          }
        </article>
        <article class="card goal-summary-card">
          <span class="goal-pill">Equipo</span>
          <h2>Meta propia del equipo</h2>
          @if(d.team_goal?.progress; as progress) {
            <strong>{{progress.count}} / {{progress.target}}</strong>
            <span>{{periodLabel(d.team_goal!.period_type)}} - {{dateText(d.team_goal!.starts_on)}} a {{dateText(d.team_goal!.ends_on)}}</span>
            <div class="progress"><span [style.width.%]="barWidth(progress.percentage)"></span></div>
            <small>{{progress.percentage}}% - {{progress.status}}</small>
          } @else {
            <p class="muted">Sin meta propia del equipo.</p>
          }
        </article>
      </section>

      <section class="split-grid">
        <article class="card">
          <h2>Ranking de capturadores</h2>
          <table>
            <thead><tr><th>Capturador</th><th>Registros</th><th>Última captura</th></tr></thead>
            <tbody>
              @for(item of d.ranking; track item.id) {
                <tr><td>{{item.full_name}}</td><td>{{item.total_records}}</td><td>{{dateTimeText(item.last_record_at)}}</td></tr>
              } @empty { <tr><td colspan="3">Sin capturadores todavía.</td></tr> }
            </tbody>
          </table>
        </article>

        <article class="card">
          <h2>Ranking por zonas</h2>
          <table>
            <thead><tr><th>Zona</th><th>Registros</th></tr></thead>
            <tbody>
              @for(zone of d.top_zones; track zone.zone) {
                <tr><td>{{zone.zone}}</td><td>{{zone.total}}</td></tr>
              } @empty { <tr><td colspan="2">Sin zonas todavía.</td></tr> }
            </tbody>
          </table>
        </article>

        <article class="card">
          <h2>Alertas de inactividad</h2>
          <div class="alert-list">
            @for(item of d.inactive_alerts; track item.id) {
              <a class="alert-row" [routerLink]="['/gestor/capturadores', item.id]">
                <strong>{{item.full_name}}</strong>
                <span>{{item.last_record_at ? ('Última captura: ' + dateTimeText(item.last_record_at)) : 'Sin registros capturados'}}</span>
              </a>
            } @empty { <p class="muted">No hay alertas por inactividad.</p> }
          </div>
        </article>
      </section>
    }
  `
})
export class ManagerDashboardComponent implements OnInit {
  private api = inject(ApiService);
  data = signal<ManagerOverview | null>(null);
  adminGoalNotice = signal<CapturerGoal | null>(null);
  loading = signal(true);
  ngOnInit() {
    this.api.get<{data: ManagerOverview}>('/dashboard/gestor').pipe(finalize(() => this.loading.set(false))).subscribe((response) => {
      this.data.set(response.data);
      this.prepareAdminGoalNotice(response.data.admin_goal ?? null);
    });
  }
  periodLabel(period: GoalPeriod) { return periodLabels[period]; }
  barWidth(value: number) { return Math.min(value, 100); }
  dateText(value: string | null | undefined) { return formatDateText(value); }
  dateTimeText(value: string | null | undefined) { return formatDateTimeText(value); }
  dismissAdminGoalNotice(goalId: string) {
    localStorage.setItem(adminGoalSeenKey, goalId);
    this.adminGoalNotice.set(null);
  }
  private prepareAdminGoalNotice(goal: CapturerGoal | null) {
    if (!goal) {
      this.adminGoalNotice.set(null);
      return;
    }
    this.adminGoalNotice.set(localStorage.getItem(adminGoalSeenKey) === goal.id ? null : goal);
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="page-title">
      <h1>Capturadores</h1>
      <div class="page-actions">
        <a routerLink="/gestor/capturadores/agregar">Agregar capturador</a>
        <a routerLink="/gestor/metas">Gestionar metas</a>
      </div>
    </div>
    <section class="card table-card">
      <table>
        <thead><tr><th>Nombre</th><th>Total de registros</th><th>Avance de meta</th><th></th></tr></thead>
        <tbody>
          @if(loading()) {
            @for(row of [1,2,3,4]; track row) {
              <tr class="skeleton-table-row"><td><span class="skeleton-line"></span></td><td><span class="skeleton-line skeleton-short"></span></td><td><span class="skeleton-line"></span></td><td><span class="skeleton-line skeleton-action"></span></td></tr>
            }
          } @else {
            @for(item of capturers(); track item.id) {
            <tr>
              <td><div class="member-identity">@if(item.profile_image) {<img class="member-avatar" [src]="item.profile_image" [alt]="'Foto de ' + (item.full_name || item.placeholder_name)">} @else {<span class="member-avatar-fallback">{{initials(item.full_name || item.placeholder_name || '')}}</span>}<span>{{item.full_name || item.placeholder_name || '-'}}</span></div></td>
              <td>{{item.total_records}}</td>
              <td>
                @if(item.progress) {
                  <div class="progress"><span [style.width.%]="barWidth(item.progress.percentage)"></span></div>
                  <small>{{progressText(item.progress)}}</small>
                } @else { <span class="muted">Sin meta</span> }
              </td>
              <td>@if(item.kind === 'profile') {<div class="row-actions"><a class="button-link" [routerLink]="['/gestor/capturadores', item.id]">Ver detalle</a><button type="button" class="danger action-button" (click)="deleteCapturer(item)">Eliminar</button></div>}</td>
            </tr>
            } @empty { <tr><td colspan="4">No hay capturadores registrados.</td></tr> }
          }
        </tbody>
      </table>
    </section>
    @if(message()) {<p class="success">{{message()}}</p>}
    @if(error()) {<p class="error">{{error()}}</p>}
  `
})
export class ManagerCapturersComponent implements OnInit {
  private api = inject(ApiService);
  capturers = signal<ManagerCapturerRow[]>([]);
  loading = signal(true);
  message = signal('');
  error = signal('');
  ngOnInit() {
    this.api.get<{data: ManagerCapturerRow[]}>('/manager/capturers').pipe(finalize(() => this.loading.set(false))).subscribe((response) => this.capturers.set(response.data));
  }
  barWidth(value: number) { return Math.min(value, 100); }
  initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'; }
  progressText(progress: NonNullable<ManagerCapturerRow['progress']>) { return `${progress.count} / ${progress.target} - ${progress.percentage}% - ${progress.status}`; }
  deleteCapturer(item: ManagerCapturerRow) {
    if (!window.confirm(`¿Borrar permanentemente a ${item.full_name || item.email}? La acción no se puede deshacer. Si tiene registros asociados, la API bloqueará el borrado y explicará por qué.`)) return;
    this.error.set('');
    this.api.delete(`/capturadores/${item.id}`).subscribe({
      next: () => { this.message.set('Capturador eliminado permanentemente.'); this.capturers.update(rows => rows.filter(row => row.id !== item.id)); },
      error: (e) => this.error.set(apiErrorMessage(e))
    });
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="page-title"><h1>Registros del equipo</h1><div><button (click)="download('csv')" [disabled]="!total()">CSV filtrado</button><button class="secondary" (click)="download('xlsx')" [disabled]="!total()">Excel filtrado</button></div></div>
    <section class="card demo-tools-card">
      <div>
        <h2>Datos demo</h2>
        <p class="muted">Genera 200 registros marcados como demo para probar filtros, metas, rankings y exportaciones.</p>
      </div>
      <div class="demo-actions">
        <button type="button" (click)="createDemoRecords()" [disabled]="demoLoading()">{{demoLoading() ? 'Procesando...' : 'Generar 200 demo'}}</button>
        <button type="button" class="danger" (click)="deleteDemoRecords()" [disabled]="demoLoading()">Eliminar demo</button>
      </div>
      @if(demoLoading()) {<div class="request-placeholder"><span class="skeleton-line"></span><span class="skeleton-line skeleton-short"></span></div>}
      @if(demoMessage()) {<p class="success">{{demoMessage()}}</p>}
      @if(demoError()) {<p class="error">{{demoError()}}</p>}
    </section>
    <section class="card records-filter-card">
      <form class="filters records-filters" [formGroup]="filters" (ngSubmit)="search()">
        <label>Buscar<input formControlName="q" placeholder="Nombre, teléfono, Clave Electoral o domicilio..."></label>
        <label>Capturador<select formControlName="capturer_id"><option value="">{{capturersLoading() ? 'Cargando capturadores...' : 'Todos'}}</option>@for(c of capturers(); track c.id) {@if(c.kind === 'profile') {<option [value]="c.id">{{c.full_name}}</option>}}</select></label>
        <label>Desde<input type="date" formControlName="date_from"></label>
        <label>Hasta<input type="date" formControlName="date_to"></label>
        <label>Domicilio<select formControlName="address"><option value="">{{filterOptionsLoading() ? 'Cargando domicilios...' : 'Todos'}}</option>@for(option of filterOptions().addresses; track option) {<option [value]="option">{{option}}</option>}</select></label>
        <label>Distrito<select formControlName="district"><option value="">{{filterOptionsLoading() ? 'Cargando distritos...' : 'Todos'}}</option>@for(option of filterOptions().districts; track option) {<option [value]="option">{{option}}</option>}</select></label>
        <label>Fraccionamiento<select formControlName="neighborhood"><option value="">{{filterOptionsLoading() ? 'Cargando fraccionamientos...' : 'Todos'}}</option>@for(option of filterOptions().neighborhoods; track option) {<option [value]="option">{{option}}</option>}</select></label>
        <label>C.P.<select formControlName="postal_code"><option value="">{{filterOptionsLoading() ? 'Cargando C.P....' : 'Todos'}}</option>@for(option of filterOptions().postal_codes; track option) {<option [value]="option">{{option}}</option>}</select></label>
        <label>Mostrar<select [value]="pageSize()" (change)="changePageSize($any($event.target).value)"><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
        <button>Filtrar</button><button type="button" class="secondary" (click)="clear()">Limpiar</button>
      </form>
    </section>
    @if(editingRecord(); as record) {
      <section class="card">
        <div class="page-title">
          <h2>Editar registro</h2>
          <button type="button" class="secondary" (click)="cancelEdit()">Cerrar</button>
        </div>
        <p class="muted">Editando registro de {{record.capturer?.full_name || 'capturador'}}</p>
        <form [formGroup]="recordForm" (ngSubmit)="saveRecord()">
          <div class="grid">
            @for(field of recordFields; track field.key) {
              <label>
                {{field.label}}
                <input [type]="field.type" [formControlName]="field.key" [placeholder]="field.placeholder" [attr.min]="field.min" [attr.max]="field.max">
                @if(recordIssue(field.key)) {<small class="field-error">{{recordIssue(field.key)}}</small>}
              </label>
            }
            <label>Observaciones<textarea formControlName="observations"></textarea></label>
          </div>
          @if(recordMessage()) {<p class="success">{{recordMessage()}}</p>}
          @if(recordError()) {<p class="error">{{recordError()}}</p>}
          <div class="form-actions"><button>Guardar cambios</button></div>
        </form>
      </section>
    }
    <section class="card table-card records-table-card">
      @if(recordsLoading()) {
        <p class="muted"><span class="skeleton-line skeleton-summary"></span></p>
      } @else {
        <p class="muted">{{total()}} registros encontrados. Página {{currentPage()}} de {{totalPages()}}</p>
      }
      <div class="records-table-scroll">
        <table class="records-table">
          <thead><tr><th>Fecha</th><th>Capturador</th><th>Nombre</th><th>Teléfono</th><th>Clave Electoral</th><th>Domicilio</th><th>No. EXT</th><th>Fracc.</th><th>Distrito</th><th>C.P.</th><th>Obs.</th></tr></thead>
          <tbody>
            @if(recordsLoading()) {
              @for(row of [1,2,3,4,5]; track row) {
                <tr class="skeleton-table-row">@for(cell of [1,2,3,4,5,6,7,8,9,10,11]; track cell) {<td><span class="skeleton-line"></span></td>}</tr>
              }
            } @else {
              @for(record of records(); track record.id) {
              <tr class="clickable-row" [class.active]="editingRecord()?.id === record.id" (click)="editRecord(record)">
                <td>{{dateTimeText(record.created_at)}}</td>
                <td>{{record.capturer?.full_name || '-'}}</td>
                <td>{{record.first_name}} {{record.paternal_surname}} {{record.maternal_surname || ''}}</td>
                <td>{{record.phone}}</td>
                <td>{{record.electoral_key}}</td>
                <td>{{record.address}}</td>
                <td>{{record.exterior_number || '-'}}</td>
                <td>{{record.neighborhood || '-'}}</td>
                <td>{{record.district || '-'}}</td>
                <td>{{record.postal_code || '-'}}</td>
                <td>{{record.observations || '-'}}</td>
              </tr>
              } @empty { <tr><td colspan="11">No hay registros con esos filtros.</td></tr> }
            }
          </tbody>
        </table>
      </div>
      <div class="pagination"><button class="secondary" (click)="previousPage()" [disabled]="currentPage() === 1">Anterior</button><button class="secondary" (click)="nextPage()" [disabled]="currentPage() >= totalPages()">Siguiente</button></div>
    </section>
  `
})
export class ManagerRecordsComponent implements OnInit {
  private api = inject(ApiService);
  capturers = signal<ManagerCapturerRow[]>([]);
  records = signal<RecordItem[]>([]);
  capturersLoading = signal(true);
  recordsLoading = signal(true);
  filterOptionsLoading = signal(true);
  filterOptions = signal<{addresses: string[]; districts: string[]; neighborhoods: string[]; postal_codes: string[]}>({ addresses: [], districts: [], neighborhoods: [], postal_codes: [] });
  editingRecord = signal<RecordItem | null>(null);
  recordMessage = signal('');
  recordError = signal('');
  demoMessage = signal('');
  demoError = signal('');
  demoLoading = signal(false);
  total = signal(0);
  currentPage = signal(1);
  pageSize = signal(10);
  totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  filters = new FormGroup({
    q: new FormControl(''), capturer_id: new FormControl(''), date_from: new FormControl(''), date_to: new FormControl(''),
    address: new FormControl(''), district: new FormControl(''), neighborhood: new FormControl(''), postal_code: new FormControl('')
  });
  readonly minBirthDate = this.isoDateYearsAgo(120);
  readonly maxBirthDate = this.todayIsoDate();
  recordForm = new FormGroup({
    first_name: new FormControl('', { nonNullable: true, validators: Validators.required }),
    paternal_surname: new FormControl('', { nonNullable: true, validators: Validators.required }),
    maternal_surname: new FormControl(''),
    address: new FormControl('', { nonNullable: true, validators: Validators.required }),
    exterior_number: new FormControl(''),
    neighborhood: new FormControl(''),
    district: new FormControl(''),
    postal_code: new FormControl('', { nonNullable: true, validators: Validators.pattern(/^\d{5}$/) }),
    birth_date: new FormControl('', { nonNullable: true, validators: [Validators.required, this.birthDateValidator.bind(this)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{10}$/)] }),
    electoral_key: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[A-Za-z0-9]{18}$/)] }),
    observations: new FormControl('')
  });
  recordFields = [
    {key: 'first_name', label: 'Nombre', type: 'text', placeholder: ''},
    {key: 'paternal_surname', label: 'Apellido paterno', type: 'text', placeholder: ''},
    {key: 'maternal_surname', label: 'Apellido materno', type: 'text', placeholder: ''},
    {key: 'address', label: 'Domicilio', type: 'text', placeholder: ''},
    {key: 'exterior_number', label: 'No. EXT', type: 'text', placeholder: ''},
    {key: 'neighborhood', label: 'Fraccionamiento', type: 'text', placeholder: ''},
    {key: 'district', label: 'Distrito', type: 'text', placeholder: ''},
    {key: 'postal_code', label: 'C.P.', type: 'text', placeholder: '5 dígitos'},
    {key: 'birth_date', label: 'Fecha de nacimiento', type: 'date', placeholder: '', min: this.minBirthDate, max: this.maxBirthDate},
    {key: 'phone', label: 'Teléfono', type: 'tel', placeholder: '10 dígitos'},
    {key: 'electoral_key', label: 'Clave Electoral', type: 'text', placeholder: '18 caracteres'}
  ];
  private recordLabels: Record<string, string> = {
    first_name: 'nombre',
    paternal_surname: 'apellido paterno',
    address: 'domicilio',
    postal_code: 'C.P.',
    birth_date: 'fecha de nacimiento',
    phone: 'telefono',
    electoral_key: 'clave electoral'
  };
  ngOnInit() {
    this.api.get<{data: ManagerCapturerRow[]}>('/manager/capturers').pipe(finalize(() => this.capturersLoading.set(false))).subscribe((response) => this.capturers.set(response.data));
    this.restoreState();
    this.loadFilterOptions();
    this.load();
  }
  search() { this.currentPage.set(1); this.saveState(); this.load(); }
  clear() { this.filters.reset(); this.currentPage.set(1); this.pageSize.set(10); sessionStorage.removeItem(managerRecordsStateKey); this.load(); }
  changePageSize(value: string) { this.pageSize.set(Number(value)); this.currentPage.set(1); this.saveState(); this.load(); }
  previousPage() { if (this.currentPage() > 1) { this.currentPage.update((page) => page - 1); this.saveState(); this.load(); } }
  nextPage() { if (this.currentPage() < this.totalPages()) { this.currentPage.update((page) => page + 1); this.saveState(); this.load(); } }
  editRecord(record: RecordItem) {
    this.editingRecord.set(record);
    this.recordMessage.set('');
    this.recordError.set('');
    this.recordForm.reset({
      first_name: this.stringValue(record['first_name']),
      paternal_surname: this.stringValue(record['paternal_surname']),
      maternal_surname: this.stringValue(record['maternal_surname']),
      address: this.stringValue(record['address']),
      exterior_number: this.stringValue(record['exterior_number']),
      neighborhood: this.stringValue(record['neighborhood']),
      district: this.stringValue(record['district']),
      postal_code: this.stringValue(record['postal_code']),
      birth_date: this.inputDate(this.stringValue(record['birth_date'])),
      phone: this.stringValue(record['phone']),
      electoral_key: this.stringValue(record['electoral_key']),
      observations: this.stringValue(record['observations'])
    });
  }
  cancelEdit() {
    this.editingRecord.set(null);
    this.recordMessage.set('');
    this.recordError.set('');
  }
  saveRecord() {
    const current = this.editingRecord();
    if (!current) return;
    if (this.recordForm.invalid) {
      this.recordForm.markAllAsTouched();
      this.recordError.set('Revisa los campos marcados antes de guardar.');
      return;
    }
    const value = this.recordForm.getRawValue();
    this.api.patch<{data: RecordItem}>(`/records/${current.id}`, { ...value, electoral_key: value.electoral_key.toUpperCase() }).subscribe({
      next: (response) => {
        this.recordError.set('');
        this.recordMessage.set('Registro actualizado correctamente.');
        this.editingRecord.set(response.data);
        this.load();
      },
      error: (e) => this.recordError.set(apiErrorMessage(e, this.recordLabels))
    });
  }
  recordIssue(key: string) {
    const control = this.recordForm.get(key);
    if (!control?.invalid || (!control.touched && !control.dirty)) return '';
    const label = this.recordLabels[key] ?? key;
    if (control.errors?.['required']) return `${label} es obligatorio.`;
    if (control.errors?.['birthDateRange']) return `fecha debe estar entre ${this.displayDate(this.minBirthDate)} y ${this.displayDate(this.maxBirthDate)}.`;
    if (control.errors?.['pattern']) return this.patternMessage(key);
    return `Revisa ${label}.`;
  }
  download(format: 'csv'|'xlsx') {
    this.api.download(`/exports/records?${queryString(this.params({ format }))}`).subscribe((blob) => saveBlob(blob, `registros-equipo.${format}`));
  }
  dateTimeText(value: unknown) { return formatDateTimeText(value); }
  createDemoRecords() {
    if (!window.confirm('Se generaran 200 registros demo para este gestor. Deseas continuar?')) return;
    this.demoLoading.set(true);
    this.demoMessage.set('');
    this.demoError.set('');
    this.api.post<{data: {created: number}}>('/manager/demo-records', { count: 200 }).pipe(finalize(() => this.demoLoading.set(false))).subscribe({
      next: (response) => {
        this.demoMessage.set(`${response.data.created} registros demo generados.`);
        this.loadFilterOptions();
        this.load();
      },
      error: (e) => this.demoError.set(apiErrorMessage(e))
    });
  }
  deleteDemoRecords() {
    if (!window.confirm('Se eliminaran solo los registros marcados como demo de este gestor. Deseas continuar?')) return;
    this.demoLoading.set(true);
    this.demoMessage.set('');
    this.demoError.set('');
    this.api.delete<{data: {deleted: number}}>('/manager/demo-records').pipe(finalize(() => this.demoLoading.set(false))).subscribe({
      next: (response) => {
        this.demoMessage.set(`${response.data.deleted} registros demo eliminados.`);
        this.editingRecord.set(null);
        this.loadFilterOptions();
        this.load();
      },
      error: (e) => this.demoError.set(apiErrorMessage(e))
    });
  }
  private load() {
    this.recordsLoading.set(true);
    this.saveState();
    this.api.get<ManagerRecordsResponse>('/manager/records', this.params({ page: this.currentPage(), limit: this.pageSize() })).pipe(finalize(() => this.recordsLoading.set(false))).subscribe((response) => {
      this.records.set(response.data);
      this.total.set(response.meta.total);
    });
  }
  private loadFilterOptions() {
    this.filterOptionsLoading.set(true);
    this.api.get<{data: {addresses: string[]; districts: string[]; neighborhoods: string[]; postal_codes: string[]}}>('/manager/record-filter-options').pipe(finalize(() => this.filterOptionsLoading.set(false))).subscribe((response) => this.filterOptions.set(response.data));
  }
  private restoreState() {
    try {
      const raw = sessionStorage.getItem(managerRecordsStateKey);
      if (!raw) return;
      const state = JSON.parse(raw) as { filters?: Record<string, string>; currentPage?: number; pageSize?: number };
      this.filters.patchValue(state.filters ?? {});
      if (state.currentPage && state.currentPage > 0) this.currentPage.set(state.currentPage);
      if (state.pageSize && [10, 25, 50, 100].includes(state.pageSize)) this.pageSize.set(state.pageSize);
    } catch {
      sessionStorage.removeItem(managerRecordsStateKey);
    }
  }
  private saveState() {
    sessionStorage.setItem(managerRecordsStateKey, JSON.stringify({
      filters: this.filters.getRawValue(),
      currentPage: this.currentPage(),
      pageSize: this.pageSize()
    }));
  }
  private params(extra: Record<string, string | number> = {}) {
    return cleanParams({ ...this.filters.getRawValue(), ...extra });
  }
  private stringValue(value: unknown) { return value ? String(value) : ''; }
  private inputDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
      const [day, month, year] = value.split('/');
      return `${year}-${month}-${day}`;
    }
    return value;
  }
  private displayDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-');
      return `${day}/${month}/${year}`;
    }
    return value;
  }
  private birthDateValidator(control: AbstractControl<string>): ValidationErrors | null {
    const value = control.value;
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { birthDateRange: true };
    if (!this.isRealIsoDate(value)) return { birthDateRange: true };
    return value >= this.minBirthDate && value <= this.maxBirthDate ? null : { birthDateRange: true };
  }
  private todayIsoDate() {
    const today = new Date();
    return this.formatIsoDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
  }
  private isoDateYearsAgo(years: number) {
    const today = new Date();
    return this.formatIsoDate(today.getFullYear() - years, today.getMonth() + 1, today.getDate());
  }
  private isRealIsoDate(value: string) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  private formatIsoDate(year: number, month: number, day: number) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  private patternMessage(key: string) {
    if (key === 'postal_code') return 'C.P. debe tener 5 dígitos';
    if (key === 'phone') return 'teléfono debe tener 10 dígitos';
    if (key === 'electoral_key') return 'clave electoral debe tener 18 letras o numeros';
    return 'formato inválido';
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="page-title"><h1>Metas</h1></div>
    <section class="card">
      <h2>{{editingId() ? 'Actualizar meta' : 'Nueva meta'}}</h2>
      <form class="filters goal-form" [formGroup]="form" (ngSubmit)="save()">
        <label>Alcance<select formControlName="capturer_id"><option value="">{{capturersLoading() ? 'Cargando capturadores...' : 'Selecciona alcance'}}</option><option value="team">Todo el equipo</option>@for(c of capturers(); track c.id) {@if(c.kind === 'profile') {<option [value]="c.id">{{c.full_name}}</option>}}</select></label>
        <label>Periodo<select formControlName="period_type"><option value="daily">Diaria</option><option value="weekly">Semanal</option><option value="monthly">Mensual</option></select></label>
        <label>Meta<input type="number" min="1" formControlName="target_count"></label>
        <label>Inicio<input type="date" formControlName="starts_on"></label>
        <label>Final<input type="date" formControlName="ends_on"></label>
        <div class="form-actions goal-actions">
          <button>{{editingId() ? 'Guardar nueva version' : 'Crear meta'}}</button>
          @if(editingId()) {<button type="button" class="secondary" (click)="cancelEdit()">Cancelar</button>}
        </div>
      </form>
      @if(message()) {<p class="success">{{message()}}</p>}
      @if(error()) {<p class="error">{{error()}}</p>}
    </section>
    <section class="goals-sections">
      <article class="card table-card goals-table-card"><h2>Metas vigentes</h2><ng-container *ngTemplateOutlet="goalsTable; context: {$implicit: active()}"></ng-container></article>
      <article class="card table-card goals-table-card"><h2>Historial</h2><ng-container *ngTemplateOutlet="goalsTable; context: {$implicit: history()}"></ng-container></article>
    </section>
    <ng-template #goalsTable let-items>
      <table class="goals-table"><thead><tr><th>Alcance</th><th>Origen</th><th>Periodo</th><th>Meta</th><th>Vigencia</th><th>Avance</th><th></th></tr></thead><tbody>
        @if(goalsLoading()) {
          @for(row of [1,2,3]; track row) {
            <tr class="skeleton-table-row">@for(cell of [1,2,3,4,5,6,7]; track cell) {<td><span class="skeleton-line"></span></td>}</tr>
          }
        } @else {
          @for(goal of items; track goal.id) {
            <tr [class.admin-goal-row]="goal.created_by_role === 'admin'"><td>{{goalTargetText(goal)}}</td><td><span class="goal-pill" [class.admin-goal]="goal.created_by_role === 'admin'">{{goal.created_by_role === 'admin' ? 'Admin' : 'Gestor'}}</span></td><td>{{periodLabel(goal.period_type)}}</td><td>{{goal.target_count}}</td><td><span class="date-range">{{dateText(goal.starts_on)}}<small>a</small>{{dateText(goal.ends_on)}}</span></td><td><div class="progress"><span [style.width.%]="barWidth(goal.progress?.percentage || 0)"></span></div><small>{{goalProgressText(goal)}}</small></td><td><div class="row-actions">@if(goal.status === 'active' && !goal.archived_at) {<button class="secondary action-button" (click)="edit(goal)">Editar</button>}<button type="button" class="danger action-button" (click)="deleteGoal(goal)">Eliminar</button></div></td></tr>
          } @empty { <tr><td colspan="7">Sin metas.</td></tr> }
        }
      </tbody></table>
    </ng-template>
  `
})
export class ManagerGoalsComponent implements OnInit {
  private api = inject(ApiService);
  capturers = signal<ManagerCapturerRow[]>([]);
  active = signal<CapturerGoal[]>([]);
  history = signal<CapturerGoal[]>([]);
  capturersLoading = signal(true);
  goalsLoading = signal(true);
  editingId = signal('');
  message = signal('');
  error = signal('');
  form = new FormGroup({
    capturer_id: new FormControl('', { nonNullable: true, validators: Validators.required }),
    period_type: new FormControl<GoalPeriod>('weekly', { nonNullable: true, validators: Validators.required }),
    target_count: new FormControl(1, { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
    starts_on: new FormControl(localDateInputValue(), { nonNullable: true, validators: Validators.required }),
    ends_on: new FormControl('')
  });
  ngOnInit() {
    this.api.get<{data: ManagerCapturerRow[]}>('/manager/capturers').pipe(finalize(() => this.capturersLoading.set(false))).subscribe((response) => this.capturers.set(response.data));
    this.load();
  }
  save() {
    if (this.form.invalid) { this.form.markAllAsTouched(); this.error.set('Completa alcance, periodo, meta e inicio.'); return; }
    const request = this.editingId() ? this.api.patch(`/manager/goals/${this.editingId()}`, this.goalPayload()) : this.api.post('/manager/goals', this.goalPayload());
    request.subscribe({ next: () => { this.message.set('Meta guardada correctamente.'); this.error.set(''); this.cancelEdit(); this.load(); }, error: (e) => this.error.set(apiErrorMessage(e)) });
  }
  edit(goal: CapturerGoal) {
    this.editingId.set(goal.id);
    this.form.reset({ capturer_id: goal.capturer_id ?? 'team', period_type: goal.period_type, target_count: goal.target_count, starts_on: goal.starts_on, ends_on: goal.ends_on });
  }
  cancelEdit() { this.editingId.set(''); this.form.reset({ capturer_id: '', period_type: 'weekly', target_count: 1, starts_on: localDateInputValue(), ends_on: '' }); }
  deleteGoal(goal: CapturerGoal) {
    if (!window.confirm(`¿Eliminar la meta de ${this.goalTargetText(goal)}? Esta acción no se puede deshacer.`)) return;
    this.api.delete<void>(`/manager/goals/${goal.id}`).subscribe({
      next: () => { this.message.set('Meta eliminada correctamente.'); this.error.set(''); this.load(); },
      error: (e) => this.error.set(apiErrorMessage(e))
    });
  }
  load() {
    this.goalsLoading.set(true);
    this.api.get<{data: {active: CapturerGoal[]; history: CapturerGoal[]}}>('/manager/goals').pipe(finalize(() => this.goalsLoading.set(false))).subscribe((response) => { this.active.set(response.data.active); this.history.set(response.data.history); });
  }
  periodLabel(period: GoalPeriod) { return periodLabels[period]; }
  barWidth(value: number) { return Math.min(value, 100); }
  dateText(value: string | null | undefined) { return formatDateText(value); }
  goalTargetText(goal: CapturerGoal) { return goal.capturer_id ? (goal.capturer?.full_name || '-') : 'Todo el equipo'; }
  goalProgressText(goal: CapturerGoal) {
    return goal.progress ? `${goal.progress.count} / ${goal.progress.target} - ${goal.progress.percentage}% - ${goal.progress.status}` : '0 / 0 - 0% - -';
  }
  private goalPayload() {
    const value = this.form.getRawValue();
    return { ...value, capturer_id: value.capturer_id === 'team' ? null : value.capturer_id };
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <a routerLink="/gestor/capturadores">Volver a capturadores</a>
    @if(detail(); as d) {
      <section class="card">
        <div class="page-title">
          <div><h1>{{d.capturer?.full_name || d.invite?.placeholder_name}}</h1><p class="muted">{{d.capturer?.email || 'Invitacion pendiente'}}</p></div>
          @if(d.can_resend_invite && d.kind === 'invite') {<button (click)="copyPendingLink(d.invite.id)">Reenviar correo</button>}
        </div>
        <div class="stats">
          <article><strong>{{d.total_records}}</strong><span>Total capturado</span></article>
          <article><strong>{{d.current_goal?.progress?.count || 0}} / {{d.current_goal?.progress?.target || 0}}</strong><span>Meta individual</span></article>
          @if(d.team_goal?.progress; as teamProgress) {
            <article class="team-goal-summary">
              <strong>{{teamProgress.count}} / {{teamProgress.target}}</strong>
              <span>Aporte a meta grupal</span>
              <div class="progress"><span [style.width.%]="barWidth(teamProgress.percentage)"></span></div>
              <small>{{teamProgress.percentage}}% - {{teamProgress.status}}</small>
            </article>
          }
        </div>
      </section>
      <section class="split-grid">
        <article class="card"><h2>Registros recientes</h2><div class="record-list">@for(record of d.recent_records; track record.id) {<div class="record-row"><strong>{{record.first_name}} {{record.paternal_surname}}</strong><span>{{record.phone}}</span><small>{{dateTimeText(record.created_at)}}</small></div>} @empty {<p class="muted">Sin registros recientes.</p>}</div></article>
        <article class="card"><h2>Zonas principales</h2><table><thead><tr><th>Zona</th><th>Registros</th></tr></thead><tbody>@for(zone of d.top_zones; track zone.zone) {<tr><td>{{zone.zone}}</td><td>{{zone.total}}</td></tr>} @empty {<tr><td colspan="2">Sin zonas todavía.</td></tr>}</tbody></table></article>
      </section>
    }
    @if(message()) {<p class="success">{{message()}}</p>}
    @if(error()) {<p class="error">{{error()}}</p>}
  `
})
export class ManagerCapturerDetailComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  detail = signal<any>(null);
  message = signal('');
  error = signal('');
  ngOnInit() { this.load(); }
  barWidth(value: number) { return Math.min(value, 100); }
  dateTimeText(value: unknown) { return formatDateTimeText(value); }
  load() {
    this.api.get<{data: any}>(`/manager/capturers/${this.route.snapshot.paramMap.get('id')}`).subscribe({ next: (response) => this.detail.set(response.data), error: (e) => this.error.set(apiErrorMessage(e)) });
  }
  copyPendingLink(id: string) {
    this.api.post<{data: {link: string}}>(`/capturadores/${id}/resend-or-copy`, {}).subscribe({ next: (response) => { void navigator.clipboard?.writeText(response.data.link); this.message.set('Invitacion reenviada. Link copiado como respaldo.'); }, error: (e) => this.error.set(apiErrorMessage(e)) });
  }
}

function cleanParams(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined && value !== '')) as Record<string, string | number>;
}

function queryString(values: Record<string, string | number>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => params.set(key, String(value)));
  return params.toString();
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateText(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return compactDateText(date);
}

function formatDateTimeText(value: unknown) {
  if (!value) return 'Sin registros';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const time = new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit' }).format(date);
  return `${compactDateText(date)}, ${time}`;
}

function compactDateText(date: Date) {
  const parts = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date);
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  return `${day}/${month}/${year}`;
}
