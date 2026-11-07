import { catalog } from '@/server/catalog';
import { handle, json } from '@/server/http';
export const runtime = 'nodejs';
export function GET() { return handle(async () => json(catalog)); }
