// Vercel serverless entry point.
//
// Vercel's Node runtime accepts an Express app as a request handler, so the
// same application that runs locally is exported here unchanged. `vercel.json`
// rewrites every /api/* path to this function.
import { createApp } from '../server/src/app.js';

export default createApp();
