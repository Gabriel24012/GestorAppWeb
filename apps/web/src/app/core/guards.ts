import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import type { AppRole } from './models';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return toObservable(auth.ready).pipe(
    filter(Boolean),
    take(1),
    map(() => auth.profile() ? true : router.createUrlTree(['/login']))
  );
};

export const roleGuard = (...roles: AppRole[]): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return toObservable(auth.ready).pipe(
    filter(Boolean),
    take(1),
    map(() => {
      const profile = auth.profile();
      return profile && roles.includes(profile.role) ? true : router.createUrlTree(['/']);
    })
  );
};
