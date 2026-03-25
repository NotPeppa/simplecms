require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const connectSessionSequelize = require('connect-session-sequelize');

const { initModels, sequelize } = require('./models');
const { ensureAdminUser } = require('./services/authService');
const publicRoutes = require('./routes/publicRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const SequelizeStore = connectSessionSequelize(session.Store);
const sessionStore = new SequelizeStore({
  db: sequelize,
  tableName: 'sessions',
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 7 * 24 * 60 * 60 * 1000
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'simplecms-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
  })
);
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.admin = req.session ? req.session.admin : null;
  next();
});

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).send('404 Not Found');
});

async function bootstrap() {
  await initModels();
  await sessionStore.sync();
  await ensureAdminUser();

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`simplecms started: http://127.0.0.1:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error('bootstrap failed', error);
  process.exit(1);
});
