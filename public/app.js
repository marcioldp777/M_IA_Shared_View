/* Shared by the desktop controller and packaged TV receiver. */
(function () {
  'use strict';
  var role = document.body.dataset.role, socket, pc, stream, candidates = [], slides = [], slideIndex = 0;
  var retryTimer, connectTimer, tvList = [], host = 'Computador', pendingAuth = null, ink = null, zoomRect = null;
  var $ = function (id) { return document.getElementById(id); };
  function load(key, fallback) { try { var value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  function randomId() {
    var bytes = new Uint8Array(24), hex = '';
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < bytes.length; j++) hex += ('0' + bytes[j].toString(16)).slice(-2);
    return hex;
  }
  function status(message) { $('status').textContent = message; if (message) send({ type: 'status', message: message }); }
  function send(data) { if (socket && socket.readyState === 1) socket.send(JSON.stringify(data)); }
  function cleanup() { if (pc) pc.close(); pc = null; candidates = []; }
  function stop() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if ($('preview')) $('preview').srcObject = null;
    cleanup();
  }
  function play() {
    var video = $('screen');
    if (video && video.srcObject) video.play().catch(function () { status('Pressione OK no controle para autorizar imagem e som.'); });
  }
  function connection() {
    cleanup();
    pc = new RTCPeerConnection({ iceServers: [] });
    pc.onicecandidate = function (e) { if (e.candidate) send({ type: 'ice', candidate: e.candidate }); };
    pc.onconnectionstatechange = function () {
      if (!pc) return;
      send({ type: 'status', message: 'webrtc ' + pc.connectionState + ' / ice ' + pc.iceConnectionState });
      if (pc.connectionState === 'connected') status(role === 'tv' ? '' : 'Transmitindo para a TV.');
      if (pc.connectionState === 'failed') status('Falha na conexão de mídia. Verifique isolamento Wi-Fi/firewall e tente compartilhar novamente.');
    };
    pc.ontrack = function (e) {
      $('welcome').hidden = true; $('slide').hidden = true; $('screen').hidden = false;
      $('screen').srcObject = e.streams[0]; play();
    };
    return pc;
  }
  // H.264 primeiro: a TV decodifica em hardware (VP8/VP9 vão para a CPU e engasgam).
  function preferH264(peer) {
    if (!window.RTCRtpSender || !RTCRtpSender.getCapabilities) return;
    var codecs = RTCRtpSender.getCapabilities('video').codecs, h264 = function (c) { return /h264/i.test(c.mimeType); };
    peer.getTransceivers().forEach(function (t) {
      if (t.sender.track && t.sender.track.kind === 'video' && t.setCodecPreferences) t.setCodecPreferences(codecs.filter(h264).concat(codecs.filter(function (c) { return !h264(c); })));
    });
  }
  // Rede local: banda folgada e prioridade para manter 30 quadros/s.
  async function tune(peer) {
    for (var sender of peer.getSenders()) {
      if (!sender.track || sender.track.kind !== 'video') continue;
      var params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = 8000000; params.encodings[0].maxFramerate = 30;
      params.degradationPreference = 'maintain-framerate';
      try { await sender.setParameters(params); } catch (_) {}
    }
  }
  // TV: retângulo onde a área compartilhada aparece (ajuste "contain"), ampliado pelo zoom por seleção.
  function frame() {
    var video = $('screen'), W = innerWidth, H = innerHeight, vw = video.videoWidth || W, vh = video.videoHeight || H;
    var s = Math.min(W / vw, H / vh), b = { w: vw * s, h: vh * s };
    b.x = (W - b.w) / 2; b.y = (H - b.h) / 2;
    if (!zoomRect) return b;
    var k = Math.min(W / (zoomRect.w * b.w), H / (zoomRect.h * b.h)), w = b.w * k, h = b.h * k;
    return { w: w, h: h, x: W / 2 - (zoomRect.x + zoomRect.w / 2) * w, y: H / 2 - (zoomRect.y + zoomRect.h / 2) * h };
  }
  function layout() {
    var f = frame();
    if ($('freeze')) $('freeze').style.cssText = zoomRect ? 'left:' + f.x + 'px;top:' + f.y + 'px;width:' + f.w + 'px;height:' + f.h + 'px;right:auto;bottom:auto;object-fit:fill' : '';
    $('screen').style.cssText = zoomRect ? 'left:' + f.x + 'px;top:' + f.y + 'px;width:' + f.w + 'px;height:' + f.h + 'px;right:auto;bottom:auto;object-fit:fill' : '';
    if (ink) ink.redraw();
  }
  function zoomTo(rect) {
    var ok = rect && [rect.x, rect.y, rect.w, rect.h].every(function (n) { return typeof n === 'number' && n >= 0 && n <= 1; }) && rect.w > 0.01 && rect.h > 0.01;
    zoomRect = ok ? rect : null; layout();
  }
  function command(action) {
    if (action === 'black' || action === 'show') $('black').hidden = action !== 'black';
    if (action === 'mute' || action === 'unmute') $('screen').muted = action === 'mute';
    if (action === 'freeze' && $('freeze') && $('screen').videoWidth) {
      // Copia o quadro atual; o vídeo (e o som) seguem por baixo.
      var still = $('freeze'), video = $('screen');
      still.width = video.videoWidth; still.height = video.videoHeight;
      still.getContext('2d').drawImage(video, 0, 0); still.style.cssText = video.style.cssText; still.hidden = false;
    }
    if (action === 'unfreeze' && $('freeze')) $('freeze').hidden = true;
    if (action === 'stop') {
      cleanup(); $('screen').srcObject = null; $('screen').hidden = true; $('slide').hidden = true;
      if ($('freeze')) $('freeze').hidden = true;
      $('welcome').hidden = false; $('black').hidden = true; status('Transmissão encerrada.');
      if (ink) { ink.handle({ op: 'reset' }); zoomTo(null); }
    }
  }
  function connect(base) {
    clearTimeout(retryTimer); clearTimeout(connectTimer);
    if (socket) { socket.onclose = null; socket.onerror = null; socket.onmessage = null; socket.onopen = null; }
    if (socket) socket.close();
    socket = new WebSocket(base.replace(/^http/, 'ws').replace(/\/$/, ''));
    if (role === 'tv') status('Conectando ao computador em ' + base + '…');
    connectTimer = setTimeout(function () { if (socket && socket.readyState === 0) socket.close(); }, 8000);
    socket.onopen = function () { clearTimeout(connectTimer); send(role === 'tv' ? { type: 'join', role: 'tv', id: tvId, name: tvName } : { type: 'join', role: 'sender' }); };
    socket.onerror = function () { status('Não foi possível conectar. Confira o endereço e o servidor.'); };
    socket.onclose = function () {
      clearTimeout(connectTimer);
      stop();
      if (role === 'sender') {
        if (desktop) desktop.sharing(false);
        $('controls').hidden = true; tvList = []; renderTvs();
        status('Sem conexão com o servidor. Nova tentativa em 3 segundos.');
        retryTimer = setTimeout(function () { connect(base); }, 3000);
      } else {
        command('stop'); // volta para a tela inicial, senão o último vídeo cobre a tela de espera
        showAuth(null); $('setup').hidden = false; $('tvName').textContent = '';
        status('Sem conexão com ' + base + '. Abra o Sala TV no Windows. Nova tentativa em 5 segundos.');
        retryTimer = setTimeout(function () { connect(base); }, 5000);
      }
    };
    socket.onmessage = async function (event) {
      try {
        var msg = JSON.parse(event.data);
        if (msg.type === 'error') { status(msg.message); return; }
        if (msg.type === 'tvs') { host = msg.host || host; tvList = msg.list; renderTvs(); }
        if (msg.type === 'waiting') status('Confirme o acesso no controle remoto da TV ' + msg.name + '…');
        if (msg.type === 'joined') {
          if (role === 'tv') { $('tvName').textContent = msg.name; $('setup').hidden = true; status('Aguardando um computador…'); }
          else { $('controls').hidden = false; status('Conectado a ' + msg.name + '. Escolha o conteúdo.'); }
        }
        if (msg.type === 'left') { $('controls').hidden = true; status('Desconectado da TV.'); }
        if (msg.type === 'auth-request' && role === 'tv') {
          if (trusted[msg.token]) send({ type: 'auth-response', allow: true });
          else showAuth(msg);
        }
        if (msg.type === 'auth-cancel' && role === 'tv') showAuth(null);
        if (msg.type === 'peer-ready') status('Apresentador conectado. Aguardando conteúdo…');
        if (msg.type === 'peer-left') {
          if (role === 'tv') { command('stop'); status('Apresentador desconectado.'); }
          else { endShare(); $('controls').hidden = true; status('A TV foi desconectada.'); }
        }
        if (msg.type === 'offer' && role === 'tv') {
          connection(); await pc.setRemoteDescription(msg.description);
          await pc.setLocalDescription(await pc.createAnswer()); send({ type: 'answer', description: pc.localDescription });
          for (var c of candidates) await pc.addIceCandidate(c); candidates = [];
        }
        if (msg.type === 'answer' && pc) {
          await pc.setRemoteDescription(msg.description); await tune(pc);
          for (var candidate of candidates) await pc.addIceCandidate(candidate); candidates = [];
        }
        if (msg.type === 'ice') { if (pc && pc.remoteDescription) await pc.addIceCandidate(msg.candidate); else candidates.push(msg.candidate); }
        if (msg.type === 'command' && role === 'tv') command(msg.action);
        if (msg.type === 'annotate' && role === 'tv' && ink) { if (msg.op === 'zoom') zoomTo(msg.rect); else ink.handle(msg); }
        if (msg.type === 'image' && role === 'tv') {
          $('slide').src = msg.data; $('slide').hidden = false; $('screen').hidden = true; $('welcome').hidden = true; status('');
        }
      } catch (error) { status('Falha: ' + error.message); }
    };
  }
  if (role === 'tv') {
    var tvId = load('sala-tv-id', '') || randomId(), trusted = load('sala-trusted', {}), tvName = 'Samsung TV';
    save('sala-tv-id', tvId);
    try { tvName = tizen.systeminfo.getCapability('http://tizen.org/system/model_name') || tvName; } catch (_) {}
    // msg null fecha o pedido; a resposta fica lembrada pelo token do computador.
    var showAuth = function (msg) {
      pendingAuth = msg; $('auth').hidden = !msg;
      if (msg) { $('authName').textContent = msg.name; $('allow').focus(); }
    };
    var answerAuth = function (allow) {
      if (!pendingAuth) return;
      if (allow) { trusted[pendingAuth.token] = { name: pendingAuth.name, at: Date.now() }; save('sala-trusted', trusted); }
      send({ type: 'auth-response', allow: allow }); showAuth(null);
    };
    $('allow').onclick = function () { answerAuth(true); };
    $('deny').onclick = function () { answerAuth(false); };
    $('forget').onclick = function () { trusted = {}; save('sala-trusted', trusted); status('Computadores autorizados foram esquecidos.'); };
    document.addEventListener('keydown', function (e) { if (e.keyCode === 10009 && pendingAuth) answerAuth(false); });
    if (typeof SalaInk !== 'undefined') {
      ink = SalaInk($('ink'), frame, { video: $('screen'), pointer: true });
      addEventListener('resize', layout); $('screen').addEventListener('resize', layout);
    }
    var saved = '';
    try { saved = localStorage.getItem('sala-server') || ''; } catch (_) {}
    var hosted = /^https?:$/.test(location.protocol) && location.port;
    var initialServer = hosted ? location.origin : (saved || document.body.dataset.server || '');
    $('server').value = initialServer;
    $('openServer').onclick = function () {
      var value = $('server').value.trim();
      if (!/^https?:\/\/[^/]+\/?$/.test(value)) return status('Use o endereço completo: http://IP-DO-COMPUTADOR:8787');
      try { localStorage.setItem('sala-server', value); } catch (_) {}
      connect(value);
    };
    document.addEventListener('keydown', function (e) { if (e.keyCode === 13) play(); });
    document.addEventListener('visibilitychange', function () {
      var media = $('screen').srcObject;
      if (media) media.getTracks().forEach(function (t) { t.enabled = !document.hidden; });
    });
    if (initialServer) connect(initialServer);
  } else {
    var renderTvs = function () {
      var box = $('tvs'), paired = tvList.some(function (tv) { return tv.mine; });
      box.textContent = '';
      if (!tvList.length) { box.textContent = 'Nenhuma TV encontrada. Abra o Sala TV na TV.'; return; }
      tvList.forEach(function (tv) {
        var button = document.createElement('button');
        button.className = tv.mine ? '' : 'secondary';
        button.textContent = tv.name + (tv.mine ? ' · conectada' : tv.busy ? ' · em uso' : '');
        button.disabled = tv.busy || paired;
        button.onclick = function () {
          // Um token por TV: uma TV falsa na rede só aprende o token dela mesma.
          var tokens = load('sala-tokens', {});
          if (!tokens[tv.id]) { tokens[tv.id] = randomId(); save('sala-tokens', tokens); }
          send({ type: 'request', tv: tv.id, token: tokens[tv.id], name: host });
          status('Pedindo acesso a ' + tv.name + '…');
        };
        box.appendChild(button);
      });
    };
    $('leave').onclick = function () { endShare(); send({ type: 'command', action: 'stop' }); send({ type: 'leave' }); };
    // Ferramentas (só no app Windows): o processo principal desenha sobre o app compartilhado e manda os eventos para cá.
    var desktop = window.salaDesktop;
    var endShare = function () { stop(); if (desktop) desktop.sharing(false); };
    if (desktop) {
      $('tools').hidden = false;
      document.querySelectorAll('[data-tool]').forEach(function (button) { button.onclick = function () { desktop.setTool(button.dataset.tool); }; });
      $('clearInk').onclick = function () { desktop.clear(); };
      $('undoInk').onclick = function () { desktop.undo(); };
      // Caixa flutuante: preferência lembrada neste computador.
      $('floating').checked = load('sala-floating', false);
      $('floating').onchange = function () { save('sala-floating', $('floating').checked); desktop.toolbar($('floating').checked); };
      desktop.toolbar($('floating').checked);
      desktop.onAnnotate(function (msg) {
        if (msg.op === 'notice') return status(msg.message);
        if (msg.op === 'stop-share') return $('stop').onclick();
        if (msg.op === 'tv-command') return send({ type: 'command', action: msg.action });
        if (msg.op === 'toolbar') { $('floating').checked = msg.visible; return save('sala-floating', msg.visible); }
        send(Object.assign({ type: 'annotate' }, msg));
        if (msg.op === 'tool') document.querySelectorAll('[data-tool]').forEach(function (button) { button.className = button.dataset.tool && button.dataset.tool === msg.tool ? '' : 'secondary'; });
      });
    }
    connect(location.origin);
    $('share').onclick = async function () {
      if ($('controls').hidden) return status('Escolha uma TV antes de compartilhar.');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return status('Abra o painel em http://localhost:8787 usando Chrome ou Edge no computador.');
      try {
        stop(); send({ type: 'command', action: 'stop' });
        var video = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } }, audioError = '';
        try { stream = await navigator.mediaDevices.getDisplayMedia({ video: video, audio: true }); }
        catch (error) {
          // Loopback de áudio indisponível (ex.: alguns dispositivos USB): segue só com imagem.
          if (error.name === 'NotAllowedError' || !/audio/i.test(error.message)) throw error;
          audioError = error.message;
          stream = await navigator.mediaDevices.getDisplayMedia({ video: video, audio: false });
          // Alternativa: dispositivo de gravação que reproduz o som do sistema (Mixagem estéreo, VB-Cable).
          var mix = (await navigator.mediaDevices.enumerateDevices()).find(function (d) { return d.kind === 'audioinput' && /mixagem est|stereo mix|cable output|voicemeeter out/i.test(d.label); });
          if (mix) {
            var mixStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: mix.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
            mixStream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
          }
        }
        $('preview').srcObject = stream;
        var peer = connection();
        var videoTrack = stream.getVideoTracks()[0];
        if ('contentHint' in videoTrack) videoTrack.contentHint = 'motion';
        stream.getTracks().forEach(function (t) { peer.addTrack(t, stream); });
        preferH264(peer);
        stream.getVideoTracks()[0].onended = function () { endShare(); send({ type: 'command', action: 'stop' }); status('Compartilhamento encerrado.'); };
        await peer.setLocalDescription(await peer.createOffer()); send({ type: 'offer', description: peer.localDescription });
        status(stream.getAudioTracks().length ? 'Conectando imagem e áudio' + (audioError ? ' (via ' + stream.getAudioTracks()[0].label + ')' : '') + '…' : audioError ? 'Conectando só imagem: o áudio do sistema não pôde ser capturado (' + audioError + '). Ative a "Mixagem estéreo" ou instale o VB-Cable.' :'Conectando imagem. A captura selecionada não forneceu áudio.');
      } catch (error) { stop(); status('Não foi possível compartilhar: ' + error.message); }
    };
    $('stop').onclick = function () { endShare(); send({ type: 'command', action: 'stop' }); status('Transmissão encerrada.'); };
    document.querySelectorAll('[data-command]').forEach(function (button) { button.onclick = function () { send({ type: 'command', action: button.dataset.command }); if (desktop) desktop.tvState(button.dataset.command); }; });
    async function showSlide(index) {
      if (!slides.length) return;
      slideIndex = (index + slides.length) % slides.length;
      var file = slides[slideIndex], url = URL.createObjectURL(file), img = new Image();
      try {
        await new Promise(function (resolve, reject) { img.onload = resolve; img.onerror = reject; img.src = url; });
        var ratio = Math.min(1, 1920 / Math.max(img.width, img.height)), canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio); canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        send({ type: 'image', data: canvas.toDataURL('image/jpeg', 0.9) });
        $('slideInfo').textContent = (slideIndex + 1) + ' / ' + slides.length + ' · ' + file.name;
      } catch (_) { status('Não foi possível abrir esta imagem.'); } finally { URL.revokeObjectURL(url); }
    }
    $('images').onchange = function (e) { slides = Array.from(e.target.files); endShare(); send({ type: 'command', action: 'stop' }); showSlide(0); };
    $('previous').onclick = function () { showSlide(slideIndex - 1); };
    $('next').onclick = function () { showSlide(slideIndex + 1); };
    document.addEventListener('keydown', function (e) { if (/INPUT|TEXTAREA/.test(e.target.tagName)) return; if (e.key === 'ArrowRight') showSlide(slideIndex + 1); if (e.key === 'ArrowLeft') showSlide(slideIndex - 1); });
  }
})();
