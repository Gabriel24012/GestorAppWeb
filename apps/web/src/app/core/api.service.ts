import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}
  get<T>(path: string, params?: Record<string, string | number>) { let httpParams = new HttpParams(); Object.entries(params ?? {}).forEach(([k, v]) => httpParams = httpParams.set(k, String(v))); return this.http.get<T>(`${environment.apiUrl}${path}`, { params: httpParams }); }
  post<T>(path: string, body: unknown) { return this.http.post<T>(`${environment.apiUrl}${path}`, body); }
  upload<T>(path: string, body: FormData) { return this.http.post<T>(`${environment.apiUrl}${path}`, body); }
  patch<T>(path: string, body: unknown) { return this.http.patch<T>(`${environment.apiUrl}${path}`, body); }
  delete<T>(path: string) { return this.http.delete<T>(`${environment.apiUrl}${path}`); }
  download(path: string) { return this.http.get(`${environment.apiUrl}${path}`, { responseType: 'blob' }); }
}
