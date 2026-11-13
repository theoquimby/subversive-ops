Feature demo data. Each feature adds `src/server/demo/<feature>.ts` exporting
`export async function seed<Feature>(db: PrismaClient): Promise<void>` that
inserts its own demo rows (assumes the base demo from ../demo-data.ts exists).
They are called from ../demo-data.ts after the base demo is created.
These files must not import "server-only" (they also run from the CLI seed).
