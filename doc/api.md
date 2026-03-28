# File Transfer Service Docs

## Overview

This project currently provides:

- NestJS HTTP file service
- Socket.IO signaling service
- WebRTC `offer / answer / candidate` exchange
- DataChannel text messaging
- DataChannel file chunk transfer
- File reassembly in the browser
- Send/receive progress display

Default endpoints:

- HTTP: `http://localhost:3000`
- Signaling namespace: `ws://localhost:3000/signaling`
- WebRTC test page: `http://localhost:3000/webrtc-test.html`

## Stage 1

Implemented signaling basics:

- user connection
- `deviceId` registration
- online list
- online/offline broadcast

Registered device payload:

```json
{
  "deviceId": "device-mac-001",
  "deviceName": "MacBook Pro",
  "platform": "mac"
}
```

## Stage 2

Implemented WebRTC signaling relay on WebSocket:

- `client:offer` -> `server:offer`
- `client:answer` -> `server:answer`
- `client:candidate` -> `server:candidate`

Flow:

```text
A -> server -> B (offer)
B -> server -> A (answer)
A/B -> server -> peer (ICE candidate)
```

## Stage 3

Implemented browser DataChannel demo:

- create `RTCPeerConnection`
- create `RTCDataChannel('chat')`
- send plain string messages
- test ping JSON payloads

Test page:

- [webrtc-test.html](E:\DevProjects\FileTransferService\public\webrtc-test.html)
- [webrtc-test.js](E:\DevProjects\FileTransferService\public\webrtc-test.js)

## Stage 4

Implemented core file transfer on DataChannel:

- file chunk splitting
- binary chunk sending
- chunk index header
- receiver-side chunk cache
- file reassembly into `Blob`
- download link creation
- send progress bar
- receive progress bar

### Transfer protocol

The browser demo uses one DataChannel for both text messages and file transfer.

Control message before file chunks:

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

Control message after all chunks:

```json
{
  "type": "file-complete",
  "transferId": "file-1711111111111-abcd12"
}
```

Binary packet format:

```text
4 bytes: chunk index (uint32)
N bytes: chunk payload
```

### Browser demo behavior

Sender:

1. choose file
2. send `file-meta`
3. slice file into `16 KB` chunks
4. prepend `4-byte` chunk index header
5. send each binary packet over DataChannel
6. update send progress UI
7. send `file-complete`

Receiver:

1. receive `file-meta`
2. initialize incoming transfer state
3. receive binary chunks
4. store each chunk by index
5. update receive progress UI
6. reassemble all chunks into `Blob`
7. generate browser download link

## HTTP Endpoints

- `GET /`
- `POST /files/upload`
- `GET /files`
- `GET /files/:id/download`
- `DELETE /files/:id`
- `GET /signaling/online-users`
- `GET /webrtc-test.html`

## Environment Variables

| Name | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Service port |
| `DATABASE_URL` | `file:./dev.db` | SQLite connection |
| `FILE_CLEANUP_ENABLED` | `true` | Enable cleanup task |
| `FILE_RETENTION_DAYS` | `7` | File retention days |
| `FILE_CLEANUP_CRON` | `0 0 * * * *` | Cleanup cron |

## How To Test File Transfer

1. Start the server with `npm run start:dev`
2. Open `http://localhost:3000/webrtc-test.html` in two browser windows
3. Use different `deviceId` values in each window
4. Click `Connect Signaling` on both sides
5. On side A, enter side B's `deviceId`
6. Click `Start WebRTC`
7. Wait until `DataChannel` status becomes `open`
8. Choose a file on one side
9. Click `Send File`
10. Wait for the receiver progress to reach 100%
11. Click the generated download link on the receiver side

## Current Limitations

- the browser demo currently handles one active incoming file transfer at a time
- incoming file chunks are buffered in memory before download
- no resume / retry support yet
- no checksum verification yet

## Suggested Next Step

Good next improvements for the next stage:

- transfer session id management
- multi-file queue
- chunk ack / resend
- checksum verification
- large file backpressure control
- resume after interruption
