# FileTransferService

基于 NestJS 的文件传输服务，包含 HTTP 文件上传下载、文件列表管理、回收站机制，以及浏览器端 WebRTC DataChannel 示例页面。

## 功能概览

- 支持 HTTP 单文件上传
- 支持当前文件列表查询
- 支持文件移入回收站
- 支持回收站列表查询
- 支持回收站单个彻底删除
- 支持清空回收站
- 支持回收站定时清理，默认保留 30 天
- 支持中文文件名下载响应头
- 提供 Socket.IO 信令服务和 WebRTC 示例页面

## 运行方式

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

## 主要接口

- `GET /`
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
- `GET /webrtc-test.html`
- `WS /signaling`

## 环境变量

- `PORT`：服务端口，默认 `3000`
- `DATABASE_URL`：SQLite 连接串，默认 `file:./dev.db`
- `FILE_TRASH_CLEANUP_ENABLED`：是否启用回收站清理任务，默认 `true`
- `FILE_TRASH_RETENTION_DAYS`：回收站文件保留天数，默认 `30`
- `FILE_TRASH_CLEANUP_CRON`：回收站清理任务 cron，默认 `0 0 * * * *`

兼容旧配置：

- `FILE_CLEANUP_ENABLED`
- `FILE_RETENTION_DAYS`
- `FILE_CLEANUP_CRON`

## 说明

- 已删除文件不会出现在 `GET /files` 中，只会出现在 `GET /files/trash`
- `DELETE /files/:id` 为软删除，会把文件移入回收站
- `POST /files/trash/:id/restore` 可将单个文件从回收站恢复
- 只有回收站接口才会真正删除磁盘文件
- 详细接口说明见 [doc/api.md](E:\DevProjects\FileTransferService\doc\api.md)
