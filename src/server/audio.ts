import 'server-only';
import OpenAI from 'openai';
import { z } from 'zod';
import { authorize } from './auth';
import { env } from './config';
import { AppError } from './errors';
import { body, handle, json, sessionId } from './http';
import { SupabaseDatabase } from './storage/supabase';

export function audio(request: Request, id: string, kind: 'speech' | 'transcriptions') {
  return handle(async () => {
    const db = new SupabaseDatabase();
    const state = await authorize(db, sessionId(id), request);
    if (!state.session.audio_processing_consent) throw new AppError('AUDIO_CONSENT_REQUIRED', 403, 'Audio consent required.');
    if (state.session.status !== 'active') throw new AppError('SESSION_INCOMPLETE', 409, 'Session is not active.');
    for (const [key, limit] of [[`audio:${id}`, 30], ['audio:global', 1000]] as const) {
      if (!await db.rpc('consume_rate', { p_key: key, p_limit: limit, p_seconds: 86400 })) throw new AppError('RATE_LIMITED', 429, 'Audio budget exceeded.');
    }
    const config = env();
    if (!config.OPENAI_API_KEY) throw new AppError('NOT_CONFIGURED', 503, 'Configure OpenAI audio credentials.');
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 60000, maxRetries: 0 });
    const question = state.questions.find(q => q.id === state.session.current_question_id);
    if (!question) throw new AppError('QUESTION_OUT_OF_ORDER', 409, 'No active question.');
    if (kind === 'speech') {
      const input = await body(request, z.object({ questionId: z.uuid() }).strict());
      if (input.questionId !== question.id) throw new AppError('QUESTION_OUT_OF_ORDER', 409, 'Question is not current.');
      if (!config.OPENAI_TTS_MODEL) throw new AppError('NOT_CONFIGURED', 503, 'Configure speech model.');
      try {
        const result = await client.audio.speech.create({ model: config.OPENAI_TTS_MODEL, voice: config.OPENAI_TTS_VOICE || 'alloy', input: question.question_text, response_format: 'mp3' });
        return new Response(await result.arrayBuffer(), { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store, private' } });
      } catch { throw new AppError('VOICE_UNAVAILABLE', 502, 'Speech generation failed. Please retry.', true); }
    }
    // Bound the actual stream as well as Content-Length before multipart parsing.
    const reader = request.body?.getReader();
    if (!reader) throw new AppError('INVALID_REQUEST', 400, 'Audio required.');
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new AppError('PAYLOAD_TOO_LARGE', 413, 'Recording exceeds 4 MiB. Record a shorter answer.'); }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('Content-Type') || '' } }).formData();
    const file = form.get('audio');
    if (form.get('questionId') !== question.id) throw new AppError('QUESTION_OUT_OF_ORDER', 409, 'Question is not current.');
    if (!(file instanceof File) || !file.size || !['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'].includes(file.type.split(';')[0])) throw new AppError('INVALID_REQUEST', 400, 'Unsupported audio format.');
    if (!config.OPENAI_TRANSCRIPTION_MODEL) throw new AppError('NOT_CONFIGURED', 503, 'Configure transcription model.');
    try {
      const result = await client.audio.transcriptions.create({ model: config.OPENAI_TRANSCRIPTION_MODEL, file, response_format: 'json' });
      return json({ transcript: result.text });
    } catch { throw new AppError('TRANSCRIPTION_UNAVAILABLE', 502, 'Transcription failed. Your recording is preserved for retry.', true); }
  });
}
