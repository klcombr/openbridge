# SPEC — OpenBridge Minimalista (corte v1)

> Fase 1 da missão. **Decisão de corte OBRIGATÓRIA:** o que não está na
> tabela abaixo não existe nesta versão. Referência: MISSAO-OPENBRIDGE.md.

## Objetivo

Hub pessoal celular ↔ PC na LAN: o celular abre um **PWA servido pelo
próprio hub** e faz 3 coisas: controlar mídia do PC, mandar arquivo pro PC,
baixar arquivo do PC. Zero dependências, R$0, um servidor Node puro.

## Decisão de corte

| Funcionalidade (do antigo) | Situação | Por quê |
|---|---|---|
| Transporte HTTP simples (polling) | **ENTRA** | 1 transporte; `node:http` puro, sem WebSocket/socket.io. |
| Cliente PWA servida pelo hub | **ENTRA** | Substitui o app Android. Sem WebView/APK/JDK. Celular abre `http://ip:18788`. |
| Controlar mídia (playerctl) | **ENTRA** | play/pause, próxima, anterior, volume ±. Uso diário real. |
| Enviar arquivo celular → PC | **ENTRA** | POST → `~/OpenBridge/Receive/`. Upload máx 50MB. |
| Baixar arquivo PC → celular | **ENTRA** | Lista de `~/OpenBridge/Send/` + GET com token no header. |
| Notificação local (dunst) | **ENTRA** | `notify-send` quando chega arquivo. Zero conta, zero custo, já instalado. |
| Auth token header + PIN 4 dígitos | **ENTRA** | Token em header (nunca URL) + PIN exibido em `openbridge pair`. Sem OAuth/cert. |
| Comandos shell allowlist | **FICA DE FORA** | Superfície de injeção + manutenção de allowlist p/ pouco valor extra além do media. Se sobrar valor real, vira "2.0". |
| App Android (WebView) | **FICA DE FORA** | PWA cobre 100% do uso; sem build/JDK no fluxo. |
| Webhooks Discord/Slack/Notion | **FICA DE FORA** | Notificação local (dunst) resolve; webhook exigiria conta/token externo. |
| Telegram bot | **FICA DE FORA** | Mais complexo que dunst (conta + token + setup). Escolhida a mais simples. |
| URL assinada HMAC pra download | **FICA DE FORA** | Header com token já é seguro e mais simples; nada de token na URL. |
| `Sent/` (histórico de download) | **FICA DE FORA (reservado)** | Diretório mantido em `~/OpenBridge/` por compatibilidade, sem uso na v1. |
| Sincronização git do storage | **FICA DE FORA** | Pasta local só; backup manual já cobre. |
| Múltiplos clientes/sessões, OAuth | **FICA DE FORA** | 1 hub doméstico, 1 token. |
| Deploy no Render (acesso de qualquer lugar) | **ENTRA** | O hub roda no Render (HTTPS *.onrender.com) pra acessar do celular de fora da LAN. Ver "Deploy no Render" abaixo. |

## Deploy no Render

- O mesmo código roda no Render; o celular acessa a URL pública em vez do IP da LAN.
- **Limitações a ter em conta (não são bugs):**
  - `playerctl` (media) só funciona onde o hub roda — no Render não há player, então o painel de mídia mostra "sem player". Mídia continua funcionando se o hub rodar local na LAN.
  - O disco do Render **é efêmero** (free tier): arquivos em `Receive/`/`Send/` somem em restart/deploy. Pra arquivos, é só stash temporário (upload → baixar na hora).
- Como o hub fica público, auth token+PIN é ainda mais crítica (não regredir nada da seção segurança). HTTPS já vem do Render.
- A URL é definida em `var` no código? Não — a PWA usa caminhos relativos (`/api/...`), então funciona igual em LAN ou Render, sem reconfigurar.

## Stack

- **Node.js puro** (stdlib), `node:http`, `node:crypto`, `node:child_process`,
  `node:fs`. **0 dependências** (sem npm install).
- Servidor: `~/openbridge/server/hub.mjs` + módulos pequenos:
  `media.mjs`, `files.mjs`, `auth.mjs`.
- Cliente: `~/openbridge/www/index.html` — HTML/CSS/JS vanilla, sem build,
  sem libs externas, tema escuro, neo-brutalista monocromática.
- Storage: **reusar** `~/OpenBridge/` (`Receive/`, `Send/`, `Sent/`).

## API

```
GET  /            → PWA (index.html) — sem auth
GET  /api/status  → auth; { online, nowPlaying } (playerctl metadata)
GET  /api/media?cmd=<play-pause|next|previous|volume>  → auth; execFile playerctl
GET  /api/files   → auth; lista arquivos de Send/  [{name,size,modified}]
GET  /api/files/<name>  → auth (header); download binário de Send/
POST /api/upload  → auth; multipart simples; Content-Length ≤ 50MB; salva em Receive/
```

Headers de auth (todas as rotas exceto `/`):
- `X-OpenBridge-Token: <token>`
- `X-OpenBridge-Pin: <4 dígitos>`

## Regras de segurança (não negociáveis)

- Token e PIN só em **header**. Nunca em query/URL/corpo.
- Comparação de token/PIN com `crypto.timingSafeEqual` (comprimentos iguais
  garantidos antes de comparar).
- Upload: rejeitar `Content-Length` ausente/`> 50MB`/não numérico; nome do
  arquivo saneado (`basename`, rejeitar `..`, `/`, `\`, caractere de
  controle, `Content-Disposition` malformado); gravar com `flags: 'wx'`
  (não sobrescreve); conteúdo não interpretado (nunca executar).
- Download: `fs.createReadStream` sobre caminho resolvido e validado dentro
  de `Send/` (anti path traversal).
- Media: `execFile('playerctl', args)` com allowlist exata de subcomando e
  volume limitado (0–100). Nunca shell/template string.
- Rate limit em memória: 10 req/min por IP em `/api/upload` e
  `/api/status` (auth inclui PIN — contra brute force). 429 em excesso.
- Servidor sem root (user `kmdev`); config `0600`; resposta de erro nunca
  inclui token/PIN; log sem segredos.
- Não expor além da LAN: bind em `0.0.0.0` só porque é LAN doméstica;
  SEM exposição pública sem OK do usuário (regra da missão).

## Config (`~/.config/openbridge/config.json`, 0600)

```json
{ "port": 18788, "token": "<hex aleatório 32B>", "pin": "1234" }
```

- Criado pelo `openbridge` na 1ª execução (`run`/`pair`) se ausente.
- `pair` rotaciona o PIN (4 dígitos) e imprime IP:porta + token encurtado + PIN.
- `token` e `pin` nunca são logados.

## Verificação

- `openbridge run` sobe em `http://0.0.0.0:18788`.
- `test/smoke.mjs`: sobe o hub, testa auth ok/falha, rate limit, upload com
  nome malicioso, download dentro/fora de `Send/`, media com mock.

## Critério de pronto (gate Fase 2)

Hub rodando + smoke test 100% verde + README curto. Depois: PWA (Fase 3) e
integração real (Fase 4).
