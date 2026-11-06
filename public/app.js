/* Shared by the desktop controller and packaged TV receiver. */
(function () {
  'use strict';
  var role = document.body.dataset.role, socket, pc, stream, candidates = [], slides = [], slideIndex = 0;
  var currentBase = '', connected = false, retryTimer, connectTimer, tvList = [], host = 'Computador', pendingAuth = null, ink = null, zoomRect = null, presenting = false, fillScreen = false, previewInk = null;
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
  function cleanup() { clearInterval(statsTimer); if (pc) pc.close(); pc = null; candidates = []; lastDecode = null; slowHinted = false; lowRes = false; }
  // Diagnóstico de fluidez: a cada 5 s, estatísticas do vídeo vão para o log do app Windows.
  var statsTimer, lastDecode = null, slowHinted = false, lowRes = false, SLOW_DECODE_MS = 60;
  function reportStats(peer) {
    peer.getStats().then(function (report) {
      report.forEach(function (s) {
        if (s.kind !== 'video' || (s.type !== 'inbound-rtp' && s.type !== 'outbound-rtp')) return;
        var parts = ['stats', s.type === 'inbound-rtp' ? 'recebido' : 'enviado', (s.frameWidth || 0) + 'x' + (s.frameHeight || 0), Math.round(s.framesPerSecond || 0) + 'fps'];
        if (s.type === 'inbound-rtp') {
          parts.push('descartados=' + (s.framesDropped || 0), 'perdidos=' + (s.packetsLost || 0), 'decoder=' + (s.decoderImplementation || '?'));
          // Tempo médio de decodificação nos últimos 5 s; aparelho lento pede 720p ao PC (uma vez por conexão).
          if (lastDecode && s.framesDecoded > lastDecode.frames) {
            var decodeMs = Math.round(1000 * (s.totalDecodeTime - lastDecode.time) / (s.framesDecoded - lastDecode.frames));
            parts.push('decode=' + decodeMs + 'ms');
            if (decodeMs > SLOW_DECODE_MS && s.frameHeight > 800 && !slowHinted) { slowHinted = true; send({ type: 'hint', lowRes: true, decodeMs: decodeMs }); }
          }
          lastDecode = { time: s.totalDecodeTime || 0, frames: s.framesDecoded || 0 };
          if (s.jitterBufferEmittedCount) parts.push('buffer=' + Math.round(1000 * s.jitterBufferDelay / s.jitterBufferEmittedCount) + 'ms');
        } else {
          parts.push('limite=' + (s.qualityLimitationReason || '?'), 'encoder=' + (s.encoderImplementation || '?'), 'kbps=' + Math.round((s.targetBitrate || 0) / 1000));
        }
        send({ type: 'status', message: parts.join(' ') });
      });
    }).catch(function () {});
  }
  function stop() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if ($('preview')) $('preview').srcObject = null;
    if ($('share')) { $('share').textContent = 'Compartilhar tela'; $('share').className = 'main-action'; $('live').hidden = true; $('fillToggle').setAttribute('aria-pressed', 'false'); }
    if (previewInk) previewInk.handle({ op: 'clear' }); // a ferramenta escolhida continua; os desenhos saem
    if (setCompact && document.body.classList.contains('compact')) setCompact(false); // painel volta ao tamanho normal
    cleanup();
  }
  // Painel: volta para a escolha da TV.
  function showPick() { if ($('controls')) $('controls').hidden = true; if ($('pick')) $('pick').hidden = false; }
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
      if (pc.connectionState === 'connected') {
        status(role === 'tv' ? '' : 'Transmitindo para a TV.');
        var peer = pc; clearInterval(statsTimer); statsTimer = setInterval(function () { reportStats(peer); }, 5000);
      }
      if (pc.connectionState === 'failed') status('Falha na conexão de mídia. Verifique isolamento Wi-Fi/firewall e tente compartilhar novamente.');
    };
    pc.ontrack = function (e) {
      // Rede local sem perdas: buffer mínimo corta ~100 ms de atraso (jitterBufferTarget em ms; playoutDelayHint em s, versões antigas).
      if ('jitterBufferTarget' in e.receiver) e.receiver.jitterBufferTarget = 0;
      else if ('playoutDelayHint' in e.receiver) e.receiver.playoutDelayHint = 0;
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
  // lowRes: TV lenta para decodificar 1080p -> envia em 720p (1920/1.5) com menos banda.
  async function tune(peer) {
    for (var sender of peer.getSenders()) {
      if (!sender.track || sender.track.kind !== 'video') continue;
      var params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = lowRes ? 5000000 : 8000000; params.encodings[0].maxFramerate = 30;
      params.encodings[0].scaleResolutionDownBy = lowRes ? 1.5 : 1;
      params.degradationPreference = 'maintain-framerate';
      try { await sender.setParameters(params); } catch (_) {}
    }
  }
  // TV: retângulo onde a área compartilhada aparece (ajuste "contain"), ampliado pelo zoom por seleção.
  function frame() {
    var video = $('screen'), W = innerWidth, H = innerHeight, vw = video.videoWidth || W, vh = video.videoHeight || H;
    // Preencher: a imagem cobre a TV inteira (corta as bordas que sobram) em vez de caber com faixas pretas.
    var s = (fillScreen ? Math.max : Math.min)(W / vw, H / vh), b = { w: vw * s, h: vh * s };
    b.x = (W - b.w) / 2; b.y = (H - b.h) / 2;
    if (!zoomRect) return b;
    var k = Math.min(W / (zoomRect.w * b.w), H / (zoomRect.h * b.h)), w = b.w * k, h = b.h * k;
    return { w: w, h: h, x: W / 2 - (zoomRect.x + zoomRect.w / 2) * w, y: H / 2 - (zoomRect.y + zoomRect.h / 2) * h };
  }
  function layout() {
    var f = frame(), css = zoomRect || fillScreen ? 'left:' + f.x + 'px;top:' + f.y + 'px;width:' + f.w + 'px;height:' + f.h + 'px;right:auto;bottom:auto;object-fit:fill' : '';
    if ($('freeze')) $('freeze').style.cssText = css;
    $('screen').style.cssText = css;
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
    if (action === 'fill' || action === 'fit') { fillScreen = action === 'fill'; layout(); }
    if (action === 'stop') {
      fillScreen = false;
      cleanup(); $('screen').srcObject = null; $('screen').hidden = true; $('slide').hidden = true;
      if ($('freeze')) $('freeze').hidden = true;
      $('welcome').hidden = false; $('black').hidden = true; status('Transmissão encerrada.');
      if (ink) { ink.handle({ op: 'reset' }); zoomTo(null); }
    }
  }
  function connect(base) {
    if (role === 'tv') return openLobby(base);
    clearTimeout(retryTimer); clearTimeout(connectTimer);
    if (socket) { socket.onclose = null; socket.onerror = null; socket.onmessage = null; socket.onopen = null; }
    if (socket) socket.close();
    currentBase = base; connected = false;
    socket = new WebSocket(base.replace(/^http/, 'ws').replace(/\/$/, ''));
    connectTimer = setTimeout(function () { if (socket && socket.readyState === 0) socket.close(); }, 8000);
    socket.onopen = function () { clearTimeout(connectTimer); connected = true; send({ type: 'join', role: 'sender' }); };
    socket.onerror = function () { status('Não foi possível conectar. Confira o endereço e o servidor.'); };
    socket.onclose = function () {
      clearTimeout(connectTimer); connected = false;
      stop();
      if (desktop) desktop.sharing(false);
      showPick(); tvList = []; renderTvs();
      status('Sem conexão com o servidor. Nova tentativa em 3 segundos.');
      retryTimer = setTimeout(function () { connect(base); }, 3000);
    };
    socket.onmessage = function (event) { return receive(event.data); };
  }
  // TV: fica conectada a todos os computadores encontrados ("saguão"); a conexão ativa (socket) é a do PC que pediu acesso.
  var lobbies = {};
  function lobbyList() { return Object.keys(lobbies).map(function (key) { return lobbies[key]; }); }
  function setPresenting(value) {
    presenting = value;
    lobbyList().forEach(function (ws) { if (ws !== socket && ws.readyState === 1) ws.send(JSON.stringify({ type: 'presence', busy: value })); });
  }
  function openLobby(base) {
    base = base.replace(/\/$/, '');
    if (lobbies[base]) return;
    var ws = new WebSocket(base.replace(/^http/, 'ws'));
    lobbies[base] = ws;
    var timer = setTimeout(function () { if (ws.readyState === 0) ws.close(); }, 8000);
    ws.onopen = function () {
      clearTimeout(timer);
      ws.send(JSON.stringify({ type: 'join', role: 'tv', id: tvId, name: tvName }));
      if (presenting) ws.send(JSON.stringify({ type: 'presence', busy: true }));
    };
    ws.onerror = function () {};
    ws.onclose = function () {
      clearTimeout(timer);
      if (lobbies[base] === ws) delete lobbies[base];
      if (ws === socket) {
        socket = null; currentBase = ''; connected = false; setPresenting(false); stop();
        command('stop'); // volta para a tela inicial, senão o último vídeo cobre a tela de espera
        showAuth(null);
      }
      if (ws.joined) setTimeout(function () { openLobby(base); }, 5000); // PC conhecido: pode só ter reiniciado
      updateLobby();
    };
    ws.onmessage = function (event) {
      if (ws !== socket) {
        var msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (msg.type === 'joined') { ws.joined = true; ws.label = msg.name; remember(base, msg.ip); updateLobby(); return; }
        if (msg.type !== 'auth-request') return;
        // Um computador por vez: apresentando (ou com pedido aberto), recusa os outros.
        if (presenting || pendingAuth) return ws.send(JSON.stringify({ type: 'auth-response', allow: false }));
        socket = ws; currentBase = base; connected = true;
      }
      return receive(event.data);
    };
  }
  function updateLobby() {
    if (presenting) return;
    var open = lobbyList().filter(function (ws) { return ws.joined; });
    $('tvName').textContent = open.length ? open[0].label : '';
    $('setup').hidden = open.length > 0;
    status(open.length > 1 ? 'Disponível para ' + open.length + ' computadores. Aguardando…' : open.length ? 'Aguardando um computador…' : 'Procurando computadores com o M I.A. Shared View na rede…');
  }
  async function receive(raw) {
      try {
        var msg = JSON.parse(raw);
        if (msg.type === 'error') { status(msg.message); return; }
        if (msg.type === 'tvs') { host = msg.host || host; tvList = msg.list; renderTvs(); }
        if (msg.type === 'waiting') status('Confirme o acesso no controle remoto da TV ' + msg.name + '…');
        if (msg.type === 'joined') {
          if (role === 'tv') { $('tvName').textContent = msg.name; $('setup').hidden = true; status('Aguardando um computador…'); }
          else { $('controls').hidden = false; $('pick').hidden = true; $('tvLabel').textContent = 'Conectado a ' + msg.name; $('tvNewName').value = msg.name.replace(/ \([\d.]+\)$/, ''); status('Clique em "Compartilhar tela" para mostrar seu computador na TV.'); }
        }
        if (msg.type === 'renamed') {
          if (role === 'tv') { tvName = msg.name; save('sala-tv-name', tvName); $('tvName').textContent = msg.full; }
          else { $('tvNewName').value = msg.name; $('tvLabel').textContent = 'Conectado a ' + msg.full; status('TV renomeada para ' + msg.name + '.'); }
        }
        if (msg.type === 'left') { showPick(); status('Desconectado da TV.'); }
        if (msg.type === 'auth-request' && role === 'tv') {
          if (trusted[msg.token]) send({ type: 'auth-response', allow: true });
          else showAuth(msg);
        }
        if (msg.type === 'auth-cancel' && role === 'tv') showAuth(null);
        if (msg.type === 'peer-ready') { setPresenting(true); status('Apresentador conectado. Aguardando conteúdo…'); }
        if (msg.type === 'peer-left') {
          setPresenting(false);
          if (role === 'tv') { command('stop'); status('Apresentador desconectado.'); }
          else { endShare(); showPick(); status('A TV foi desconectada.'); }
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
        if (msg.type === 'hint' && role === 'sender' && pc && msg.lowRes && !lowRes) {
          lowRes = true; await tune(pc);
          status('Transmitindo em 720p: a TV demora para decodificar 1080p (' + msg.decodeMs + ' ms), assim o atraso diminui.');
        }
        if (msg.type === 'ice') { if (pc && pc.remoteDescription) await pc.addIceCandidate(msg.candidate); else candidates.push(msg.candidate); }
        if (msg.type === 'command' && role === 'tv') command(msg.action);
        if (msg.type === 'annotate' && role === 'tv' && ink) { if (msg.op === 'zoom') zoomTo(msg.rect); else ink.handle(msg); }
        if (msg.type === 'image' && role === 'tv') {
          $('slide').src = msg.data; $('slide').hidden = false; $('screen').hidden = true; $('welcome').hidden = true; status('');
        }
      } catch (error) { status('Falha: ' + error.message); }
  }
  if (role === 'tv') {
    var tvId = load('sala-tv-id', '') || randomId(), trusted = load('sala-trusted', {}), tvName = 'Samsung TV';
    save('sala-tv-id', tvId);
    try { tvName = tizen.systeminfo.getCapability('http://tizen.org/system/model_name') || tvName; } catch (_) {}
    // App Android (Fire TV, Android TV, TV Box): nome do aparelho, botão Voltar e descoberta do computador.
    if (typeof PalmSystem !== 'undefined') tvName = 'LG TV'; // LG webOS: renomeie pelo painel
    if (typeof SalaAndroid !== 'undefined') { tvName = 'Android TV'; try { tvName = SalaAndroid.deviceName() || tvName; } catch (_) {} }
    tvName = load('sala-tv-name', '') || tvName; // nome dado pelo painel (Renomear TV)
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
    // Voltar: recusa um pedido aberto; senão, sai só se apertado de novo em até 2 s. false = pode sair.
    var backAt = 0, backMessage = 'Pressione Voltar novamente para sair.';
    var back = function () {
      if (pendingAuth) { answerAuth(false); return true; }
      if (Date.now() - backAt < 2000) return false;
      backAt = Date.now(); status(backMessage);
      setTimeout(function () { if ($('status').textContent === backMessage) status(''); }, 2000);
      return true;
    };
    document.addEventListener('keydown', function (e) {
      if ((e.keyCode !== 10009 && e.keyCode !== 461) || back()) return; // Voltar: 10009 no controle Samsung, 461 no LG
      try { tizen.application.getCurrentApplication().exit(); } catch (_) { try { window.close(); } catch (__) {} }
    });
    if (typeof SalaInk !== 'undefined') {
      ink = SalaInk($('ink'), frame, { video: $('screen'), pointer: true });
      addEventListener('resize', layout); $('screen').addEventListener('resize', layout);
    }
    // Descoberta: a TV procura sozinha os computadores com o app aberto (porta 8787) e se liga a todos.
    // Varre as sub-redes /24 já vistas (dela e dos PCs) e as faixas cadastradas uma vez na TV.
    var PORT = 8787, servers = load('sala-servers', []), subnets = load('sala-subnets', []), scanning = false;
    var prefixOf = function (ip) { var m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip || ''); return m ? m[1] : ''; };
    var hostOf = function (base) { var m = /^https?:\/\/([\d.]+)/.exec(base || ''); return m ? m[1] : ''; };
    var remember = function (base, tvIp) {
      if (servers.indexOf(base) < 0) { servers.unshift(base); servers = servers.slice(0, 30); save('sala-servers', servers); }
      [prefixOf(hostOf(base)), prefixOf(tvIp)].forEach(function (prefix) {
        if (prefix && subnets.indexOf(prefix) < 0) { subnets.push(prefix); subnets = subnets.slice(-16); save('sala-subnets', subnets); }
      });
    };
    // "192.168.1.0/24", "192.168.1.*", "192.168.1.20-80", "192.168.1.15" ou "http://192.168.1.15:8787", separados por vírgula/espaço.
    var expand = function (text) {
      var hosts = [];
      String(text || '').split(/[\s,;]+/).filter(Boolean).forEach(function (item) {
        var m, ip = hostOf(item) || item;
        if ((m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(?:\*|0\/24)$/.exec(ip))) for (var i = 1; i < 255; i++) hosts.push(m[1] + '.' + i);
        else if ((m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})-(\d{1,3})$/.exec(ip)) && +m[2] <= +m[3] && +m[3] < 256) for (var j = +m[2]; j <= +m[3]; j++) hosts.push(m[1] + '.' + j);
        else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) hosts.push(ip);
        else throw new Error('Faixa inválida: ' + item + '. Use, por exemplo, 192.168.1.0/24');
      });
      return hosts;
    };
    var ranges = load('sala-ranges', '') || document.body.dataset.ranges || ''; // data-ranges: faixas gravadas na instalação
    var ping = function (ip) {
      var abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (abort) abort.abort(); }, 1500);
      return fetch('http://' + ip + ':' + PORT + '/ping', abort ? { signal: abort.signal } : {})
        .then(function (res) { return res.json(); })
        .then(function (info) { if (info && info.app === 'sala-tv') openLobby('http://' + ip + ':' + PORT); })
        .catch(function () {})
        .then(function () { clearTimeout(timer); });
    };
    var scan = async function () {
      servers.forEach(function (base) { openLobby(base); });
      if (scanning || typeof fetch === 'undefined') return;
      scanning = true;
      try {
        var hosts = [];
        subnets.forEach(function (prefix) { hosts = hosts.concat(expand(prefix + '.*')); });
        try { hosts = hosts.concat(expand(ranges)); } catch (_) {}
        hosts = hosts.filter(function (ip, i) { return hosts.indexOf(ip) === i && !lobbies['http://' + ip + ':' + PORT]; }).slice(0, 4096);
        for (var i = 0; i < hosts.length; i += 64) await Promise.all(hosts.slice(i, i + 64).map(ping));
      } finally { scanning = false; }
    };
    var hosted = /^https?:$/.test(location.protocol) && location.port;
    $('server').value = ranges;
    $('openServer').onclick = function () {
      var value = $('server').value.trim();
      try { expand(value); } catch (error) { return status(error.message); }
      ranges = value; save('sala-ranges', value);
      status('Procurando computadores…'); scan();
    };
    document.addEventListener('keydown', function (e) { if (e.keyCode === 13) play(); });
    document.addEventListener('visibilitychange', function () {
      var media = $('screen').srcObject;
      if (media) media.getTracks().forEach(function (t) { t.enabled = !document.hidden; });
    });
    if (typeof window !== 'undefined') {
      window.salaBack = back; // app Android: o botão Voltar nativo pergunta aqui antes de fechar
      // Anúncio UDP do app Windows (Android) e abertura pela busca de um PC: mais um computador no saguão.
      window.salaDiscovered = function (url) { openLobby(url); };
    }
    // Aberto pela busca de um PC (API remota da Samsung): o endereço dele vem no PAYLOAD do app control.
    var launchedServer = function () {
      try {
        var request = tizen.application.getCurrentApplication().getRequestedAppControl();
        var match = /https?:\/\/\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}/.exec(JSON.stringify(request.appControl.data || []));
        return match ? match[0] : '';
      } catch (_) { return ''; }
    };
    var useLaunchedServer = function () { var url = launchedServer(); if (url) openLobby(url); };
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('appcontrol', useLaunchedServer);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) useLaunchedServer(); });
    if (hosted) openLobby(location.origin);
    else {
      // Endereço gravado na instalação (data-server) e o antigo endereço salvo: viram pontos de partida da busca.
      var legacy = ''; try { legacy = JSON.parse(localStorage.getItem('sala-server') || '""'); } catch (_) { try { legacy = localStorage.getItem('sala-server') || ''; } catch (__) {} }
      [document.body.dataset.server, legacy, launchedServer()].forEach(function (base) {
        if (base && /^https?:\/\/[\d.]+:\d+\/?$/.test(base)) { openLobby(base); var prefix = prefixOf(hostOf(base)); if (subnets.indexOf(prefix) < 0) subnets.push(prefix); }
      });
      updateLobby(); scan(); setInterval(scan, 30000);
    }
  } else {
    var renderTvs = function () {
      var box = $('tvs'), paired = tvList.some(function (tv) { return tv.mine; });
      box.textContent = '';
      if (!tvList.length) { box.textContent = 'Nenhuma TV encontrada. Abra o M I.A. Shared View na TV.'; return; }
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
        // TV aberta pela busca: pede o acesso assim que ela entra na lista.
        if (awaitIp && !paired && !tv.busy && tv.name.slice(-(awaitIp.length + 2)) === '(' + awaitIp + ')') { awaitIp = null; clearTimeout(awaitTimer); button.onclick(); }
      });
    };
    var awaitIp = null, awaitTimer;
    $('renameTv').onclick = function () { send({ type: 'rename', name: $('tvNewName').value }); };
    $('tvNewName').onkeydown = function (e) { if (e.key === 'Enter') $('renameTv').onclick(); };
    $('leave').onclick = function () { endShare(); send({ type: 'command', action: 'stop' }); send({ type: 'leave' }); };
    // Ferramentas (só no app Windows): o processo principal desenha sobre o app compartilhado e manda os eventos para cá.
    var desktop = window.salaDesktop;
    var endShare = function () { stop(); if (desktop) desktop.sharing(false); };
    var setToolbar = null, setCompact = null; // só no app Windows
    $('fillToggle').onclick = function () {
      var on = $('fillToggle').getAttribute('aria-pressed') !== 'true';
      $('fillToggle').setAttribute('aria-pressed', on ? 'true' : 'false');
      send({ type: 'command', action: on ? 'fill' : 'fit' });
    };
    if (desktop) {
      // Busca por IP/faixa (rede grande): a TV escolhida abre o receptor apontando para este PC e o acesso é pedido sozinho.
      $('search').hidden = false;
      $('searchRange').value = load('sala-search', '');
      $('searchRange').onkeydown = function (e) { if (e.key === 'Enter') $('searchTvs').onclick(); };
      desktop.onSearchProgress(function (data) {
        if (data.found) addFound(data.found);
        if (data.total) status('Procurando TVs Samsung… ' + data.done + ' de ' + data.total + ' endereços.');
      });
      var addFound = function (tv) {
        var button = document.createElement('button');
        button.className = 'secondary';
        button.textContent = tv.name + ' (' + tv.ip + ')';
        button.onclick = async function () {
          button.disabled = true;
          status('Abrindo o M I.A. Shared View em ' + tv.name + '… Se a TV pedir, permita o acesso no controle remoto.');
          var result = await desktop.launchTv(tv.ip);
          button.disabled = false;
          if (!result || !result.ok) return status(result ? result.message : 'Falha ao abrir o app na TV.');
          awaitIp = tv.ip; clearTimeout(awaitTimer);
          awaitTimer = setTimeout(function () { if (awaitIp) { awaitIp = null; status('A TV abriu o app, mas não conectou a este computador. Confira se o firewall libera a porta 8787.'); } }, 30000);
          status('App aberto na TV. Aguardando ela se conectar a ' + result.server + '…');
          renderTvs();
        };
        $('found').appendChild(button);
      };
      $('searchTvs').onclick = async function () {
        var text = $('searchRange').value.trim();
        save('sala-search', text);
        $('searchTvs').disabled = true; $('found').textContent = '';
        var result = await desktop.searchTvs(text);
        $('searchTvs').disabled = false;
        if (!result) return;
        if (!result.ok) return status(result.message);
        status(result.found.length ? result.found.length + ' TV(s) Samsung encontrada(s). Clique em uma para conectar.' : 'Nenhuma TV Samsung respondeu nessa faixa. Confira se a TV está ligada e o endereço.');
      };
      // Ferramentas ficam só na caixa flutuante; ela abre sozinha ao compartilhar (preferência lembrada neste computador).
      $('toolbarToggle').hidden = false; $('autoToolbarRow').hidden = false;
      $('autoToolbar').checked = load('sala-auto-toolbar', true);
      $('autoToolbar').onchange = function () { save('sala-auto-toolbar', $('autoToolbar').checked); };
      var markToolbar = function (on) { $('toolbarToggle').setAttribute('aria-pressed', on ? 'true' : 'false'); };
      setToolbar = function (on) { desktop.toolbar(on); markToolbar(on); };
      $('toolbarToggle').onclick = function () { setToolbar($('toolbarToggle').getAttribute('aria-pressed') !== 'true'); };
      // Modo mini: ao compartilhar, o painel encolhe para o canto da tela (preferência lembrada neste computador).
      $('miniToggle').hidden = false; $('autoMiniRow').hidden = false;
      $('autoMini').checked = load('sala-auto-mini', true);
      $('autoMini').onchange = function () { save('sala-auto-mini', $('autoMini').checked); };
      setCompact = function (on) {
        document.body.classList.toggle('compact', on);
        $('miniToggle').textContent = on ? '⤢ Expandir' : '⤡ Encolher para o canto';
        desktop.compact(on);
      };
      $('miniToggle').onclick = function () { setCompact(!document.body.classList.contains('compact')); };
      // Pré-via como mesa de trabalho: as ferramentas da caixa também desenham aqui; o traço vai à TV e à tela real.
      var stage = $('stage'), preview = $('preview'), canvas = $('previewInk'), cursorTool = false;
      var previewFrame = function () { return SalaPen.fit(stage.clientWidth || 1, stage.clientHeight || 1, preview.videoWidth || 16, preview.videoHeight || 9); };
      var toPoint = function (e) {
        var box = canvas.getBoundingClientRect(), f = previewFrame();
        var x = (e.clientX - box.left - f.x) / f.w, y = (e.clientY - box.top - f.y) / f.h;
        return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x: x, y: y } : null; // faixas pretas não contam
      };
      previewInk = SalaInk(canvas, previewFrame, { box: function () { return { width: stage.clientWidth, height: stage.clientHeight }; }, video: preview, pointer: true });
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(function () { previewInk.resize(); }).observe(stage);
      preview.addEventListener('resize', function () { previewInk.resize(); });
      var fromPreview = function (msg) { previewInk.handle(msg); send(Object.assign({ type: 'annotate' }, msg)); desktop.ink(msg); };
      var pen = SalaPen(canvas, {
        point: toPoint, emit: fromPreview, local: previewInk.handle, hit: previewInk.hit,
        zoom: function (rect) { send({ type: 'annotate', op: 'zoom', rect: rect }); desktop.ink({ op: 'zoom', rect: rect }); }
      });
      // Apontador, lupa e holofote acompanham o mouse sobre a pré-via.
      canvas.addEventListener('pointermove', function (e) { if (cursorTool) { var p = toPoint(e); fromPreview(p ? { op: 'cursor', x: p.x, y: p.y } : { op: 'cursor', x: null, y: null }); } });
      canvas.addEventListener('pointerleave', function () { if (cursorTool) fromPreview({ op: 'cursor', x: null, y: null }); });
      desktop.onAnnotate(function (msg) {
        if (msg.op === 'notice') return status(msg.message);
        if (msg.op === 'stop-share') return stopShare();
        if (msg.op === 'tv-command') return send({ type: 'command', action: msg.action });
        if (msg.op === 'toolbar') return markToolbar(msg.visible); // fechada pelo X da própria caixa
        send(Object.assign({ type: 'annotate' }, msg));
        if (msg.op === 'zoom') return; // a pré-via mostra a captura sem zoom
        previewInk.handle(msg);
        if (msg.op === 'tool') {
          pen.setTool(msg);
          cursorTool = /^(pointer|magnifier|spotlight)$/.test(msg.tool || '');
          stage.className = 'stage' + (msg.tool === 'eraser' ? ' erase' : /^(pen|highlighter|laser|shape|select)$/.test(msg.tool || '') ? ' draw' : '');
        }
      });
    }
    connect(location.origin);
    // Um único botão: compartilha ou, durante a transmissão, para.
    $('share').onclick = async function () {
      if (stream) return stopShare();
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
        $('share').textContent = 'Parar transmissão'; $('share').className = 'main-action stop'; $('live').hidden = false;
        if (setToolbar && $('autoToolbar').checked) setToolbar(true);
        if (setCompact && $('autoMini').checked) setCompact(true);
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
    function stopShare() { endShare(); send({ type: 'command', action: 'stop' }); status('Transmissão encerrada.'); }
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
