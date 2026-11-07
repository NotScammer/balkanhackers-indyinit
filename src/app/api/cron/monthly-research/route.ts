import { authorizeCron } from '@/server/auth';
import { handle, json } from '@/server/http';
import { runMonthly } from '@/server/research/run-monthly';
export const runtime = 'nodejs';
export const maxDuration = 240;
export function GET(request: Request) {
  return handle(async () => {
    authorizeCron(request, process.env.CRON_SECRET);
    const result = await runMonthly();
    return json(result, result.status === 'failed' ? 503 : 200);
  });
}
