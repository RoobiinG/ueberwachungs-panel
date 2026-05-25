require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const auth = require('./middleware/auth');
const { setup: setupWS } = require('./websocket');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/system', auth, require('./routes/system'));
app.use('/api/docker', auth, require('./routes/docker'));
app.use('/api/services', auth, require('./routes/services'));
app.use('/api/firewall', auth, require('./routes/firewall'));
app.use('/api/network', auth, require('./routes/network'));
app.use('/api/users', auth, require('./routes/users'));
app.use('/api/webhooks', auth, require('./routes/webhooks'));
app.use('/api/hetzner', auth, require('./routes/hetzner'));
app.use('/api/mchost', auth, require('./routes/mchost'));

// Serve React frontend in production
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

setupWS(server);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Überwachungs-Panel running on port ${PORT}`));
