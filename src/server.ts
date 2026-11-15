import { app } from './app';
import { env } from './config';
import { prisma } from './prisma';
import { releaseMaturedCommissions } from './services/commission-release';
async function main() {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  const server = app.listen(env.PORT, () => console.log(`Flyover API listening on :${env.PORT}`));
  let releaseRunning = false;
  const runRelease = async () => {
    if (releaseRunning) return;
    releaseRunning = true;
    try {
      const count = await releaseMaturedCommissions(env.COMMISSION_RELEASE_BATCH_SIZE);
      if (count > 0) console.log(`Released ${count} matured commission(s)`);
    } catch (error) {
      console.error('Commission release worker failed', error);
    } finally {
      releaseRunning = false;
    }
  };
  void runRelease();
  const releaseTimer = setInterval(() => void runRelease(), env.COMMISSION_RELEASE_INTERVAL_MS);
  releaseTimer.unref();
  const shutdown = () => {
    clearInterval(releaseTimer);
    server.close(async () => { await prisma.$disconnect(); process.exit(0); });
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
main().catch(async e => { console.error('Startup failed', e); await prisma.$disconnect(); process.exit(1); });
