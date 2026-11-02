/* Assistente "Instalar na TV Samsung" (janela do app Windows). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { tvs: [], selected: null, ips: [], profiles: [], author: '', distributor: '', busy: false };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function tvReady(tv) { return tv.developerMode && state.ips.indexOf(tv.developerIP) >= 0; }
  function renderTvs() {
    var box = $('tvs');
    box.innerHTML = state.tvs.length ? '' : '<small class="path">Nenhuma TV encontrada ainda.</small>';
    state.tvs.forEach(function (tv) {
      var div = document.createElement('div');
      var chip = tvReady(tv) ? '<span class="chip ok">modo desenvolvedor OK</span>' : '<span class="chip bad">' + (tv.developerMode ? 'modo dev. com outro IP' : 'modo desenvolvedor desligado') + '</span>';
      div.className = 'tv' + (state.selected === tv ? ' on' : '');
      div.innerHTML = '<div><b>' + esc(tv.name) + ' · ' + esc(tv.model || 'Samsung') + '</b><small>' + esc(tv.ip) + '</small></div>' + chip;
      div.onclick = function () { state.selected = tv; renderTvs(); };
      box.appendChild(div);
    });
    renderHelp(); renderInstall();
  }
  function renderHelp() {
    var tv = state.selected, help = $('devHelp');
    help.hidden = !tv || tvReady(tv);
    if (help.hidden) return;
    var ip = state.ips.filter(function (a) { return a.split('.').slice(0, 3).join('.') === tv.ip.split('.').slice(0, 3).join('.'); })[0] || state.ips[0];
    help.innerHTML = '<b>Ative o modo desenvolvedor em "' + esc(tv.name) + '":</b><ol>'
      + '<li>Com o controle, abra <b>Apps</b> (aplicativos).</li>'
      + '<li>Digite <code>1</code> <code>2</code> <code>3</code> <code>4</code> <code>5</code> com o teclado numérico do controle (ou o teclado na tela).</li>'
      + '<li>Em <b>Modo de desenvolvedor</b>, escolha <b>Ligado</b> e informe o IP deste computador: <code>' + esc(ip) + '</code></li>'
      + '<li>Confirme e <b>desligue e ligue a TV</b> (reinício completo).</li></ol>'
      + '<div class="row" style="margin-top:8px"><button id="recheck" class="secondary">Verificar de novo</button></div>';
    $('recheck').onclick = function () { refresh(tv.ip); };
  }
  function currentFiles() {
    var p = state.profiles[$('profile').value];
    return p ? { author: p.author, distributor: p.distributor, profile: p.name, duids: p.duids } : { author: state.author, distributor: state.distributor, profile: '' };
  }
  function renderProfile() {
    var p = state.profiles[$('profile').value];
    $('manualFiles').hidden = !!p;
    $('profileInfo').textContent = p ? 'Autor: ' + p.author + '\nDistribuidor: ' + p.distributor + (p.duids ? '\nTVs autorizadas (DUID): ' + (p.duids.join(', ') || 'nenhuma') + (p.privilege ? ' · privilégio ' + p.privilege : '') : '') : '';
    $('profileInfo').style.whiteSpace = 'pre-wrap';
    renderInstall();
  }
  function renderInstall() {
    var f = currentFiles(), hint = '';
    if (!state.sdb) hint = 'Instale o Tizen Studio (ferramenta sdb) para continuar.';
    else if (!state.selected) hint = 'Escolha uma TV.';
    else if (!tvReady(state.selected)) hint = 'Ative o modo desenvolvedor na TV (passo 1).';
    else if (!f.author || !f.distributor) hint = 'Escolha o certificado.';
    $('installHint').textContent = hint;
    $('install').disabled = state.busy || !!hint;
  }
  async function refresh(ip) {
    var tv = await salaInstaller.probe(ip);
    if (!tv) { alert('Nenhuma TV Samsung respondeu em ' + ip + '. Confira se ela está ligada e na mesma rede.'); return; }
    var i = state.tvs.findIndex(function (t) { return t.ip === tv.ip; });
    if (i >= 0) state.tvs[i] = tv; else state.tvs.push(tv);
    state.selected = tv; renderTvs();
  }

  $('scan').onclick = async function () {
    $('scan').disabled = true; $('scan').textContent = 'Procurando…';
    state.tvs = await salaInstaller.scan();
    if (state.tvs.length === 1) state.selected = state.tvs[0];
    $('scan').disabled = false; $('scan').textContent = 'Procurar TVs na rede';
    renderTvs();
  };
  $('addIp').onclick = function () { var ip = $('manualIp').value.trim(); if (ip) refresh(ip); };
  $('profile').onchange = renderProfile;
  $('pickAuthor').onclick = async function () { var p = await salaInstaller.pickP12(); if (p) { state.author = p; $('authorPath').textContent = p; renderInstall(); } };
  $('pickDistributor').onclick = async function () { var p = await salaInstaller.pickP12(); if (p) { state.distributor = p; $('distributorPath').textContent = p; renderInstall(); } };
  $('forget').onclick = async function () { await salaInstaller.forget(); $('forget').hidden = true; $('authorPassword').placeholder = 'senha definida no Certificate Manager'; };

  salaInstaller.onLog(function (entry) {
    var li = document.createElement('li');
    li.className = entry.status; li.textContent = entry.text;
    var last = $('log').lastElementChild;
    if (last && last.dataset.step === entry.step && last.className === 'run') $('log').replaceChild(li, last); else $('log').appendChild(li);
    li.dataset.step = entry.step;
  });
  $('install').onclick = async function () {
    var f = currentFiles();
    state.busy = true; renderInstall(); $('log').innerHTML = '';
    var result = await salaInstaller.install({
      ip: state.selected.ip, author: f.author, distributor: f.distributor, profile: f.profile,
      authorPassword: $('authorPassword').value, distributorPassword: $('distributorPassword').value, remember: $('remember').checked
    });
    state.busy = false; renderInstall();
    if (result.ok) { $('authorPassword').value = ''; $('distributorPassword').value = ''; }
  };

  salaInstaller.init().then(function (info) {
    state.ips = info.ips; state.sdb = info.sdb; state.profiles = info.profiles;
    var select = $('profile');
    info.profiles.forEach(function (p, i) { var o = document.createElement('option'); o.value = i; o.textContent = 'Perfil do Tizen Studio: ' + p.name; select.appendChild(o); });
    var other = document.createElement('option'); other.value = 'manual'; other.textContent = 'Outro: escolher os arquivos .p12'; select.appendChild(other);
    var saved = info.profiles.findIndex(function (p) { return p.name === info.saved.profile; });
    select.value = saved >= 0 ? String(saved) : info.profiles.length ? '0' : 'manual';
    if (info.saved.author && select.value === 'manual') { state.author = info.saved.author; state.distributor = info.saved.distributor; $('authorPath').textContent = state.author; $('distributorPath').textContent = state.distributor; }
    if (info.saved.remembered) { $('forget').hidden = false; $('remember').checked = true; $('authorPassword').placeholder = 'senha salva — deixe em branco para usar'; }
    renderProfile(); renderTvs();
    $('scan').onclick();
  });
})();
