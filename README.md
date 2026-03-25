# simplecms

一个基于 Node.js、Express、EJS 和 MySQL 的轻量 CMS，主要面向采集和基础内容管理场景。

## 环境要求

- Node.js 20+
- MySQL 8.0+
- Docker / Docker Compose（可选）

## 本地开发

1. 复制环境变量模板：

```bash
cp env.example .env
```

2. 按需修改 [`.env`](.env.example) 中的数据库和管理员配置。

3. 安装依赖：

```bash
npm install
```

4. 启动项目：

```bash
npm run dev
```

默认访问地址：[`http://127.0.0.1:3000`](README.md)

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

## Docker 构建

项目已提供 [`Dockerfile`](Dockerfile)，可直接本地构建镜像：

```bash
docker build -t simplecms:local .
```

运行容器示例：

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
  simplecms:local
```

## Docker Compose

项目已提供 [`docker-compose.yml`](docker-compose.yml)，包含：

- [`app`](docker-compose.yml:3)：Node.js 应用服务
- [`mysql`](docker-compose.yml:20)：MySQL 8 数据库服务

启动：

```bash
docker compose up -d --build
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
- MySQL：[`127.0.0.1:3306`](README.md)

Compose 默认数据库配置见 [`docker-compose.yml`](docker-compose.yml:11) 和 [`docker-compose.yml`](docker-compose.yml:25)。

## GitHub Actions 自动构建镜像

已新增工作流 [`docker-image.yml`](.github/workflows/docker-image.yml)，功能如下：

- push 到 [`main`](.github/workflows/docker-image.yml:5) 时自动构建
- 推送标签 [`v*`](.github/workflows/docker-image.yml:7) 时自动构建并打标签
- Pull Request 到 [`main`](.github/workflows/docker-image.yml:10) 时执行构建校验，但不会推送镜像
- 支持手动触发 [`workflow_dispatch`](.github/workflows/docker-image.yml:11)

### 需要配置的 GitHub Secrets

在仓库 Secrets 中添加：

- [`DOCKERHUB_USERNAME`](.github/workflows/docker-image.yml:14)
- [`DOCKERHUB_TOKEN`](.github/workflows/docker-image.yml:31)

镜像名默认使用：

- [`docker.io/<DOCKERHUB_USERNAME>/simplecms`](.github/workflows/docker-image.yml:14)

工作流会自动生成以下常见标签：

- 分支标签
- Git Tag 标签
- [`latest`](.github/workflows/docker-image.yml:38)（默认分支）
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
