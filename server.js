require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const axios   = require("axios");
const path    = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Serve all your HTML/JS/CSS files from the same folder.
// { extensions: ["html"] } lets "/watches-offer" resolve to "watches-offer.html"
app.use(express.static(path.join(__dirname), { extensions: ["html"] }));
// Redirect root → listing page
app.get("/", (req, res) => {
  res.redirect("/watches-offer");
});

// ─── CONFIG ────────────────────────────────────────────────────────────────
const MID            = process.env.PAYTM_MID;
const MERCHANT_UPI   = process.env.MERCHANT_UPI;    // e.g. yourbusiness@paytm
const MERCHANT_NAME  = process.env.MERCHANT_NAME;   // required — Paytm declines QR/intent without a payee name
const PHP_VERIFY_URL = process.env.PHP_VERIFY_URL;  // e.g. https://yourhost.com/paytmapi.php

if (!MID)            console.error("Missing PAYTM_MID in .env");
if (!MERCHANT_UPI)   console.error("Missing MERCHANT_UPI in .env");
if (!MERCHANT_NAME)  console.error("Missing MERCHANT_NAME in .env");
if (!PHP_VERIFY_URL) console.error("Missing PHP_VERIFY_URL in .env");

// --- ROUTE: Merchant Info (used by frontend to build UPI QR + deeplinks) ----
// UPI IDs are public info (like a bank account number for receiving money),
// so exposing this endpoint is safe.
app.get("/api/merchant-info", (req, res) => {
  if (!MERCHANT_UPI)  return res.status(500).json({ error: "MERCHANT_UPI not set in .env" });
  if (!MERCHANT_NAME) return res.status(500).json({ error: "MERCHANT_NAME not set in .env" });
  res.json({ upiId: MERCHANT_UPI, name: MERCHANT_NAME });
});

// --- ROUTE: Verify Payment (Paytm / PhonePe) -------------------------------─
// Called by the frontend after it opens the UPI app via deeplink.
// We proxy to the PHP getTxnStatus script, passing the merchant id, the
// expected amount, and the order reference (tr=) used in the UPI intent.
// The PHP script returns { success, amount, txn_id } or { success:false, msg }.
app.get("/api/verify-payment", async (req, res) => {
  const { txn, amount } = req.query;

  if (!txn || !amount) {
    return res.status(400).json({ success: false, msg: "Missing txn or amount" });
  }
  if (!PHP_VERIFY_URL) {
    return res.status(500).json({ success: false, msg: "PHP_VERIFY_URL not set in .env" });
  }

  try {
    const { data } = await axios.get(PHP_VERIFY_URL, {
      params : { mid: MID, amount, txn },
      timeout: 25000,
    });
    // Relay the PHP response straight through to the frontend
    res.json(data);
  } catch (err) {
    console.error("[verify-payment]", err.message);
    res.status(502).json({ success: false, msg: "Could not reach verification server" });
  }
});

// ─── START ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n🚀  Server running → http://localhost:${PORT}`);
  console.log(`    Paytm MID : ${MID || "NOT SET"}`);
  console.log(`    Verify URL: ${PHP_VERIFY_URL || "NOT SET"}\n`);
});
