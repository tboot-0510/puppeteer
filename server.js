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
