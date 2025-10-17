# Security Considerations

This document outlines the security measures implemented in the Puppeteer microservice.

## Server-Side Request Forgery (SSRF) Protection

### Issue
The service accepts user-provided URLs for Puppeteer to visit, which could potentially be used for SSRF attacks.

### Mitigation
1. **URL Validation**: All user-provided URLs are validated through the `validateURL()` function before use
2. **Protocol Restriction**: Only HTTP and HTTPS protocols are allowed
3. **Host Blocking**: Access to localhost, internal IPs, and cloud metadata services is blocked
4. **Private IP Filtering**: Requests to private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x) are blocked

### Protected Resources
- `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`
- AWS metadata service (`169.254.169.254`)
- Google Cloud metadata service (`metadata.google.internal`)
- Docker internal networks (`172.16.0.0/12`)
- Private network ranges (`10.0.0.0/8`, `192.168.0.0/16`)

## Container Security

### Non-Root Execution
- Container runs as non-privileged user `pptruser`
- Process capabilities are dropped (`cap_drop: ALL`)
- Only necessary capabilities are added (`cap_add: SYS_ADMIN` for Chrome)

### Security Options
- `no-new-privileges:true` prevents privilege escalation
- Chrome runs with security-focused arguments:
  - `--no-sandbox`: Required for containerized Chrome
  - `--disable-setuid-sandbox`: Prevents setuid sandbox usage
  - `--disable-dev-shm-usage`: Uses /tmp instead of /dev/shm

## Application Security

### HTTP Security Headers
Implemented via `helmet.js`:
- X-Frame-Options: SAMEORIGIN
- X-XSS-Protection: 1; mode=block
- X-Content-Type-Options: nosniff
- Referrer-Policy: no-referrer-when-downgrade

### CORS Configuration
- Cross-Origin Resource Sharing is configured to allow controlled access
- Can be customized for specific domains in production

### Rate Limiting (Nginx)
- API rate limiting: 10 requests per second with burst of 20
- Prevents abuse and resource exhaustion

### Request Size Limits
- JSON payload limit: 10MB
- URL-encoded payload limit: 10MB
- Prevents memory exhaustion attacks

## Network Security

### Reverse Proxy (Production)
- Nginx reverse proxy provides additional security layer
- Request buffering and timeout management
- Security headers enforcement
- SSL/TLS termination

### Health Check Security
- Health endpoint (`/health`) has no authentication
- Provides minimal information (service name, timestamp, status)
- Used for monitoring without exposing sensitive data

## Resource Protection

### Memory Limits
- Docker container memory limit: 1GB
- Reserved memory: 512MB
- Shared memory size for Chrome: 2GB

### Process Limits
- CPU limit: 0.5 cores
- CPU reservation: 0.25 cores

### Timeout Configuration
- Puppeteer operations have implicit timeouts
- Nginx proxy timeouts: 60 seconds
- Health check timeout: 10 seconds

## Input Validation

### URL Validation
```javascript
// Example of URL validation
const validatedURL = validateURL(userProvidedURL);
// Only proceeds if URL passes security checks
```

### HTML Content
- HTML content for PDF generation is processed in isolated browser context
- No server-side evaluation of user-provided scripts
- Browser sandbox provides additional isolation

## Monitoring and Logging

### Security Events
- Invalid URL access attempts are logged
- Failed requests are logged with error details
- Health check failures are monitored

### Container Health
- Docker health checks every 30 seconds
- Automatic restart on health check failures
- Resource usage monitoring available via `docker stats`

## Production Recommendations

### Environment Variables
- Use environment variables for configuration
- Never commit secrets to source code
- Use Docker secrets or external secret management

### SSL/TLS
- Always use HTTPS in production
- Implement proper certificate management
- Use strong cipher suites

### Authentication (Optional)
Consider adding authentication for production use:
```javascript
// Example: API key validation middleware
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
```

### Firewall Configuration
- Restrict network access to necessary ports only
- Use security groups/firewall rules to limit source IPs
- Monitor network traffic for unusual patterns

## Known Limitations

### CodeQL Alerts
Static analysis tools (like CodeQL) may flag URL usage as potential SSRF vulnerabilities. This is expected behavior as the microservice intentionally allows URL access with proper validation.

### Chrome Security
- Chrome in containers requires `--no-sandbox` flag
- This is standard practice for containerized Chrome instances
- Additional container-level security compensates for this requirement

## Incident Response

### Suspicious Activity
1. Monitor logs for repeated failed URL validations
2. Check for requests to blocked hosts/IPs
3. Monitor resource usage for unusual spikes

### Emergency Procedures
1. Stop container: `docker-compose down`
2. Check logs: `docker-compose logs puppeteer-service`
3. Restart with clean state: `docker-compose up -d --force-recreate`

## Regular Maintenance

### Updates
- Regularly update Node.js base image
- Update npm dependencies for security patches
- Monitor Chrome updates and security advisories
- Review and update blocked host lists

### Security Scanning
- Run dependency vulnerability scans
- Use container image scanning tools
- Monitor security advisories for used packages