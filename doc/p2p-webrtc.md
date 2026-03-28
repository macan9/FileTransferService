# P2P 传输与 WebRTC 文档

本文档仅描述项目中的 P2P 传输能力，包括信令服务、WebRTC 建链、DataChannel 文件传输和调试方式。

公共文件服务 HTTP 接口请查看：
[doc/api.md](E:\DevProjects\FileTransferService\doc\api.md)

## 功能范围

当前项目中的 P2P 方案由两部分组成：

- 信令层：基于 Socket.IO 的 `/signaling` 命名空间，用于交换设备注册信息、`offer`、`answer` 和 `ICE candidate`
- 数据传输层：基于浏览器 `RTCPeerConnection` 和 `RTCDataChannel` 实现字符串消息与文件分片传输

当前还提供一个浏览器测试页：

- `GET /webrtc-test.html`

## 整体架构

P2P 传输流程如下：

1. 两端浏览器分别打开 `webrtc-test.html`
2. 两端通过 Socket.IO 连接 `/signaling`
3. 每端发送 `client:register` 完成设备注册
4. 发起方输入目标 `deviceId` 后点击 `Start WebRTC`
5. 发起方创建 `offer` 并通过信令服务转发给目标端
6. 目标端创建 `answer` 并回传
7. 双方持续交换 `ICE candidate`
8. `RTCDataChannel` 状态变为 `open` 后，开始发送文本或文件分片

## 访问入口

| 入口 | 方法 | 说明 |
| --- | --- | --- |
| `/webrtc-test.html` | `GET` | WebRTC P2P 调试页面 |
| `/signaling/online-users` | `GET` | 查询当前在线设备列表 |
| `/signaling` | `WS` | Socket.IO 信令命名空间 |

## 调试页面

调试页面地址：

```text
http://localhost:3000/webrtc-test.html
```

页面支持：

- 手动填写 `deviceId`、`deviceName`、`platform`
- 连接信令服务
- 建立 WebRTC 连接
- 发送字符串消息
- 发送单个文件
- 查看发送进度、接收进度和运行日志

建议调试方式：

- 在两台设备上分别访问 `http://服务机IP:3000/webrtc-test.html`
- 或在同一台机器打开两个浏览器窗口进行本地联调

## 信令接口

### `GET /signaling/online-users`

返回当前已注册在线设备列表。

响应示例：

```json
{
  "total": 2,
  "users": [
    {
      "socketId": "oC8aG6xN4K7z",
      "deviceId": "device-a",
      "deviceName": "Windows A",
      "platform": "windows",
      "connectedAt": "2026-03-28T10:00:00.000Z"
    },
    {
      "socketId": "Yf7kM0yE2rQp",
      "deviceId": "device-b",
      "deviceName": "Mac B",
      "platform": "mac",
      "connectedAt": "2026-03-28T10:00:05.000Z"
    }
  ]
}
```

说明：

- 这里只返回信令层的在线设备，不代表 DataChannel 一定已经建立完成

## Socket.IO 信令事件

Socket.IO 客户端连接方式：

```js
const socket = window.io('/signaling', { transports: ['websocket'] });
```

服务端网关特性：

- 命名空间：`/signaling`
- CORS：`origin: '*'`
- 设备注册采用 `deviceId` 作为逻辑唯一标识
- 同一个 `deviceId` 重复注册时，旧连接会被踢下线

### 服务端主动事件

#### `server:welcome`

连接成功后立即返回基础说明。

示例：

```json
{
  "socketId": "oC8aG6xN4K7z",
  "message": "Connected to signaling server",
  "registerEvent": "client:register",
  "onlineListEvent": "server:online-list",
  "rtcEvents": {
    "offer": "client:offer",
    "answer": "client:answer",
    "candidate": "client:candidate"
  }
}
```

#### `server:registered`

当前连接注册成功后返回。

#### `server:online-list`

广播当前在线用户列表。

#### `server:user-online`

有新设备上线时广播。

#### `server:user-offline`

有设备离线时广播。

#### `server:force-disconnect`

相同 `deviceId` 从新连接登录时，旧连接会收到此事件并被断开。

#### `server:offer`

服务端转发来自对端的 `offer`。

示例结构：

```json
{
  "from": {
    "socketId": "socket-a",
    "deviceId": "device-a",
    "deviceName": "Windows A",
    "platform": "windows"
  },
  "to": {
    "socketId": "socket-b",
    "deviceId": "device-b",
    "deviceName": "Mac B",
    "platform": "mac"
  },
  "offer": {
    "type": "offer",
    "sdp": "..."
  }
}
```

#### `server:answer`

服务端转发来自对端的 `answer`。

#### `server:candidate`

服务端转发来自对端的 ICE 候选。

### 客户端发送事件

#### `client:register`

用于设备注册。

请求体：

```json
{
  "deviceId": "device-a",
  "deviceName": "Windows A",
  "platform": "windows"
}
```

校验规则：

- `deviceId`：必填，字符串，最大 `100` 字符
- `deviceName`：必填，字符串，最大 `100` 字符
- `platform`：必填，字符串，最大 `50` 字符

成功 ack 示例：

```json
{
  "success": true,
  "user": {
    "socketId": "oC8aG6xN4K7z",
    "deviceId": "device-a",
    "deviceName": "Windows A",
    "platform": "windows",
    "connectedAt": "2026-03-28T10:00:00.000Z"
  },
  "onlineUsers": [
    {
      "socketId": "oC8aG6xN4K7z",
      "deviceId": "device-a",
      "deviceName": "Windows A",
      "platform": "windows",
      "connectedAt": "2026-03-28T10:00:00.000Z"
    }
  ]
}
```

#### `client:offer`

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

校验规则：

- `targetDeviceId`：必填，字符串，最大 `100` 字符
- `offer`：必填，对象

成功 ack 示例：

```json
{
  "success": true,
  "event": "server:offer-sent",
  "fromDeviceId": "device-a",
  "targetDeviceId": "device-b"
}
```

#### `client:answer`

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

#### `client:candidate`

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

### 错误场景

常见错误包括：

- 当前 socket 未注册就发送 `offer/answer/candidate`
- 目标 `deviceId` 不在线
- DTO 校验失败

目标设备不在线时，服务端会抛出：

```text
Target device <deviceId> is not online
```

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

## 文件传输机制

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

- 前 4 字节：分片索引
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
5. 在发起方填写目标端的 `deviceId`
6. 点击 `Start WebRTC`
7. 等待 `DataChannel` 状态变为 `open`
8. 发送字符串或选择文件进行传输

跨机器联调建议：

- 使用 `http://服务机IP:3000/webrtc-test.html`
- 不要使用另一台机器自己的 `localhost:3000`
- 确保服务机防火墙已放行 `3000` 端口

## 当前限制

当前实现更适合演示和内网调试，主要限制如下：

- 仅有 STUN，没有 TURN 中继
- 当前页面一次只处理一个活动中的入站文件传输
- 接收端使用内存缓存全部分片，大文件场景压力较大
- 传输链路主要存在于测试页面，尚不是完整业务化前端
- 服务端信令只负责交换协商消息，不参与实际文件内容转发

## 文档边界

为了避免混淆，后续维护建议保持以下划分：

- 公共文件服务相关内容统一写入 `doc/api.md`
- P2P、WebRTC、信令、DataChannel 相关内容统一写入 `doc/p2p-webrtc.md`
