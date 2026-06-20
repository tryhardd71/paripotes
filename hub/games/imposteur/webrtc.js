const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export class VoiceCall {
  constructor(socket, getMyId, getPlayerName) {
    this.socket = socket;
    this.getMyId = getMyId;
    this.getPlayerName = getPlayerName;
    this.peers = new Map();
    this.localStream = null;
    this.micEnabled = true;
    this.camEnabled = true;
    this.inCall = false;
    this.panel = document.getElementById('video-panel');
    this.grid = document.getElementById('video-grid');
    this.controls = document.getElementById('video-controls');
    this.statusEl = document.getElementById('video-status');

    socket.on('call_signal', ({ from, signal }) => {
      if (this.inCall) this.handleSignal(from, signal);
    });

    socket.on('call_peer_joined', ({ peerId, name }) => {
      if (this.inCall) this.ensurePlaceholder(peerId, name);
    });

    socket.on('call_peer_left', ({ peerId }) => {
      this.removePeer(peerId);
    });
  }

  showPanel() {
    this.panel?.classList.remove('hidden');
  }

  hidePanel() {
    this.panel?.classList.add('hidden');
  }

  setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  renderJoinPrompt() {
    if (!this.controls) return;
    this.controls.innerHTML = `
      <button class="btn btn-primary" id="btn-join-call">🎤 Rejoindre le vocal & caméra</button>
      <p class="video-hint">Autorise le micro et la caméra quand le navigateur te le demande.</p>
    `;
    document.getElementById('btn-join-call')?.addEventListener('click', () => this.join());
  }

  renderInCallControls() {
    if (!this.controls) return;
    this.controls.innerHTML = `
      <div class="video-btn-row">
        <button class="btn btn-secondary video-ctrl" id="btn-toggle-mic">${this.micEnabled ? '🔊 Micro ON' : '🔇 Micro OFF'}</button>
        <button class="btn btn-secondary video-ctrl" id="btn-toggle-cam">${this.camEnabled ? '📷 Cam ON' : '📷 Cam OFF'}</button>
        <button class="btn btn-danger video-ctrl" id="btn-leave-call">Quitter</button>
      </div>
    `;
    document.getElementById('btn-toggle-mic')?.addEventListener('click', () => this.toggleMic());
    document.getElementById('btn-toggle-cam')?.addEventListener('click', () => this.toggleCam());
    document.getElementById('btn-leave-call')?.addEventListener('click', () => this.leave());
  }

  async join() {
    if (this.inCall) return;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
    } catch {
      alert('Impossible d\'accéder au micro/caméra. Vérifie les permissions du navigateur.');
      return;
    }

    this.inCall = true;
    this.micEnabled = true;
    this.camEnabled = true;
    this.showPanel();
    this.addLocalVideo();
    this.renderInCallControls();
    this.setStatus('Connexion au salon vocal…');

    const res = await new Promise((resolve) => {
      this.socket.emit('call_ready', {}, (r) => resolve(r ?? {}));
    });

    if (res.error) {
      this.leave();
      alert(res.error);
      return;
    }

    for (const peer of res.peers ?? []) {
      this.ensurePlaceholder(peer.id, peer.name);
      await this.createOffer(peer.id);
    }

    this.setStatus('Vocal actif');
  }

  leave() {
    this.socket.emit('call_leave');

    this.peers.forEach((_, peerId) => this.removePeer(peerId));
    this.peers.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    const localTile = document.getElementById('video-local');
    if (localTile) localTile.remove();

    this.inCall = false;
    this.setStatus('');
    this.renderJoinPrompt();
  }

  leaveAndHide() {
    this.leave();
    this.hidePanel();
    if (this.grid) this.grid.innerHTML = '';
  }

  toggleMic() {
    this.micEnabled = !this.micEnabled;
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = this.micEnabled;
    });
    this.updateLocalOverlay();
    this.renderInCallControls();
  }

  toggleCam() {
    this.camEnabled = !this.camEnabled;
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = this.camEnabled;
    });
    this.updateLocalOverlay();
    this.renderInCallControls();
  }

  addLocalVideo() {
    if (!this.grid) return;

    let tile = document.getElementById('video-local');
    if (!tile) {
      tile = document.createElement('div');
      tile.id = 'video-local';
      tile.className = 'video-tile local';
      tile.innerHTML = `
        <video autoplay playsinline muted></video>
        <div class="video-label">${this.getPlayerName(this.getMyId())} (toi)</div>
        <div class="video-overlay hidden"></div>
      `;
      this.grid.prepend(tile);
    }

    const video = tile.querySelector('video');
    video.srcObject = this.localStream;
    this.updateLocalOverlay();
  }

  updateLocalOverlay() {
    const tile = document.getElementById('video-local');
    const overlay = tile?.querySelector('.video-overlay');
    if (!overlay) return;

    const off = !this.micEnabled || !this.camEnabled;
    overlay.classList.toggle('hidden', !off);
    const parts = [];
    if (!this.micEnabled) parts.push('🔇');
    if (!this.camEnabled) parts.push('📷 off');
    overlay.textContent = parts.join(' ');
  }

  ensurePlaceholder(peerId, name) {
    if (peerId === this.getMyId() || document.getElementById(`video-${peerId}`)) return;

    const tile = document.createElement('div');
    tile.id = `video-${peerId}`;
    tile.className = 'video-tile';
    tile.innerHTML = `
      <video autoplay playsinline></video>
      <div class="video-label">${name ?? 'Joueur'}</div>
      <div class="video-placeholder">Connexion…</div>
    `;
    this.grid?.appendChild(tile);
  }

  attachRemoteStream(peerId, stream) {
    let tile = document.getElementById(`video-${peerId}`);
    if (!tile) {
      this.ensurePlaceholder(peerId, 'Joueur');
      tile = document.getElementById(`video-${peerId}`);
    }

    const video = tile?.querySelector('video');
    const placeholder = tile?.querySelector('.video-placeholder');
    if (video) {
      video.srcObject = stream;
      placeholder?.classList.add('hidden');
    }
  }

  async createPeerConnection(peerId, isInitiator) {
    if (this.peers.has(peerId)) return this.peers.get(peerId).pc;

    const pc = new RTCPeerConnection(ICE_SERVERS);

    this.localStream?.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream);
    });

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.attachRemoteStream(peerId, stream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('call_signal', {
          to: peerId,
          signal: { candidate: event.candidate },
        });
      }
    };

    this.peers.set(peerId, { pc });

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit('call_signal', { to: peerId, signal: { sdp: offer } });
    }

    return pc;
  }

  async createOffer(peerId) {
    await this.createPeerConnection(peerId, true);
  }

  async handleSignal(from, signal) {
    if (!signal) return;

    if (signal.sdp?.type === 'offer') {
      const pc = await this.createPeerConnection(from, false);
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.emit('call_signal', { to: from, signal: { sdp: answer } });
      return;
    }

    const peer = this.peers.get(from);
    if (!peer) return;

    if (signal.sdp?.type === 'answer') {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else if (signal.candidate) {
      await peer.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer?.pc) peer.pc.close();
    this.peers.delete(peerId);

    const tile = document.getElementById(`video-${peerId}`);
    if (tile) tile.remove();
  }

  onEnterRoom() {
    this.showPanel();
    if (!this.inCall) {
      if (this.grid) this.grid.innerHTML = '';
      this.renderJoinPrompt();
      this.setStatus('Vocal disponible dans le salon');
    }
  }

  async onReconnect() {
    if (!this.inCall) return;
    this.leave();
    this.onEnterRoom();
    this.setStatus('Reconnecté — rejoins le vocal');
  }
}