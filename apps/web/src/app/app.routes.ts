import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/guards';
import { LoginComponent, ConfirmAccountComponent, InviteSignupComponent } from './features/login.component';
import { CaptureComponent } from './features/capture.component';
import { AdminDashboardComponent, AdminManagerDetailComponent, AdminManagerGoalsComponent, AdminRecordsComponent } from './features/dashboard.component';
import { ManagerCapturerDetailComponent, ManagerCapturersComponent, ManagerDashboardComponent, ManagerGoalsComponent, ManagerRecordsComponent } from './features/manager.component';
import { TeamComponent } from './features/team.component';
import { ExportsComponent } from './features/exports.component';
import { PreferencesComponent } from './features/preferences.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'auth/confirm', component: ConfirmAccountComponent },
  { path: 'auth/invite/:token', component: InviteSignupComponent },
  { path: 'captura', component: CaptureComponent, canActivate: [authGuard, roleGuard('capturador')] },
  { path: 'admin', component: AdminDashboardComponent, canActivate: [authGuard, roleGuard('admin')] },
  { path: 'admin/gestores/:id', component: AdminManagerDetailComponent, canActivate: [authGuard, roleGuard('admin')] },
  { path: 'admin/registros', component: AdminRecordsComponent, canActivate: [authGuard, roleGuard('admin')] },
  { path: 'admin/metas', component: AdminManagerGoalsComponent, canActivate: [authGuard, roleGuard('admin')] },
  { path: 'gestor', component: ManagerDashboardComponent, canActivate: [authGuard, roleGuard('gestor')] },
  { path: 'gestor/capturadores', component: ManagerCapturersComponent, canActivate: [authGuard, roleGuard('gestor')] },
  { path: 'gestor/capturadores/agregar', component: TeamComponent, canActivate: [authGuard, roleGuard('gestor')] },
  { path: 'gestor/capturadores/:id', component: ManagerCapturerDetailComponent, canActivate: [authGuard, roleGuard('gestor')] },
  { path: 'gestor/registros', component: ManagerRecordsComponent, canActivate: [authGuard, roleGuard('gestor')] },
  { path: 'gestor/metas', component: ManagerGoalsComponent, canActivate: [authGuard, roleGuard('gestor')] },
  { path: 'equipo', component: TeamComponent, canActivate: [authGuard, roleGuard('admin', 'gestor')] },
  { path: 'exportar', component: ExportsComponent, canActivate: [authGuard, roleGuard('admin', 'gestor')] },
  { path: 'configuracion', component: PreferencesComponent, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' }
];
