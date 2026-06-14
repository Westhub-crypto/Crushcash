const axios  = require("axios");
const crypto = require("crypto");

// Auto-detect live vs sandbox from the key prefix — no manual URL needed
const SECRET_KEY = process.env.SQUADCO_SECRET_KEY || "";
const PUBLIC_KEY = process.env.SQUADCO_PUBLIC_KEY || "";
const WEBHOOK_S  = process.env.SQUADCO_WEBHOOK_SECRET || "";

const isSandboxKey = SECRET_KEY.toLowerCase().startsWith("sandbox_") || SECRET_KEY.toLowerCase().startsWith("test_");
const BASE_URL = process.env.SQUADCO_BASE_URL ||
  (isSandboxKey ? "https://sandbox-api-d.squadco.com" : "https://api-d.squadco.com");

console.log(`💳 SquadCo: ${isSandboxKey ? "SANDBOX" : "LIVE"} mode → ${BASE_URL}`);

const client = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization:`Bearer ${SECRET_KEY}`, "Content-Type":"application/json" },
  timeout: 30000,
});

const toKobo  = n => Math.round(n * 100);
const toNaira = k => k / 100;

const initiatePayment = async ({ email, amountNaira, reference, callbackUrl, metadata = {} }) => {
  try {
    const { data } = await client.post("/transaction/initiate", {
      email, amount: toKobo(amountNaira), currency:"NGN",
      initiate_type:"inline", transaction_ref: reference,
      callback_url: callbackUrl, pass_charge: false,
      customer_name: metadata.name || email,
    });
    if (!data.success) throw new Error(data.message || "Payment initiation failed");
    return { checkoutUrl: data.data.checkout_url, transactionRef: data.data.transaction_ref };
  } catch (err) {
    const msg = err?.response?.data?.message || err.message;
    console.error("SquadCo initiatePayment error:", msg);
    throw new Error(msg);
  }
};

const verifyPayment = async (ref) => {
  try {
    const { data } = await client.get(`/transaction/verify/${ref}`);
    if (!data.success) throw new Error(data.message || "Verification failed");
    const tx = data.data;
    return {
      reference:   tx.transaction_ref,
      status:      tx.transaction_status,
      amountNaira: toNaira(tx.amount),
      email:       tx.email,
      isSuccess:   tx.transaction_status === "success",
    };
  } catch (err) {
    const msg = err?.response?.data?.message || err.message;
    throw new Error(msg);
  }
};

const transferToBank = async ({ bankCode, accountNumber, accountName, amountNaira, reference, narration = "CrushCash Payout" }) => {
  try {
    const { data } = await client.post("/payout/transfer", {
      bank_code: bankCode, account_number: accountNumber, account_name: accountName,
      amount: toKobo(amountNaira), transaction_reference: reference, narration, currency_id:"NGN",
    });
    if (!data.success) throw new Error(data.message || "Transfer failed");
    return { reference: data.data?.transaction_reference, status: data.data?.status };
  } catch (err) {
    const msg = err?.response?.data?.message || err.message;
    throw new Error(msg);
  }
};

const verifyWebhookSignature = (rawBody, sig) => {
  if (!WEBHOOK_S) return true;
  try {
    const expected = crypto.createHmac("sha512", WEBHOOK_S).update(rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig || ""));
  } catch { return false; }
};

const lookupBankAccount = async (bankCode, accountNumber) => {
  try {
    const { data } = await client.post("/payout/account/lookup", { bank_code:bankCode, account_number:accountNumber });
    if (!data.success) throw new Error("Lookup failed");
    return { accountName: data.data.account_name };
  } catch (err) {
    const msg = err?.response?.data?.message || err.message;
    throw new Error(msg);
  }
};

const getSupportedBanks = async () => {
  try {
    const { data } = await client.get("/payout/banks");
    return data.success ? data.data.map(b => ({ name:b.bank_name, code:b.bank_code })) : [];
  } catch { return []; }
};

module.exports = { initiatePayment, verifyPayment, transferToBank, verifyWebhookSignature, lookupBankAccount, getSupportedBanks, toKobo, toNaira };
            
