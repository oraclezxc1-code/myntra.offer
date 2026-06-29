require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const axios      = require("axios");
const checksum   = require("paytmchecksum");
const path       = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Serve all your HTML/JS/CSS files from the same folder
app.use(express.static(path.join(__dirname)));
// Redirect root → products page
app.get("/", (req, res) => {
  res.redirect("/products.html");
});

// ─── CONFIG ────────────────────────────────────────────────────────────────
const MID           = process.env.PAYTM_MID;
const KEY           = process.env.PAYTM_KEY;
const WEBSITE       = process.env.PAYTM_WEBSITE  || "DEFAULT";
const BACKEND_URL   = process.env.BACKEND_URL;
const MERCHANT_UPI  = process.env.MERCHANT_UPI;   // e.g. yourbusiness@paytm
const MERCHANT_NAME = process.env.MERCHANT_NAME  || "My Store";
const IS_PROD       = process.env.PAYTM_ENV === "production";
const PAYTM_HOST    = IS_PROD
  ? "https://securegw.paytm.in"
  : "https://securegw-stage.paytm.in";

if (!MID || !KEY)   console.error("Missing PAYTM_MID or PAYTM_KEY in .env");
if (!MERCHANT_UPI)  console.error("Missing MERCHANT_UPI in .env");

// ─── IN-MEMORY ORDER STORE ─────────────────────────────────────────────────
// Fine for now. Replace with MongoDB/PostgreSQL/Redis for production.
const orders = {};

// --- ROUTE: Merchant Info (used by frontend to generate UPI QR) -------------
// UPI IDs are public info (like a bank account number for receiving money),
// so exposing this endpoint is safe.
app.get("/api/merchant-info", (req, res) => {
  if (!MERCHANT_UPI) return res.status(500).json({ error: "MERCHANT_UPI not set in .env" });
  res.json({ upiId: MERCHANT_UPI, name: MERCHANT_NAME });
});

// --- ROUTE: Create Order ---------------------------------------------------───────
// Called by the frontend when user clicks PAY.
// Talks to Paytm, gets a txnToken, returns it to the frontend.
app.post("/api/create-order", async (req, res) => {
  try {
    const { amount, customerId = "GUEST" } = req.body;

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const orderId = "ORD" + Date.now();
    const txnAmount = parseFloat(amount).toFixed(2);

    const body = {
      requestType : "Payment",
      mid         : MID,
      websiteName : WEBSITE,
      orderId,
      txnAmount   : { value: txnAmount, currency: "INR" },
      userInfo    : { custId: String(customerId) },
      callbackUrl : `${BACKEND_URL}/api/paytm-webhook`,
    };

    // Generate checksum — this MUST be done on the server, never the browser
    const signature = await checksum.generateSignature(JSON.stringify(body), KEY);

    const { data } = await axios.post(
      `${PAYTM_HOST}/theia/api/v1/initiateTransaction?mid=${MID}&orderId=${orderId}`,
      { head: { signature }, body },
      { headers: { "Content-Type": "application/json" } }
    );

    const { resultInfo, txnToken } = data.body;

    if (resultInfo.resultStatus !== "S") {
      console.error("[create-order] Paytm error:", resultInfo);
      return res.status(400).json({ error: resultInfo.resultMsg });
    }

    // Save order record
    orders[orderId] = { status: "pending", amount: txnAmount };
    console.log(`[create-order] Created → ${orderId} ₹${txnAmount}`);

    res.json({
      orderId,
      txnToken,
      mid       : MID,
      amount    : txnAmount,
      paytmHost : PAYTM_HOST,
    });

  } catch (err) {
    console.error("[create-order]", err.message);
    res.status(500).json({ error: "UPI servers are facing heavy traffic. Please try QR "Scan & Pay" option." });
  }
});

// ─── ROUTE: Paytm Webhook ──────────────────────────────────────────────────
// Paytm calls this URL automatically when a payment is completed.
// MUST be a publicly reachable URL — use ngrok in local dev.
app.post("/api/paytm-webhook", async (req, res) => {
  try {
    const { CHECKSUMHASH, ...params } = req.body;

    // Always verify the checksum — never trust the payload blindly
    const isValid = await checksum.verifySignature(
      JSON.stringify(params),
      KEY,
      CHECKSUMHASH
    );

    if (!isValid) {
      console.warn("[webhook] ⚠️  Checksum mismatch — possible tampered request");
      return res.status(400).end();
    }

    const { ORDERID, STATUS, TXNID, TXNAMOUNT, RESPMSG } = params;

    if (STATUS === "TXN_SUCCESS") {
      orders[ORDERID] = { status: "paid",   txnId: TXNID, amount: TXNAMOUNT };
      console.log(`[webhook] ✅ PAID   → ${ORDERID} | TxnID: ${TXNID} | ₹${TXNAMOUNT}`);
    } else {
      orders[ORDERID] = { status: "failed", message: RESPMSG };
      console.log(`[webhook] ❌ FAILED → ${ORDERID} | ${RESPMSG}`);
    }

    // Paytm expects this response — always send it
    res.json({
      resultInfo: { resultStatus: "S", resultCode: "0", resultMsg: "Notification Received" }
    });

  } catch (err) {
    console.error("[webhook]", err.message);
    res.status(500).end();
  }
});

// ─── ROUTE: Payment Status ─────────────────────────────────────────────────
// Frontend polls this every 2.5s after checkout closes to check if webhook arrived.
app.get("/api/payment-status/:orderId", (req, res) => {
  const order = orders[req.params.orderId];
  if (!order) return res.status(404).json({ status: "not_found" });
  res.json(order);
});

// ─── START ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀  Server running → http://localhost:${PORT}`);
  console.log(`    Mode     : ${IS_PROD ? "PRODUCTION 🔴" : "STAGING 🟡"}`);
  console.log(`    Paytm MID: ${MID || "NOT SET"}`);
  console.log(`    Webhook  : ${BACKEND_URL}/api/paytm-webhook\n`);
});
