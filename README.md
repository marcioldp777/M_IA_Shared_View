# Sala TV

Aplicativo Windows + receptor Samsung Tizen para apresentações na rede local.
TV alvo informada: UN70DU8000GXZD, Tizen 9.0, IP 192.168.1.11. Computador: 192.168.1.15.

## Windows

Execute `dist/Sala TV 1.0.0.exe` (portátil, sem instalador). Mantenha uma única instância aberta.
O servidor escuta na porta TCP 8787. Permita acesso na rede privada se o Windows solicitar.
Na TV, abra `http://192.168.1.15:8787/tv` no navegador para experimentar o receptor.
No aplicativo Windows, clique na TV desejada. Na primeira vez, a TV pergunta se o computador pode transmitir: escolha **Permitir** com o controle remoto. A autorização fica lembrada na TV (botão "Esquecer computadores autorizados" na tela inicial da TV para revogar).
O IP do computador pode mudar; confira com `ipconfig`.

O compartilhamento abre uma seleção de tela ou janela e transmite também o áudio do sistema no Windows. O áudio pode incluir sons de outros aplicativos. No painel em Chrome/Edge (`http://localhost:8787`), também é possível selecionar uma aba e compartilhar somente o som dela quando o navegador oferecer essa opção. A captura sempre exige seleção pelo usuário.

Recursos: compartilhar tela/janela, som, encerrar transmissão, tela preta, silenciar/ativar som e apresentação de PNG/JPEG/WebP com setas do teclado. Tela preta cobre a imagem; use Silenciar TV se também quiser interromper o som.

## Receptor instalado na TV

1. Execute `npm run prepare:tv`.
2. Importe `tv/` como aplicação web no ambiente Samsung Tizen.
3. Use um perfil Samsung com certificado autorizado para o DUID da TV. Não versione certificados ou senhas.
4. Empacote e assine como `.wgt`; instale pelo dispositivo conectado em `192.168.1.11:26101`.
5. No receptor instalado, informe `http://192.168.1.15:8787` e conecte. A TV aparece na lista do aplicativo Windows.

O projeto inclui `config.xml`, mas apenas compactar os arquivos não produz um pacote Samsung assinado válido. Não substitua certificados existentes.

Estado nesta máquina: receptor assinado e instalado com sucesso na TV usando `D:\tizen-studio\tools\ide\bin\tizen.bat` e o perfil `ia-signage` de `D:\tizen-studio-data\profile\profiles.xml`. Os arquivos `.pwd` são criptografados: utilize o Tizen Studio para acessá-los. Pacote assinado: `dist/SalaTV.wgt`.

Para empacotar novamente no ambiente configurado:

```powershell
npm run prepare:tv
& D:\tizen-studio\tools\ide\bin\tizen.bat package -t wgt -s ia-signage -- tv
Copy-Item 'tv\Sala TV.wgt' dist\SalaTV.wgt -Force
& D:\tizen-studio\tools\ide\bin\tizen.bat install -n SalaTV.wgt -s 192.168.1.11:26101 -- dist
& D:\tizen-studio\tools\ide\bin\tizen.bat run -p SalaTV0001.Sala -s 192.168.1.11:26101
```

Use o nome de pacote sem espaços no comando de instalação.

## Desenvolvimento

Requer Node.js e npm.

```
npm install
npm start
npm run desktop
npm test
npm run prepare:tv
npm run build:windows
```

`npm start` serve o painel e o receptor sem Electron. Não execute junto com o aplicativo, pois ambos usam a porta 8787.

## Limites e validação

Pareamento e sinalização foram testados automaticamente. Reprodução de imagem e som precisa ser validada na TV física; conectividade SDB não comprova reprodução WebRTC. Redes com isolamento de clientes ou bloqueio de tráfego de mídia podem impedir conexão. Não há servidor TURN nem transmissão pela internet. O pareamento usa autorização na TV com token por computador e transporte local HTTP/WS (sem criptografia): use somente em rede confiável e não exponha a porta no roteador. Não há suporte a conteúdo protegido por DRM, PowerPoint nativo ou captura sem consentimento. Para slides PowerPoint/PDF, compartilhe a janela da apresentação.

Referências oficiais: [Samsung Web Engine](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html), [conexão e instalação na TV](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).
