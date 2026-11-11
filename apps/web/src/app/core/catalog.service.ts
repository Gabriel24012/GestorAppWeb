import { Injectable } from '@angular/core';
import { map, of, tap } from 'rxjs';
import { ApiService } from './api.service';
import { aguascalientesDistricts, aguascalientesZones, type ZoneCatalogEntry } from './aguascalientes-catalog';

export type CatalogField = 'address' | 'neighborhood' | 'district' | 'postal_code';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  constructor(private api: ApiService) {}

  private zones = aguascalientesZones;
  private districts = aguascalientesDistricts;
  private remoteCache = new Map<string, string[]>();

  suggest(field: CatalogField, term: string, limit = 12) {
    const value = this.normalize(term);
    if (value.length < 2 && field !== 'district') return [];
    const values = field === 'neighborhood'
      ? this.zones.map((entry) => entry.neighborhood)
      : field === 'postal_code'
        ? this.zones.map((entry) => entry.postalCode).filter(Boolean) as string[]
        : field === 'district'
          ? this.districts
          : [];
    return this.unique(values)
      .filter((item) => this.normalize(item).includes(value))
      .slice(0, limit);
  }

  suggestAll(field: CatalogField, term: string, limit = 12) {
    const local = this.suggest(field, term, limit);
    const value = term.trim();
    if (!['address', 'neighborhood', 'postal_code'].includes(field) || value.length < 2) {
      return of(local);
    }
    const key = `${field}:${this.normalize(value)}`;
    const cached = this.remoteCache.get(key);
    if (cached) return of(this.unique([...local, ...cached]).slice(0, limit));
    return this.api.get<{ data: string[] }>('/record-suggestions', { field, q: value }).pipe(
      map((response) => response.data ?? []),
      tap((remote) => this.remoteCache.set(key, remote)),
      map((remote) => this.unique([...local, ...remote]).slice(0, limit))
    );
  }

  exactByNeighborhood(value: string) {
    const normalized = this.normalize(value);
    return this.zones.find((entry) => this.normalize(entry.neighborhood) === normalized) ?? null;
  }

  exactByPostalCode(value: string) {
    const matches = this.zones.filter((entry) => entry.postalCode === value);
    return matches.length === 1 ? matches[0] : null;
  }

  entryPatch(entry: ZoneCatalogEntry) {
    return {
      district: entry.district ?? '',
      postal_code: entry.postalCode ?? ''
    };
  }

  private unique(values: string[]) {
    return [...new Set(values)];
  }

  private normalize(value: string) {
    return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
}
