import 'dotenv/config';
import { startWebServer } from './web/server.js';
import { startEventScheduler } from './services/eventScheduler.js';
import { startDigestScheduler } from './services/eventDigest.js';

startWebServer();
startEventScheduler();
startDigestScheduler();
