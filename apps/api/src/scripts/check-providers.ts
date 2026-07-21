import { REGIONS, STREAMING_SERVICES, providerIdsInRegion } from '@watchly/shared';
import { providersInRegion } from '../lib/tmdb.js';

/**
 * Verifies the tmdbProviderId we hard-coded for each service against what TMDB
 * actually reports per region. Getting one of these wrong doesn't throw — it
 * just silently makes that service match zero titles forever, so it's worth
 * checking explicitly rather than discovering it as "why is Hotstar empty?".
 *
 *   npm run tmdb:providers -w @watchly/api
 */
async function main() {
  for (const region of REGIONS) {
    const [movies, tv] = await Promise.all([
      providersInRegion('movie', region),
      providersInRegion('tv', region),
    ]);

    const live = new Map<number, string>();
    for (const p of [...movies.results, ...tv.results]) live.set(p.provider_id, p.provider_name);

    console.log(`\n=== ${region} (${live.size} providers live on TMDB) ===`);

    for (const svc of STREAMING_SERVICES) {
      const ids = providerIdsInRegion(svc, region);
      if (ids.length === 0) continue; // Not offered here — nothing to check.

      for (const id of ids) {
        const actual = live.get(id);
        if (actual) {
          console.log(`  OK    ${svc.label.padEnd(14)} id=${id} -> "${actual}"`);
        } else {
          // Suggest what the id probably should be, by name.
          const guess = [...live.entries()].find(([, name]) =>
            name.toLowerCase().includes(svc.label.toLowerCase().split(' ')[0]!),
          );
          console.log(
            `  WRONG ${svc.label.padEnd(14)} id=${id} not in ${region}.` +
              (guess ? ` Did you mean ${guess[0]} ("${guess[1]}")?` : ' No name match either.'),
          );
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
