import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiService } from '../core/api.service';
import type { GoalPeriod, ManagerRecordsResponse, RecordItem } from '../core/models';
import { apiErrorMessage } from '../core/api-errors';

const periodLabels: Record<GoalPeriod, string> = { daily: 'Diaria', weekly: 'Semanal', monthly: 'Mensual' };

interface AdminManagerRow {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  total_capturadores: number;
  capturadores_activos: number;
  total_records: number;
  active_goals: number;
  active_goals_list?: AdminGoal[];
  main_goal?: AdminGoal | null;
  last_activity_at: string | null;
}

interface AdminGoal {
  id: string;
  period_type: GoalPeriod;
  target_count: number;
  starts_on: string;
  ends_on: string;
  created_by_role?: 'admin' | 'gestor';
  progress?: { count: number; target: number; percentage: number; status: string };
}

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="page-title"><h1>Gestores</h1><a routerLink="/equipo">Agregar gestor</a></div>
    @if(error()) {<p class="error">{{error()}}</p>}
    @if(loading()) {
      <section class="card"><div class="request-placeholder"><span class="skeleton-line"></span><span class="skeleton-line skeleton-short"></span></div></section>
    } @else {
      <div class="stats manager-stats">
        <article><strong>{{totalRecords()}}</strong><span>Registros activos</span></article>
        <article><strong>{{managers().length}}</strong><span>Gestores</span></article>
        <article><strong>{{activeManagers()}}</strong><span>Gestores activos</span></article>
      </div>
      <section class="card table-card">
        <table>
          <thead><tr><th>Gestor</th><th>Capturadores</th><th>Registros</th><th>Meta principal</th><th>Ultimo movimiento</th><th></th></tr></thead>
          <tbody>
            @for(manager of managers(); track manager.id) {
              <tr>
                <td><strong>{{manager.full_name}}</strong><br><small class="muted">{{manager.email}}</small></td>
                <td>{{manager.capturadores_activos}} / {{manager.total_capturadores}}</td>
                <td>{{manager.total_records}}</td>
                <td>
                  @if(manager.main_goal; as goal) {
                    <span class="goal-pill" [class.admin-goal]="goal.created_by_role === 'admin'">{{goal.progress?.count || 0}} / {{goal.target_count}}</span>
                    <div class="progress"><span [style.width.%]="barWidth(goal.progress?.percentage || 0)"></span></div>
                  } @else { <span class="muted">Sin meta</span> }
                </td>
                <td>{{dateTimeText(manager.last_activity_at)}}</td>
                <td><div class="row-actions"><a class="button-link" [routerLink]="['/admin/gestores', manager.id]">Ver detalle</a><button type="button" class="danger action-button" (click)="deleteManager(manager)">Eliminar</button></div></td>
              </tr>
            } @empty { <tr><td colspan="6">No hay gestores registrados.</td></tr> }
          </tbody>
        </table>
      </section>
    }
  `
})
export class AdminDashboardComponent implements OnInit {
  private api = inject(ApiService);
  managers = signal<AdminManagerRow[]>([]);
  loading = signal(true);
  error = signal('');
  totalRecords = computed(() => this.managers().reduce((sum, manager) => sum + manager.total_records, 0));
  activeManagers = computed(() => this.managers().filter((manager) => manager.is_active).length);
  ngOnInit() {
    this.api.get<{data: AdminManagerRow[]}>('/admin/managers').pipe(finalize(() => this.loading.set(false))).subscribe((response) => this.managers.set(response.data));
  }
  barWidth(value: number) { return Math.min(value, 100); }
  dateTimeText(value: unknown) { return formatDateTimeText(value); }
  deleteManager(manager: AdminManagerRow) {
    if (!window.confirm(`¿Borrar permanentemente al gestor ${manager.full_name}? La acción no se puede deshacer. Si tiene miembros o registros asociados, el servidor impedirá el borrado y explicará por qué.`)) return;
    this.error.set('');
    this.api.delete(`/gestores/${manager.id}`).subscribe({
      next: () => this.managers.update(rows => rows.filter(row => row.id !== manager.id)),
      error: (e) => this.error.set(apiErrorMessage(e))
    });
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <a routerLink="/admin">Volver a gestores</a>
    @if(detail(); as d) {
      <section class="card">
        <div class="page-title">
          <div><h1>{{d.manager.full_name}}</h1><p class="muted">{{d.manager.email}}</p></div>
          <a routerLink="/admin/registros" [queryParams]="{manager_id: d.manager.id}">Ver registros</a>
        </div>
        <div class="stats manager-stats">
          <article><strong>{{d.total_records}}</strong><span>Registros</span></article>
          <article><strong>{{d.total_capturadores}}</strong><span>Capturadores</span></article>
          <article><strong>{{d.active_goals}}</strong><span>Metas activas</span></article>
        </div>
      </section>
      <section class="card table-card goals-list-card">
        <div class="page-title"><h2>Metas del gestor</h2></div>
        @if(editingGoalId()) {
          <form class="filters goal-form" [formGroup]="goalForm" (ngSubmit)="saveGoal()">
            <label>Periodo<select formControlName="period_type"><option value="daily">Diaria</option><option value="weekly">Semanal</option><option value="monthly">Mensual</option></select></label>
            <label>Meta de registros<input type="number" min="1" formControlName="target_count"></label>
            <label>Inicio<input type="date" formControlName="starts_on"></label>
            <label>Final<input type="date" formControlName="ends_on"></label>
            <div class="form-actions goal-actions"><button [disabled]="goalSaving()">{{goalSaving() ? 'Guardando...' : 'Guardar cambios'}}</button><button type="button" class="secondary" (click)="cancelGoalEdit()">Cancelar</button></div>
          </form>
        }
        @if(goalMessage()) {<p class="success">{{goalMessage()}}</p>}
        @if(goalError()) {<p class="error">{{goalError()}}</p>}
        <table>
          <thead><tr><th>Origen</th><th>Periodo</th><th>Vigencia</th><th>Avance</th><th></th></tr></thead>
          <tbody>
            @for(goal of d.active_goals_list || []; track goal.id) {
              <tr [class.admin-goal-row]="goal.created_by_role === 'admin'">
                <td><span class="goal-pill" [class.admin-goal]="goal.created_by_role === 'admin'">{{goal.created_by_role === 'admin' ? 'Admin' : 'Gestor'}}</span></td>
                <td>{{periodLabel(goal.period_type)}} - {{goal.target_count}} registros</td>
                <td><span class="date-range">{{dateText(goal.starts_on)}}<small>a</small>{{dateText(goal.ends_on)}}</span></td>
                <td><div class="progress"><span [style.width.%]="barWidth(goal.progress?.percentage || 0)"></span></div><small>{{goal.progress?.count || 0}} / {{goal.target_count}} - {{goal.progress?.percentage || 0}}%</small></td>
                <td><div class="row-actions"><button class="secondary action-button" (click)="editGoal(goal)">Editar</button><button class="danger action-button" (click)="deleteGoal(goal)">Eliminar</button></div></td>
              </tr>
            } @empty {<tr><td colspan="5">Sin metas activas.</td></tr>}
          </tbody>
        </table>
      </section>
      <section class="split-grid">
        <article class="card">
          <h2>Ranking de capturadores</h2>
          @if(deleteError()) {<p class="error">{{deleteError()}}</p>}
          <table><thead><tr><th>Capturador</th><th>Registros</th><th>Última captura</th><th></th></tr></thead><tbody>
            @for(item of d.ranking; track item.id) {
              <tr><td>{{item.full_name}}</td><td>{{item.total_records}}</td><td>{{dateTimeText(item.last_record_at)}}</td><td><button type="button" class="danger action-button" (click)="deleteCapturer(item)">Eliminar</button></td></tr>
            } @empty { <tr><td colspan="4">Sin capturadores.</td></tr> }
          </tbody></table>
        </article>
        <article class="card">
          <h2>Zonas principales</h2>
          <table><thead><tr><th>Zona</th><th>Registros</th></tr></thead><tbody>
            @for(zone of d.top_zones; track zone.zone) {<tr><td>{{zone.zone}}</td><td>{{zone.total}}</td></tr>}
            @empty {<tr><td colspan="2">Sin zonas.</td></tr>}
          </tbody></table>
        </article>
      </section>
    }
  `
})
export class AdminManagerDetailComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  detail = signal<any>(null);
  editingGoalId = signal('');
  goalSaving = signal(false);
  goalMessage = signal('');
  goalError = signal('');
  deleteError = signal('');
  goalForm = new FormGroup({
    period_type: new FormControl<GoalPeriod>('weekly', { nonNullable: true, validators: Validators.required }),
    target_count: new FormControl(1, { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
    starts_on: new FormControl(localDateInputValue(), { nonNullable: true, validators: Validators.required }),
    ends_on: new FormControl('', { nonNullable: true, validators: Validators.required })
  });
  ngOnInit() {
    this.load();
  }
  periodLabel(period: GoalPeriod) { return periodLabels[period]; }
  barWidth(value: number) { return Math.min(value, 100); }
  dateText(value: string | null | undefined) { return formatDateText(value); }
  dateTimeText(value: string | null | undefined) { return formatDateTimeText(value); }
  editGoal(goal: AdminGoal) {
    this.editingGoalId.set(goal.id);
    this.goalError.set('');
    this.goalMessage.set('');
    this.goalForm.reset({ period_type: goal.period_type, target_count: goal.target_count, starts_on: goal.starts_on, ends_on: goal.ends_on });
  }
  cancelGoalEdit() {
    this.editingGoalId.set('');
    this.goalForm.reset({ period_type: 'weekly', target_count: 1, starts_on: localDateInputValue(), ends_on: '' });
  }
  saveGoal() {
    if (this.goalForm.invalid) {
      this.goalForm.markAllAsTouched();
      this.goalError.set('Completa periodo, meta, inicio y final.');
      return;
    }
    this.goalSaving.set(true);
    this.api.patch(`/admin/manager-goals/${this.editingGoalId()}`, this.goalForm.getRawValue()).pipe(finalize(() => this.goalSaving.set(false))).subscribe({
      next: () => { this.goalMessage.set('Meta actualizada correctamente.'); this.cancelGoalEdit(); this.load(); },
      error: (e) => this.goalError.set(apiErrorMessage(e))
    });
  }
  deleteGoal(goal: AdminGoal) {
    if (!window.confirm('Eliminar esta meta?')) return;
    this.api.delete(`/admin/manager-goals/${goal.id}`).subscribe({
      next: () => { this.goalMessage.set('Meta eliminada correctamente.'); this.load(); },
      error: (e) => this.goalError.set(apiErrorMessage(e))
    });
  }
  deleteCapturer(item: { id: string; full_name: string }) {
    if (!window.confirm(`¿Borrar permanentemente a ${item.full_name}? La acción no se puede deshacer. Si tiene registros asociados, el servidor impedirá el borrado y explicará por qué.`)) return;
    this.deleteError.set('');
    this.api.delete(`/capturadores/${item.id}`).subscribe({
      next: () => { this.deleteError.set('Capturador eliminado permanentemente.'); this.load(); },
      error: (e) => this.deleteError.set(apiErrorMessage(e))
    });
  }
  private load() {
    this.api.get<{data: any}>(`/admin/managers/${this.route.snapshot.paramMap.get('id')}`).subscribe((response) => this.detail.set(response.data));
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="page-title"><h1>Registros globales</h1><div><button (click)="download('csv')" [disabled]="!total()">CSV filtrado</button><button class="secondary" (click)="download('xlsx')" [disabled]="!total()">Excel filtrado</button></div></div>
    <section class="card records-filter-card">
      <form class="filters records-filters" [formGroup]="filters" (ngSubmit)="search()">
        <label>Buscar<input formControlName="q" placeholder="Nombre, teléfono, Clave Electoral o domicilio..."></label>
        <label>Gestor<select formControlName="manager_id"><option value="">Todos</option>@for(manager of managers(); track manager.id) {<option [value]="manager.id">{{manager.full_name}}</option>}</select></label>
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
        <p class="muted">Editando registro de {{record.capturer?.full_name || 'capturador'}} asignado a {{record.manager?.full_name || 'gestor'}}</p>
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
          <thead><tr><th>Fecha</th><th>Gestor</th><th>Capturador</th><th>Nombre</th><th>Teléfono</th><th>Clave Electoral</th><th>Fracc.</th><th>Distrito</th><th>C.P.</th></tr></thead>
          <tbody>
            @if(recordsLoading()) {
              @for(row of [1,2,3,4,5]; track row) {
                <tr class="skeleton-table-row">@for(cell of [1,2,3,4,5,6,7,8,9]; track cell) {<td><span class="skeleton-line"></span></td>}</tr>
              }
            } @else {
              @for(record of records(); track record.id) {
                <tr class="clickable-row" [class.active]="editingRecord()?.id === record.id" (click)="editRecord(record)"><td>{{dateTimeText(record.created_at)}}</td><td>{{record.manager?.full_name || '-'}}</td><td>{{record.capturer?.full_name || '-'}}</td><td>{{record.first_name}} {{record.paternal_surname}} {{record.maternal_surname || ''}}</td><td>{{record.phone}}</td><td>{{record.electoral_key}}</td><td>{{record.neighborhood || '-'}}</td><td>{{record.district || '-'}}</td><td>{{record.postal_code || '-'}}</td></tr>
              } @empty {<tr><td colspan="9">No hay registros con esos filtros.</td></tr>}
            }
          </tbody>
        </table>
      </div>
      <div class="pagination"><button class="secondary" (click)="previousPage()" [disabled]="currentPage() === 1">Anterior</button><button class="secondary" (click)="nextPage()" [disabled]="currentPage() >= totalPages()">Siguiente</button></div>
    </section>
  `
})
export class AdminRecordsComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  managers = signal<AdminManagerRow[]>([]);
  records = signal<RecordItem[]>([]);
  recordsLoading = signal(true);
  filterOptionsLoading = signal(true);
  filterOptions = signal<{addresses: string[]; districts: string[]; neighborhoods: string[]; postal_codes: string[]}>({ addresses: [], districts: [], neighborhoods: [], postal_codes: [] });
  editingRecord = signal<RecordItem | null>(null);
  recordMessage = signal('');
  recordError = signal('');
  total = signal(0);
  currentPage = signal(1);
  pageSize = signal(10);
  totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  filters = new FormGroup({
    q: new FormControl(''), manager_id: new FormControl(''), date_from: new FormControl(''), date_to: new FormControl(''),
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
    {key: 'postal_code', label: 'C.P.', type: 'text', placeholder: '5 digitos'},
    {key: 'birth_date', label: 'Fecha de nacimiento', type: 'date', placeholder: '', min: this.minBirthDate, max: this.maxBirthDate},
    {key: 'phone', label: 'Telefono', type: 'tel', placeholder: '10 digitos'},
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
    this.api.get<{data: AdminManagerRow[]}>('/admin/managers').subscribe((response) => this.managers.set(response.data));
    this.loadFilterOptions();
    const managerId = this.route.snapshot.queryParamMap.get('manager_id');
    if (managerId) this.filters.patchValue({ manager_id: managerId });
    this.load();
  }
  search() { this.currentPage.set(1); this.cancelEdit(); this.load(); }
  clear() { this.filters.reset(); this.currentPage.set(1); this.cancelEdit(); this.load(); }
  changePageSize(value: string) { this.pageSize.set(Number(value)); this.currentPage.set(1); this.load(); }
  previousPage() { if (this.currentPage() > 1) { this.currentPage.update((page) => page - 1); this.load(); } }
  nextPage() { if (this.currentPage() < this.totalPages()) { this.currentPage.update((page) => page + 1); this.load(); } }
  download(format: 'csv'|'xlsx') {
    this.api.download(`/exports/records?${queryString(cleanParams({ ...this.filters.getRawValue(), format }))}`).subscribe((blob) => saveBlob(blob, `registros-globales.${format}`));
  }
  dateTimeText(value: unknown) { return formatDateTimeText(value); }
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
  private loadFilterOptions() {
    this.filterOptionsLoading.set(true);
    this.api.get<{data: {addresses: string[]; districts: string[]; neighborhoods: string[]; postal_codes: string[]}}>('/admin/record-filter-options').pipe(finalize(() => this.filterOptionsLoading.set(false))).subscribe((response) => this.filterOptions.set(response.data));
  }
  private load() {
    this.recordsLoading.set(true);
    this.api.get<ManagerRecordsResponse>('/admin/records', cleanParams({ ...this.filters.getRawValue(), page: this.currentPage(), limit: this.pageSize() })).pipe(finalize(() => this.recordsLoading.set(false))).subscribe((response) => {
      this.records.set(response.data);
      this.total.set(response.meta.total);
    });
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
    if (key === 'postal_code') return 'C.P. debe tener 5 digitos';
    if (key === 'phone') return 'telefono debe tener 10 digitos';
    if (key === 'electoral_key') return 'clave electoral debe tener 18 letras o numeros';
    return 'formato invalido';
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="page-title"><h1>Metas de gestores</h1></div>
    <section class="card">
      <h2>{{editingGoalId() ? 'Editar meta' : 'Nueva meta'}}</h2>
      <form class="filters goal-form" [formGroup]="form" (ngSubmit)="save()">
        <label>Gestor<select formControlName="capturer_id" [disabled]="!!editingGoalId()"><option value="">Selecciona gestor</option>@for(manager of managers(); track manager.id) {<option [value]="manager.id">{{manager.full_name}}</option>}</select></label>
        <label>Periodo<select formControlName="period_type"><option value="daily">Diaria</option><option value="weekly">Semanal</option><option value="monthly">Mensual</option></select></label>
        <label>Meta de registros<input type="number" min="1" formControlName="target_count"></label>
        <label>Inicio<input type="date" formControlName="starts_on"></label>
        <label>Final<input type="date" formControlName="ends_on"></label>
        <div class="form-actions goal-actions"><button [disabled]="saving()">{{saving() ? 'Guardando...' : editingGoalId() ? 'Guardar cambios' : 'Guardar meta'}}</button>@if(editingGoalId()) {<button type="button" class="secondary" (click)="cancelEdit()">Cancelar</button>}</div>
      </form>
      @if(message()) {<p class="success">{{message()}}</p>}
      @if(error()) {<p class="error">{{error()}}</p>}
    </section>
    <section class="card table-card goals-list-card">
      <h2>Metas activas</h2>
      <table>
        <thead><tr><th>Gestor</th><th>Origen</th><th>Periodo</th><th>Vigencia</th><th>Avance</th><th></th></tr></thead>
        <tbody>
          @if(goalsLoading()) {
            @for(row of [1,2,3]; track row) {
              <tr class="skeleton-table-row">@for(cell of [1,2,3,4,5,6]; track cell) {<td><span class="skeleton-line"></span></td>}</tr>
            }
          } @else {
            @for(row of goalRows(); track row.goal.id) {
              <tr [class.admin-goal-row]="row.goal.created_by_role === 'admin'">
                <td>{{row.manager.full_name}}</td>
                <td><span class="goal-pill" [class.admin-goal]="row.goal.created_by_role === 'admin'">{{row.goal.created_by_role === 'admin' ? 'Admin' : 'Gestor'}}</span></td>
                <td>{{periodLabel(row.goal.period_type)}} - {{row.goal.target_count}} registros</td>
                <td><span class="date-range">{{dateText(row.goal.starts_on)}}<small>a</small>{{dateText(row.goal.ends_on)}}</span></td>
                <td><div class="progress"><span [style.width.%]="barWidth(row.goal.progress?.percentage || 0)"></span></div><small>{{row.goal.progress?.count || 0}} / {{row.goal.target_count}} - {{row.goal.progress?.percentage || 0}}%</small></td>
                <td><div class="row-actions"><button class="secondary action-button" (click)="editGoal(row.manager.id, row.goal)">Editar</button><button class="danger action-button" (click)="deleteGoal(row.goal)">Eliminar</button></div></td>
              </tr>
            } @empty {<tr><td colspan="6">Sin metas activas.</td></tr>}
          }
        </tbody>
      </table>
    </section>
  `
})
export class AdminManagerGoalsComponent implements OnInit {
  private api = inject(ApiService);
  managers = signal<AdminManagerRow[]>([]);
  goalsLoading = signal(true);
  goalRows = computed(() => this.managers().flatMap((manager) => (manager.active_goals_list || []).map((goal) => ({ manager, goal }))));
  saving = signal(false);
  editingGoalId = signal('');
  message = signal('');
  error = signal('');
  form = new FormGroup({
    capturer_id: new FormControl('', { nonNullable: true, validators: Validators.required }),
    period_type: new FormControl<GoalPeriod>('weekly', { nonNullable: true, validators: Validators.required }),
    target_count: new FormControl(1, { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
    starts_on: new FormControl(localDateInputValue(), { nonNullable: true, validators: Validators.required }),
    ends_on: new FormControl('', { nonNullable: true, validators: Validators.required })
  });
  ngOnInit() { this.loadManagers(); }
  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Selecciona gestor, meta, inicio y final.');
      return;
    }
    this.saving.set(true);
    this.message.set('');
    this.error.set('');
    const request = this.editingGoalId()
      ? this.api.patch(`/admin/manager-goals/${this.editingGoalId()}`, this.form.getRawValue())
      : this.api.post('/admin/manager-goals', this.form.getRawValue());
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.message.set(this.editingGoalId() ? 'Meta actualizada correctamente.' : 'Meta guardada correctamente.');
        this.cancelEdit();
        this.loadManagers();
      },
      error: (e) => this.error.set(apiErrorMessage(e))
    });
  }
  editGoal(managerId: string, goal: AdminGoal) {
    this.editingGoalId.set(goal.id);
    this.message.set('');
    this.error.set('');
    this.form.reset({ capturer_id: managerId, period_type: goal.period_type, target_count: goal.target_count, starts_on: goal.starts_on, ends_on: goal.ends_on });
  }
  cancelEdit() {
    this.editingGoalId.set('');
    this.form.reset({ capturer_id: '', period_type: 'weekly', target_count: 1, starts_on: localDateInputValue(), ends_on: '' });
  }
  deleteGoal(goal: AdminGoal) {
    if (!window.confirm('Eliminar esta meta?')) return;
    this.api.delete(`/admin/manager-goals/${goal.id}`).subscribe({
      next: () => { this.message.set('Meta eliminada correctamente.'); this.loadManagers(); },
      error: (e) => this.error.set(apiErrorMessage(e))
    });
  }
  private loadManagers() {
    this.goalsLoading.set(true);
    this.api.get<{data: AdminManagerRow[]}>('/admin/managers').pipe(finalize(() => this.goalsLoading.set(false))).subscribe((response) => this.managers.set(response.data));
  }
  periodLabel(period: GoalPeriod) { return periodLabels[period]; }
  barWidth(value: number) { return Math.min(value, 100); }
  dateText(value: string | null | undefined) { return formatDateText(value); }
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
