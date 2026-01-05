import Database from 'better-sqlite3';
import { config } from './config.js';

const db = new Database(config.DATABASE_URL);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS commands (
    key TEXT PRIMARY KEY,
    description TEXT,
    urlCall TEXT NOT NULL,
    args TEXT -- JSON stringified array of arguments
  );
`);

export { db };
