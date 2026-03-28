# FileTransferService

这是一个基于 NestJS 的文件传输服务，结合了 HTTP 文件管理、Socket.IO 信令，以及浏览器端的 WebRTC DataChannel 演示页面。

## 功能特性

- 支持 HTTP 文件上传、列表查询、下载和删除
- 使用 Prisma + SQLite 持久化保存文件元数据
- 提供 Socket.IO 信令服务，用于设备发现和 WebRTC 协商
- 提供浏览器端 DataChannel 文本消息测试
- 提供浏览器端点对点分片文件传输演示
- 支持过期上传文件的定时清理

## 技术栈

- NestJS
- TypeScript
- Prisma
- SQLite
- Socket.IO
- WebRTC DataChannel

## 项目结构

- `src/`：NestJS 应用源码
- `src/signaling/`：信令相关的 HTTP 与 WebSocket 逻辑
- `public/`：浏览器端演示页面资源
- `prisma/`：数据库模型与迁移文件
- `doc/`：补充说明文档

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式启动

```bash
npm run start:dev
```

### 构建项目

```bash
npm run build
```

### 运行生产构建

```bash
npm run start:prod
```

## 默认接口

- `GET /`
- `POST /files/upload`
- `GET /files`
- `GET /files/:id/download`
- `DELETE /files/:id`
- `GET /signaling/online-users`
- `GET /webrtc-test.html`
- `WS /signaling`

## 环境变量

- `PORT`：服务端口，默认 `3000`
- `DATABASE_URL`：SQLite 连接串，默认 `file:./dev.db`
- `FILE_CLEANUP_ENABLED`：是否启用清理任务，默认 `true`
- `FILE_RETENTION_DAYS`：文件保留天数，默认 `7`
- `FILE_CLEANUP_CRON`：清理任务的 cron 表达式，默认 `0 0 * * * *`

## WebRTC 演示

1. 使用 `npm run start:dev` 启动服务。
2. 在两个浏览器窗口中分别打开 `http://localhost:3000/webrtc-test.html`。
3. 在两个窗口中使用不同的 `deviceId`。
4. 两端都先连接信令服务。
5. 在其中一端填写目标设备的 `deviceId` 并发起 WebRTC 连接。
6. 当 DataChannel 状态变为 `open` 后，即可发送文本消息或传输文件。

## 说明

- 上传的文件会保存在本地 `uploads/` 目录。
- 文件元数据通过 Prisma 存储在 SQLite 中。
- 当前浏览器演示会先在内存中缓存接收到的文件分片，再进行重组。

## 更多文档

- 更多实现细节和传输协议说明，请查看 `doc/api.md`。
