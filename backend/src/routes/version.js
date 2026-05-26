const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');

// Liest version.json aus dem Projekt-Root (ein Level über /backend)
const versionFile = path.join(__dirname, '../../../version.json');

router.get('/', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    res.json(data);
  } catch {
    res.json({ version: 'unknown', build: 0, date: null });
  }
});

module.exports = router;
