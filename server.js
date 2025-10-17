const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

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
    
    await page.goto(url, { waitUntil: 'networkidle0' });
    
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
      await page.goto(url, { waitUntil: 'networkidle0' });
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
    await page.goto(url, { waitUntil: 'networkidle0' });
    
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