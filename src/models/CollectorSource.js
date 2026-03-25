const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CollectorSource = sequelize.define(
  'CollectorSource',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: true
    },
    apiUrl: {
      type: DataTypes.STRING(500),
      allowNull: false
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    note: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  },
  {
    tableName: 'collector_sources',
    timestamps: true
  }
);

module.exports = CollectorSource;
