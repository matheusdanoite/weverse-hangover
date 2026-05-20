# Weverse Hangover — CLAUDE.md

## O que é este projeto

Feed social para a festa **Hangul Hangover** (evento K-pop). Usuários criam perfil sem conta (apenas `localStorage`), postam texto ou desenhos, curtem, respondem e recebem notificações. Moderadores se autenticam via Google (trigger secreto: 5 toques na marca) e gerenciam posts pelo painel `/adm/`.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | HTML + CSS + JS puro, ES modules, sem bundler |
| Backend | Cloudflare Pages Functions (`functions/`) |
| Banco | Firebase Firestore (tempo real, SDK via CDN) |
| Auth | Firebase Auth (Google OAuth — somente moderadores) |
| Push | FCM HTTP v1 via Cloudflare Worker (`notify_mods.js`) |
| Deploy | Cloudflare Pages (`wrangler`) |

**Não há build step.** Os arquivos são servidos diretamente. Nunca introduza um bundler ou transpilador sem discussão explícita.

## Estrutura

```
hangul/
├── index.html              # App principal (feed público)
├── styles.css              # Estilos do app principal
├── adm/index.html          # Painel administrativo (noindex)
├── src/
│   ├── app.js              # Lógica do feed — módulo principal
│   └── shared.js           # Utilitários compartilhados (buildPostCard, gradientCSS, etc.)
│   └── shared.css          # CSS compartilhado entre feed e /adm
├── functions/
│   ├── _middleware.js      # Bloqueia acesso a arquivos sensíveis
│   └── api/
│       ├── config.js       # Serve config do Firebase (evita keys no client)
│       └── notify_mods.js  # Envia push FCM para moderadores via Service Account
├── hangover/               # Subpágina legada (hangover/index.html)
├── firebase-messaging-sw.js # Service Worker do FCM
├── firestore.rules
├── firebase.json
└── wrangler.toml
```

## Convenções de código

- **Sem comentários** exceto quando o `porquê` for não óbvio. A base já usa `// ═══` como separador de seção — mantenha esse padrão nos arquivos existentes, mas não o adicione em arquivos novos sem necessidade.
- **Sem frameworks.** Manipulação de DOM direta, `createElement`, `innerHTML` controlado. Não adicione React, Vue, Alpine ou similares.
- **`escapeHTML()` é obrigatório** antes de qualquer conteúdo vindo do Firestore ser inserido via `innerHTML`. Nunca interpole dados do usuário sem sanitizar.
- **ES modules nativos** (`import`/`export`). Sem `require`, sem CommonJS no frontend.
- **SDK do Firebase** importado da CDN (`gstatic.com`). Não instale o pacote npm no frontend.
- Identidade do usuário: `{ id, name, gradient }` em `localStorage`. Não há backend de autenticação para usuários comuns.

## Segurança — regras fixas

- **Nunca exponha emails de moderadores no client.** Eles chegam via `/api/config` (Cloudflare Function) que lê `MODERATOR_PROFILES` de variável de ambiente.
- **Nunca exponha credenciais do Firebase no HTML/JS.** Toda a config vai por `/api/config`.
- O `_middleware.js` bloqueia `.dev.vars`, `firebase.json`, `firestore.rules` e `.firebaserc`. Se adicionar novos arquivos sensíveis na raiz, inclua-os no `BLOCKED` set.
- As Firestore rules estão abertas intencionalmente (app de festa, sem usuários cadastrados). Não "corrija" isso sem pedido explícito.

## Variáveis de ambiente

Definidas em `.dev.vars` (local, nunca commitado) e nas Pages Environment Variables do Cloudflare (produção).

```
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
MODERATOR_PROFILES   # JSON array: [{email, id, name, gradient}]
FIREBASE_SERVICE_ACCOUNT  # JSON do Service Account para FCM push
```

Consulte `.dev.vars.example` como referência.

## Deploy

```bash
# Dev local
wrangler pages dev .

# Produção
wrangler pages deploy .
```

O projeto no Cloudflare se chama `weverse-hangover`. O `wrangler.toml` aponta `pages_build_output_dir = "."`.

## Coleções do Firestore

| Coleção | Uso |
|---|---|
| `hangul_messages` | Posts do feed (texto e desenhos base64) |
| `hangul_messages/{id}/replies` | Respostas em thread |
| `hangul_usernames` | Reserva de nomes (previne duplicatas) |
| `hangul_fcm_tokens` | Tokens FCM dos moderadores para push |

## Padrões de UI/UX

- **Tema:** dark neon — `#1a0a2e` base, pink `#ff2d78`, purple `#9b59ff`, blue `#00d4ff`
- **Fontes:** Outfit (pesos 300/400/600/700/800) + Noto Sans KR (para coreano)
- Avatares são gradientes CSS gerados das cores escolhidas pelo usuário (`gradientCSS()` em `shared.js`)
- Posts novos de outros usuários ficam em buffer (`pendingNewPosts`) e aparecem via botão flutuante — não quebre esse padrão ao mexer no feed
- Moderadores têm badge `★` ao lado do nome em posts e replies

## O que não fazer

- Não crie arquivos de documentação adicionais sem pedido
- Não adicione dependências npm ao frontend
- Não refatore para um framework JS
- Não altere as Firestore rules sem pedido explícito
- Não faça deploy automaticamente — sempre confirme antes de rodar `wrangler pages deploy`
- Não commite `.dev.vars` ou qualquer arquivo com credenciais reais
