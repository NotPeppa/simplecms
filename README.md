# simplecms

一个专注于“采集资源 + 前台展示播放 + 后台管理采集”的轻量 CMS，基于 Node.js、Express、EJS、MySQL 和 Sequelize 实现。

## 已实现功能

- 前台：
  - 首页展示最近视频
  - 分类筛选
  - 关键词搜索
  - 视频详情与分集播放
- 后台：
  - 管理员登录
  - 采集源管理（新增、启停）
  - 手动采集（按页数）
  - 采集日志查看
- 采集：
  - 兼容常见资源站 [`ac=detail`](README.md) JSON 结构
  - 自动分类入库
  - 视频按 [`sourceName:vod_id`](README.md) 去重更新

## 环境要求

- Node.js 20+
- MySQL 8.0+
- Docker / Docker Compose（可选）

## 本地开发

1. 准备 MySQL 数据库，例如 [`simplecms`](README.md)。
2. 复制环境变量模板：

```bash
cp env.example .env
```

3. 按需修改 [`.env`](env.example) 中的数据库和管理员配置。
4. 安装依赖：

```bash
npm install
```

5. 启动项目：

```bash
npm run dev
```

启动后默认访问：

- 前台：[`http://127.0.0.1:3000/`](README.md)
- 后台：[`http://127.0.0.1:3000/admin`](README.md)

默认管理员账号来自：

- [`INIT_ADMIN_USERNAME`](env.example:8)
- [`INIT_ADMIN_PASSWORD`](env.example:9)

## 环境变量

可参考 [`env.example`](env.example)：

- [`PORT`](env.example:1)：应用端口
- [`DB_HOST`](env.example:2)：数据库地址
- [`DB_PORT`](env.example:3)：数据库端口
- [`DB_NAME`](env.example:4)：数据库名
- [`DB_USER`](env.example:5)：数据库用户名
- [`DB_PASSWORD`](env.example:6)：数据库密码
- [`SESSION_SECRET`](env.example:7)：会话密钥
- [`INIT_ADMIN_USERNAME`](env.example:8)：初始化管理员用户名
- [`INIT_ADMIN_PASSWORD`](env.example:9)：初始化管理员密码

## 采集源

采集源支持的格式为 maccms 的 JSON / XML。

## Docker 部署

项目镜像直接使用 [`ghcr.io/notpeppa/simplecms:latest`](README.md)，不再需要本地构建。

手动拉取镜像：

```bash
docker pull ghcr.io/notpeppa/simplecms:latest
```

单容器运行示例：

```bash
docker run --rm -p 3000:3000 \
  -e PORT=3000 \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=3306 \
  -e DB_NAME=simplecms \
  -e DB_USER=root \
  -e DB_PASSWORD=123456 \
  -e SESSION_SECRET=change-me \
  -e INIT_ADMIN_USERNAME=admin \
  -e INIT_ADMIN_PASSWORD=admin123 \
  ghcr.io/notpeppa/simplecms:latest
```

## Docker Compose

项目已提供 [`docker-compose.yml`](docker-compose.yml)，其中 [`app`](docker-compose.yml:2) 服务直接使用 [`ghcr.io/notpeppa/simplecms:latest`](docker-compose.yml:3)，[`mysql`](docker-compose.yml:20) 服务使用 [`mysql:8.0`](docker-compose.yml:21)。

当前 Compose 配置中，MySQL 只在 Compose 内部网络暴露 [`3306`](docker-compose.yml:31)，不会映射到宿主机，因此只有 [`simplecms-app`](docker-compose.yml:4) 能通过服务名 [`mysql`](docker-compose.yml:10) 访问它。

启动：

```bash
docker compose up -d
```

停止：

```bash
docker compose down
```

如需连同数据库数据卷一起删除：

```bash
docker compose down -v
```

启动后可访问：

- 前台：[`http://127.0.0.1:3000`](README.md)
- MySQL：仅容器内部网络可访问

Compose 文件内容如下：

```yaml
services:
  app:
    image: ghcr.io/notpeppa/simplecms:latest
    container_name: simplecms-app
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      PORT: 3000
      DB_HOST: mysql
      DB_PORT: 3306
      DB_NAME: simplecms
      DB_USER: simplecms
      DB_PASSWORD: simplecms123
      SESSION_SECRET: change-me
      INIT_ADMIN_USERNAME: admin
      INIT_ADMIN_PASSWORD: admin123
    depends_on:
      mysql:
        condition: service_healthy

  mysql:
    image: mysql:8.0
    container_name: simplecms-mysql
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: simplecms
      MYSQL_USER: simplecms
      MYSQL_PASSWORD: simplecms123
      MYSQL_ROOT_PASSWORD: root123456
    expose:
      - "3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-proot123456"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s

volumes:
  mysql_data:
```

如果镜像是私有的，先登录 GHCR：

```bash
docker login ghcr.io
```

然后执行：

```bash
docker compose pull
docker compose up -d
```

## GitHub Actions 自动构建镜像

已新增工作流 [`docker-image.yml`](.github/workflows/docker-image.yml)，功能如下：

- push 到 [`main`](.github/workflows/docker-image.yml:5) 时自动构建
- 推送标签 [`v*`](.github/workflows/docker-image.yml:7) 时自动构建并打标签
- Pull Request 到 [`main`](.github/workflows/docker-image.yml:10) 时执行构建校验，但不会推送镜像
- 支持手动触发 [`workflow_dispatch`](.github/workflows/docker-image.yml:11)
- 非 PR 场景下会自动推送镜像到 GitHub Container Registry

### Registry 与权限说明

工作流当前发布到固定镜像地址：

- [`ghcr.io/notpeppa/simplecms:latest`](README.md)

工作流的镜像仓库基础名配置在 [`IMAGE_NAME`](.github/workflows/docker-image.yml:16)，最终推送地址前缀为 [`ghcr.io/notpeppa/simplecms`](.github/workflows/docker-image.yml:36)。

使用的是 GitHub 自带凭据：

- [`github.actor`](.github/workflows/docker-image.yml:31)
- [`secrets.GITHUB_TOKEN`](.github/workflows/docker-image.yml:32)

工作流会自动生成以下常见标签：

- 分支标签
- Git Tag 标签
- [`latest`](.github/workflows/docker-image.yml:40)（默认分支）
- Commit SHA 标签

## 目录说明

- [`src/`](src)：应用源码
- [`public/`](public)：静态资源
- [`Dockerfile`](Dockerfile)：镜像构建文件
- [`docker-compose.yml`](docker-compose.yml)：本地容器编排
- [`.github/workflows/docker-image.yml`](.github/workflows/docker-image.yml)：GitHub Actions 镜像构建流程

## 说明

- 当前应用启动时会自动执行数据库连接、建表和初始化管理员逻辑，相关入口位于 [`bootstrap()`](src/app.js:51)。
- 数据库连接配置位于 [`src/config/database.js`](src/config/database.js)。
