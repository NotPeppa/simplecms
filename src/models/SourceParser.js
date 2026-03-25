const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SourceParser = sequelize.define(
  'SourceParser',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    sourceId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    parserId: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    fromCode: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    showName: {
      type: DataTypes.STRING(120),
      allowNull: true
    },
    parseUrl: {
      type: DataTypes.STRING(1000),
      allowNull: false
    },
    target: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    ps: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: '1'
    },
    sort: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    rawJson: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  },
  {
    tableName: 'source_parsers',
    timestamps: true,
    indexes: [{ fields: ['sourceId'] }, { fields: ['sourceId', 'enabled'] }]
  }
);

module.exports = SourceParser;
