import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.includes('/auth/verify-email') || req.url.includes('/auth/resend-verification') || req.url.includes('/invites/')) return next(req);
  const auth = inject(AuthService);
  return from(auth.accessToken()).pipe(switchMap((token) => {
    const authorized = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
    return next(authorized).pipe(catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !token) return throwError(() => error);
      return from(auth.refreshAccessToken()).pipe(switchMap((refreshed) => {
        if (!refreshed) { void auth.signOut(); return throwError(() => error); }
        return from(auth.accessToken()).pipe(switchMap((newToken) => next(req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } }))));
      }));
    }));
  }));
};
