import fs from 'fs';
import initSqlJs from 'sql.js';

const dbPath = './data/optiontrap.db';

async function inspect() {
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);

  // List all tables
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('\n=== Tables ===');
  console.log(tables[0].values.map(v => v[0]).join(', '));

  // Count rows in each table
  const tableNames = tables[0].values.map(v => v[0]);
  console.log('\n=== Row Counts ===');
  for (const name of tableNames) {
    const result = db.exec(`SELECT COUNT(*) FROM ${name}`);
    const count = result.length ? result[0].values[0][0] : 0;
    console.log(`${name}: ${count}`);
  }

  // Show positions
  const positions = db.exec('SELECT * FROM positions');
  if (positions.length && positions[0].values.length) {
    console.log('\n=== Positions ===');
    console.log('Columns:', positions[0].columns.join(', '));
    positions[0].values.forEach(row => console.log(row));
  } else {
    console.log('\n=== Positions: EMPTY ===');
  }

  // Show watchlists
  const watchlists = db.exec('SELECT * FROM watchlists');
  if (watchlists.length && watchlists[0].values.length) {
    console.log('\n=== Watchlists ===');
    console.log('Columns:', watchlists[0].columns.join(', '));
    watchlists[0].values.forEach(row => console.log(row));
  } else {
    console.log('\n=== Watchlists: EMPTY ===');
  }

  // Show watchlist_items
  const items = db.exec('SELECT * FROM watchlist_items');
  if (items.length && items[0].values.length) {
    console.log('\n=== Watchlist Items ===');
    console.log('Columns:', items[0].columns.join(', '));
    items[0].values.slice(0, 5).forEach(row => console.log(row));
  } else {
    console.log('\n=== Watchlist Items: EMPTY ===');
  }

  db.close();
}

inspect().catch(console.error);
