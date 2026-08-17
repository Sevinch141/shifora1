// Applies the schema to the configured Postgres database. Safe to re-run.
import '../config.js';
import { migrate, closePool } from './index.js';

await migrate();
console.log('Shifora: schema qo‘llandi.');
await closePool();
