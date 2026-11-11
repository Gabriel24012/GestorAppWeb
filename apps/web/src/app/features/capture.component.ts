import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AbstractControl, ReactiveFormsModule, FormControl, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { CatalogService } from '../core/catalog.service';
import type { CaptureContext, RecordItem } from '../core/models';
import { apiErrorMessage } from '../core/api-errors';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <h1>Captura de registros</h1>
    <section class="leadership-banner">
      <small>Liderazgo</small>
      <strong>{{context()?.leadership_name || 'Cargando...'}}</strong>
    </section>
    <div class="capture-layout">
      <section class="card">
        <div class="step-title">
          <span>1</span>
          <div class="step-heading">
            <h2>{{editingRecord() ? 'Editar registro' : 'Registro ciudadano'}}</h2>
          </div>
        </div>

        <div class="form-tabs">
          <button type="button" [class.active]="!editingRecord()" (click)="newRecord()">Nuevo registro</button>
          <button type="button" [class.active]="editingRecord()" [disabled]="!editingRecord()">Editar registro</button>
        </div>

        @if (editingRecord()) {
          <p class="muted">Editando: {{editingRecord()!.first_name}} {{editingRecord()!.paternal_surname}}</p>
        }

        <form [formGroup]="recordForm" (ngSubmit)="save()">
          <div class="grid">
            @for (field of fields; track field.key) {
              <label>
                {{field.label}}
                @if (field.key === 'district') {
                  <select [formControlName]="field.key">
                    <option value="">Selecciona</option>
                    @for(option of districtSuggestions(); track option) { <option [value]="option">{{option}}</option> }
                  </select>
                } @else {
                  <input [type]="field.type" [formControlName]="field.key" [placeholder]="field.placeholder" [attr.min]="field.min" [attr.max]="field.max" [attr.list]="catalogList(field.key)" (change)="applyCatalogMatch(field.key)">
                }
                @if (recordIssue(field.key)) {<small class="field-error">{{recordIssue(field.key)}}</small>}
              </label>
            }
            <label>Observaciones<textarea formControlName="observations"></textarea></label>
          </div>
          <datalist id="address-options">
            @for(option of addressSuggestions(); track option) { <option [value]="option"></option> }
          </datalist>
          <datalist id="neighborhood-options">
            @for(option of neighborhoodSuggestions(); track option) { <option [value]="option"></option> }
          </datalist>
          <datalist id="postal-code-options">
            @for(option of postalCodeSuggestions(); track option) { <option [value]="option"></option> }
          </datalist>
          @if(message()){<p class="success">{{message()}}</p>}
          @if(error()){<p class="error">{{error()}}</p>}
          @if ((recordForm.touched || recordForm.dirty) && recordForm.invalid) {<p class="form-hint">Revisa: {{recordMissingText()}}</p>}
          <div class="form-actions">
            <button>{{editingRecord() ? 'Guardar cambios' : 'Guardar registro'}}</button>
            @if (editingRecord()) {
              <button type="button" class="danger" (click)="deleteRecord()">Eliminar registro</button>
            }
          </div>
        </form>
      </section>

      <aside class="card capture-side">
        <div class="side-header">
          <div>
            <h2>Mis registros</h2>
            <p>{{recordsTotal()}} registros</p>
          </div>
          <div class="side-actions">
            <button class="secondary" (click)="download('csv')" [disabled]="!recordsTotal()">CSV</button>
            <button class="secondary" (click)="download('xlsx')" [disabled]="!recordsTotal()">Excel</button>
          </div>
        </div>

        <label class="search-box">
          Buscar registro
          <input [value]="searchTerm()" (input)="search($any($event.target).value)" placeholder="Nombre, apellido, teléfono, Clave Electoral...">
        </label>

        <div class="list-controls">
          <label>
            Mostrar
            <select [value]="pageSize()" (change)="changePageSize($any($event.target).value)">
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
          </label>
          <span>Página {{currentPage()}} de {{totalPages()}}</span>
        </div>

        <div class="record-list">
          @for (record of records(); track record.id) {
            <button type="button" class="record-row" [class.active]="editingRecord()?.id === record.id" (click)="editRecord(record)">
              <strong>{{record.first_name}} {{record.paternal_surname}}</strong>
              <span>{{record.phone}}</span>
              <small>{{record.electoral_key}}</small>
            </button>
          } @empty {
            <p>No se encontraron registros.</p>
          }
        </div>

        <div class="pagination">
          <button type="button" class="secondary" (click)="previousPage()" [disabled]="currentPage() === 1">Anterior</button>
          <button type="button" class="secondary" (click)="nextPage()" [disabled]="currentPage() >= totalPages()">Siguiente</button>
        </div>
      </aside>
    </div>
  `
})
export class CaptureComponent implements OnInit {
  private api = inject(ApiService);
  private catalog = inject(CatalogService);
  readonly minBirthDate = this.isoDateYearsAgo(120);
  readonly maxBirthDate = this.todayIsoDate();

  context = signal<CaptureContext | null>(null);
  message = signal('');
  error = signal('');
  records = signal<RecordItem[]>([]);
  recordsTotal = signal(0);
  searchTerm = signal('');
  editingRecord = signal<RecordItem | null>(null);
  currentPage = signal(1);
  pageSize = signal(10);
  addressSuggestions = signal<string[]>([]);
  neighborhoodSuggestions = signal<string[]>([]);
  districtSuggestions = signal<string[]>(this.catalog.suggest('district', ''));
  postalCodeSuggestions = signal<string[]>([]);
  totalPages = computed(() => Math.max(1, Math.ceil(this.recordsTotal() / this.pageSize())));

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

  fields = [
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

  private labels: Record<string, string> = {
    first_name: 'nombre',
    paternal_surname: 'apellido paterno',
    address: 'domicilio',
    postal_code: 'C.P.',
    birth_date: 'fecha de nacimiento',
    phone: 'telefono',
    electoral_key: 'clave electoral'
  };

  ngOnInit() {
    this.setupCatalogAutocomplete();
    this.api.get<{data: CaptureContext}>('/capture-context').subscribe((response) => this.context.set(response.data));
    this.loadRecords();
  }

  save() {
    if (this.recordForm.invalid) {
      this.recordForm.markAllAsTouched();
      this.message.set('');
      this.error.set('Revisa los campos marcados antes de guardar.');
      return;
    }
    if (this.editingRecord()) {
      this.updateRecord();
      return;
    }
    this.api.post('/records', this.recordPayload()).subscribe({
      next: () => {
        this.error.set('');
        this.message.set('Registro guardado correctamente.');
        this.recordForm.reset();
        this.loadRecords();
      },
      error: (e) => {
        this.message.set('');
        this.error.set(apiErrorMessage(e, this.labels));
      }
    });
  }

  search(value: string) {
    this.searchTerm.set(value);
    this.currentPage.set(1);
    this.loadRecords();
  }

  changePageSize(value: string) {
    this.pageSize.set(Number(value));
    this.currentPage.set(1);
    this.loadRecords();
  }

  previousPage() {
    if (this.currentPage() === 1) return;
    this.currentPage.update((page) => page - 1);
    this.loadRecords();
  }

  nextPage() {
    if (this.currentPage() >= this.totalPages()) return;
    this.currentPage.update((page) => page + 1);
    this.loadRecords();
  }

  editRecord(record: RecordItem) {
    this.editingRecord.set(record);
    this.message.set('');
    this.error.set('');
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
    this.recordForm.markAsPristine();
  }

  newRecord() {
    this.editingRecord.set(null);
    this.message.set('');
    this.error.set('');
    this.recordForm.reset();
  }

  deleteRecord() {
    const current = this.editingRecord();
    if (!current) return;
    const name = `${current.first_name} ${current.paternal_surname}`;
    if (!window.confirm(`Vas a eliminar el registro de ${name}. Esta acción no se puede deshacer. ¿Deseas continuar?`)) return;
    if (!window.confirm('Confirma por segunda vez: ¿seguro que quieres eliminar definitivamente este registro?')) return;
    this.api.delete<void>(`/records/${current.id}`).subscribe({
      next: () => {
        this.error.set('');
        this.message.set('Registro eliminado correctamente.');
        this.newRecord();
        this.loadRecords();
      },
      error: (e) => {
        this.message.set('');
        this.error.set(apiErrorMessage(e, this.labels));
      }
    });
  }

  download(format: 'csv' | 'xlsx') {
    const params = new URLSearchParams({ format });
    if (this.searchTerm().trim()) params.set('q', this.searchTerm().trim());
    this.api.download(`/exports/records?${params}`).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mis-registros.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  recordIssue(key: string) {
    const control = this.recordForm.get(key);
    if (!control?.invalid || (!control.touched && !control.dirty)) return '';
    const label = this.labels[key] ?? key;
    if (control.errors?.['required']) return `${label} es obligatorio.`;
    if (control.errors?.['birthDateRange']) return `fecha debe estar entre ${this.displayDate(this.minBirthDate)} y ${this.displayDate(this.maxBirthDate)}.`;
    if (control.errors?.['pattern']) return this.patternMessage(key);
    return `Revisa ${label}.`;
  }

  recordMissingText() {
    return Object.keys(this.labels).filter((key) => this.recordForm.get(key)?.invalid).map((key) => {
      const control = this.recordForm.get(key);
      if (control?.errors?.['birthDateRange']) return 'Fecha de nacimiento válida';
      return capitalize(control?.errors?.['pattern'] ? this.patternMessage(key) : this.labels[key]);
    }).join(', ');
  }

  catalogList(key: string) {
    if (key === 'address') return 'address-options';
    if (key === 'neighborhood') return 'neighborhood-options';
    if (key === 'postal_code') return 'postal-code-options';
    return null;
  }

  applyCatalogMatch(key: string) {
    if (key === 'neighborhood') {
      const entry = this.catalog.exactByNeighborhood(this.recordForm.controls.neighborhood.value ?? '');
      if (!entry) return;
      this.patchCatalogFields(entry);
    }
    if (key === 'postal_code') {
      const entry = this.catalog.exactByPostalCode(this.recordForm.controls.postal_code.value);
      if (!entry) return;
      const patch: Partial<Record<'neighborhood' | 'district', string>> = {};
      if (!this.recordForm.controls.neighborhood.value) patch.neighborhood = entry.neighborhood;
      if (entry.district && !this.recordForm.controls.district.value) patch.district = entry.district;
      if (Object.keys(patch).length) this.recordForm.patchValue(patch);
    }
  }

  private loadRecords() {
    const params: Record<string, string | number> = { page: this.currentPage(), limit: this.pageSize() };
    if (this.searchTerm().trim()) params['q'] = this.searchTerm().trim();
    this.api.get<{data: RecordItem[]; meta: {total: number}}>('/records', params).subscribe((response) => {
      if (!response.data.length && response.meta.total > 0 && this.currentPage() > 1) {
        this.currentPage.set(Math.max(1, Math.ceil(response.meta.total / this.pageSize())));
        this.loadRecords();
        return;
      }
      this.records.set(response.data);
      this.recordsTotal.set(response.meta.total);
    });
  }

  private updateRecord() {
    const current = this.editingRecord();
    if (!current) return;
    this.api.patch<{data: RecordItem}>(`/records/${current.id}`, this.recordPayload()).subscribe({
      next: (response) => {
        this.error.set('');
        this.editingRecord.set(response.data);
        this.message.set('Registro actualizado correctamente.');
        this.loadRecords();
      },
      error: (e) => {
        this.message.set('');
        this.error.set(apiErrorMessage(e, this.labels));
      }
    });
  }

  private setupCatalogAutocomplete() {
    this.recordForm.controls.address.valueChanges
      .pipe(debounceTime(250), distinctUntilChanged(), switchMap((value) => this.catalog.suggestAll('address', value ?? '')))
      .subscribe((suggestions) => this.addressSuggestions.set(suggestions));
    this.recordForm.controls.neighborhood.valueChanges
      .pipe(debounceTime(250), distinctUntilChanged(), switchMap((value) => this.catalog.suggestAll('neighborhood', value ?? '')))
      .subscribe((suggestions) => this.neighborhoodSuggestions.set(suggestions));
    this.recordForm.controls.postal_code.valueChanges
      .pipe(debounceTime(250), distinctUntilChanged(), switchMap((value) => this.catalog.suggestAll('postal_code', value ?? '')))
      .subscribe((suggestions) => this.postalCodeSuggestions.set(suggestions));
  }

  private patchCatalogFields(entry: { district?: string; postalCode?: string }) {
    const patch: Partial<Record<'district' | 'postal_code', string>> = {};
    if (entry.district && !this.recordForm.controls.district.value) patch.district = entry.district;
    if (entry.postalCode && !this.recordForm.controls.postal_code.value) patch.postal_code = entry.postalCode;
    if (Object.keys(patch).length) this.recordForm.patchValue(patch);
  }

  private recordPayload() {
    const value = this.recordForm.getRawValue();
    return { ...value, electoral_key: value.electoral_key.toUpperCase() };
  }

  private stringValue(value: unknown) {
    return value ? String(value) : '';
  }

  private inputDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
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
    if (key === 'birth_date') return 'fecha debe ir como dd/MM/aaaa';
    if (key === 'phone') return 'teléfono debe tener 10 dígitos';
    if (key === 'electoral_key') return 'clave electoral debe tener 18 letras o numeros';
    return 'formato inválido';
  }
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
