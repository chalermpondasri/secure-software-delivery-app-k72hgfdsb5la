/**
 * PR Gate workshop — new file for diff-aware Static Code Analysis only.
 */
const fs = require('fs');
const express = require('express');
const path = require('path');

const router = express.Router();

router.get('/read', (req, res) => {
  // Only this public document may be read; request data never forms a path.
  if (req.query.file !== 'README.md') {
    return res.status(400).send('Unsupported file');
  }

  fs.readFile(path.join(__dirname, '..', 'README.md'), 'utf8', (err, data) => {
    if (err) return res.status(500).send('Unable to read file');
    res.send(data);
  });
});

module.exports = router;
