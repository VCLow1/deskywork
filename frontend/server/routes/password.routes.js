const express = require('express');
const router = express.Router();
const { requestPasswordReset } = require('../controllers/passwordController');

router.post('/auth/password-reset', requestPasswordReset);

module.exports = router;
