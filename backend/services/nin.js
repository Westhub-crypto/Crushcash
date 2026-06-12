const axios = require("axios");
const BASE_URL = process.env.NIN_VERIFY_BASE_URL || "https://api.youverify.co/v2";
const API_KEY  = process.env.NIN_VERIFY_API_KEY;
const client = axios.create({ baseURL: BASE_URL, headers: { token: API_KEY, "Content-Type":"application/json" }, timeout:20000 });

const validateNINFormat = (nin) => {
  if (!nin) return { valid:false, error:"NIN is required" };
  const cleaned = nin.replace(/\s/g,"");
  if (!/^\d{11}$/.test(cleaned)) return { valid:false, error:"NIN must be exactly 11 digits" };
  return { valid:true, nin:cleaned };
};

const verifyNIN = async ({ nin, firstName, lastName }) => {
  const fmt = validateNINFormat(nin);
  if (!fmt.valid) return { success:false, error:fmt.error };
  if (!API_KEY) {
    console.warn("⚠️  NIN_VERIFY_API_KEY not set — dev mode (format check only)");
    return { success:true, verified:true, devMode:true, message:"NIN format valid (dev mode)", data:{ nin:fmt.nin, firstName, lastName } };
  }
  try {
    const { data } = await client.post("/identity/ng/nin", { id: fmt.nin, isSubjectConsent:true });
    if (!data.success || !data.data) return { success:false, error:data.message || "NIN verification failed" };
    const result = data.data;
    const firstMatch = result.firstName?.toLowerCase().includes(firstName.toLowerCase());
    const lastMatch  = result.lastName?.toLowerCase().includes(lastName.toLowerCase());
    if (!firstMatch || !lastMatch) return { success:false, error:"NIN does not match the name on your account." };
    return { success:true, verified:true, data:{ nin:fmt.nin, firstName:result.firstName, lastName:result.lastName, dob:result.dateOfBirth, gender:result.gender } };
  } catch (err) {
    console.error("NIN verification error:", err?.response?.data || err.message);
    return { success:false, error: err?.response?.data?.message || "NIN verification service unavailable" };
  }
};

const maskNIN = (nin) => `*******${nin.slice(-4)}`;
module.exports = { verifyNIN, validateNINFormat, maskNIN };
