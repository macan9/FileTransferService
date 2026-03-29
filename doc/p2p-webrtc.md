# P2P 传输与 WebRTC 文档

本文档描述项目中的 P2P 传输能力，包括设备在线状态、连接请求、会话管理、WebRTC 信令协商、DataChannel 文件传输以及传输历史查询。

公共文件服务 HTTP 接口请查看：
[doc/api.md](E:\DevProjects\FileTransferService\doc\api.md)

## 功能范围

当前项目中的 P2P 方案由四层组成：

- 设备层：基于 Socket.IO 的设备注册、心跳与在线状态维护
- 连接请求层：A 向 B 发起连接请求，由 B 决定是否接受
- 会话层：表示两台设备之间已建立的一条连接关系，同一对设备同时只保留一条活动会话
- 传输层：基于 WebRTC `RTCPeerConnection` 和 `RTCDataChannel` 实现文本消息与文件分片传输，并记录每次传输历史

当前还提供一个浏览器测试页：

- `GET /webrtc-test.html`

## 状态机约定

为了降低前后端复杂度，当前实现采用固定状态机。

### 设备状态

- `offline`
- `online`
- `stale`

说明：

- `online`：设备已注册且心跳正常
- `stale`：设备连接仍存在，但心跳超时，不能继续作为在线目标使用
- `offline`：设备 socket 已断开

### 连接请求状态

- `pending`
- `accepted`
- `rejected`
- `cancelled`
- `expired`

### 会话状态

- `connecting`
- `active`
- `closed`
- `failed`

### 传输状态

- `pending`
- `sending`
- `receiving`
- `received`
- `sent`
- `failed`
- `cancelled`

## 整体流程

推荐的完整链路如下：

1. 两端设备连接 `/signaling`
2. 两端发送 `client:register` 完成设备注册
3. 客户端按固定周期发送 `client:heartbeat`
4. A 通过 `client:connection-request` 向 B 发起连接请求
5. B 通过 `client:connection-request:respond` 接受或拒绝
6. 请求被接受后，服务端为这一对设备创建或复用一条 `connecting` 会话
7. 双方通过 `client:offer`、`client:answer`、`client:candidate` 完成 WebRTC 协商
8. `answer` 转发成功后，会话状态变为 `active`
9. 基于该 `active` 会话发起文件传输，传输状态由双方事件共同驱动
10. 历史传输记录通过 HTTP 接口分页查询、隐藏或逻辑删除

## 访问入口

### 浏览器与信令入口

| 入口 | 方法 | 说明 |
| --- | --- | --- |
| `/webrtc-test.html` | `GET` | WebRTC P2P 调试页面 |
| `/signaling` | `WS` | Socket.IO 信令命名空间 |
| `/signaling/devices` | `GET` | 查询全部设备状态 |
| `/signaling/online-users` | `GET` | 查询当前在线设备 |
| `/signaling/connection-requests` | `GET` | 查询连接请求列表 |
| `/signaling/sessions` | `GET` | 查询会话列表 |

### 传输历史接口

| 入口 | 方法 | 说明 |
| --- | --- | --- |
| `/transfers` | `GET` | 分页查询传输记录 |
| `/transfers/:id` | `GET` | 查询单条传输记录详情 |
| `/transfers/:id` | `PATCH` | 隐藏或恢复一条传输记录 |
| `/transfers/:id` | `DELETE` | 逻辑删除一条传输记录 |

## 数据模型

### 设备 `device`

用于设备在线注册和展示。

字段：

- `deviceId`：稳定唯一标识，前后端内部使用
- `deviceName`：展示名称
- `platform`：设备平台
- `socketId`：当前信令连接，离线时为 `null`
- `status`：`offline / online / stale`
- `lastHeartbeatAt`
- `connectedAt`
- `disconnectedAt`

示例：

```json
{
  "deviceId": "device-a",
  "deviceName": "Windows A",
  "platform": "windows",
  "socketId": "oC8aG6xN4K7z",
  "status": "online",
  "lastHeartbeatAt": "2026-03-29T02:00:00.000Z",
  "connectedAt": "2026-03-29T01:59:30.000Z",
  "disconnectedAt": null
}
```

### 连接请求 `connection_request`

用于 A 向 B 发起连接请求，B 决定是否接受。

字段：

- `id`
- `requestId`
- `fromDeviceId`
- `toDeviceId`
- `status`
- `message`
- `createdAt`
- `respondedAt`
- `expiredAt`

示例：

```json
{
  "id": "66116eb7-3ed0-4f3f-a0ca-0d5c34925fef",
  "requestId": "53033d46-9db2-4d95-b790-3f8c0c9c9210",
  "fromDeviceId": "device-a",
  "toDeviceId": "device-b",
  "status": "pending",
  "message": "请求建立直连通道",
  "createdAt": "2026-03-29T02:00:00.000Z",
  "respondedAt": null,
  "expiredAt": "2026-03-29T02:01:00.000Z"
}
```

### 会话 `session`

用于表示两台设备之间已经建立的一条会话。

字段：

- `id`
- `sessionId`
- `deviceAId`
- `deviceBId`
- `status`
- `createdByDeviceId`
- `createdAt`
- `connectedAt`
- `closedAt`
- `closeReason`

说明：

- 同一对设备之间同时只保留一条活动会话
- `connecting` 和 `active` 视为活动会话
- 后续双向发文件都应复用这条会话

示例：

```json
{
  "id": "db1fc2d6-5538-40d3-a8d7-29263a3d2d0f",
  "sessionId": "89276fe7-6f35-46a2-bd33-c1f70401b602",
  "deviceAId": "device-a",
  "deviceBId": "device-b",
  "status": "active",
  "createdByDeviceId": "device-b",
  "createdAt": "2026-03-29T02:01:10.000Z",
  "connectedAt": "2026-03-29T02:01:20.000Z",
  "closedAt": null,
  "closeReason": null
}
```

### 传输记录 `transfer_record`

用于记录每一次文件传输任务。

字段：

- `id`
- `transferId`
- `sessionId`
- `senderDeviceId`
- `receiverDeviceId`
- `fileName`
- `fileSize`
- `mimeType`
- `direction`
- `status`
- `errorMessage`
- `createdAt`
- `startedAt`
- `completedAt`

当前实现另外维护：

- `hiddenAt`：前台隐藏时间
- `deletedAt`：逻辑删除时间

示例：

```json
{
  "id": "b1b61f1d-7100-4f1e-ac4a-e74cf65dc8d5",
  "transferId": "aa0d3fc1-7b53-4d5b-a881-ec6a8022d964",
  "sessionId": "89276fe7-6f35-46a2-bd33-c1f70401b602",
  "senderDeviceId": "device-a",
  "receiverDeviceId": "device-b",
  "fileName": "demo.pdf",
  "fileSize": 102400,
  "mimeType": "application/pdf",
  "direction": "device-a->device-b",
  "status": "receiving",
  "errorMessage": null,
  "createdAt": "2026-03-29T02:05:00.000Z",
  "startedAt": "2026-03-29T02:05:02.000Z",
  "completedAt": null
}
```

## HTTP 接口

### `GET /signaling/devices`

返回全部已注册设备，包括 `offline`、`online`、`stale`。

响应示例：

```json
{
  "total": 2,
  "users": [
    {
      "deviceId": "device-a",
      "deviceName": "Windows A",
      "platform": "windows",
      "socketId": "socket-a",
      "status": "online",
      "lastHeartbeatAt": "2026-03-29T02:00:00.000Z",
      "connectedAt": "2026-03-29T01:59:30.000Z",
      "disconnectedAt": null
    },
    {
      "deviceId": "device-b",
      "deviceName": "Mac B",
      "platform": "mac",
      "socketId": null,
      "status": "offline",
      "lastHeartbeatAt": "2026-03-29T01:58:10.000Z",
      "connectedAt": "2026-03-29T01:57:00.000Z",
      "disconnectedAt": "2026-03-29T01:58:45.000Z"
    }
  ]
}
```

### `GET /signaling/online-users`

返回当前在线设备列表，只包含 `status = online` 的设备。

### `GET /signaling/connection-requests`

返回当前连接请求列表。

响应示例：

```json
{
  "total": 1,
  "requests": [
    {
      "id": "66116eb7-3ed0-4f3f-a0ca-0d5c34925fef",
      "requestId": "53033d46-9db2-4d95-b790-3f8c0c9c9210",
      "fromDeviceId": "device-a",
      "toDeviceId": "device-b",
      "status": "pending",
      "message": "请求建立直连通道",
      "createdAt": "2026-03-29T02:00:00.000Z",
      "respondedAt": null,
      "expiredAt": "2026-03-29T02:01:00.000Z"
    }
  ]
}
```

### `GET /signaling/sessions`

返回当前会话列表。

响应示例：

```json
{
  "total": 1,
  "sessions": [
    {
      "id": "db1fc2d6-5538-40d3-a8d7-29263a3d2d0f",
      "sessionId": "89276fe7-6f35-46a2-bd33-c1f70401b602",
      "deviceAId": "device-a",
      "deviceBId": "device-b",
      "status": "active",
      "createdByDeviceId": "device-b",
      "createdAt": "2026-03-29T02:01:10.000Z",
      "connectedAt": "2026-03-29T02:01:20.000Z",
      "closedAt": null,
      "closeReason": null
    }
  ]
}
```

### `GET /transfers`

分页查询传输记录。

支持查询参数：

- `deviceId`
- `sessionId`
- `status`
- `dateFrom`
- `dateTo`
- `page`
- `pageSize`
- `includeHidden`
- `includeDeleted`

响应示例：

```json
{
  "total": 3,
  "page": 1,
  "pageSize": 20,
  "items": [
    {
      "id": "b1b61f1d-7100-4f1e-ac4a-e74cf65dc8d5",
      "transferId": "aa0d3fc1-7b53-4d5b-a881-ec6a8022d964",
      "sessionId": "89276fe7-6f35-46a2-bd33-c1f70401b602",
      "senderDeviceId": "device-a",
      "receiverDeviceId": "device-b",
      "fileName": "demo.pdf",
      "fileSize": 102400,
      "mimeType": "application/pdf",
      "direction": "device-a->device-b",
      "status": "sent",
      "errorMessage": null,
      "createdAt": "2026-03-29T02:05:00.000Z",
      "startedAt": "2026-03-29T02:05:02.000Z",
      "completedAt": "2026-03-29T02:05:10.000Z",
      "hiddenAt": null,
      "deletedAt": null
    }
  ]
}
```

### `GET /transfers/:id`

按 `id` 或 `transferId` 查询单条传输记录。

### `PATCH /transfers/:id`

只允许修改可见性，不允许任意修改状态。

请求体：

```json
{
  "action": "hide"
}
```

或：

```json
{
  "action": "restore"
}
```

### `DELETE /transfers/:id`

逻辑删除一条传输记录，不会真正物理删除服务端文件内容。

## Socket.IO 连接方式

```js
const socket = window.io('/signaling', { transports: ['websocket'] });
```

服务端网关特性：

- 命名空间：`/signaling`
- CORS：`origin: '*'`
- 设备注册采用 `deviceId` 作为逻辑唯一标识
- 同一个 `deviceId` 重复注册时，旧连接会被踢下线
- 心跳超时后设备进入 `stale`
- 同一对设备同时只保留一条活动会话

## 服务端主动事件

### `server:welcome`

连接成功后立即返回基础说明。

示例：

```json
{
  "socketId": "oC8aG6xN4K7z",
  "message": "Connected to signaling server",
  "registerEvent": "client:register",
  "heartbeatEvent": "client:heartbeat",
  "connectionRequestEvents": {
    "create": "client:connection-request",
    "respond": "client:connection-request:respond",
    "cancel": "client:connection-request:cancel"
  },
  "sessionEvents": {
    "close": "client:session:close",
    "updated": "server:session-updated"
  },
  "transferEvents": {
    "start": "client:transfer-start",
    "progress": "client:transfer-progress",
    "complete": "client:transfer-complete",
    "failed": "client:transfer-failed",
    "cancel": "client:transfer-cancel",
    "updated": "server:transfer-updated"
  },
  "onlineListEvent": "server:online-list",
  "heartbeatTimeoutMs": 30000,
  "connectionRequestTimeoutMs": 60000,
  "rtcEvents": {
    "offer": "client:offer",
    "answer": "client:answer",
    "candidate": "client:candidate"
  }
}
```

### `server:registered`

当前连接注册成功后返回。

### `server:online-list`

广播当前在线设备列表。

### `server:user-online`

有新设备上线时广播。

### `server:user-stale`

设备心跳超时时广播，表示该设备变为 `stale`。

### `server:user-offline`

设备断开 socket 时广播。

### `server:force-disconnect`

相同 `deviceId` 从新连接登录时，旧连接会收到此事件并被断开。

### `server:connection-request`

向目标设备推送一条新的连接请求。

### `server:connection-request-updated`

连接请求状态变化时，推送给请求双方。

### `server:session-updated`

会话状态变化时，推送给会话双方。

### `server:transfer-updated`

传输记录状态变化时，推送给传输双方。

### `server:offer`

服务端转发来自对端的 `offer`。

### `server:answer`

服务端转发来自对端的 `answer`。

### `server:candidate`

服务端转发来自对端的 ICE 候选。

## 客户端发送事件

### `client:register`

用于设备注册。

请求体：

```json
{
  "deviceId": "device-a",
  "deviceName": "Windows A",
  "platform": "windows"
}
```

成功 ack 示例：

```json
{
  "success": true,
  "user": {
    "deviceId": "device-a",
    "deviceName": "Windows A",
    "platform": "windows",
    "socketId": "oC8aG6xN4K7z",
    "status": "online",
    "lastHeartbeatAt": "2026-03-29T02:00:00.000Z",
    "connectedAt": "2026-03-29T01:59:30.000Z",
    "disconnectedAt": null
  },
  "onlineUsers": []
}
```

### `client:heartbeat`

用于刷新设备心跳。

请求体：

```json
{}
```

成功 ack 示例：

```json
{
  "success": true,
  "user": {
    "deviceId": "device-a",
    "deviceName": "Windows A",
    "platform": "windows",
    "socketId": "oC8aG6xN4K7z",
    "status": "online",
    "lastHeartbeatAt": "2026-03-29T02:00:00.000Z",
    "connectedAt": "2026-03-29T01:59:30.000Z",
    "disconnectedAt": null
  },
  "serverTime": "2026-03-29T02:00:00.000Z"
}
```

### `client:connection-request`

用于发起连接请求。

请求体：

```json
{
  "toDeviceId": "device-b",
  "message": "请求建立直连通道"
}
```

### `client:connection-request:respond`

用于目标设备接受或拒绝请求。

请求体：

```json
{
  "requestId": "53033d46-9db2-4d95-b790-3f8c0c9c9210",
  "status": "accepted"
}
```

### `client:connection-request:cancel`

用于请求发起方取消请求。

请求体：

```json
{
  "requestId": "53033d46-9db2-4d95-b790-3f8c0c9c9210"
}
```

### `client:session:close`

用于会话参与方主动关闭会话。

请求体：

```json
{
  "sessionId": "89276fe7-6f35-46a2-bd33-c1f70401b602",
  "closeReason": "User closed session"
}
```

### `client:offer`

发起 WebRTC 建链。

请求体：

```json
{
  "targetDeviceId": "device-b",
  "offer": {
    "type": "offer",
    "sdp": "..."
  }
}
```

### `client:answer`

回传 `answer`。

请求体：

```json
{
  "targetDeviceId": "device-a",
  "answer": {
    "type": "answer",
    "sdp": "..."
  }
}
```

说明：

- `answer` 转发成功后，服务端会尝试将该设备对对应的会话状态从 `connecting` 推进为 `active`

### `client:candidate`

发送 ICE 候选。

请求体：

```json
{
  "targetDeviceId": "device-b",
  "candidate": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

### `client:transfer-start`

发起一条文件传输记录。

请求体：

```json
{
  "sessionId": "89276fe7-6f35-46a2-bd33-c1f70401b602",
  "receiverDeviceId": "device-b",
  "fileName": "demo.pdf",
  "fileSize": 102400,
  "mimeType": "application/pdf"
}
```

说明：

- 只能挂在 `active` 会话下
- 接口创建传输记录时状态为 `pending`

### `client:transfer-progress`

用于推进传输中的状态。

请求体：

```json
{
  "transferId": "aa0d3fc1-7b53-4d5b-a881-ec6a8022d964",
  "status": "sending"
}
```

或：

```json
{
  "transferId": "aa0d3fc1-7b53-4d5b-a881-ec6a8022d964",
  "status": "receiving"
}
```

约束：

- 发送方只能上报 `sending`
- 接收方只能上报 `receiving`

### `client:transfer-complete`

用于推进传输完成状态。

请求体：

```json
{
  "transferId": "aa0d3fc1-7b53-4d5b-a881-ec6a8022d964"
}
```

约束：

- 接收方调用时会推进到 `received`
- 发送方只有在对方已 `received` 后，才能推进到 `sent`

### `client:transfer-failed`

用于标记传输失败。

请求体：

```json
{
  "transferId": "aa0d3fc1-7b53-4d5b-a881-ec6a8022d964",
  "errorMessage": "DataChannel closed unexpectedly"
}
```

### `client:transfer-cancel`

用于取消传输。

请求体：

```json
{
  "transferId": "aa0d3fc1-7b53-4d5b-a881-ec6a8022d964",
  "errorMessage": "Cancelled by user"
}
```

## 传输状态流转建议

当前实现按“双方事件共同驱动”的原则推进传输状态，推荐前端遵循以下顺序：

1. A 调用 `client:transfer-start`，创建 `pending`
2. DataChannel 真正开始发送时，A 调用 `client:transfer-progress` 上报 `sending`
3. B 收到文件 metadata 或开始接收内容时，B 调用 `client:transfer-progress` 上报 `receiving`
4. B 收齐全部数据并校验成功后，B 调用 `client:transfer-complete`，状态变 `received`
5. A 收到来自 B 的业务确认后，A 再调用 `client:transfer-complete`，状态变 `sent`

这样可以避免“发送方以为成功，接收方实际未收全”的假成功问题。

## WebRTC 传输实现

### 当前实现内容

项目中的浏览器端 P2P 功能已经包含：

- `RTCPeerConnection`
- `RTCDataChannel`
- `offer / answer / ICE candidate` 交换
- 文本消息收发
- 文件分片发送
- 文件分片接收与本地重组
- 浏览器端下载链接生成

### ICE 配置

当前仅配置了公共 STUN：

```js
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
```

这意味着：

- 局域网内和部分公网环境可以建立连接
- 在对称 NAT、企业内网、严格防火墙环境下可能无法打通
- 目前没有 TURN 中继兜底

## DataChannel 文件分片机制

当前 DataChannel 文件传输方案：

- 分片大小：`16 KB`
- 每个二进制分片前带一个 `4` 字节头部
- 头部用于存储分片序号
- 文件发送完成后会额外发送一条 `file-complete` JSON 消息

传输消息类型：

### `file-meta`

发送文件元数据。

示例：

```json
{
  "type": "file-meta",
  "transferId": "file-1711612345678-ab12cd",
  "fileName": "demo.pdf",
  "fileSize": 102400,
  "mimeType": "application/pdf",
  "chunkSize": 16384,
  "totalChunks": 7
}
```

### 二进制分片

- 前 `4` 字节：分片索引
- 后续字节：分片内容

### `file-complete`

通知接收端文件发送完成。

示例：

```json
{
  "type": "file-complete",
  "transferId": "file-1711612345678-ab12cd"
}
```

接收端行为：

- 收到 `file-meta` 后创建接收上下文
- 收到二进制分片后按索引缓存
- 所有分片齐全后重组为 `Blob`
- 通过 `URL.createObjectURL` 生成下载链接

## 调试步骤

推荐按下面步骤联调：

1. 启动服务：`npm run start:dev`
2. 在两台设备或两个浏览器窗口打开 `GET /webrtc-test.html`
3. 确保两个页面使用不同的 `deviceId`
4. 两边都点击 `Connect Signaling`
5. 发起连接请求并在对端接受
6. 等待服务端创建 `connecting` 会话
7. 发起 `offer / answer / candidate` 协商
8. 等待会话变为 `active`
9. 发起 `client:transfer-start`
10. 按状态流推进传输并通过 `/transfers` 查看历史

跨机器联调建议：

- 使用 `http://服务机IP:3000/webrtc-test.html`
- 不要使用另一台机器自己的 `localhost:3000`
- 确保服务机防火墙已放行 `3000` 端口

## 常见错误场景

常见错误包括：

- 当前 socket 未注册就发送信令事件
- 目标 `deviceId` 不在线
- 对未参与的请求、会话或传输进行操作
- 在非 `active` 会话下创建传输
- 发送方在接收方未确认前就试图将传输标为 `sent`
- DTO 校验失败

目标设备不在线时，服务端会抛出：

```text
Target device <deviceId> is not online
```

## 当前限制

当前实现更适合演示和内网调试，主要限制如下：

- 仅有 STUN，没有 TURN 中继
- 设备、连接请求、会话、传输记录当前都保存在内存中，服务重启后不会保留
- 当前页面一次只处理一个活动中的入站文件传输
- 接收端使用内存缓存全部分片，大文件场景压力较大
- 会话变为 `active` 当前以 `answer` 转发成功为准，尚未与 DataChannel `open` 做更强绑定
- 传输链路主要存在于测试页面，尚不是完整业务化前端

## 文档边界

为了避免混淆，后续维护建议保持以下划分：

- 公共文件服务相关内容统一写入 `doc/api.md`
- P2P、WebRTC、信令、DataChannel、会话和传输历史相关内容统一写入 `doc/p2p-webrtc.md`
