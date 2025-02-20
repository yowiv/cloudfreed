import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import Server from './lib/Server.js';

const argv = yargs(hideBin(process.argv))
  .locale('en')
  .option('clientKey', {
    alias: 'k',
    type: 'string',
    description: 'Client API key'
  })
  .option('maxTasks', {
    alias: 'm',
    type: 'number',
    description: 'Maximum concurrent tasks',
    default: 1
  })
  .option('port', {
    alias: 'p',
    type: 'number',
    description: 'Server port to listen',
    default: 3000
  })
  .option('host', {
    alias: 'h',
    type: 'string',
    description: 'Server host to listen',
    default: 'localhost'
  })
  .option('timeout', {
    alias: 't',
    type: 'number',
    description: 'Timeout per task in seconds',
    default: 60
  })
  .argv;

const config = {
    clientKey: argv.clientKey || process.env.CLIENT_KEY,
    maxConcurrentTasks: argv.maxTasks || parseInt(process.env.MAX_CONCURRENT_TASKS, 10) || 1,
    port: argv.port || process.env.PORT || 3000,
    host: argv.host || process.env.HOST || "localhost",
    timeout: argv.timeout || 60,
};

const server = new Server(config);
await server.initialize();
const httpServer = server.listen();

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM signal. Shutting down gracefully...');
  await server.stop();
  httpServer.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT signal. Shutting down gracefully...');
  await server.stop();
  httpServer.close(() => {
    process.exit(0);
  });
});
