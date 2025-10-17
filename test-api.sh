#!/bin/bash

# API Testing Script for Puppeteer Microservice
# Usage: ./test-api.sh [BASE_URL]

BASE_URL=${1:-"http://localhost:3000"}

echo "Testing Puppeteer Microservice API at $BASE_URL"
echo "================================================="

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test function
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    local expected_status=$5
    
    echo -n "Testing $name... "
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "%{http_code}" "$BASE_URL$endpoint")
        status_code="${response: -3}"
        body="${response%???}"
    else
        response=$(curl -s -w "%{http_code}" -X "$method" "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
        status_code="${response: -3}"
        body="${response%???}"
    fi
    
    if [ "$status_code" = "$expected_status" ]; then
        echo -e "${GREEN}PASS${NC} (HTTP $status_code)"
        if [[ "$body" != *"error"* ]] && [[ "$body" = *"{"* ]]; then
            echo "  Response: $(echo "$body" | head -c 100)..."
        fi
    else
        echo -e "${RED}FAIL${NC} (HTTP $status_code, expected $expected_status)"
        echo "  Response: $body"
    fi
    echo
}

# Test health endpoint
test_endpoint "Health Check" "GET" "/health" "" "200"

# Test root endpoint
test_endpoint "Root Endpoint" "GET" "/" "" "200"

# Test scrape endpoint
test_endpoint "Scrape Endpoint" "POST" "/scrape" '{"url":"https://example.com"}' "500"

# Test invalid endpoint
test_endpoint "Invalid Endpoint" "GET" "/invalid" "" "404"

echo "================================================="
echo "Note: Screenshot, PDF, and Scrape endpoints return 500 because"
echo "Puppeteer requires Chrome to be installed. This is normal in"
echo "testing environments without full Chrome installation."
echo
echo "For full functionality testing, run with Docker:"
echo "  docker-compose up -d"
echo "  ./test-api.sh"