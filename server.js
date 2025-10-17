const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Security configuration
const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  '169.254.169.254', // AWS metadata service
  '172.16.0.0/12',   // Docker internal networks
  '10.0.0.0/8',      // Private networks
  '192.168.0.0/16'   // Private networks
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
      throw new Error('Access to private IP ranges is not allowed');
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'puppeteer-microservice'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Puppeteer Microservice',
    version: '1.0.0',
    endpoints: {
      '/health': 'Health check',
      '/screenshot': 'POST - Generate screenshot',
      '/pdf': 'POST - Generate PDF',
      '/scrape': 'POST - Scrape webpage content'
    }
  });
});

// Screenshot endpoint
app.post('/screenshot', async (req, res) => {
  try {
    const { url, options = {} } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL for security
    const validatedURL = validateURL(url);

    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport if specified
    if (options.viewport) {
      await page.setViewport(options.viewport);
    }
    
    await page.goto(validatedURL.href, { waitUntil: 'networkidle0' });
    
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: options.fullPage || false,
      ...options.screenshotOptions
    });
    
    await browser.close();
    
    res.set('Content-Type', 'image/png');
    res.send(screenshot);
  } catch (error) {
    console.error('Screenshot error:', error);
    res.status(500).json({ error: 'Failed to generate screenshot', details: error.message });
  }
});

// PDF generation endpoint
app.post('/pdf', async (req, res) => {
  try {
    const { url, html, options = {} } = req.body;
    
    if (!url && !html) {
      return res.status(400).json({ error: 'URL or HTML content is required' });
    }

    let validatedURL;
    if (url) {
      validatedURL = validateURL(url);
    }

    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    if (url) {
      await page.goto(validatedURL.href, { waitUntil: 'networkidle0' });
    } else {
      await page.setContent(html, { waitUntil: 'networkidle0' });
    }
    
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      ...options
    });
    
    await browser.close();
    
    res.set('Content-Type', 'application/pdf');
    res.send(pdf);
  } catch (error) {
    console.error('PDF error:', error);
    res.status(500).json({ error: 'Failed to generate PDF', details: error.message });
  }
});

// Web scraping endpoint
app.post('/scrape', async (req, res) => {
  try {
    const { url, selector, options = {} } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL for security
    const validatedURL = validateURL(url);

    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.goto(validatedURL.href, { waitUntil: 'networkidle0' });
    
    let result;
    if (selector) {
      result = await page.evaluate((sel) => {
        const elements = document.querySelectorAll(sel);
        return Array.from(elements).map(el => ({
          text: el.textContent?.trim(),
          html: el.innerHTML,
          attributes: Object.fromEntries(
            Array.from(el.attributes).map(attr => [attr.name, attr.value])
          )
        }));
      }, selector);
    } else {
      result = {
        title: await page.title(),
        url: page.url(),
        content: await page.evaluate(() => document.body.innerText)
      };
    }
    
    await browser.close();
    
    res.json({ data: result });
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape content', details: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Puppeteer microservice running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});