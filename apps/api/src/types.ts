import type { SupabaseClient, User } from '@supabase/supabase-js';

export type AppRole = 'admin' | 'gestor' | 'capturador';
export interface Profile { id: string; email: string; full_name: string; role: AppRole; parent_user_id: string | null; is_active: boolean; onboarding_completed_at?: string | null; }
export interface AuthContext { user: User; profile: Profile; db: SupabaseClient; }
