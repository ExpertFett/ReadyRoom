import 'dotenv/config';
import { startWebServer } from './web/server.js';
import { startEventScheduler } from './services/eventScheduler.js';

startWebServer();
startEventScheduler();
