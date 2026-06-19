const { Pool } = require('pg');

// Pool maintains a set of reusable database connections
// so we don't open a new connection for every query
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
