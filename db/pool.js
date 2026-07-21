// Oracle connection pool — the one shared dependency every route needs.
// Moved out of server.js so route files (routes/*.js) can import getConn()
// without needing server.js itself.

import oracledb from 'oracledb';

let pool;

export async function initDB() {
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.autoCommit = true;
  oracledb.fetchAsString = [oracledb.CLOB];

  pool = await oracledb.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING,
    poolMin: 0,
    poolMax: 10,
    poolIncrement: 1,
  });
  console.log('✅  Oracle DB pool created');
}

export async function getConn() {
  return pool.getConnection();
}
