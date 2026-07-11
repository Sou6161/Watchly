import type { z } from 'zod';
import { ApiError } from './errors.js';

/**
 * Parses a request body, turning zod issues into a 422 with a field->message
 * map the mobile form can render inline.
 */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    // Keep the first message per field; later ones are usually noise.
    fields[key] ??= issue.message;
  }
  throw ApiError.validation(fields);
}
