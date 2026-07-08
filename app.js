// Constants and Configuration
const CHUNK_SIZE = 64 * 1024; // 64KB WebRTC chunk size
let peer = null;
let activeConnection = null;
let isLocalMode = false;
let localServerConfig = null;
let currentMode = 'receiver'; // 'receiver' or 'sender'

// State tracking for transfers
const transfers = {};

// DOM Elements
const modeBadge = document.getElementById('modeBadge');
const receiverView = document.getElementById('receiverView');
const senderView = document.getElementById('senderView');

// Receiver (Mac) Elements
const qrCodeCanvas = document.getElementById('qrCodeCanvas');
const qrPlaceholder = document.getElementById('qrPlaceholder');
const joinUrlInput = document.getElementById('joinUrlInput');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const localSaveTip = document.getElementById('localSaveTip');
const connectionStatus = document.getElementById('connectionStatus');
const emptyTransfers = document.getElementById('emptyTransfers');
const transferList = document.getElementById('transferList');

// Receiver (Mac) Sending Elements
const receiverDropZone = document.getElementById('receiverDropZone');
const receiverFileSelector = document.getElementById('receiverFileSelector');
const receiverSelectedContainer = document.getElementById('receiverSelectedContainer');
const receiverSelectedList = document.getElementById('receiverSelectedList');
const receiverSendBtn = document.getElementById('receiverSendBtn');

// Sender (Phone) Elements
const senderConnectionStatus = document.getElementById('senderConnectionStatus');
const dropZone = document.getElementById('dropZone');
const fileSelector = document.getElementById('fileSelector');
const selectedFilesContainer = document.getElementById('selectedFilesContainer');
const selectedFilesList = document.getElementById('selectedFilesList');
const sendBtn = document.getElementById('sendBtn');
const sendProgressContainer = document.getElementById('sendProgressContainer');
const sendProgressList = document.getElementById('sendProgressList');

// Sender (Phone) Receiving Elements
const emptyReceived = document.getElementById('emptyReceived');
const receivedList = document.getElementById('receivedList');

const toastContainer = document.getElementById('toastContainer');

// Selected files cache for sending
let filesToSend = [];
let receiverFilesToSend = [];

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

// Detect mode and config
async function initApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const connectId = urlParams.get('connect');
  const queryMode = urlParams.get('mode');

  // Check if we are running in local server mode
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      localServerConfig = await response.json();
      isLocalMode = true;
      console.log('Running in Local Server Mode:', localServerConfig);
    }
  } catch (e) {
    console.log('Running in Static WebRTC Mode (No local server detected)');
  }

  // Determine if this instance is a sender or receiver
  if (connectId || queryMode === 'local-sender') {
    currentMode = 'sender';
    setupSenderView(connectId);
  } else {
    currentMode = 'receiver';
    setupReceiverView();
  }
}

function setupEventListeners() {
  // Copy Join URL
  copyUrlBtn.addEventListener('click', () => {
    joinUrlInput.select();
    navigator.clipboard.writeText(joinUrlInput.value)
      .then(() => showToast('Connection URL copied to clipboard!', 'success'))
      .catch(() => showToast('Failed to copy URL', 'error'));
  });

  // Drag & drop logic for Sender (Phone)
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFileSelection(e.dataTransfer.files);
      }
    });

    fileSelector.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileSelection(e.target.files);
      }
    });

    sendBtn.addEventListener('click', startSending);
  }

  // Drag & drop logic for Receiver (Mac) Outgoing sharing
  if (receiverDropZone) {
    receiverDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      receiverDropZone.classList.add('dragover');
    });

    receiverDropZone.addEventListener('dragleave', () => {
      receiverDropZone.classList.remove('dragover');
    });

    receiverDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      receiverDropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleReceiverFileSelection(e.dataTransfer.files);
      }
    });

    receiverFileSelector.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleReceiverFileSelection(e.target.files);
      }
    });

    receiverSendBtn.addEventListener('click', startReceiverSending);
  }
}

/* =========================================================================
   RECEIVER FLOW (Dashboard on Mac)
   ========================================================================= */

function setupReceiverView() {
  receiverView.classList.remove('hidden');
  
  if (isLocalMode) {
    modeBadge.textContent = 'Local Mode';
    localSaveTip.classList.remove('hidden');
    
    // Direct URL to this local instance for local HTTP upload
    const localIp = localServerConfig.ip || window.location.hostname;
    const localPort = localServerConfig.port || window.location.port;
    const localUrl = `http://${localIp}:${localPort}/?mode=local-sender`;
    
    joinUrlInput.value = localUrl;
    generateQrCode(localUrl);
    
    connectionStatus.textContent = 'Running Offline';
    connectionStatus.className = 'status-indicator online';
    
    // Enable file sharing input locally
    receiverFileSelector.removeAttribute('disabled');
    
    // Poll the local server for newly saved files
    startLocalFilesPolling();
  } else {
    modeBadge.textContent = 'P2P WebRTC';
    connectionStatus.textContent = 'Connecting to Cloud...';
    connectionStatus.className = 'status-indicator offline';
    
    // Initialize WebRTC Peer
    initWebRTCReceiver();
  }
}

function generateQrCode(text) {
  qrPlaceholder.classList.add('hidden');
  new QRious({
    element: qrCodeCanvas,
    value: text,
    size: 250,
    background: 'transparent',
    foreground: '#6366f1',
    level: 'H'
  });
}

function initWebRTCReceiver() {
  peer = new Peer({
    debug: 1
  });

  const peerTimeout = setTimeout(() => {
    if (!peer || !peer.id) {
      connectionStatus.textContent = 'Cloud Connection Slow/Offline';
      connectionStatus.className = 'status-indicator offline';
      showToast('WebRTC cloud connection is slow. You can still use Local Mode offline.', 'warning');
    }
  }, 10000);

  peer.on('open', (id) => {
    clearTimeout(peerTimeout);
    console.log('PeerJS Receiver ID:', id);
    connectionStatus.textContent = 'Waiting for Devices';
    connectionStatus.className = 'status-indicator online';
    
    const joinUrl = `${window.location.origin}${window.location.pathname}?connect=${id}`;
    joinUrlInput.value = joinUrl;
    generateQrCode(joinUrl);
  });

  peer.on('error', (err) => {
    clearTimeout(peerTimeout);
    console.error('PeerJS error:', err);
    connectionStatus.textContent = 'Network Error';
    connectionStatus.className = 'status-indicator offline';
    showToast(`Connection error: ${err.type}`, 'error');
  });

  peer.on('connection', (conn) => {
    activeConnection = conn;
    console.log('Sender connected:', conn.peer);
    connectionStatus.textContent = 'Device Connected';
    showToast('A sender device has connected!', 'success');
    
    // Enable file sharing input since we have an active WebRTC peer
    receiverFileSelector.removeAttribute('disabled');
    updateReceiverSendBtnState();
    
    // Monitor connectionState on RTCPeerConnection for absolute disconnection detection
    if (conn.peerConnection) {
      conn.peerConnection.addEventListener('connectionstatechange', () => {
        const state = conn.peerConnection.connectionState;
        console.log('RTCPeerConnection state change:', state);
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          handleReceiverDisconnect();
        }
      });
    }

    conn.on('data', (data) => {
      handleIncomingData(conn, data);
    });

    conn.on('close', () => {
      handleReceiverDisconnect();
    });
  });
}

function handleReceiverDisconnect() {
  if (!activeConnection) return;
  console.log('Receiver disconnected from sender');
  connectionStatus.textContent = 'Device Disconnected';
  showToast('Sender device disconnected', 'warning');
  activeConnection = null;
  receiverFileSelector.setAttribute('disabled', 'true');
  updateReceiverSendBtnState();
}


function handleIncomingData(conn, data) {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'file-init') {
    transfers[data.id] = {
      name: data.name,
      size: data.size,
      totalChunks: data.totalChunks,
      chunks: [],
      receivedChunks: 0,
      startTime: Date.now()
    };
    
    addTransferToUi(data.id, data.name, data.size);
  } 
  else if (data.type === 'file-chunk') {
    const transfer = transfers[data.id];
    if (transfer) {
      transfer.chunks[data.chunkIndex] = data.data;
      transfer.receivedChunks++;
      
      const percent = Math.floor((transfer.receivedChunks / transfer.totalChunks) * 100);
      const speed = calculateSpeed(transfer.receivedChunks * CHUNK_SIZE, transfer.startTime);
      
      updateTransferProgressUi(data.id, percent, speed);
    }
  } 
  else if (data.type === 'file-complete') {
    const transfer = transfers[data.id];
    if (transfer) {
      const blob = new Blob(transfer.chunks);
      saveReceivedFile(transfer.name, blob, data.id);
      delete transfers[data.id];
    }
  }
}

function saveReceivedFile(name, blob, id) {
  // If in local server mode, upload it to the Flask backend so it gets saved on disk
  if (isLocalMode) {
    const formData = new FormData();
    formData.append('file', blob, name);
    
    updateTransferStatusUi(id, 'saving', 'Saving to disk...');
    
    fetch('/upload', {
      method: 'POST',
      body: formData
    })
    .then(res => {
      if (res.ok) {
        updateTransferStatusUi(id, 'success', 'Saved directly to uploads/');
        showToast(`Saved to uploads/: ${name}`, 'success');
      } else {
        triggerBrowserDownload(name, blob, id);
      }
    })
    .catch(err => {
      console.error('Failed saving to local backend:', err);
      triggerBrowserDownload(name, blob, id);
    });
  } else {
    triggerBrowserDownload(name, blob, id);
  }
}

function triggerBrowserDownload(name, blob, id) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  updateTransferStatusUi(id, 'success', 'Downloaded');
  showToast(`Downloaded: ${name}`, 'success');
}

// Local mode files list polling
let lastFileListHash = '';
function startLocalFilesPolling() {
  const poll = async () => {
    try {
      const response = await fetch('/api/files');
      if (response.ok) {
        const files = await response.json();
        
        // Quick hash comparison
        const filesHash = JSON.stringify(files);
        if (filesHash !== lastFileListHash) {
          lastFileListHash = filesHash;
          renderLocalFilesList(files);
        }
      }
    } catch (e) {
      console.error('Error polling files:', e);
    }
    setTimeout(poll, 2000);
  };
  poll();
}

function renderLocalFilesList(files) {
  if (files.length === 0) return;
  
  emptyTransfers.classList.add('hidden');
  transferList.classList.remove('hidden');
  
  // Clear lists, but keep active WebRTC transfers if any exist
  const activeItems = Array.from(transferList.children).filter(el => !el.id.startsWith('local-'));
  transferList.innerHTML = '';
  activeItems.forEach(el => transferList.appendChild(el));
  
  files.forEach(file => {
    const fileId = `local-${file.name.replace(/[^a-zA-Z0-9]/g, '')}`;
    // Skip if already in list
    if (document.getElementById(fileId)) return;

    const dateStr = new Date(file.modified * 1000).toLocaleTimeString();
    
    const fileHtml = `
      <div class="file-item" id="${fileId}">
        <div class="file-item-header">
          <div class="file-info">
            <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
            <div class="file-name-container">
              <span class="file-name" title="${file.name}">${file.name}</span>
              <span class="file-size">${formatBytes(file.size)} • Received at ${dateStr}</span>
            </div>
          </div>
          <span class="file-status success">Saved</span>
        </div>
      </div>
    `;
    transferList.insertAdjacentHTML('beforeend', fileHtml);
  });
}

// Receiver (Mac) Outgoing Share Logic
function handleReceiverFileSelection(filesList) {
  receiverFilesToSend = Array.from(filesList);
  
  if (receiverFilesToSend.length === 0) {
    receiverSelectedContainer.classList.add('hidden');
    return;
  }
  
  receiverSelectedContainer.classList.remove('hidden');
  receiverSelectedList.innerHTML = '';
  
  receiverFilesToSend.forEach((file, index) => {
    const fileId = `receiver-select-${index}`;
    const fileHtml = `
      <div class="file-item" id="${fileId}">
        <div class="file-item-header">
          <div class="file-info">
            <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
            <div class="file-name-container">
              <span class="file-name" title="${file.name}">${file.name}</span>
              <span class="file-size">${formatBytes(file.size)}</span>
            </div>
          </div>
          <span class="file-status pending">Ready</span>
        </div>
      </div>
    `;
    receiverSelectedList.insertAdjacentHTML('beforeend', fileHtml);
  });
  
  updateReceiverSendBtnState();
}

function updateReceiverSendBtnState() {
  if (receiverFilesToSend.length === 0) {
    receiverSendBtn.disabled = true;
    return;
  }

  if (isLocalMode) {
    receiverSendBtn.disabled = false;
  } else {
    receiverSendBtn.disabled = !(activeConnection && activeConnection.open);
  }
}

async function startReceiverSending() {
  if (receiverFilesToSend.length === 0) return;
  
  receiverSendBtn.disabled = true;
  
  for (let i = 0; i < receiverFilesToSend.length; i++) {
    const file = receiverFilesToSend[i];
    const uiId = `mac-send-${Math.random().toString(36).substring(2, 9)}`;
    
    // Add to transfers log in Mac UI
    addTransferToUi(uiId, file.name, file.size);
    updateTransferStatusUi(uiId, 'transferring', 'Sending...');
    
    try {
      if (isLocalMode) {
        // HTTP share: upload to /share folder on server so mobile client can poll and download
        await uploadFileToLocalShare(file, uiId);
      } else if (activeConnection && activeConnection.open) {
        // WebRTC transfer
        await uploadFileWebRTCFromReceiver(file, uiId);
      } else {
        throw new Error('No connection available');
      }
      updateTransferStatusUi(uiId, 'success', 'Shared');
    } catch (err) {
      console.error('Error sending file from receiver:', err);
      updateTransferStatusUi(uiId, 'error', 'Failed');
      showToast(`Failed to send ${file.name}`, 'error');
    }
  }
  
  showToast('All files shared!', 'success');
  receiverFilesToSend = [];
  receiverSelectedContainer.classList.add('hidden');
  updateReceiverSendBtnState();
}

function uploadFileToLocalShare(file, uiId) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    
    const xhr = new XMLHttpRequest();
    const startTime = Date.now();
    
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.floor((e.loaded / e.total) * 100);
        const speed = calculateSpeed(e.loaded, startTime);
        updateTransferProgressUi(uiId, percent, speed);
      }
    };
    
    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve();
      } else {
        reject(new Error(`Server error: ${xhr.statusText}`));
      }
    };
    
    xhr.onerror = () => reject(new Error('Network error'));
    
    xhr.open('POST', '/share');
    xhr.send(formData);
  });
}

async function uploadFileWebRTCFromReceiver(file, uiId) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileId = `file-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  
  activeConnection.send({
    type: 'file-init',
    id: fileId,
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    totalChunks: totalChunks
  });

  let offset = 0;
  for (let index = 0; index < totalChunks; index++) {
    if (!activeConnection || !activeConnection.open) {
      throw new Error('Connection lost during upload');
    }
    
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const arrayBuffer = await readBlobAsArrayBuffer(chunk);
    
    while (activeConnection.dataChannel.bufferedAmount > 1024 * 1024) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    activeConnection.send({
      type: 'file-chunk',
      id: fileId,
      chunkIndex: index,
      data: arrayBuffer
    });
    
    offset += CHUNK_SIZE;
    const percent = Math.floor((Math.min(offset, file.size) / file.size) * 100);
    const speed = calculateSpeed(Math.min(offset, file.size), startTime);
    updateTransferProgressUi(uiId, percent, speed);
  }

  activeConnection.send({
    type: 'file-complete',
    id: fileId
  });
}


/* =========================================================================
   SENDER FLOW (Mobile UI)
   ========================================================================= */

function setupSenderView(connectId) {
  senderView.classList.remove('hidden');
  
  if (connectId) {
    modeBadge.textContent = 'P2P WebRTC';
    senderConnectionStatus.textContent = 'Connecting...';
    senderConnectionStatus.className = 'status-indicator offline';
    
    initWebRTCSender(connectId);
  } else {
    modeBadge.textContent = 'Local Direct';
    senderConnectionStatus.textContent = 'Connected (HTTP)';
    senderConnectionStatus.className = 'status-indicator online';
    
    // Poll the local server for shared files that the Mac is offering to the phone
    startLocalSharedPolling();
  }
}

function initWebRTCSender(receiverId) {
  peer = new Peer({
    debug: 1
  });

  const senderPeerTimeout = setTimeout(() => {
    if (!peer || !peer.id) {
      senderConnectionStatus.textContent = 'Connection Slow/Offline';
      senderConnectionStatus.className = 'status-indicator offline';
      showToast('WebRTC cloud connection is slow.', 'warning');
    }
  }, 10000);

  peer.on('open', (id) => {
    clearTimeout(senderPeerTimeout);
    console.log('Sender Peer ID:', id);
    const conn = peer.connect(receiverId, {
      reliable: true
    });
    
    activeConnection = conn;
    
    conn.on('open', () => {
      console.log('Connected to receiver:', receiverId);
      senderConnectionStatus.textContent = 'Connected (P2P)';
      senderConnectionStatus.className = 'status-indicator online';
      showToast('Successfully connected to Mac!', 'success');
      
      updateSendButtonState();
    });

    // Monitor connectionState on RTCPeerConnection for absolute disconnection detection
    if (conn.peerConnection) {
      conn.peerConnection.addEventListener('connectionstatechange', () => {
        const state = conn.peerConnection.connectionState;
        console.log('RTCPeerConnection state change:', state);
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          handleSenderDisconnect();
        }
      });
    }

    conn.on('data', (data) => {
      // In sender mode, handle files sent from the Mac
      handleIncomingData(conn, data);
    });

    conn.on('error', (err) => {
      console.error('Connection error:', err);
      showToast('Connection failed', 'error');
    });

    conn.on('close', () => {
      handleSenderDisconnect();
    });
  });

  peer.on('error', (err) => {
    clearTimeout(senderPeerTimeout);
    console.error('Peer error:', err);
    senderConnectionStatus.textContent = 'Connection Error';
    senderConnectionStatus.className = 'status-indicator offline';
  });
}

function handleSenderDisconnect() {
  if (!activeConnection) return;
  console.log('Sender disconnected from receiver');
  senderConnectionStatus.textContent = 'Disconnected';
  senderConnectionStatus.className = 'status-indicator offline';
  showToast('Disconnected from Mac', 'warning');
  activeConnection = null;
  updateSendButtonState();
}


function handleFileSelection(filesList) {
  filesToSend = Array.from(filesList);
  
  if (filesToSend.length === 0) {
    selectedFilesContainer.classList.add('hidden');
    return;
  }
  
  selectedFilesContainer.classList.remove('hidden');
  selectedFilesList.innerHTML = '';
  
  filesToSend.forEach((file, index) => {
    const fileId = `select-${index}`;
    const fileHtml = `
      <div class="file-item" id="${fileId}">
        <div class="file-item-header">
          <div class="file-info">
            <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
            <div class="file-name-container">
              <span class="file-name" title="${file.name}">${file.name}</span>
              <span class="file-size">${formatBytes(file.size)}</span>
            </div>
          </div>
          <span class="file-status pending">Ready</span>
        </div>
      </div>
    `;
    selectedFilesList.insertAdjacentHTML('beforeend', fileHtml);
  });
  
  updateSendButtonState();
}

function updateSendButtonState() {
  if (filesToSend.length === 0) {
    sendBtn.disabled = true;
    return;
  }

  if (localServerConfig) {
    sendBtn.disabled = false;
  } else {
    sendBtn.disabled = !(activeConnection && activeConnection.open);
  }
}

async function startSending() {
  if (filesToSend.length === 0) return;
  
  sendBtn.disabled = true;
  dropZone.classList.add('hidden');
  selectedFilesContainer.classList.add('hidden');
  sendProgressContainer.classList.remove('hidden');
  
  sendProgressList.innerHTML = '';
  
  for (let i = 0; i < filesToSend.length; i++) {
    const file = filesToSend[i];
    const uiId = `send-${i}`;
    
    addSendProgressUi(uiId, file.name, file.size);
    
    try {
      if (localServerConfig) {
        // Direct local upload via HTTP
        await uploadFileDirect(file, uiId);
      } else if (activeConnection && activeConnection.open) {
        // WebRTC transfer
        await uploadFileWebRTC(file, uiId);
      } else {
        throw new Error('No connection available');
      }
      updateSendProgressStatus(uiId, 'success', 'Sent');
    } catch (err) {
      console.error('Error sending file:', err);
      updateSendProgressStatus(uiId, 'error', 'Failed');
      showToast(`Failed to send ${file.name}`, 'error');
    }
  }
  
  showToast('All transfers completed!', 'success');
  
  setTimeout(() => {
    sendBtn.disabled = false;
    dropZone.classList.remove('hidden');
    sendProgressContainer.classList.add('hidden');
    filesToSend = [];
    updateSendButtonState();
  }, 3000);
}

function uploadFileDirect(file, uiId) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    const path = file.webkitRelativePath || file.name;
    formData.append('file', file, path);
    
    const xhr = new XMLHttpRequest();
    const startTime = Date.now();
    
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.floor((e.loaded / e.total) * 100);
        const speed = calculateSpeed(e.loaded, startTime);
        updateSendProgressValue(uiId, percent, speed);
      }
    };
    
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.responseText === 'ok') {
        resolve();
      } else {
        reject(new Error(`Server returned status: ${xhr.status}`));
      }
    };
    
    xhr.onerror = () => {
      reject(new Error('Network error during upload'));
    };
    
    xhr.open('POST', '/upload');
    xhr.send(formData);
  });
}

async function uploadFileWebRTC(file, uiId) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileId = `file-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  
  activeConnection.send({
    type: 'file-init',
    id: fileId,
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    totalChunks: totalChunks
  });

  let offset = 0;
  for (let index = 0; index < totalChunks; index++) {
    if (!activeConnection || !activeConnection.open) {
      throw new Error('Connection closed during transfer');
    }
    
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const arrayBuffer = await readBlobAsArrayBuffer(chunk);
    
    while (activeConnection.dataChannel.bufferedAmount > 1024 * 1024) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    activeConnection.send({
      type: 'file-chunk',
      id: fileId,
      chunkIndex: index,
      data: arrayBuffer
    });
    
    offset += CHUNK_SIZE;
    
    const percent = Math.floor((Math.min(offset, file.size) / file.size) * 100);
    const speed = calculateSpeed(Math.min(offset, file.size), startTime);
    updateSendProgressValue(uiId, percent, speed);
  }

  activeConnection.send({
    type: 'file-complete',
    id: fileId
  });
}

function readBlobAsArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

// Local mode shared files polling (Mac to phone outgoing files list)
let lastSharedListHash = '';
function startLocalSharedPolling() {
  const poll = async () => {
    try {
      const response = await fetch('/api/shared');
      if (response.ok) {
        const files = await response.json();
        
        const filesHash = JSON.stringify(files);
        if (filesHash !== lastSharedListHash) {
          lastSharedListHash = filesHash;
          renderLocalSharedList(files);
        }
      }
    } catch (e) {
      console.error('Error polling shared files:', e);
    }
    setTimeout(poll, 2000);
  };
  poll();
}

function renderLocalSharedList(files) {
  if (files.length === 0) {
    emptyReceived.classList.remove('hidden');
    receivedList.classList.add('hidden');
    return;
  }
  
  emptyReceived.classList.add('hidden');
  receivedList.classList.remove('hidden');
  receivedList.innerHTML = '';
  
  files.forEach(file => {
    const fileId = `shared-${file.name.replace(/[^a-zA-Z0-9]/g, '')}`;
    const dateStr = new Date(file.modified * 1000).toLocaleTimeString();
    
    const downloadUrl = `/shared/${encodeURIComponent(file.name)}`;
    
    const fileHtml = `
      <div class="file-item" id="${fileId}">
        <div class="file-item-header" style="align-items: center;">
          <div class="file-info" style="flex: 1;">
            <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
            <div class="file-name-container">
              <span class="file-name" title="${file.name}">${file.name}</span>
              <span class="file-size">${formatBytes(file.size)} • Shared at ${dateStr}</span>
            </div>
          </div>
          <a href="${downloadUrl}" download="${file.name}" class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            Download
          </a>
        </div>
      </div>
    `;
    receivedList.insertAdjacentHTML('beforeend', fileHtml);
  });
}


/* =========================================================================
   UI HELPERS (DOM manipulation)
   ========================================================================= */

function addTransferToUi(id, name, size) {
  // Determine targets depending on currentMode
  const targetList = (currentMode === 'sender') ? receivedList : transferList;
  const targetEmpty = (currentMode === 'sender') ? emptyReceived : emptyTransfers;
  
  if (targetEmpty) targetEmpty.classList.add('hidden');
  if (targetList) targetList.classList.remove('hidden');
  
  const html = `
    <div class="file-item" id="${id}">
      <div class="file-item-header">
        <div class="file-info">
          <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
          <div class="file-name-container">
            <span class="file-name" title="${name}">${name}</span>
            <span class="file-size">${formatBytes(size)}</span>
          </div>
        </div>
        <span class="file-status transferring" id="status-${id}">0%</span>
      </div>
      <div class="progress-bar-wrapper">
        <div class="progress-track">
          <div class="progress-fill" id="progress-${id}"></div>
        </div>
        <div class="progress-meta">
          <span id="speed-${id}">0 B/s</span>
        </div>
      </div>
    </div>
  `;
  if (targetList) targetList.insertAdjacentHTML('afterbegin', html);
}

function updateTransferProgressUi(id, percent, speedInfo) {
  const progressFill = document.getElementById(`progress-${id}`);
  const statusLabel = document.getElementById(`status-${id}`);
  const speedLabel = document.getElementById(`speed-${id}`);
  
  if (progressFill) progressFill.style.width = `${percent}%`;
  if (statusLabel) statusLabel.textContent = `${percent}%`;
  if (speedLabel && speedInfo) speedLabel.textContent = speedInfo;
}

function updateTransferStatusUi(id, state, text) {
  const statusLabel = document.getElementById(`status-${id}`);
  const progressFill = document.getElementById(`progress-${id}`);
  
  if (statusLabel) {
    statusLabel.textContent = text || state;
    statusLabel.className = `file-status ${state}`;
  }
  
  if (progressFill && (state === 'success' || state === 'error')) {
    progressFill.className = `progress-fill ${state}`;
    if (state === 'success') progressFill.style.width = '100%';
  }
}

function addSendProgressUi(id, name, size) {
  const html = `
    <div class="file-item" id="${id}">
      <div class="file-item-header">
        <div class="file-info">
          <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
          <div class="file-name-container">
            <span class="file-name" title="${name}">${name}</span>
            <span class="file-size">${formatBytes(size)}</span>
          </div>
        </div>
        <span class="file-status transferring" id="status-${id}">0%</span>
      </div>
      <div class="progress-bar-wrapper">
        <div class="progress-track">
          <div class="progress-fill" id="progress-${id}"></div>
        </div>
        <div class="progress-meta">
          <span id="speed-${id}">0 B/s</span>
        </div>
      </div>
    </div>
  `;
  sendProgressList.insertAdjacentHTML('beforeend', html);
}

function updateSendProgressValue(id, percent, speedInfo) {
  const progressFill = document.getElementById(`progress-${id}`);
  const statusLabel = document.getElementById(`status-${id}`);
  const speedLabel = document.getElementById(`speed-${id}`);
  
  if (progressFill) progressFill.style.width = `${percent}%`;
  if (statusLabel) statusLabel.textContent = `${percent}%`;
  if (speedLabel && speedInfo) speedLabel.textContent = speedInfo;
}

function updateSendProgressStatus(id, state, text) {
  const statusLabel = document.getElementById(`status-${id}`);
  const progressFill = document.getElementById(`progress-${id}`);
  
  if (statusLabel) {
    statusLabel.textContent = text;
    statusLabel.className = `file-status ${state}`;
  }
  
  if (progressFill) {
    progressFill.className = `progress-fill ${state}`;
    if (state === 'success') progressFill.style.width = '100%';
  }
}

// System alerts (Toasts)
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}


/* =========================================================================
   UTILITIES
   ========================================================================= */

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function calculateSpeed(bytesLoaded, startTime) {
  const timeElapsed = (Date.now() - startTime) / 1000; // in seconds
  if (timeElapsed <= 0) return '0 B/s';
  const speedBps = bytesLoaded / timeElapsed;
  return formatBytes(speedBps) + '/s';
}
