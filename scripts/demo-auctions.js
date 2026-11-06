// Standalone local fixture server. Never imported by server.js.
// No .env loading, production database access, or real authentication.
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const auctionRouter = require('../routes/auctions');

async function start() {
  const mode = process.argv[2] || '--verified';
  if (!['--verified', '--unverified', '--anonymous'].includes(mode)) {
    throw new Error('Use --verified, --unverified, or --anonymous.');
  }
  const db = new PGlite();
  const root = path.join(__dirname, '..');
  await db.exec(fs.readFileSync(path.join(root, 'sql/schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'sql/migrations/001_auctions.sql'), 'utf8'));
  await db.query("INSERT INTO users (email,password_hash,name,verified) VALUES ('demo@drexel.edu',$1,'Demo student',$2)",
    [randomBytes(32).toString('hex'), mode === '--verified']);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (mode !== '--anonymous') req.session = { userId: 1 };
    next();
  });
  app.use('/api/auctions', auctionRouter(db, () => true));
  app.use(express.static(path.join(root, 'public')));
  const server = app.listen(3001, '127.0.0.1', () => {
    console.log('Auction demo: http://127.0.0.1:3001');
    console.log('Test account mode: ' + mode.slice(2));
    console.log('Temporary local database only. Auctions reset when you stop this command.');
    console.log('Login/registration pages are not connected in this fixture.');
  });
  server.on('error', async error => {
    console.error('Demo server failed:', error.code || error.message);
    await db.close();
    process.exitCode = 1;
  });
  async function stop() {
    server.close(async () => { await db.close(); process.exit(0); });
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
start().catch(error => { console.error(error.message); process.exitCode = 1; });
