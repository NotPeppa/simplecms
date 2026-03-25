# simplecms

一个专注于"采集资源 + 前台展示播放 + 后台管理采集"的最小 CMS 实现。

当前技术栈：Node.js + Express + MySQL + Sequelize + EJS。

## 已实现

- 前台：
  - 首页展示最近视频
  - 分类筛选
  - 关键词搜索
  - 视频详情 + 分集播放
- 后台：
  - 管理员登录
  - 采集源管理（新增、启停）
  - 手动采集（按页数）
  - 采集日志查看
- 采集：
  - 兼容常见资源站 `ac=detail` JSON 结构
  - 自动分类入库
  - 视频按 `sourceName:vod_id` 去重更新

## 快速开始

1. 准备 MySQL 数据库，例如 `simplecms`。
2. 复制环境变量：

```bash
cp .env.example .env
```

3. 修改 `.env` 中数据库连接信息。
4. 安装依赖并启动：

```bash
npm install
npm run dev
```

启动后：

- 前台：`http://127.0.0.1:3000/`
- 后台：`http://127.0.0.1:3000/admin`

默认管理员账号来自 `.env`：

- `INIT_ADMIN_USERNAME`
- `INIT_ADMIN_PASSWORD`

## 采集源示例

后台新增采集源时，接口可填写类似：

`https://example.com/api.php/provide/vod/?ac=detail`

系统会在采集时自动追加或替换页码参数 `pg`。
