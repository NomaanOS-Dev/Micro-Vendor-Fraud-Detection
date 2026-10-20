import { app } from './app.js';
import { prisma } from './config/database.js';
import { env } from './config/env.js';
import { drainNotificationQueue } from './services/notification.service.js';

const server = app.listen(env.PORT, env.HOST, () => {
  console.info(`Vendor fraud API listening on http://${env.HOST}:${env.PORT}`);
});

const notificationTimer = setInterval(() => {
  void drainNotificationQueue().catch(() => console.error('Notification queue processing failed.'));
}, 5_000);
notificationTimer.unref();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal} received; closing server`);

  const timeout = setTimeout(() => {
    console.error('Graceful shutdown timed out');
    process.exit(1);
  }, 10_000);
  timeout.unref();

  server.close(async (error) => {
    try {
      clearInterval(notificationTimer);
      await prisma.$disconnect();
    } finally {
      clearTimeout(timeout);
      process.exit(error ? 1 : 0);
    }
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

