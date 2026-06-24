
export async function initDB() {
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.autoCommit = true;
    oracledb.fetchAsString = [oracledb.CLOB];

    pool = await oracledb.createPool({
        user: 'moscmar18',
        password: 'moscmar18',
        connectString: '192.168.1.104:1521/lifetest',
        poolMin: 0,
        poolMax: 10,
        poolIncrement: 1,
    });
    console.log('✅  Oracle DB pool created');
}

export async function getConn() {
    return pool.getConnection();
}