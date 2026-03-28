# FileTransferService

基于 NestJS 的文件传输服务，包含两条独立能力线：

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
- `GET /webrtc-test.html`
- `WS /signaling`

## 文档说明

为了避免公共文件服务和 P2P 传输文档混在一起，文档现已拆分：

- 公共文件服务 API 文档：[doc/api.md](E:\DevProjects\FileTransferService\doc\api.md)
- P2P / WebRTC 文档：[doc/p2p-webrtc.md](E:\DevProjects\FileTransferService\doc\p2p-webrtc.md)

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
- WebRTC 相关能力当前主要用于测试页和联调，不替代公共 HTTP 文件服务
