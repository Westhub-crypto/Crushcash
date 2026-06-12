const axios  = require("axios");
const crypto = require("crypto");
const BASE_URL = process.env.SQUADCO_BASE_URL || "https://sandbox-api-d.squadco.com";
const SECRET_KEY = process.env.SQUADCO_SECRET_KEY;
const WEBHOOK_S = process.env.SQUADCO_WEBHOOK_SECRET;
const client = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${SECRET_KEY}`, "Content-Type":"application/json" },
  timeout: 30000,
});
const toKobo = n => Math.round(n*100);
const toNaira = k => k/100;

const initiatePayment = async ({ email, amountNaira, reference, callbackUrl, metadata={} }) => {
  const { data } = await client.post("/transaction/initiate", {
    email, amount: toKobo(amountNaira), currency:"NGN", initiate_type:"inline",
    transaction_ref: reference, callback_url: callbackUrl, pass_charge:false,
    customer_name: metadata.name || email,
  });
  if (!data.success) throw new Error(data.message || "Payment initiation failed");
  return { checkoutUrl: data.data.checkout_url, transactionRef: data.data.transaction_ref };
};

const verifyPayment = async (ref) => {
  const { data } = await client.get(`/transaction/verify/${ref}`);
  if (!data.success) throw new Error(data.message || "Verification failed");
  const tx = data.data;
  return { reference: tx.transaction_ref, status: tx.transaction_status, amountNaira: toNaira(tx.amount), email: tx.email, isSuccess: tx.transaction_status === "success" };
};

const transferToBank = async ({ bankCode, accountNumber, accountName, amountNaira, reference, narration="CrushCash Payout" }) => {
  const { data } = await client.post("/payout/transfer", {
    bank_code: bankCode, account_number: accountNumber, account_name: accountName,
    amount: toKobo(amountNaira), transaction_reference: reference, narration, currency_id:"NGN",
  });
  if (!data.success) throw new Error(data.message || "Transfer failed");
  return { reference: data.data?.transaction_reference, status: data.data?.status };
};

const verifyWebhookSignature = (rawBody, sig) => {
  if (!WEBHOOK_S) return true;
  const expected = crypto.createHmac("sha512", WEBHOOK_S).update(rawBody).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig||"")); }
  catch (_) { return false; }
};

const lookupBankAccount = async (bankCode, accountNumber) => {
  const { data } = await client.post("/payout/account/lookup", { bank_code: bankCode, account_number: accountNumber });
  if (!data.success) throw new Error("Lookup failed");
  return { accountName: data.data.account_name };
};

const getSupportedBanks = async () => {
  try {
    const { data } = await client.get("/payout/banks");
    return data.success ? data.data.map(b => ({ name:b.bank_name, code:b.bank_code })) : [];
  } catch { return []; }
};

module.exports = { initiatePayment, verifyPayment, transferToBank, verifyWebhookSignature, lookupBankAccount, getSupportedBanks, toKobo, toNaira };
