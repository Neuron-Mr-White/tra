import { serve } from '@hono/node-server';
import { app } from './server.js';
import { connectToWhatsApp } from './wa.js';
import { config } from './config.js';
import { pino } from 'pino';

const logger = pino({ level: 'info' });

async function main() {
    logger.info('Starting TRA Server...');

    // Start WhatsApp
    await connectToWhatsApp();

    // Start Web Server
    serve({
        fetch: app.fetch,
        port: config.PORT
    }, (info) => {
        logger.info(`Web server listening on http://localhost:${info.port}`);
    });
}

main().catch(err => {
    logger.error(err);
    process.exit(1);
});
