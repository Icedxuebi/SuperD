import pg from "pg";
const { Pool, types } = pg; types.setTypeParser(1082,v=>v); types.setTypeParser(1114,v=>v);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:2,statement_timeout:120000});
for(const [t,c] of [["payment_transaction","payment_date"],["transfer_transaction","transfer_date"]]){
  const {rows}=await pool.query(`SELECT MIN(${c})::text mn, MAX(${c})::text mx, COUNT(*)::bigint n FROM ${t}`);
  console.log(`${t}: min=${rows[0].mn}  max=${rows[0].mx}  rows=${rows[0].n}`);
}
await pool.end();
