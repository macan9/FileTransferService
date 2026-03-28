(function () {
  const CHUNK_SIZE = 16 * 1024;
  const HEADER_BYTES = 4;

  const elements = {
    deviceId: document.getElementById('deviceId'),
    deviceName: document.getElementById('deviceName'),
    platform: document.getElementById('platform'),
    targetDeviceId: document.getElementById('targetDeviceId'),
    connectSignal: document.getElementById('connectSignal'),
    startRtc: document.getElementById('startRtc'),
    closeRtc: document.getElementById('closeRtc'),
    sendMessage: document.getElementById('sendMessage'),
    sendPing: document.getElementById('sendPing'),
    sendFile: document.getElementById('sendFile'),
    fileInput: document.getElementById('fileInput'),
    messageInput: document.getElementById('messageInput'),
    signalStatus: document.getElementById('signalStatus'),
    peerStatus: document.getElementById('peerStatus'),
    channelStatus: document.getElementById('channelStatus'),
    sendProgressText: document.getElementById('sendProgressText'),
    receiveProgressText: document.getElementById('receiveProgressText'),
    sendProgressBar: document.getElementById('sendProgressBar'),
    receiveProgressBar: document.getElementById('receiveProgressBar'),
    downloadLink: document.getElementById('downloadLink'),
    log: document.getElementById('log'),
  };

  const state = {
    socket: null,
    peerConnection: null,
    dataChannel: null,
    targetDeviceId: '',
    receivingTransfer: null,
    downloadUrl: null,
  };

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  function log(message, payload) {
    const time = new Date().toLocaleTimeString();
    const lines = [`[${time}] ${message}`];

    if (payload !== undefined) {
      lines.push(
        typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      );
    }

    elements.log.textContent += `${lines.join('\n')}\n\n`;
    elements.log.scrollTop = elements.log.scrollHeight;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function setBadge(element, text, ok) {
    element.textContent = text;
    element.className = ok ? 'badge good' : 'badge';
  }

  function setSignalStatus(text, ok = false) {
    setBadge(elements.signalStatus, text, ok);
  }

  function setPeerStatus(text, ok = false) {
    setBadge(elements.peerStatus, text, ok);
  }

  function setChannelStatus(text, ok = false) {
    setBadge(elements.channelStatus, text, ok);
  }

  function updateProgress(bar, text, percent, label, done = false) {
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    bar.className = done ? 'progress-bar good' : 'progress-bar';
    text.textContent = label;
  }

  function resetDownloadLink() {
    if (state.downloadUrl) {
      URL.revokeObjectURL(state.downloadUrl);
      state.downloadUrl = null;
    }

    elements.downloadLink.hidden = true;
    elements.downloadLink.removeAttribute('href');
    elements.downloadLink.removeAttribute('download');
    elements.downloadLink.textContent = 'Download received file';
  }

  function toggleChannelActions(enabled) {
    elements.sendMessage.disabled = !enabled;
    elements.sendPing.disabled = !enabled;
    elements.sendFile.disabled = !enabled;
  }

  function fillDefaults() {
    const randomId = Math.random().toString(36).slice(2, 8);

    if (!elements.deviceId.value) elements.deviceId.value = `device-${randomId}`;
    if (!elements.deviceName.value) elements.deviceName.value = `Browser-${randomId}`;
    if (!elements.platform.value) elements.platform.value = navigator.platform || 'web';
    if (!elements.messageInput.value) {
      elements.messageInput.value = `hello from ${elements.deviceId.value}`;
    }
  }

  function getRegistration() {
    return {
      deviceId: elements.deviceId.value.trim(),
      deviceName: elements.deviceName.value.trim(),
      platform: elements.platform.value.trim(),
    };
  }

  function requireTargetDeviceId() {
    const targetDeviceId = elements.targetDeviceId.value.trim();
    if (!targetDeviceId) throw new Error('Please enter target device ID first.');
    state.targetDeviceId = targetDeviceId;
    return targetDeviceId;
  }

  function requireOpenChannel() {
    if (!state.dataChannel || state.dataChannel.readyState !== 'open') {
      throw new Error('DataChannel is not open yet.');
    }

    return state.dataChannel;
  }

  async function createPeerConnection() {
    if (state.peerConnection) return state.peerConnection;

    const peerConnection = new RTCPeerConnection(rtcConfig);
    state.peerConnection = peerConnection;
    setPeerStatus('created', true);
    elements.closeRtc.disabled = false;

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !state.socket || !state.targetDeviceId) return;

      state.socket.emit(
        'client:candidate',
        {
          targetDeviceId: state.targetDeviceId,
          candidate: event.candidate.toJSON
            ? event.candidate.toJSON()
            : event.candidate,
        },
        (ack) => log('ICE candidate sent', ack),
      );
    };

    peerConnection.onconnectionstatechange = () => {
      const status = peerConnection.connectionState || 'unknown';
      setPeerStatus(status, status === 'connected');
      log('PeerConnection state changed', status);
    };

    peerConnection.ondatachannel = (event) => {
      log('Remote DataChannel received');
      attachDataChannel(event.channel);
    };

    return peerConnection;
  }

  function attachDataChannel(channel) {
    if (state.dataChannel && state.dataChannel !== channel) {
      state.dataChannel.close();
    }

    state.dataChannel = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      setChannelStatus('open', true);
      toggleChannelActions(true);
      log('DataChannel opened');
    };

    channel.onclose = () => {
      setChannelStatus('closed');
      toggleChannelActions(false);
      log('DataChannel closed');
    };

    channel.onerror = (error) => {
      log('DataChannel error', error.message || String(error));
    };

    channel.onmessage = (event) => {
      handleDataChannelMessage(event.data).catch((error) => {
        log('Failed to process DataChannel message', error.message || String(error));
      });
    };

    setChannelStatus(channel.readyState === 'open' ? 'open' : channel.readyState);
    toggleChannelActions(channel.readyState === 'open');
  }

  async function startRtcConnection() {
    if (!state.socket) throw new Error('Please connect to the signaling server first.');

    const targetDeviceId = requireTargetDeviceId();
    const peerConnection = await createPeerConnection();
    const dataChannel =
      state.dataChannel && state.dataChannel.readyState !== 'closed'
        ? state.dataChannel
        : peerConnection.createDataChannel('chat');

    attachDataChannel(dataChannel);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    state.socket.emit(
      'client:offer',
      { targetDeviceId, offer },
      (ack) => log('Offer sent', ack),
    );
  }

  async function handleOffer(payload) {
    const peerConnection = await createPeerConnection();
    state.targetDeviceId = payload.from.deviceId;

    log('Offer received', payload);
    await peerConnection.setRemoteDescription(payload.offer);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    state.socket.emit(
      'client:answer',
      {
        targetDeviceId: payload.from.deviceId,
        answer,
      },
      (ack) => log('Answer sent', ack),
    );
  }

  async function handleAnswer(payload) {
    if (!state.peerConnection) {
      log('Answer ignored because no PeerConnection exists');
      return;
    }

    log('Answer received', payload);
    await state.peerConnection.setRemoteDescription(payload.answer);
  }

  async function handleCandidate(payload) {
    if (!state.peerConnection) {
      log('Candidate ignored because no PeerConnection exists');
      return;
    }

    log('ICE candidate received', payload);
    await state.peerConnection.addIceCandidate(payload.candidate);
  }

  function closeRtcConnection() {
    if (state.dataChannel) {
      state.dataChannel.close();
      state.dataChannel = null;
    }

    if (state.peerConnection) {
      state.peerConnection.close();
      state.peerConnection = null;
    }

    state.receivingTransfer = null;
    resetDownloadLink();
    updateProgress(elements.sendProgressBar, elements.sendProgressText, 0, 'No file is being sent.');
    updateProgress(
      elements.receiveProgressBar,
      elements.receiveProgressText,
      0,
      'No file is being received.',
    );

    setPeerStatus('closed');
    setChannelStatus('not created');
    toggleChannelActions(false);
    elements.closeRtc.disabled = true;
    log('Current WebRTC connection closed');
  }

  function connectSignalServer() {
    const registration = getRegistration();

    if (!registration.deviceId || !registration.deviceName || !registration.platform) {
      throw new Error('Please fill in device ID, device name, and platform.');
    }

    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }

    const socket = window.io('/signaling', { transports: ['websocket'] });
    state.socket = socket;
    setSignalStatus('connecting');

    socket.on('connect', () => {
      setSignalStatus('connected', true);
      elements.startRtc.disabled = false;
      log('Connected to signaling server', { socketId: socket.id });
      socket.emit('client:register', registration, (ack) => log('Device registered', ack));
    });

    socket.on('disconnect', (reason) => {
      setSignalStatus(`disconnected: ${reason}`);
      elements.startRtc.disabled = true;
      log('Signaling socket disconnected', reason);
    });

    socket.on('server:registered', (payload) => log('Registration success event received', payload));
    socket.on('server:online-list', (payload) => log('Online user list updated', payload));
    socket.on('server:offer', (payload) => {
      handleOffer(payload).catch((error) => log('Failed to handle offer', error.message || String(error)));
    });
    socket.on('server:answer', (payload) => {
      handleAnswer(payload).catch((error) => log('Failed to handle answer', error.message || String(error)));
    });
    socket.on('server:candidate', (payload) => {
      handleCandidate(payload).catch((error) => log('Failed to handle candidate', error.message || String(error)));
    });
    socket.on('server:force-disconnect', (payload) => {
      log('Forced offline event received', payload);
      closeRtcConnection();
    });
    socket.on('connect_error', (error) => {
      setSignalStatus('connect error');
      log('Failed to connect signaling server', error.message || String(error));
    });
  }

  function createTransferId() {
    return `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function sendStringMessage(content) {
    const dataChannel = requireOpenChannel();
    dataChannel.send(content);
    log('DataChannel message sent', content);
  }

  async function sendSelectedFile() {
    const dataChannel = requireOpenChannel();
    const file = elements.fileInput.files && elements.fileInput.files[0];

    if (!file) throw new Error('Please choose a file first.');

    const transferId = createTransferId();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    dataChannel.send(
      JSON.stringify({
        type: 'file-meta',
        transferId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        chunkSize: CHUNK_SIZE,
        totalChunks,
      }),
    );

    log('File transfer metadata sent', {
      transferId,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
    });

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = await file.slice(start, end).arrayBuffer();
      const packet = new ArrayBuffer(HEADER_BYTES + chunk.byteLength);
      const view = new DataView(packet);

      view.setUint32(0, chunkIndex);
      new Uint8Array(packet, HEADER_BYTES).set(new Uint8Array(chunk));
      dataChannel.send(packet);

      const percent = (end / file.size) * 100;
      updateProgress(
        elements.sendProgressBar,
        elements.sendProgressText,
        percent,
        `${file.name}: ${chunkIndex + 1}/${totalChunks} chunks, ${formatBytes(end)}/${formatBytes(file.size)}`,
        percent >= 100,
      );

      if (chunkIndex % 32 === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }

    dataChannel.send(JSON.stringify({ type: 'file-complete', transferId }));
    updateProgress(
      elements.sendProgressBar,
      elements.sendProgressText,
      100,
      `${file.name} sent successfully.`,
      true,
    );
    log('File transfer finished', { transferId, fileName: file.name, fileSize: file.size });
  }

  async function handleDataChannelMessage(data) {
    if (typeof data === 'string') {
      handleStringPayload(data);
      return;
    }

    if (data instanceof ArrayBuffer) {
      handleFileChunk(data);
      return;
    }

    if (data instanceof Blob) {
      handleFileChunk(await data.arrayBuffer());
    }
  }

  function handleStringPayload(raw) {
    try {
      const payload = JSON.parse(raw);

      if (payload.type === 'file-meta') {
        resetDownloadLink();
        state.receivingTransfer = {
          id: payload.transferId,
          fileName: payload.fileName,
          fileSize: payload.fileSize,
          mimeType: payload.mimeType,
          totalChunks: payload.totalChunks,
          receivedChunks: 0,
          receivedBytes: 0,
          chunks: new Array(payload.totalChunks),
        };

        updateProgress(
          elements.receiveProgressBar,
          elements.receiveProgressText,
          0,
          `Receiving ${payload.fileName} (${formatBytes(payload.fileSize)})`,
        );
        log('File metadata received', payload);
        return;
      }

      if (payload.type === 'file-complete') {
        finalizeIncomingFile(payload.transferId);
        return;
      }

      if (payload.type === 'ping') {
        log('Ping message received', payload);
        return;
      }

      log('JSON message received', payload);
      return;
    } catch {
      log('DataChannel text message received', raw);
    }
  }

  function handleFileChunk(buffer) {
    if (!state.receivingTransfer) {
      log('Binary chunk ignored because no incoming transfer metadata exists');
      return;
    }

    const view = new DataView(buffer);
    const chunkIndex = view.getUint32(0);
    const payload = buffer.slice(HEADER_BYTES);

    if (!state.receivingTransfer.chunks[chunkIndex]) {
      state.receivingTransfer.chunks[chunkIndex] = payload;
      state.receivingTransfer.receivedChunks += 1;
      state.receivingTransfer.receivedBytes += payload.byteLength;
    }

    const percent =
      (state.receivingTransfer.receivedBytes / state.receivingTransfer.fileSize) * 100;

    updateProgress(
      elements.receiveProgressBar,
      elements.receiveProgressText,
      percent,
      `${state.receivingTransfer.fileName}: ${state.receivingTransfer.receivedChunks}/${state.receivingTransfer.totalChunks} chunks, ${formatBytes(state.receivingTransfer.receivedBytes)}/${formatBytes(state.receivingTransfer.fileSize)}`,
      percent >= 100,
    );

    if (state.receivingTransfer.receivedChunks === state.receivingTransfer.totalChunks) {
      finalizeIncomingFile(state.receivingTransfer.id);
    }
  }

  function finalizeIncomingFile(transferId) {
    if (!state.receivingTransfer || state.receivingTransfer.id !== transferId) {
      return;
    }

    const transfer = state.receivingTransfer;

    if (transfer.chunks.some((chunk) => !chunk)) {
      log('Transfer completion arrived before all chunks were received', { transferId });
      return;
    }

    const blob = new Blob(transfer.chunks, { type: transfer.mimeType });
    const downloadUrl = URL.createObjectURL(blob);

    resetDownloadLink();
    state.downloadUrl = downloadUrl;
    elements.downloadLink.href = downloadUrl;
    elements.downloadLink.download = transfer.fileName;
    elements.downloadLink.textContent = `Download ${transfer.fileName}`;
    elements.downloadLink.hidden = false;

    updateProgress(
      elements.receiveProgressBar,
      elements.receiveProgressText,
      100,
      `${transfer.fileName} received successfully.`,
      true,
    );

    log('File reassembled successfully', {
      transferId,
      fileName: transfer.fileName,
      fileSize: transfer.fileSize,
    });

    state.receivingTransfer = null;
  }

  fillDefaults();
  setSignalStatus('not connected');
  setPeerStatus('not created');
  setChannelStatus('not created');
  toggleChannelActions(false);
  resetDownloadLink();
  updateProgress(elements.sendProgressBar, elements.sendProgressText, 0, 'No file is being sent.');
  updateProgress(
    elements.receiveProgressBar,
    elements.receiveProgressText,
    0,
    'No file is being received.',
  );

  elements.connectSignal.addEventListener('click', () => {
    try {
      connectSignalServer();
    } catch (error) {
      log('Failed to connect signaling server', error.message || String(error));
    }
  });

  elements.startRtc.addEventListener('click', () => {
    startRtcConnection().catch((error) => {
      log('Failed to start WebRTC connection', error.message || String(error));
    });
  });

  elements.closeRtc.addEventListener('click', () => {
    closeRtcConnection();
  });

  elements.sendMessage.addEventListener('click', () => {
    try {
      sendStringMessage(elements.messageInput.value || '');
    } catch (error) {
      log('Failed to send message', error.message || String(error));
    }
  });

  elements.sendPing.addEventListener('click', () => {
    try {
      sendStringMessage(
        JSON.stringify({
          type: 'ping',
          from: elements.deviceId.value.trim(),
          sentAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      log('Failed to send ping', error.message || String(error));
    }
  });

  elements.sendFile.addEventListener('click', () => {
    sendSelectedFile().catch((error) => {
      log('Failed to send file', error.message || String(error));
    });
  });
})();
