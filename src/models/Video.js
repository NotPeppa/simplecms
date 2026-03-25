const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Video = sequelize.define(
  'Video',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    sourceId: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: true
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    cover: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    playUrl: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    sourceName: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: 'unknown'
    },
    updatedAtSource: {
      type: DataTypes.STRING(64),
      allowNull: true
    }
  },
  {
    tableName: 'videos',
    timestamps: true,
    indexes: [
      { fields: ['title'] },
      { fields: ['createdAt'] }
    ]
  }
);

module.exports = Video;
