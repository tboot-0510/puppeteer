const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const { URL } = require("url");

const app = express();
const PORT = process.env.PORT || 3000;

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

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

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
    },
  });
});

// Web scraping endpoint
app.post("/scrape", async (req, res) => {
  try {
    const { url, selector, options = {} } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    // Validate URL for security
    const validatedURL = validateURL(url);

    console.time("launchBrowser");
    const launchStart = Date.now();
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });
    const launchStop = Date.now() - launchStart;
    console.timeEnd("launchBrowser");

    const openPageStart = Date.now();
    console.time("openPageStart");
    const page = await browser.newPage();
    await page.goto(validatedURL.href, { waitUntil: "networkidle0" });
    const openPageStop = Date.now() - openPageStart;

    console.timeEnd("openPageStart");

    console.time("scrapPage");
    const textContent = await page.evaluate(() => {
      return document.querySelector("body")?.innerText;
    });
    console.timeEnd("scrapPage");

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

    await browser.close();

    res.json({
      data: textContent,
      launchTime: launchStop,
      openPageTime: openPageStop,
      scrapPageTime: Date.now() - openPageStop,
    });
  } catch (error) {
    console.error("Scraping error:", error);
    res
      .status(500)
      .json({ error: "Failed to scrape content", details: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Puppeteer microservice running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});
