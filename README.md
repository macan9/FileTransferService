# FileTransferService

基于 NestJS 的文件传输服务，包含两条相对独立的能力线：

- 公共文件服务：HTTP 上传、下载、文件列表、回收站和定时清理
- P2P 传输能力：Socket.IO 信令服务和浏览器 WebRTC DataChannel 测试页

## 功能概览

- 支持 HTTP 单文件上传
- 支持文件列表查询
- 支持回收站、恢复和彻底删除
- 支持回收站定时清理
- 支持中文文件名下载
- 提供 Socket.IO 信令服务
- 提供 WebRTC P2P 文件传输测试页面

## 快速开始

安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run start:dev
```

构建：

```bash
npm run build
```

生产运行：

```bash
npm run start:prod
```

## 部署流程

当前仓库已经内置部署脚本 [deploy.sh](E:/DevProjects/FileTransferService/deploy.sh) 和 PM2 配置 [ecosystem.config.js](E:/DevProjects/FileTransferService/ecosystem.config.js)。默认部署方式是：

1. 本地执行 `deploy.sh`
2. 使用 `rsync` 将代码同步到服务器 `/srv/file-transfer-service/current`
3. 在服务器执行构建和 Prisma 迁移
4. 使用 `pm2 startOrReload` 重启服务

### 1. 部署前准备

本地环境需要：

- Node.js `20.19.0` 或更高版本
- `bash`
- `ssh`
- `rsync`

服务器需要：

- Node.js `20.19.0` 或更高版本
- `npm`、`npx`
- `pm2`
- Python 3
- 已创建部署目录 `/srv/file-transfer-service/current`

建议先在服务器安装 PM2：

```bash
npm install -g pm2
```

### 2. 配置部署脚本

部署脚本里当前写死了以下信息，如需更换服务器请先修改：

- `SERVER_USER`
- `SERVER_HOST`
- `SERVER_PORT`
- `LOCAL_DIR`
- `REMOTE_DIR`

对应文件： [deploy.sh](E:/DevProjects/FileTransferService/deploy.sh)

### 3. 服务器初始化

首次部署前，建议在服务器上手动完成以下准备：

```bash
mkdir -p /srv/file-transfer-service/current
cd /srv/file-transfer-service/current
```

然后准备生产环境变量文件 `.env`，至少包含：

```env
PORT=3100
DATABASE_URL="file:./dev.db"
FILE_TRASH_CLEANUP_ENABLED="true"
FILE_TRASH_RETENTION_DAYS="30"
FILE_TRASH_CLEANUP_CRON="0 0 * * * *"
```

说明：

- 脚本同步时会排除 `.env`，所以服务器上的 `.env` 会被保留
- 脚本同步时也会排除 `dev.db`、`uploads`、`node_modules`、`dist`
- 生产环境建议将 `PORT` 设置为 `3100`，与脚本末尾的检查地址保持一致

### 4. 执行部署

快速部署：

```bash
./deploy.sh
```

或：

```bash
./deploy.sh fast
```

完整部署：

```bash
./deploy.sh pro
```

两种模式区别：

- `fast`：只同步代码、复用服务器现有 `node_modules`、构建并重启
- `pro`：同步代码后执行 `npm ci`，适合首次部署或依赖变更后使用

如果需要临时指定 npm 镜像，可以这样执行：

```bash
NPM_REGISTRY=https://registry.npmmirror.com ./deploy.sh pro
```

### 5. 部署脚本实际做了什么

脚本会自动完成下面这些动作：

```bash
npm run build
npx prisma migrate deploy
pm2 startOrReload ecosystem.config.js --update-env
```

其中：

- 构建命令会先清理 `dist` 和 `tsconfig.tsbuildinfo`
- 构建时会自动执行 `npm run prisma:generate`
- 脚本对历史数据库做了兼容处理，会在需要时自动执行 `prisma migrate resolve`

### 6. 查看运行状态

部署完成后，可在服务器执行：

```bash
pm2 status
pm2 logs file-transfer-service
```

如果端口为 `3100`，可在服务器本机检查：

```bash
curl http://127.0.0.1:3100
```

### 7. 常见注意事项

- 首次部署请优先使用 `./deploy.sh pro`
- 如果服务器不存在 `node_modules`，执行 `fast` 模式会失败
- 如果服务器 Node.js 版本低于 `20.19.0`，脚本会直接中止
- `uploads` 和 `dev.db` 不会被部署脚本覆盖，适合保留线上数据
- 若前面还有 Nginx，请将流量反向代理到应用实际监听端口

## 主要入口

- `GET /`
- `GET /http-upload.html`
- `POST /files/upload`
- `GET /files`
- `GET /files/trash`
- `GET /files/limits`
- `GET /files/:id/download`
- `DELETE /files/:id`
- `DELETE /files/trash/:id`
- `POST /files/trash/:id/restore`
- `DELETE /files/trash`
- `GET /signaling/online-users`
- `GET /signaling/devices`
- `GET /webrtc-test.html`
- `WS /signaling`

## Device Presence Notes

Signaling now maintains device presence in memory for registration and display.

- `GET /signaling/devices`: returns all registered devices, including `online` and `offline` states
- `GET /signaling/online-users`: returns online devices only
- `client:heartbeat`: websocket heartbeat event used to refresh `lastHeartbeatAt`

Tracked device fields:

- `deviceId`: stable unique identifier used internally
- `deviceName`: display name used by the frontend list
- `platform`: device platform
- `socketId`: current signaling socket id, `null` when offline
- `status`: `online` or `offline`
- `lastHeartbeatAt`: last heartbeat timestamp
- `connectedAt`: current session connected timestamp
- `disconnectedAt`: last disconnect timestamp

## 文档说明

为了避免公共文件服务和 P2P 传输文档混在一起，文档现已拆分：

- 公共文件服务 API 文档：[doc/api.md](E:/DevProjects/FileTransferService/doc/api.md)
- P2P / WebRTC 文档：[doc/p2p-webrtc.md](E:/DevProjects/FileTransferService/doc/p2p-webrtc.md)

## 环境变量

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `DATABASE_URL` | `file:./dev.db` | SQLite 数据库连接串 |
| `FILE_TRASH_CLEANUP_ENABLED` | `true` | 是否启用回收站清理任务 |
| `FILE_TRASH_RETENTION_DAYS` | `30` | 回收站文件保留天数 |
| `FILE_TRASH_CLEANUP_CRON` | `0 0 * * * *` | 回收站清理任务 cron |

兼容旧变量：

- `FILE_CLEANUP_ENABLED`
- `FILE_RETENTION_DAYS`
- `FILE_CLEANUP_CRON`

## 补充说明

- `DELETE /files/:id` 是软删除，会将文件移入回收站
- 回收站文件不会出现在 `GET /files` 中
- `POST /files/trash/:id/restore` 可恢复单个回收站文件
- 只有回收站彻底删除接口才会删除磁盘文件
- WebRTC 相关能力当前主要用于测试页面和联调，不替代公共 HTTP 文件服务
