const bcrypt = require('bcryptjs');
const { AdminUser } = require('../models');

async function ensureAdminUser() {
  const username = process.env.INIT_ADMIN_USERNAME || 'admin';
  const password = process.env.INIT_ADMIN_PASSWORD || 'admin123';

  const existing = await AdminUser.findOne({ where: { username } });
  if (existing) {
    return existing;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  return AdminUser.create({ username, passwordHash });
}

async function validateAdmin(username, password) {
  const user = await AdminUser.findOne({ where: { username } });
  if (!user) {
    return null;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return null;
  }

  return user;
}

module.exports = {
  ensureAdminUser,
  validateAdmin
};
