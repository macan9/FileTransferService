# FileTransferService

A NestJS-based file transfer service that combines HTTP file management with Socket.IO signaling and a browser WebRTC DataChannel demo.

## Features

- HTTP file upload, list, download, and delete
- SQLite persistence with Prisma
- Socket.IO signaling for peer discovery and WebRTC negotiation
- Browser demo for DataChannel text messaging
- Browser demo for chunked peer-to-peer file transfer
- Scheduled cleanup for expired uploaded files

## Tech Stack

- NestJS
- TypeScript
- Prisma
- SQLite
- Socket.IO
- WebRTC DataChannel

## Project Structure

- `src/`: NestJS application source code
- `src/signaling/`: signaling HTTP and WebSocket logic
- `public/`: browser demo assets
- `prisma/`: database schema and migrations
- `doc/`: supplementary project docs

## Getting Started

### Install dependencies

```bash
npm install
```

### Run in development

```bash
npm run start:dev
```

### Build

```bash
npm run build
```

### Run production build

```bash
npm run start:prod
```

## Default Endpoints

- `GET /`
- `POST /files/upload`
- `GET /files`
- `GET /files/:id/download`
- `DELETE /files/:id`
- `GET /signaling/online-users`
- `GET /webrtc-test.html`
- `WS /signaling`

## Environment Variables

- `PORT`: service port, default `3000`
- `DATABASE_URL`: SQLite connection string, default `file:./dev.db`
- `FILE_CLEANUP_ENABLED`: enable cleanup task, default `true`
- `FILE_RETENTION_DAYS`: retention period in days, default `7`
- `FILE_CLEANUP_CRON`: cleanup schedule, default `0 0 * * * *`

## WebRTC Demo

1. Start the server with `npm run start:dev`.
2. Open `http://localhost:3000/webrtc-test.html` in two browser windows.
3. Use a different `deviceId` in each window.
4. Connect both clients to signaling.
5. Enter the target device ID on one side and start WebRTC.
6. After the DataChannel is open, send a message or transfer a file.

## Notes

- Uploaded files are stored in the local `uploads/` directory.
- File metadata is stored in SQLite through Prisma.
- The current browser demo keeps incoming file chunks in memory before reassembly.

## Additional Documentation

- See `doc/api.md` for more implementation details and protocol notes.
