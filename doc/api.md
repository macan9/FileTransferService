# 公共文件服务 API 文档

本文档仅描述公共文件服务相关的 HTTP 接口，包括上传、下载、文件列表、回收站和容量限制。

P2P 传输、WebRTC 信令和测试页面请查看：
[doc/p2p-webrtc.md](E:\DevProjects\FileTransferService\doc\p2p-webrtc.md)

## 基础说明

- 默认服务端口：`3000`
- 基础地址示例：`http://localhost:3000`
- 文件上传字段名：`file`
- 上传目录：`<项目根目录>/uploads`
- 静态演示页：`GET /http-upload.html`

## 接口概览

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/` | `GET` | 返回服务基础信息和接口入口 |
| `/files/upload` | `POST` | 上传单个文件 |
| `/files` | `GET` | 获取未删除文件列表 |
| `/files/limits` | `GET` | 获取大小限制、总容量限制和当前占用 |
| `/files/:id/download` | `GET` | 下载指定文件 |
| `/files/:id` | `DELETE` | 软删除文件，移入回收站 |
| `/files/trash` | `GET` | 获取回收站文件列表 |
| `/files/trash/:id` | `DELETE` | 彻底删除单个回收站文件 |
| `/files/trash/:id/restore` | `POST` | 恢复单个回收站文件 |
| `/files/trash` | `DELETE` | 清空回收站 |

## `GET /`

返回服务状态、接口入口和回收站清理配置。

响应示例：

```json
{
  "message": "File transfer service is running",
  "endpoints": {
    "upload": "POST /files/upload",
    "httpUploadDemo": "GET /http-upload.html",
    "list": "GET /files",
    "trashList": "GET /files/trash",
    "download": "GET /files/:id/download",
    "delete": "DELETE /files/:id",
    "permanentlyDeleteTrashItem": "DELETE /files/trash/:id",
    "restoreTrashItem": "POST /files/trash/:id/restore",
    "emptyTrash": "DELETE /files/trash",
    "onlineUsers": "GET /signaling/online-users",
    "websocket": "WS /signaling",
    "webrtcDemo": "GET /webrtc-test.html"
  },
  "trashCleanup": {
    "enabled": true,
    "cron": "0 0 * * * *",
    "retentionDays": 30
  }
}
```

说明：

- 返回内容中会包含 P2P 相关入口，但这些内容不属于本文档范围。

## `POST /files/upload`

上传单个文件，表单字段名必须为 `file`。

请求示例：

```bash
curl -X POST "http://localhost:3000/files/upload" ^
  -F "file=@E:\test\demo.pdf"
```

成功响应示例：

```json
{
  "id": 12,
  "originalName": "demo.pdf",
  "filename": "1743158891000-550e8400-e29b-41d4-a716-446655440000.pdf",
  "mimeType": "application/pdf",
  "size": 102400,
  "url": "/files/12/download",
  "createdAt": "2026-03-28T09:15:10.000Z"
}
```

说明：

- 单文件大小上限为 `200 MB`。
- 上传时会进行文件名有效性校验。
- 服务端会对 HTTP 上传速率做限速处理。
- 当上传目录总容量超过限制时，接口会返回 `413 Payload Too Large`。

常见失败情况：

- 未传文件：返回校验错误。
- 文件超过单文件上限：返回 `413`。
- 存储空间不足：返回 `413`。

## `GET /files`

返回当前未删除文件列表，按 `createdAt` 倒序排列。

响应示例：

```json
[
  {
    "id": 12,
    "originalName": "需求说明.docx",
    "filename": "1743158891000-550e8400-e29b-41d4-a716-446655440000.docx",
    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "size": 102400,
    "storagePath": "E:\\DevProjects\\FileTransferService\\uploads\\1743158891000-550e8400-e29b-41d4-a716-446655440000.docx",
    "url": "/files/12/download",
    "createdAt": "2026-03-28T09:15:10.000Z",
    "deletedAt": null
  }
]
```

## `GET /files/trash`

返回回收站文件列表，按 `deletedAt` 倒序排列。

响应示例：

```json
[
  {
    "id": 9,
    "originalName": "旧版本.zip",
    "filename": "1743158800000-550e8400-e29b-41d4-a716-446655440001.zip",
    "mimeType": "application/zip",
    "size": 204800,
    "storagePath": "E:\\DevProjects\\FileTransferService\\uploads\\1743158800000-550e8400-e29b-41d4-a716-446655440001.zip",
    "url": "/files/9/download",
    "createdAt": "2026-03-20T02:10:00.000Z",
    "deletedAt": "2026-03-25T08:00:00.000Z"
  }
]
```

## `GET /files/limits`

返回单文件大小限制、上传目录总容量限制、当前已占用空间和 HTTP 传输速率限制。

响应示例：

```json
{
  "singleFileLimitBytes": 209715200,
  "totalUploadsLimitBytes": 1073741824,
  "currentUsageBytes": 15728640,
  "remainingBytes": 1058013184,
  "transferRateLimitBytesPerSecond": 2097152
}
```

字段说明：

- `singleFileLimitBytes`：单文件最大体积。
- `totalUploadsLimitBytes`：上传目录总容量限制。
- `currentUsageBytes`：当前上传目录已占用空间。
- `remainingBytes`：剩余可用空间。
- `transferRateLimitBytesPerSecond`：HTTP 上传/下载限速值。

## `GET /files/:id/download`

下载指定的未删除文件。

行为说明：

- 仅允许下载未删除文件。
- 如果文件不存在，返回 `404`。
- 如果文件已在回收站中，返回 `404`。
- 响应头会尽量保留原始文件名，并兼容中文文件名。
- 下载流会应用 HTTP 限速。

请求示例：

```bash
curl -L "http://localhost:3000/files/12/download" -o demo.pdf
```

## `DELETE /files/:id`

软删除文件，将文件标记为已删除并移入回收站。

响应示例：

```json
{
  "id": 12,
  "originalName": "需求说明.docx",
  "filename": "1743158891000-550e8400-e29b-41d4-a716-446655440000.docx",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "size": 102400,
  "storagePath": "E:\\DevProjects\\FileTransferService\\uploads\\1743158891000-550e8400-e29b-41d4-a716-446655440000.docx",
  "url": "/files/12/download",
  "createdAt": "2026-03-28T09:15:10.000Z",
  "deletedAt": "2026-03-28T09:20:00.000Z",
  "message": "File moved to trash.",
  "deleted": true
}
```

说明：

- 这是软删除，不会立即删除磁盘文件。
- 删除后该文件不会再出现在 `GET /files` 中。

## `POST /files/trash/:id/restore`

从回收站恢复单个文件。

响应示例：

```json
{
  "id": 9,
  "originalName": "旧版本.zip",
  "filename": "1743158800000-550e8400-e29b-41d4-a716-446655440001.zip",
  "mimeType": "application/zip",
  "size": 204800,
  "storagePath": "E:\\DevProjects\\FileTransferService\\uploads\\1743158800000-550e8400-e29b-41d4-a716-446655440001.zip",
  "url": "/files/9/download",
  "createdAt": "2026-03-20T02:10:00.000Z",
  "deletedAt": null,
  "restored": true,
  "message": "File restored from trash."
}
```

说明：

- 恢复前会检查对应磁盘文件是否仍然存在。
- 恢复成功后，该文件会重新出现在 `GET /files` 中。

## `DELETE /files/trash/:id`

彻底删除单个回收站文件，会删除数据库记录和磁盘文件。

响应示例：

```json
{
  "id": 9,
  "originalName": "旧版本.zip",
  "filename": "1743158800000-550e8400-e29b-41d4-a716-446655440001.zip",
  "permanentlyDeleted": true
}
```

## `DELETE /files/trash`

清空回收站，尝试删除全部回收站文件。

回收站非空时响应示例：

```json
{
  "cleared": true,
  "deletedCount": 3,
  "totalCount": 3
}
```

回收站为空时响应示例：

```json
{
  "cleared": true,
  "deletedCount": 0
}
```

说明：

- 删除过程中如果某个文件失败，接口仍会继续尝试删除其他文件。
- `deletedCount` 表示实际成功删除的数量。

## 回收站定时清理

服务会按定时任务清理回收站中过期文件。

默认行为：

- 默认启用
- 默认保留 `30` 天
- 默认 cron：`0 0 * * * *`

相关环境变量：

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `FILE_TRASH_CLEANUP_ENABLED` | `true` | 是否启用回收站清理任务 |
| `FILE_TRASH_RETENTION_DAYS` | `30` | 回收站文件保留天数 |
| `FILE_TRASH_CLEANUP_CRON` | `0 0 * * * *` | 回收站清理任务的 cron 表达式 |

兼容旧变量：

| 旧变量名 | 新变量名 |
| --- | --- |
| `FILE_CLEANUP_ENABLED` | `FILE_TRASH_CLEANUP_ENABLED` |
| `FILE_RETENTION_DAYS` | `FILE_TRASH_RETENTION_DAYS` |
| `FILE_CLEANUP_CRON` | `FILE_TRASH_CLEANUP_CRON` |

说明：

- 当新旧变量同时存在时，优先使用 `FILE_TRASH_*` 配置。
- 当保留天数小于等于 `0` 时，定时任务会跳过实际清理。
