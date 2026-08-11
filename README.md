# Checkout PIX - Curso Digital

Checkout responsivo com integracao server-side para a API BlackCat. O projeto aceita somente PIX e ja envia o produto como `Curso Digital`, do tipo digital (`tangible: false`).

## Onde colocar a API

1. Abra o arquivo `.env`, que ja esta pronto na raiz do projeto.
2. Substitua estas duas linhas:

```env
BLACKCAT_API_KEY=COLE_SUA_CHAVE_PRIVADA_AQUI
DEMO_MODE=false
```

Use a **Chave API / Privada** que comeca com `sk_live_`. A chave publica nao e necessaria neste fluxo PIX, porque a chamada e feita de forma segura pelo servidor. O arquivo `.env.example` fica como copia de referencia para novas instalacoes.

Se tiver uma URL publica para notificacoes, preencha tambem `BLACKCAT_POSTBACK_URL`. O codigo de split nao e enviado porque ele nao aparece como parametro do endpoint PIX na documentacao atual da BlackCat.

## Rodar o projeto

Requer Node.js 18 ou superior.

```bash
npm start
```

Depois acesse `http://localhost:3000`.

Com `DEMO_MODE=true`, o checkout gera uma cobranca visual de demonstracao sem chamar a BlackCat. Para pagamentos reais, informe a chave privada e altere para `DEMO_MODE=false`.

## Configuracoes rapidas

- Nome do produto: `PRODUCT_NAME` no arquivo `.env`
- Preco em centavos: `PRODUCT_PRICE_CENTS` no arquivo `.env`
- Expiracao do PIX: campo `expiresInDays` em `server.js`
- Textos e visual: arquivos dentro de `public/`
- Avaliacoes: secao `reviews-section` em `public/index.html`
- Fotos das avaliacoes: arquivos `review-*.webp` em `public/assets/`
- Logo do checkout: `public/assets/serasa-logo-top.png`
- Imagem do produto: `public/assets/serasa-product.png`
- Icone oficial do PIX: `public/assets/pix-icon.png`

## Seguranca

- Nunca coloque a chave `sk_live_` dentro de `public/app.js` ou qualquer arquivo do navegador.
- O arquivo `.env` esta ignorado pelo Git.
- Antes de publicar, use HTTPS e configure `BLACKCAT_POSTBACK_URL` com uma rota publica segura.
