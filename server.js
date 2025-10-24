const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const { URL } = require("url");

const app = express();
const PORT = process.env.PORT || 3000;

// Browser instance for reuse
let browserInstance = null;

// Get or create browser instance (reuse for better performance)
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-plugins",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-features=TranslateUI",
        "--disable-ipc-flooding-protection",
        "--disable-backgrounding-occluded-windows",
        "--disable-web-security",
        "--memory-pressure-off",
        "--max_old_space_size=4096",
      ],
    });
  }
  return browserInstance;
}

// Security configuration
const ALLOWED_PROTOCOLS = ["http:", "https:"];
const BLOCKED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "169.254.169.254", // AWS metadata service
  "172.16.0.0/12", // Docker internal networks
  "10.0.0.0/8", // Private networks
  "192.168.0.0/16", // Private networks
];

// URL validation function to prevent SSRF attacks
// This validates URLs before they are used in Puppeteer page.goto() calls
function validateURL(urlString) {
  try {
    const url = new URL(urlString);

    // Check protocol
    if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
      throw new Error(`Protocol ${url.protocol} is not allowed`);
    }

    // Check for blocked hosts
    const hostname = url.hostname.toLowerCase();
    for (const blockedHost of BLOCKED_HOSTS) {
      if (hostname === blockedHost || hostname.includes(blockedHost)) {
        throw new Error(`Access to ${hostname} is not allowed`);
      }
    }

    // Block private IP ranges
    if (hostname.match(/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/)) {
      throw new Error("Access to private IP ranges is not allowed");
    }

    return url;
  } catch (error) {
    throw new Error(`Invalid URL: ${error.message}`);
  }
}

// Authentication middleware to restrict access
const ALLOWED_ORIGINS = [
  "https://us-central1-clicksafe-374816.cloudfunctions.net",
];

const ALLOWED_IPS = [
  "176.136.146.11", // Your laptop IP
];

// Allowed Chrome extension IDs (replace with your actual extension ID)
const ALLOWED_EXTENSION_IDS = [
  process.env.CHROME_EXTENSION_ID || "ojgppiocgnfkdafnikkiliekbmmagome",
];

// Secret for request signing (keep this secret on server only)
const SERVER_SECRET =
  process.env.SERVER_SECRET || "your-server-secret-key-2024";

// Simple request signature verification
function verifyRequestSignature(timestamp, nonce, signature, extensionId) {
  const crypto = require("crypto");

  // Check if timestamp is within 5 minutes (prevent replay attacks)
  const currentTime = Date.now();
  const requestTime = parseInt(timestamp);
  const fiveMinutes = 5 * 60 * 1000;

  if (Math.abs(currentTime - requestTime) > fiveMinutes) {
    return false;
  }

  // Create expected signature
  const message = `${timestamp}:${nonce}:${extensionId}`;
  const expectedSignature = crypto
    .createHmac("sha256", SERVER_SECRET)
    .update(message)
    .digest("hex");

  return signature === expectedSignature;
}

function authenticateRequest(req, res, next) {
  // Skip authentication for health check and root endpoints
  if (req.path === "/health" || req.path === "/") {
    return next();
  }

  const origin = req.get("Origin");
  const referer = req.get("Referer");
  const userAgent = req.get("User-Agent");
  const forwardedFor = req.get("X-Forwarded-For");
  const realIP = req.get("X-Real-IP");
  const clientIP =
    req.ip || req.connection.remoteAddress || req.socket.remoteAddress;

  // Chrome extension authentication headers
  const timestamp = req.get("X-Timestamp");
  const nonce = req.get("X-Nonce");
  const signature = req.get("X-Signature");

  // Log all incoming requests for monitoring
  console.log(`Incoming request: ${req.method} ${req.path}`, {
    origin,
    referer,
    userAgent,
    forwardedFor,
    realIP,
    clientIP,
    hasSignature: !!signature,
    timestamp: new Date().toISOString(),
  });

  // Check if request comes from Chrome extension
  const isChromeExtension = origin && origin.startsWith("chrome-extension://");
  let isValidChromeExtension = false;

  if (isChromeExtension) {
    // Extract extension ID from origin
    const extensionId = origin.replace("chrome-extension://", "").split("/")[0];

    // Check if extension ID is in allowed list
    const isAllowedExtension = ALLOWED_EXTENSION_IDS.includes(extensionId);

    // For development/testing, allow any extension from your IP
    const isFromAllowedDevIP =
      ALLOWED_IPS.includes(clientIP) ||
      ALLOWED_IPS.includes(realIP) ||
      (forwardedFor && ALLOWED_IPS.some((ip) => forwardedFor.includes(ip)));

    if (isAllowedExtension || isFromAllowedDevIP) {
      // Verify signature if provided (optional for enhanced security)
      if (timestamp && nonce && signature) {
        isValidChromeExtension = verifyRequestSignature(
          timestamp,
          nonce,
          signature,
          extensionId
        );
        if (!isValidChromeExtension) {
          console.warn(`❌ Invalid signature for extension ${extensionId}`);
        }
      } else {
        // Allow without signature for basic extension validation
        isValidChromeExtension = true;
        console.log(
          `✅ Chrome extension allowed: ${extensionId} (no signature required)`
        );
      }
    }
  }

  // Check if request comes from allowed origins
  const isValidOrigin =
    origin &&
    ALLOWED_ORIGINS.some((allowedOrigin) => origin.startsWith(allowedOrigin));
  const isValidReferer =
    referer &&
    ALLOWED_ORIGINS.some((allowedOrigin) => referer.startsWith(allowedOrigin));

  // Check if request comes from allowed IP addresses
  const isFromAllowedIP =
    ALLOWED_IPS.includes(clientIP) ||
    ALLOWED_IPS.includes(realIP) ||
    (forwardedFor && ALLOWED_IPS.some((ip) => forwardedFor.includes(ip)));

  // Also check for Google Cloud Function user agent pattern
  const isGoogleCloudFunction =
    userAgent && userAgent.includes("Google-Cloud-Functions");

  // Additional check for Google Cloud internal IP ranges
  const isFromGoogleCloud =
    forwardedFor &&
    (forwardedFor.includes("169.254.") || // Google Cloud metadata IP range
      forwardedFor.includes("10.")); // Internal Google Cloud IP range

  // Allow if any of the authentication methods pass
  if (
    !isValidChromeExtension &&
    !isValidOrigin &&
    !isValidReferer &&
    !isFromAllowedIP &&
    !isGoogleCloudFunction &&
    !isFromGoogleCloud
  ) {
    console.warn(`🚫 Unauthorized request blocked`, {
      path: req.path,
      origin,
      referer,
      userAgent,
      forwardedFor,
      realIP,
      clientIP,
      isChromeExtension,
      extensionId: isChromeExtension
        ? origin.replace("chrome-extension://", "").split("/")[0]
        : null,
      timestamp: new Date().toISOString(),
    });

    return res.status(403).json({
      error: "Forbidden: Unauthorized access",
      message: "This service only accepts requests from authorized sources.",
      hint: isChromeExtension
        ? "Chrome extension ID not recognized or request not properly signed."
        : "Invalid origin or IP address.",
    });
  }

  const authSource = isValidChromeExtension
    ? "Chrome Extension"
    : origin || referer || clientIP || realIP || "Google Cloud Function";

  console.log(`✅ Authorized request allowed from: ${authSource}`);
  next();
}

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", ...ALLOWED_ORIGINS],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);

      // Allow Chrome extension origins
      if (origin.startsWith("chrome-extension://")) {
        return callback(null, true);
      }

      // Allow requests from whitelisted origins
      const isAllowedOrigin = ALLOWED_ORIGINS.some((allowedOrigin) =>
        origin.startsWith(allowedOrigin)
      );

      if (isAllowedOrigin) {
        return callback(null, true);
      }

      // Log CORS rejections for debugging
      console.warn(`CORS blocked origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Timestamp",
      "X-Nonce",
      "X-Signature",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Apply authentication middleware
app.use(authenticateRequest);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "puppeteer-microservice",
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    service: "Puppeteer Microservice",
    version: "1.0.0",
    endpoints: {
      "/health": "Health check",
      "/scrape": "POST - Scrape webpage content",
      "/extension-info": "GET - Chrome extension authentication info",
    },
    authentication: {
      "chrome-extensions":
        "Extension ID must be whitelisted. Optional signature headers for enhanced security.",
      "cloud-functions":
        "Requests from allowed origins are automatically authenticated",
      "allowed-ips": "Requests from whitelisted IPs are allowed",
    },
  });
});

// Chrome extension info endpoint
app.get("/extension-info", (req, res) => {
  const origin = req.get("Origin");
  const isChromeExtension = origin && origin.startsWith("chrome-extension://");

  if (!isChromeExtension) {
    return res.status(400).json({
      error: "This endpoint is only for Chrome extensions",
    });
  }

  const extensionId = origin.replace("chrome-extension://", "").split("/")[0];
  const isAllowed = ALLOWED_EXTENSION_IDS.includes(extensionId);

  res.json({
    extensionId,
    isAllowed,
    message: isAllowed
      ? "Extension is authorized"
      : "Extension ID not in whitelist",
    signatureRequired: false, // Set to true if you want to enforce signatures
    serverTime: Date.now(),
  });
});

// Web scraping endpoint
app.post("/scrape", async (req, res) => {
  let page; // Declare page variable for proper cleanup

  try {
    const { url, selector, options = {} } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    // Validate URL for security
    const validatedURL = validateURL(url);

    console.time("getBrowser");
    const launchStart = Date.now();
    const browser = await getBrowser();
    const launchStop = Date.now() - launchStart;
    console.timeEnd("getBrowser");

    const openPageStart = Date.now();
    console.time("openPageStart");
    page = await browser.newPage();

    // Set smaller viewport for faster rendering
    await page.setViewport({ width: 1024, height: 768 });

    // Set a faster user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    // Disable images and CSS for faster loading (optional - can be configured)
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (["image", "stylesheet", "font"].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Use faster wait strategy with timeout
    await page.goto(validatedURL.href, {
      waitUntil: "domcontentloaded",
      timeout: 10000, // 10 second timeout
    });

    const openPageStop = Date.now() - openPageStart;

    console.timeEnd("openPageStart");

    console.time("scrapPage");
    const scapePageStart = Date.now();
    const textContent = await page.evaluate(() => {
      return document.querySelector("body")?.innerText;
    });
    console.timeEnd("scrapPage");
    const scapePageStop = Date.now() - scapePageStart;

    if (!textContent) {
      res.status(500).json({ error: "An error occurred during scraping." });
      return;
    }

    await page.close();

    const isCloudflareProtected = /cloudflare|CLOUDFLARE|Cloudflare/.test(
      textContent
    );

    if (isCloudflareProtected) {
      res.status(406).json({
        error: "The website is protected by Cloudfare.",
      });
      return;
    }

    if (textContent.length < 10000) {
      res.status(406).json({
        error: "The content is too short to be analyzed.",
      });
      return;
    }

    res.json({
      data: textContent,
      launchTime: launchStop / 1000,
      openPageTime: openPageStop / 1000,
      scrapPageTime: scapePageStop / 1000,
    });
  } catch (error) {
    console.error("Scraping error:", error);

    // Ensure page is closed even on error
    try {
      if (page && !page.isClosed()) {
        await page.close();
      }
    } catch (closeError) {
      console.error("Error closing page:", closeError);
    }

    res
      .status(500)
      .json({ error: "Failed to scrape content", details: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  // Handle CORS errors specifically
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      error: "CORS Error",
      message:
        "This origin is not allowed. Chrome extensions must include X-API-Key header.",
      origin: req.get("Origin"),
    });
  }

  res.status(500).json({ error: "Internal server error" });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Puppeteer microservice running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`${signal} received, shutting down gracefully`);

  try {
    if (browserInstance && browserInstance.isConnected()) {
      await browserInstance.close();
      console.log("Browser instance closed successfully");
    }
  } catch (error) {
    console.error("Error closing browser:", error);
  }

  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
