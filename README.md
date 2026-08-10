# OpenBridge (minimalista)

Hub pessoal celular ↔ PC, versão MINIMALISTA. O celular abre o **PWA
servido pelo próprio hub** e controla mídia do PC, envia arquivo pro PC e
baixa arquivo do PC.

**Por que existe:** o openbridge antigo (app Android WebView + comandos
allowlist + webhooks + URLs assinadas) foi desativado — servia demais,
exigia demais. Esta versão é o corte mínimo viável: 0 dependências, 3
ações, 1 cliente (PWA), auth por token + PIN.

**Escopo completo (decisão de corte) está em `SPEC.md`.** Tudo que não
está lá não existe.

## Como roda

```sh
openbridge run        # sobe o hub em foreground (http://0.0.0.0:18788)
openbridge pair       # mostra IP:porta + token + PIN pra digitar no celular
openbridge start      # (Fase 4) sobe via systemd --user
```

1. Rode `openbridge pair` — mostra endereço, token e PIN de 4 dígitos.
2. No celular (mesma rede Wi-Fi), abra `http://<ip-da-lan>:18788`.
3. Digite token + PIN na tela de pareamento (fica salvo no `localStorage`).

## Estrutura

```
~/openbridge/
  server/hub.mjs        # servidor HTTP (node:http), ponto único
  server/media.mjs      # playerctl via execFile (args validados)
  server/files.mjs      # upload/download em ~/OpenBridge/
  server/auth.mjs       # token + PIN, comparação constante de tempo
  www/index.html        # PWA (vanilla, neo-brutalista monocromática)
  SPEC.md               # decisão de corte ENTRADA / FICOU DE FORA
```

Storage (reusado de `~/OpenBridge/`): `Receive/` = uploads do celular,
`Send/` = arquivos disponíveis pra baixar, `Sent/` = reservado (inativo).

## Deploy no Render

O mesmo código roda no Render (HTTPS público) pra acessar de qualquer
lugar. A PWA usa caminhos relativos (`/api/...`), então não precisa
reconfigurar.

**Atenção:** `playerctl` só funciona onde o hub roda (no Render mostra
"sem player"); e o disco do Render é efêmero (arquivos somem em restart).

**Passos:**

1. Suba o repositório `~/openbridge` num repo do GitHub (klcombr).
2. No Render: **New → Web Service** → conectar o repo.
   - Build command: vazio. Start command: `node server/hub.mjs`
   - Instância Free.
3. No Render **Environment**: defina as mesmas credenciais do seu PC
   (rode `openbridge pair` na máquina e copie):
   - `OPENBRIDGE_TOKEN=<token completo>`
   - `OPENBRIDGE_PIN=<pin de 4 dígitos>`
4. Deploy. O Render injeta a `PORT` dele automaticamente (o hub respeita
   `PORT`/`OPENBRIDGE_PORT`).
5. No celular, abra `https://<seu-app>.onrender.com` e digite o mesmo
   token + PIN.

O config do hub continua sendo criado localmente (fora do repo, `0600`) —
o repositório não contém segredo nenhum.

## Segurança

- Token exigido em **header**, nunca na URL; PIN de 4 dígitos junto.
- Comparações com `timingSafeEqual`; config `0600`; log sem token.
- Upload: máx 50MB (Content-Length), nome saneado (sem `..`, `/`, controle).
- Media: `execFile` com allowlist de subcomando, nunca template string.
- Rate limit em memória (10 req/min por IP em auth/upload).
- Servidor roda como usuário (sem root).

Ver `SPEC.md` para a tabela de corte e `~/memoria/` para histórico.
