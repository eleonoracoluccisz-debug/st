const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_BODY_SIZE = 32 * 1024;

loadEnvFile(path.join(ROOT, ".env"));

const config = {
  port: Number(process.env.PORT || 3000),
  apiUrl: (process.env.BLACKCAT_API_URL || "https://api.blackcatoficial.com/api").replace(/\/$/, ""),
  apiKey: process.env.BLACKCAT_API_KEY || "",
  postbackUrl: process.env.BLACKCAT_POSTBACK_URL || "",
  productName: process.env.PRODUCT_NAME || "Curso Digital",
  productPriceCents: Number(process.env.PRODUCT_PRICE_CENTS || 19990),
  demoMode: parseBoolean(process.env.DEMO_MODE, true),
};

const demoTransactions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/config") {
      return sendJson(response, 200, {
        productName: config.productName,
        productPriceCents: config.productPriceCents,
        demoMode: isDemoMode(),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/checkout") {
      const body = await readJsonBody(request);
      const customer = validateCustomer(body);

      if (!customer.ok) {
        return sendJson(response, 400, { success: false, message: customer.message });
      }

      const payload = buildSalePayload(customer.data, body.utm || {});
      const result = isDemoMode()
        ? createDemoTransaction(payload)
        : await blackcatRequest("/sales/create-sale", { method: "POST", body: payload });

      return sendJson(response, 201, result);
    }

    if (request.method === "GET" && url.pathname === "/api/status") {
      const transactionId = url.searchParams.get("transactionId");
      if (!transactionId || !/^[A-Za-z0-9_-]{6,100}$/.test(transactionId)) {
        return sendJson(response, 400, { success: false, message: "ID da transacao invalido." });
      }

      const result = isDemoMode()
        ? getDemoTransactionStatus(transactionId)
        : await blackcatRequest(`/sales/${encodeURIComponent(transactionId)}/status`, { method: "GET" });

      return sendJson(response, 200, result);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { success: false, message: "Metodo nao permitido." });
    }

    return serveStatic(url.pathname, request.method, response);
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    const message = statusCode >= 500
      ? "Nao foi possivel processar o pagamento agora. Tente novamente em instantes."
      : error.message;

    if (statusCode >= 500) {
      console.error("Checkout error:", error);
    }

    return sendJson(response, statusCode, { success: false, message });
  }
});

server.listen(config.port, () => {
  const mode = isDemoMode() ? "demonstracao" : "producao BlackCat";
  console.log(`Checkout disponivel em http://localhost:${config.port} (${mode})`);
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

function isDemoMode() {
  return config.demoMode || !config.apiKey || config.apiKey.includes("COLE_SUA_CHAVE");
}

function validateCustomer(body) {
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  const email = String(body.email || "").trim().toLowerCase();
  const phone = onlyDigits(body.phone);
  const documentNumber = onlyDigits(body.document);

  if (name.length < 5 || !name.includes(" ")) {
    return { ok: false, message: "Informe seu nome e sobrenome." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "Informe um e-mail valido." };
  }
  if (phone.length < 10 || phone.length > 11) {
    return { ok: false, message: "Informe um telefone com DDD." };
  }
  if (documentNumber.length !== 11 && documentNumber.length !== 14) {
    return { ok: false, message: "Informe um CPF ou CNPJ valido." };
  }
  if (documentNumber.length === 11 && !isValidCpf(documentNumber)) {
    return { ok: false, message: "Informe um CPF valido." };
  }
  if (documentNumber.length === 14 && !isValidCnpj(documentNumber)) {
    return { ok: false, message: "Informe um CNPJ valido." };
  }

  return {
    ok: true,
    data: {
      name,
      email,
      phone,
      document: {
        number: documentNumber,
        type: documentNumber.length === 11 ? "cpf" : "cnpj",
      },
    },
  };
}

function buildSalePayload(customer, utm) {
  const externalRef = `CURSO-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const payload = {
    amount: config.productPriceCents,
    currency: "BRL",
    paymentMethod: "pix",
    items: [
      {
        title: config.productName,
        unitPrice: config.productPriceCents,
        quantity: 1,
        tangible: false,
      },
    ],
    customer,
    pix: { expiresInDays: 1 },
    metadata: `Checkout ${config.productName}`,
    externalRef,
  };

  if (config.postbackUrl) payload.postbackUrl = config.postbackUrl;

  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const value = String(utm[key] || "").trim().slice(0, 200);
    if (value) payload[key] = value;
  }

  return payload;
}

async function blackcatRequest(endpoint, options) {
  const fetchOptions = {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
    },
    signal: AbortSignal.timeout(15000),
  };

  if (options.body) fetchOptions.body = JSON.stringify(options.body);

  const apiResponse = await fetch(`${config.apiUrl}${endpoint}`, fetchOptions);
  const rawText = await apiResponse.text();
  let data;

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    const error = new Error("Resposta inesperada do provedor de pagamento.");
    error.statusCode = 502;
    throw error;
  }

  if (!apiResponse.ok || data.success === false) {
    const error = new Error(data.message || data.error || "A BlackCat recusou a solicitacao.");
    error.statusCode = apiResponse.status >= 500 ? 502 : 400;
    throw error;
  }

  return data;
}

function createDemoTransaction(payload) {
  const transactionId = `DEMO-${Date.now()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const copyPaste = `00020101021226890014br.gov.bcb.pix2567demo.blackcatoficial.com/${transactionId}5204000053039865406${(payload.amount / 100).toFixed(2)}5802BR5913CURSO DIGITAL6009SAO PAULO62070503***6304DEMO`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  demoTransactions.set(transactionId, { createdAt: Date.now(), amount: payload.amount });

  return {
    success: true,
    demo: true,
    data: {
      transactionId,
      status: "PENDING",
      paymentMethod: "pix",
      amount: payload.amount,
      invoiceUrl: "",
      createdAt: new Date().toISOString(),
      paymentData: {
        qrCode: copyPaste,
        qrCodeBase64: createDemoQrCode(transactionId),
        copyPaste,
        expiresAt,
      },
    },
  };
}

function getDemoTransactionStatus(transactionId) {
  const transaction = demoTransactions.get(transactionId);
  if (!transaction) {
    return { success: false, message: "Transacao demonstrativa nao encontrada." };
  }

  return {
    success: true,
    demo: true,
    data: {
      transactionId,
      status: "PENDING",
      paymentMethod: "PIX",
      amount: transaction.amount,
    },
  };
}

function createDemoQrCode(seed) {
  const size = 29;
  const cells = [];
  const hash = crypto.createHash("sha256").update(seed).digest();

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (isFinderCell(x, y, size)) continue;
      const byte = hash[(x * 7 + y * 13) % hash.length];
      if (((byte >> ((x + y) % 8)) & 1) === 1) {
        cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
      }
    }
  }

  const finders = [finderSvg(0, 0), finderSvg(size - 7, 0), finderSvg(0, size - 7)].join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${size + 4} ${size + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${size + 4}" height="${size + 4}" fill="white"/><g fill="#071b36">${cells.join("")}${finders}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function isFinderCell(x, y, size) {
  return (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
}

function finderSvg(x, y) {
  return `<rect x="${x}" y="${y}" width="7" height="7"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="white"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidCpf(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += Number(cpf[index]) * (10 - index);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let index = 0; index < 10; index += 1) sum += Number(cpf[index]) * (11 - index);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(cpf[10]);
}

function isValidCnpj(value) {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calculateDigit = (base, weights) => {
    const sum = base.split("").reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calculateDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondDigit = calculateDigit(cnpj.slice(0, 12) + firstDigit, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return firstDigit === Number(cnpj[12]) && secondDigit === Number(cnpj[13]);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_SIZE) {
        const error = new Error("Solicitacao muito grande.");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("JSON invalido.");
        error.statusCode = 400;
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function serveStatic(pathname, method, response) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);

  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    return sendJson(response, 403, { success: false, message: "Acesso negado." });
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      return sendJson(response, 404, { success: false, message: "Pagina nao encontrada." });
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stats.size,
      "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });

    if (method === "HEAD") return response.end();
    return fs.createReadStream(filePath).pipe(response);
  });
}
