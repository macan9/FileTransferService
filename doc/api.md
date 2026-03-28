# 文件传输服务接口文档

## 文件列表与回收站

### `GET /files`

返回当前未删除的文件列表，也就是“已上传文件列表”。

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

### `GET /files/trash`

返回回收站中的文件列表。

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

## 文件上传与下载

### `POST /files/upload`

上传单个文件，表单字段名为 `file`。

### `GET /files/:id/download`

下载当前未删除的文件。

说明：

- 回收站中的文件不允许通过该接口下载。
- 响应头会尽量保留原始文件名，并兼容中文文件名。

## 删除与回收站

### `DELETE /files/:id`

将文件移入回收站，不会立即删除磁盘文件。

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

### `DELETE /files/trash/:id`

彻底删除回收站中的单个文件，会删除数据库记录和磁盘文件。

响应示例：

```json
{
  "id": 9,
  "originalName": "旧版本.zip",
  "filename": "1743158800000-550e8400-e29b-41d4-a716-446655440001.zip",
  "permanentlyDeleted": true
}
```

### `POST /files/trash/:id/restore`

从回收站恢复单个文件，恢复后该文件会重新出现在 `GET /files` 列表中。

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

### `DELETE /files/trash`

清空回收站，彻底删除回收站中的全部文件。

响应示例：

```json
{
  "cleared": true,
  "deletedCount": 3,
  "totalCount": 3
}
```

当回收站为空时：

```json
{
  "cleared": true,
  "deletedCount": 0
}
```

## 回收站定时清理

服务会定时清理“已经移入回收站”的文件，默认保留 30 天。

环境变量：

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `FILE_TRASH_CLEANUP_ENABLED` | `true` | 是否启用回收站清理任务 |
| `FILE_TRASH_RETENTION_DAYS` | `30` | 回收站文件保留天数 |
| `FILE_TRASH_CLEANUP_CRON` | `0 0 * * * *` | 回收站清理任务的 cron 表达式 |

兼容说明：

- 服务仍兼容旧变量 `FILE_CLEANUP_ENABLED`、`FILE_RETENTION_DAYS`、`FILE_CLEANUP_CRON`。
- 如果新旧变量同时存在，优先使用新的 `FILE_TRASH_*` 配置。

## 其他接口

### `GET /files/limits`

返回单文件大小限制、总存储限制和当前占用情况。

### `GET /`

返回服务基础信息和主要接口入口。
