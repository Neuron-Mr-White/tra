import Database from 'better-sqlite3';
import { config } from './config.js';

import fs from 'fs';
import path from 'path';

const dbPath = config.DATABASE_URL;
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

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
