import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { Database, Forecast, Snapshot } from '../src/server/storage/types';
import { databaseError } from '../src/server/errors';
import { testUser, otherUser } from './identity';
export class TestDatabase implements Database {
  constructor(public sql: PGlite) {}
  static async create(beforeTopicTrends?: (sql: PGlite) => Promise<void>) {
    const sql = new PGlite();
    await sql.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await sql.exec(await readFile('supabase/migrations/202611070001_backend.sql', 'utf8'));
    await sql.exec(await readFile('supabase/migrations/202611070002_research_persistence.sql', 'utf8'));
    await sql.exec(await readFile('supabase/migrations/202611070003_live_conversation.sql', 'utf8'));
    // Supabase provides auth.users in production. Emulate only its referenced ID here.
    await sql.exec('create schema auth; create table auth.users(id uuid primary key);');
    await sql.query('insert into auth.users(id) values($1),($2)', [testUser.id, otherUser.id]);
    await sql.exec(await readFile('supabase/migrations/202611070004_oauth_ownership.sql', 'utf8'));
    await beforeTopicTrends?.(sql);
    await sql.exec(await readFile('supabase/migrations/202611070005_topic_trends.sql', 'utf8'));
    return new TestDatabase(sql);
  }
  async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!/^\w+$/.test(name) || Object.keys(args).some(k => !/^\w+$/.test(k))) throw new Error('Invalid RPC');
    const keys = Object.keys(args);
    try {
      const { rows } = await this.sql.query<{ value: T }>(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) as value`, keys.map(k => args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
      return rows[0].value;
    } catch (e) { throw databaseError((e as Error).message); }
  }
  snapshot(id: string) { return this.rpc<Snapshot | null>('interview_snapshot', { p_session_id: id }); }
  async forecasts(): Promise<Forecast[]> { return [forecast]; }
  async deleteSession(id: string) { await this.sql.query('delete from interview_sessions where id=$1', [id]); }
}
export const forecast: Forecast = {
  id: '11111111-1111-4111-8111-111111111111', topic: 'Efficient inference', explanation: 'ILLUSTRATIVE test hypothesis, no real-world citation.',
  predicted_skills: ['capacity planning'], target_roles: ['software-engineer'], preparation_score: 75,
  evidence_confidence: 'weak', data_mode: 'illustrative', created_at: new Date().toISOString(),
  evidence: [{ id: '22222222-2222-4222-8222-222222222222', research_source_id: '33333333-3333-4333-8333-333333333333', explanation: 'Synthetic test evidence', stance: 'support', relationship_type: 'illustrative', source: { title: 'ILLUSTRATIVE test fixture', url: 'https://example.invalid/fixture', published_at: new Date().toISOString(), publisher: 'Test fixture', source_type: 'illustrative' } }],
};
export async function seedTestForecast(db: TestDatabase) {
  await db.sql.query("insert into topic_forecasts(id,topic,explanation,predicted_skills,target_roles,time_horizon_months,preparation_score,evidence_confidence,rubric_version,dimensions,data_mode) values($1,$2,$3,$4,$5,12,75,'weak','preparation-v1','{}','illustrative')", [forecast.id, forecast.topic, forecast.explanation, forecast.predicted_skills, forecast.target_roles]);
}
