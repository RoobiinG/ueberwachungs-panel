const db = require('../backend/src/db');
const agents = db.prepare('SELECT id, name, token, version FROM remote_agents').all();
console.log(agents);
