const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CollectorJobLog = sequelize.define(
  'CollectorJobLog',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    sourceName: {
      type: DataTypes.STRING(120),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('success', 'failed'),
      allowNull: false
    },
    importedCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0
    },
    updatedCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0
    },
    skippedCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0
    },
    detail: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  },
  {
    tableName: 'collector_job_logs',
    timestamps: true
  }
);

module.exports = CollectorJobLog;
