import 'dotenv/config';
import { z } from 'zod';

/**
 * Fail loudly at boot rather than at 2am with an undefined JWT secret silently
 * signing tokens as "undefined".
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),

  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),

  // Used from Feature 2 onward; optional so Feature 1 boots without it.
  TMDB_API_KEY: z.string().optional(),

  // Shared secret for the nightly catalog-sync trigger. Without it,
  // /internal/sync-catalog refuses to run rather than sitting open.
  CRON_SECRET: z.string().min(16).optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;

if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
  console.error(
    'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ — sharing one secret lets an access token be replayed as a refresh token.',
  );
  process.exit(1);
}
