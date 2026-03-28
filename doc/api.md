# 文件传输服务文档

## 项目概览

当前项目已经提供以下能力：

- 基于 NestJS 的 HTTP 文件服务
- 基于 Socket.IO 的信令服务
- WebRTC `offer / answer / candidate` 交换
- DataChannel 文本消息
- DataChannel 文件分片传输
- 浏览器端文件重组
- 发送与接收进度展示

默认访问入口：

- HTTP：`http://localhost:3000`
- 信令命名空间：`ws://localhost:3000/signaling`
- WebRTC 测试页：`http://localhost:3000/webrtc-test.html`

## 阶段 1

已实现基础信令能力：

- 用户连接
- `deviceId` 注册
- 在线列表
- 上下线广播

注册设备的请求示例：

```json
{
  "deviceId": "device-mac-001",
  "deviceName": "MacBook Pro",
  "platform": "mac"
}
```

## 阶段 2

已实现基于 WebSocket 的 WebRTC 信令转发：

- `client:offer` -> `server:offer`
- `client:answer` -> `server:answer`
- `client:candidate` -> `server:candidate`

流程示意：

```text
A -> server -> B (offer)
B -> server -> A (answer)
A/B -> server -> peer (ICE candidate)
```

## 阶段 3

已实现浏览器端 DataChannel 演示：

- 创建 `RTCPeerConnection`
- 创建 `RTCDataChannel('chat')`
- 发送普通字符串消息
- 测试 `ping` JSON 消息

测试页面：

- [webrtc-test.html](E:\DevProjects\FileTransferService\public\webrtc-test.html)
- [webrtc-test.js](E:\DevProjects\FileTransferService\public\webrtc-test.js)

## 阶段 4

已实现 DataChannel 文件传输核心能力：

- 文件分片切割
- 二进制分片发送
- 分片序号头部
- 接收端分片缓存
- 重组为 `Blob`
- 生成下载链接
- 发送进度条
- 接收进度条

### 传输协议

浏览器演示页使用同一个 DataChannel 同时传输文本消息和文件内容。

发送文件分片前先发送控制消息：

```json
{
  "type": "file-meta",
  "transferId": "file-1711111111111-abcd12",
  "fileName": "demo.png",
  "fileSize": 245760,
  "mimeType": "image/png",
  "chunkSize": 16384,
  "totalChunks": 15
}
```

所有分片发送完成后，再发送完成控制消息：

```json
{
  "type": "file-complete",
  "transferId": "file-1711111111111-abcd12"
}
```

二进制包格式：

```text
4 bytes: chunk index (uint32)
N bytes: chunk payload
```

### 浏览器演示行为

发送端：

1. 选择文件
2. 发送 `file-meta`
3. 将文件按 `16 KB` 切片
4. 在每个分片前加上 `4-byte` 的 chunk index 头部
5. 通过 DataChannel 发送每个二进制包
6. 更新发送进度 UI
7. 发送 `file-complete`

接收端：

1. 接收 `file-meta`
2. 初始化当前传输状态
3. 接收二进制分片
4. 按索引缓存各个分片
5. 更新接收进度 UI
6. 将所有分片重组为 `Blob`
7. 生成浏览器下载链接

## HTTP 接口

- `GET /`
- `POST /files/upload`
- `GET /files`
- `GET /files/:id/download`
- `DELETE /files/:id`
- `GET /signaling/online-users`
- `GET /webrtc-test.html`

## 环境变量

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `DATABASE_URL` | `file:./dev.db` | SQLite 连接串 |
| `FILE_CLEANUP_ENABLED` | `true` | 是否启用清理任务 |
| `FILE_RETENTION_DAYS` | `7` | 文件保留天数 |
| `FILE_CLEANUP_CRON` | `0 0 * * * *` | 清理任务 cron 表达式 |

## 文件传输测试方法

1. 使用 `npm run start:dev` 启动服务
2. 在两个浏览器窗口中打开 `http://localhost:3000/webrtc-test.html`
3. 两个窗口分别填写不同的 `deviceId`
4. 两端都点击 `Connect Signaling`
5. 在 A 端输入 B 端的 `deviceId`
6. 点击 `Start WebRTC`
7. 等待 `DataChannel` 状态变为 `open`
8. 在任意一端选择文件
9. 点击 `Send File`
10. 等待接收端进度到达 100%
11. 点击接收端生成的下载链接

## 当前限制

- 浏览器演示目前一次只处理一个活动中的入站文件传输
- 接收到的文件分片会先缓存在内存中，再提供下载
- 暂不支持断点续传或失败重试
- 暂未实现校验和验证

## 下一步建议

下一阶段比较适合继续完善这些能力：

- 传输会话 ID 管理
- 多文件队列
- 分片确认与重发
- 校验和验证
- 大文件背压控制
- 中断后续传
