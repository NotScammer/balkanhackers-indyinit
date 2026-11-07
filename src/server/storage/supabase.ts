import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/server/config';
import { databaseError } from '@/server/errors';
import type { Database, Forecast, Snapshot } from './types';
export function databaseClient() {
  const config = env();
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
  });
}
export class SupabaseDatabase implements Database {
  constructor(public client: SupabaseClient = databaseClient()) {}
  async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw databaseError(error.message);
    return data as T;
  }
  snapshot(id: string) { return this.rpc<Snapshot | null>('interview_snapshot', { p_session_id: id }); }
  async forecasts(roleId: string, mode: Forecast['data_mode']): Promise<Forecast[]> {
    const { data, error } = await this.client.from('topic_forecasts').select('*, evidence:forecast_evidence(*, source:research_sources(title,url,published_at,publisher,source_type))')
      .eq('data_mode', mode).contains('target_roles', [roleId]).order('created_at', { ascending: false }).limit(60);
    if (error) throw databaseError(error.message);
    const seen = new Set<string>();
    return (data as Forecast[]).filter(f => {
      const key = f.topic.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return f.evidence.some(e => e.stance === 'support' && (mode === 'illustrative' || e.source.source_type !== 'illustrative'));
    }).sort((a, b) => b.preparation_score - a.preparation_score).slice(0, 12);
  }
  async deleteSession(id: string) {
    const { error } = await this.client.from('interview_sessions').delete().eq('id', id);
    if (error) throw databaseError(error.message);
  }
}
