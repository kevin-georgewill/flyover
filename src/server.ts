import { app } from './app';
import { env } from './config';
import { prisma } from './prisma';
async function main() {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  const server = app.listen(env.PORT, () => console.log(`Flyover API listening on :${env.PORT}`));
  const shutdown = () => server.close(async () => { await prisma.$disconnect(); process.exit(0); });
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
main().catch(async e => { console.error('Startup failed', e); await prisma.$disconnect(); process.exit(1); });
