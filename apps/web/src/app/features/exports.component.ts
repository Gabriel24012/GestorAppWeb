import { Component, inject } from '@angular/core';
import { ApiService } from '../core/api.service';

@Component({ standalone: true, template: `<h1>Exportar registros</h1><section class="card"><p>La descarga respeta automáticamente el alcance de tu equipo.</p><button (click)="download('csv')">Descargar CSV</button><button class="secondary" (click)="download('xlsx')">Descargar Excel</button></section>` })
export class ExportsComponent { private api = inject(ApiService); download(format: 'csv'|'xlsx') { this.api.download(`/exports/records?format=${format}`).subscribe(blob => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `registros.${format}`; a.click(); URL.revokeObjectURL(url); }); } }
