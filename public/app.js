const state = {
  config: {
    productName: "Curso Digital",
    productPriceCents: 19990,
    demoMode: true,
  },
  transactionId: null,
  expiresAt: null,
  timerId: null,
  pollId: null,
  toastId: null,
};

const elements = {
  form: document.querySelector("#checkout-form"),
  result: document.querySelector("#pix-result"),
  submitButton: document.querySelector("#submit-button"),
  buttonLabel: document.querySelector("#submit-button .button-label"),
  formAlert: document.querySelector("#form-alert"),
  demoBanner: document.querySelector("#demo-banner"),
  demoQrNote: document.querySelector("#demo-qr-note"),
  productName: document.querySelector("#product-name"),
  subtotalPrice: document.querySelector("#subtotal-price"),
  totalPrice: document.querySelector("#total-price"),
  qrCode: document.querySelector("#qr-code"),
  pixCode: document.querySelector("#pix-code"),
  copyButton: document.querySelector("#copy-button"),
  timer: document.querySelector("#pix-timer"),
  statusTitle: document.querySelector("#status-title"),
  statusSubtitle: document.querySelector("#status-subtitle"),
  newPaymentButton: document.querySelector("#new-payment-button"),
  toast: document.querySelector("#toast"),
};

initialize();

async function initialize() {
  bindEvents();
  captureUtmParameters();

  try {
    const response = await fetch("/api/config", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    state.config = await response.json();
  } catch {
    // The fallback values keep the page usable if configuration loading fails.
  }

  updateProductSummary();
  elements.demoBanner.hidden = true;
}

function bindEvents() {
  elements.form.addEventListener("submit", submitCheckout);
  elements.copyButton.addEventListener("click", copyPixCode);
  elements.newPaymentButton.addEventListener("click", resetCheckout);

  for (const input of elements.form.querySelectorAll("input")) {
    input.addEventListener("blur", () => validateField(input));
    input.addEventListener("input", () => {
      formatInput(input);
      clearFieldError(input);
    });
  }
}

async function submitCheckout(event) {
  event.preventDefault();
  elements.formAlert.hidden = true;

  if (!validateForm()) return;

  setLoading(true);

  const data = Object.fromEntries(new FormData(elements.form).entries());
  const payload = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    document: data.document,
    utm: getCapturedUtm(),
  };

  try {
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Nao foi possivel gerar seu PIX.");
    }

    showPixResult(result);
  } catch (error) {
    elements.formAlert.textContent = error.message || "Ocorreu um erro inesperado. Tente novamente.";
    elements.formAlert.hidden = false;
    elements.formAlert.scrollIntoView({ behavior: "smooth", block: "center" });
  } finally {
    setLoading(false);
  }
}

function validateForm() {
  let isValid = true;
  const inputs = [...elements.form.querySelectorAll("input[required]")];

  for (const input of inputs) {
    if (!validateField(input)) isValid = false;
  }

  if (!isValid) {
    const firstInvalid = elements.form.querySelector(".field.has-error input");
    firstInvalid?.focus();
  }

  return isValid;
}

function validateField(input) {
  let message = "";
  const digits = input.value.replace(/\D/g, "");

  if (input.id === "name" && (input.value.trim().length < 5 || !input.value.trim().includes(" "))) {
    message = "Informe seu nome e sobrenome.";
  } else if (input.id === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) {
    message = "Digite um e-mail valido.";
  } else if (input.id === "phone" && (digits.length < 10 || digits.length > 11)) {
    message = "Digite um telefone com DDD.";
  } else if (input.id === "document") {
    if (digits.length !== 11 && digits.length !== 14) {
      message = "Digite um CPF ou CNPJ valido.";
    } else if (digits.length === 11 && !isValidCpf(digits)) {
      message = "Digite um CPF valido.";
    } else if (digits.length === 14 && !isValidCnpj(digits)) {
      message = "Digite um CNPJ valido.";
    }
  }

  const field = input.closest(".field");
  const errorElement = field?.querySelector(`[data-error-for="${input.id}"]`);
  field?.classList.toggle("has-error", Boolean(message));
  input.setAttribute("aria-invalid", String(Boolean(message)));
  if (errorElement) errorElement.textContent = message;
  return !message;
}

function clearFieldError(input) {
  if (input.id === "terms") {
    if (input.checked) elements.formAlert.hidden = true;
    return;
  }

  const field = input.closest(".field");
  field?.classList.remove("has-error");
  input.removeAttribute("aria-invalid");
  const errorElement = field?.querySelector(`[data-error-for="${input.id}"]`);
  if (errorElement) errorElement.textContent = "";
}

function formatInput(input) {
  const digits = input.value.replace(/\D/g, "");

  if (input.id === "phone") {
    const limited = digits.slice(0, 11);
    input.value = limited.length <= 10
      ? limited.replace(/^(\d{0,2})(\d{0,4})(\d{0,4})$/, (_, ddd, first, last) => [ddd && `(${ddd}`, ddd.length === 2 ? ") " : "", first, last && `-${last}`].join(""))
      : limited.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  }

  if (input.id === "document") {
    const limited = digits.slice(0, 14);
    input.value = limited.length <= 11
      ? limited.replace(/^(\d{0,3})(\d{0,3})(\d{0,3})(\d{0,2})$/, (_, a, b, c, d) => [a, b && `.${b}`, c && `.${c}`, d && `-${d}`].join(""))
      : limited.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
}

function isValidCpf(value) {
  const cpf = value.replace(/\D/g, "");
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
  const cnpj = value.replace(/\D/g, "");
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

function setLoading(isLoading) {
  elements.submitButton.disabled = isLoading;
  elements.submitButton.classList.toggle("is-loading", isLoading);
  elements.buttonLabel.textContent = isLoading ? "Gerando seu PIX..." : "Gerar PIX";
}

function showPixResult(result) {
  const data = result.data;
  const paymentData = data.paymentData || {};

  state.transactionId = data.transactionId;
  state.expiresAt = paymentData.expiresAt ? new Date(paymentData.expiresAt) : new Date(Date.now() + 30 * 60 * 1000);

  elements.qrCode.src = paymentData.qrCodeBase64 || createFallbackQrDataUrl();
  elements.pixCode.value = paymentData.copyPaste || paymentData.qrCode || "";
  elements.demoQrNote.hidden = !result.demo;
  elements.form.hidden = true;
  elements.result.hidden = false;
  elements.result.scrollIntoView({ behavior: "smooth", block: "start" });

  updateTimer();
  state.timerId = window.setInterval(updateTimer, 1000);
  state.pollId = window.setInterval(checkPaymentStatus, 7000);
}

async function checkPaymentStatus() {
  if (!state.transactionId) return;

  try {
    const response = await fetch(`/api/status?transactionId=${encodeURIComponent(state.transactionId)}`, {
      headers: { Accept: "application/json" },
    });
    const result = await response.json();
    if (!response.ok || !result.success) return;

    const status = String(result.data?.status || "").toUpperCase();
    if (status === "PAID") showPaidStatus();
    if (["CANCELLED", "REFUNDED"].includes(status)) showExpiredStatus();
  } catch {
    elements.statusSubtitle.textContent = "Tentaremos consultar novamente em instantes.";
  }
}

function showPaidStatus() {
  clearPolling();
  elements.statusTitle.textContent = "Pagamento confirmado!";
  elements.statusSubtitle.textContent = "O acesso ao curso foi enviado para seu e-mail.";
  elements.timer.textContent = "Pago";
  elements.timer.style.color = "var(--success)";
  showToast("Pagamento confirmado. Bem-vindo ao Curso Digital!");
}

function showExpiredStatus() {
  clearPolling();
  elements.statusTitle.textContent = "Este PIX expirou";
  elements.statusSubtitle.textContent = "Volte e gere um novo codigo para continuar.";
  elements.timer.textContent = "Expirado";
}

function updateTimer() {
  if (!state.expiresAt) return;
  const remaining = Math.max(0, state.expiresAt.getTime() - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  elements.timer.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  if (remaining === 0) showExpiredStatus();
}

async function copyPixCode() {
  if (!elements.pixCode.value) return;

  try {
    await navigator.clipboard.writeText(elements.pixCode.value);
  } catch {
    elements.pixCode.select();
    document.execCommand("copy");
  }

  elements.copyButton.querySelector("span").textContent = "Copiado";
  showToast("Codigo PIX copiado com sucesso.");
  window.setTimeout(() => {
    elements.copyButton.querySelector("span").textContent = "Copiar";
  }, 1800);
}

function resetCheckout() {
  clearPolling();
  state.transactionId = null;
  state.expiresAt = null;
  elements.result.hidden = true;
  elements.form.hidden = false;
  elements.form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearPolling() {
  window.clearInterval(state.timerId);
  window.clearInterval(state.pollId);
  state.timerId = null;
  state.pollId = null;
}

function updateProductSummary() {
  const formattedPrice = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(state.config.productPriceCents / 100);
  elements.productName.textContent = state.config.productName;
  elements.subtotalPrice.textContent = formattedPrice;
  elements.totalPrice.textContent = formattedPrice;
  document.title = `Checkout | ${state.config.productName}`;
}

function captureUtmParameters() {
  const params = new URLSearchParams(window.location.search);
  const utm = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    if (params.get(key)) utm[key] = params.get(key).slice(0, 200);
  }
  sessionStorage.setItem("checkout_utm", JSON.stringify(utm));
}

function getCapturedUtm() {
  try {
    return JSON.parse(sessionStorage.getItem("checkout_utm") || "{}");
  } catch {
    return {};
  }
}

function showToast(message) {
  window.clearTimeout(state.toastId);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastId = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
}

function createFallbackQrDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220"><rect width="220" height="220" rx="12" fill="white"/><path d="M25 25h55v55H25V25Zm115 0h55v55h-55V25ZM25 140h55v55H25v-55Zm90-40h15v15h-15v-15Zm25 0h15v15h-15v-15Zm25 0h30v15h-30v-15Zm-65 25h15v30h-15v-30Zm25 10h30v15h-30v-15Zm45-10h25v30h-25v-30Zm-75 45h25v25h-25v-25Zm40 0h15v15h-15v-15Zm30 0h30v25h-30v-25Z" fill="#081c37"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
