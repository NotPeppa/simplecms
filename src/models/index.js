const sequelize = require('../config/database');
const Category = require('./Category');
const Video = require('./Video');
const CollectorSource = require('./CollectorSource');
const SourceParser = require('./SourceParser');
const CollectorJobLog = require('./CollectorJobLog');
const AdminUser = require('./AdminUser');

Category.hasMany(Video, { foreignKey: 'categoryId', as: 'videos' });
Video.belongsTo(Category, { foreignKey: 'categoryId', as: 'category' });
CollectorSource.hasMany(SourceParser, { foreignKey: 'sourceId', as: 'parsers' });
SourceParser.belongsTo(CollectorSource, { foreignKey: 'sourceId', as: 'source' });

async function initModels() {
  await sequelize.authenticate();
  await sequelize.sync();
}

module.exports = {
  sequelize,
  initModels,
  Category,
  Video,
  CollectorSource,
  SourceParser,
  CollectorJobLog,
  AdminUser
};
