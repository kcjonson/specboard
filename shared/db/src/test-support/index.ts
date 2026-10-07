/** Test-only database support, exported as @specboard/db/test-support for other packages' tests. */

export { migratedDb } from './migrated-db.ts';
export { pgliteAsPg, type PgliteAsPg } from './pglite-pg.ts';
