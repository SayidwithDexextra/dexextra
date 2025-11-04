import { launchBrowser, type Browser } from './puppeteerLauncher';
import type { Page } from 'puppeteer-core';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ScrapedData {
  title: string;
  content: string;
  screenshot_path?: string;
  metadata: {
    url: string;
    timestamp: Date;
    contentLength: number;
    hasImages: boolean;
    hasNumbers: boolean;
  };
}

export class WebScrapingService {
  private browser: Browser | null = null;
  private screenshotDir: string;

  constructor() {
    // Use ephemeral storage on serverless platforms
    this.screenshotDir = path.join('/tmp', 'screenshots');
    this.ensureScreenshotDir();
  }

  /**
   * Scrape a URL with screenshot capture
   */
  async scrapeWithScreenshot(url: string, metricContext?: string): Promise<ScrapedData> {
    console.log(`📸 Scraping with screenshot: ${url}${metricContext ? ` (metric: ${metricContext})` : ''}`);
    
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    
    try {
      // Configure page
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      
      // Set reasonable timeouts
      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(30000);
      
      // Navigate to page
      const response = await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      if (!response || !response.ok()) {
        throw new Error(`HTTP ${response?.status()}: Failed to load page`);
      }

      // Wait for content to load with intelligent waiting
      try {
        await page.waitForFunction(
          () => document.readyState === 'complete' && document.body.innerText.length > 100,
          { timeout: 5000 }
        );
      } catch {
        // Fallback to simple timeout if waitForFunction fails
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Extract page data
      const pageData = await page.evaluate(() => {
        // Remove script and style elements
        const scripts = document.querySelectorAll('script, style, nav, header, footer, aside');
        scripts.forEach(el => el.remove());
        
        // Get title
        const title = document.title || document.querySelector('h1')?.textContent || 'No title';
        
        // Get main content
        const contentSelectors = [
          'main',
          '[role="main"]',
          '.content',
          '.main-content',
          'article',
          '.article',
          'body'
        ];
        
        let contentElement = null;
        for (const selector of contentSelectors) {
          contentElement = document.querySelector(selector);
          if (contentElement) break;
        }
        
        if (!contentElement) {
          contentElement = document.body;
        }
        
        // Clean and extract text
        const textContent = contentElement?.innerText || '';
        
        // Check for numbers and images
        const hasNumbers = /\d+([,.\d]*\d+)?/g.test(textContent);
        const hasImages = document.querySelectorAll('img').length > 0;
        
        return {
          title: title.trim(),
          content: textContent.trim(),
          contentLength: textContent.length,
          hasNumbers,
          hasImages
        };
      });

              // Take screenshot (pass metric context for smarter targeting)
        const screenshotPath = await this.captureScreenshot(page, url, metricContext);
      
      // Process and clean content
      const cleanedContent = this.cleanContent(pageData.content);
      
      const result: ScrapedData = {
        title: pageData.title,
        content: cleanedContent,
        screenshot_path: screenshotPath,
        metadata: {
          url,
          timestamp: new Date(),
          contentLength: cleanedContent.length,
          hasImages: pageData.hasImages,
          hasNumbers: pageData.hasNumbers
        }
      };

      console.log(`✅ Successfully scraped ${url}: ${cleanedContent.length} chars, screenshot: ${!!screenshotPath}`);
      return result;

    } catch (error) {
      console.error(`❌ Puppeteer scraping failed for ${url}:`, error);
      console.log(`🔄 Falling back to simple HTTP scraping for ${url}`);
      
      // Close the page and browser if they exist
      try {
        if (page && !page.isClosed()) {
          await page.close();
        }
        if (browser) {
          await browser.close();
        }
      } catch (cleanupError) {
        console.error('⚠️ Error during cleanup:', cleanupError);
      }
      
      // Fallback to simple HTTP scraping
      return await this.scrapeWithoutScreenshot(url);
    } finally {
      // Clean up resources if they weren't already closed in catch block
      try {
        if (page && !page.isClosed()) {
          await page.close();
        }
      } catch (cleanupError) {
        console.error('⚠️ Error during final cleanup:', cleanupError);
      }
    }
  }

  /**
   * Capture screenshot of the page, focusing on metric data when possible
   */
  private async captureScreenshot(page: Page, url: string, metricContext?: string): Promise<string | undefined> {
    try {
      const timestamp = Date.now();
      const base64CleanupRegex = /[/+=]/g;
      const urlHash = Buffer.from(url).toString('base64').replace(base64CleanupRegex, '').substring(0, 10);
      
      // Try to capture metric-focused screenshot first
      const metricScreenshot = await this.captureMetricFocusedScreenshot(page, timestamp, urlHash, metricContext);
      if (metricScreenshot) {
        console.log('📸 Captured metric-focused screenshot');
        return metricScreenshot;
      }
      
      // Fallback to full page screenshot
      console.log('📸 Falling back to full page screenshot');
      const filename = `screenshot_full_${timestamp}_${urlHash}.png`;
      const screenshotPath = path.join(this.screenshotDir, filename);
      
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
        type: 'png'
      });
      
      return screenshotPath;
    } catch (error) {
      console.error('❌ Failed to capture screenshot:', error);
      return undefined;
    }
  }

  /**
   * Attempt to capture a screenshot focused on metric data
   */
  private async captureMetricFocusedScreenshot(page: Page, timestamp: number, urlHash: string, metricContext?: string): Promise<string | undefined> {
    try {
      // Find elements that likely contain metric data
      const metricElement = await page.evaluate((metricContext) => {
        // Strategy 1: Look for large numbers (likely metrics)
        const findLargeNumbers = () => {
          const allElements = document.querySelectorAll('*');
          const candidates: { element: Element; score: number; rect: DOMRect }[] = [];
          
          for (const el of allElements) {
            const text = el.textContent?.trim() || '';
            
            // Look for patterns like: 8.1 billion, $50,000, 75%, 123,456,789
            const numberPatterns = [
              /\b\d{1,3}(,\d{3})+(\.\d+)?\s*(billion|million|thousand|trillion)\b/gi,
              /\b\$\d{1,3}(,\d{3})+(\.\d+)?\b/gi,
              /\b\d{1,3}(,\d{3})+(\.\d+)?\b/g,
              /\b\d+\.\d+\s*(billion|million|thousand|trillion)\b/gi,
              /\b\d+(\.\d+)?%\b/g
            ];
            
            let score = 0;
            for (const pattern of numberPatterns) {
              const matches = text.match(pattern);
              if (matches) {
                score += matches.length * 10;
                // Bonus for larger numbers
                if (text.includes('billion')) score += 20;
                if (text.includes('million')) score += 15;
                if (text.includes('trillion')) score += 25;
              }
            }
            
            // Bonus for metric-related keywords
            const metricKeywords = ['population', 'total', 'current', 'live', 'count', 'value', 'price', 'rate', 'percentage'];
            
            // Add context-specific keywords if metric context is provided
            if (metricContext) {
              const contextWords = metricContext.toLowerCase().split(/\s+/);
              metricKeywords.push(...contextWords);
            }
            
            for (const keyword of metricKeywords) {
              if (text.toLowerCase().includes(keyword)) {
                score += 5;
                // Extra bonus for context-specific matches
                if (metricContext && metricContext.toLowerCase().includes(keyword)) {
                  score += 10;
                }
              }
            }
            
            // Penalty for very small or very large elements
            const rect = el.getBoundingClientRect();
            if (rect.width > 50 && rect.width < 800 && rect.height > 20 && rect.height < 400) {
              score += 5;
            }
            
            if (score > 10) {
              candidates.push({ element: el, score, rect });
            }
          }
          
          // Sort by score and return the best candidate
          candidates.sort((a, b) => b.score - a.score);
          return candidates[0] || null;
        };

        // Strategy 2: Look for specific selectors commonly used for metrics
        const findBySelectors = () => {
          const selectors = [
            '[class*="counter"]',
            '[class*="metric"]',
            '[class*="value"]',
            '[class*="number"]',
            '[id*="counter"]',
            '[id*="metric"]',
            '[id*="value"]',
            '.stat',
            '.statistics',
            '.data-value',
            '.live-count',
            '.current-value'
          ];
          
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              const text = el.textContent?.trim() || '';
              if (/\d{1,3}(,\d{3})*/.test(text)) {
                const rect = el.getBoundingClientRect();
                return { element: el, score: 50, rect };
              }
            }
          }
          return null;
        };

        // Try both strategies
        const candidate = findBySelectors() || findLargeNumbers();
        
        if (candidate) {
          // Expand the bounding box to include some context
          const rect = candidate.rect;
          const expandedRect = {
            x: Math.max(0, rect.x - 50),
            y: Math.max(0, rect.y - 30),
            width: Math.min(window.innerWidth - rect.x + 50, rect.width + 100),
            height: Math.min(window.innerHeight - rect.y + 30, rect.height + 60)
          };
          
          return {
            element: candidate.element,
            boundingBox: expandedRect,
            score: candidate.score
          };
        }
        
        return null;
      }, metricContext);

      if (!metricElement) {
        console.log('🔍 No metric-specific elements found');
        return undefined;
      }

      console.log(`🎯 Found metric element with score: ${metricElement.score}`);
      
      // Take screenshot of the specific element's bounding box
      const filename = `screenshot_metric_${timestamp}_${urlHash}.png`;
      const screenshotPath = path.join(this.screenshotDir, filename);
      
      await page.screenshot({
        path: screenshotPath,
        type: 'png',
        clip: {
          x: metricElement.boundingBox.x,
          y: metricElement.boundingBox.y,
          width: metricElement.boundingBox.width,
          height: metricElement.boundingBox.height
        }
      });
      
      return screenshotPath;
      
    } catch (error) {
      console.error('⚠️ Metric-focused screenshot failed:', error);
      return undefined;
    }
  }

  /**
   * Clean and normalize content
   */
  private cleanContent(content: string): string {
    if (!content) return '';
    
    // Define regex patterns
    const whitespaceRegex = /\s+/g;
    const excessiveLineBreaksRegex = /\n\s*\n\s*\n/g;
    const specialCharsRegex = /[^\w\s.,!?;:()\-$%'"]/g;
    
    return content
      // Normalize whitespace
      .replace(whitespaceRegex, ' ')
      // Remove excessive line breaks
      .replace(excessiveLineBreaksRegex, '\n\n')
      // Remove special characters that might confuse AI
      .replace(specialCharsRegex, ' ')
      // Trim and limit length
      .trim()
      .substring(0, 15000); // Limit to 15k chars to avoid token limits
  }

  /**
   * Get or create browser instance
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      console.log('🌐 Launching browser...');
      
      this.browser = await launchBrowser([
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ]);
      
      // Handle browser disconnection
      this.browser.on('disconnected', () => {
        console.log('🌐 Browser disconnected');
        this.browser = null;
      });
    }
    
    return this.browser;
  }

  /**
   * Ensure screenshot directory exists
   */
  private async ensureScreenshotDir(): Promise<void> {
    try {
      await fs.mkdir(this.screenshotDir, { recursive: true });
    } catch (error) {
      console.error('❌ Failed to create screenshot directory:', error);
    }
  }

  /**
   * Cleanup browser and temporary files
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    
    // Optionally clean up old screenshots
    try {
      const files = await fs.readdir(this.screenshotDir);
      const screenshotPattern = /screenshot_(\d+)_/;
      const oldFiles = files.filter(file => {
        const match = file.match(screenshotPattern);
        if (match) {
          const timestamp = parseInt(match[1]);
          const age = Date.now() - timestamp;
          return age > 24 * 60 * 60 * 1000; // Older than 24 hours
        }
        return false;
      });
      
      for (const file of oldFiles) {
        await fs.unlink(path.join(this.screenshotDir, file));
      }
      
      if (oldFiles.length > 0) {
        console.log(`🧹 Cleaned up ${oldFiles.length} old screenshots`);
      }
    } catch (error) {
      console.error('❌ Failed to cleanup old screenshots:', error);
    }
  }

  /**
   * Fallback scraping without Puppeteer (for environments where it's not available)
   */
  async scrapeWithoutScreenshot(url: string): Promise<ScrapedData> {
    console.log(`📄 Fallback scraping (no screenshot): ${url}`);
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MetricOracle/1.0)',
        },
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const html = await response.text();
      
      // Basic HTML parsing
      const titleRegex = /<title[^>]*>([^<]+)<\/title>/i;
      const titleMatch = html.match(titleRegex);
      const title = titleMatch ? titleMatch[1].trim() : 'No title found';
      
      // Remove scripts, styles, and extract text
      const scriptRegex = /<script[^>]*>[\s\S]*?<\/script>/gi;
      const styleRegex = /<style[^>]*>[\s\S]*?<\/style>/gi;
      const tagRegex = /<[^>]+>/g;
      const whitespaceRegex = /\s+/g;
      
      const textContent = html
        .replace(scriptRegex, '')
        .replace(styleRegex, '')
        .replace(tagRegex, ' ')
        .replace(whitespaceRegex, ' ')
        .trim();
      
      const cleanedContent = this.cleanContent(textContent);
      
              // Test for content patterns
        const imgRegex = /<img/i;
        const numberRegex = /\d+([,.\d]*\d+)?/g;
        
        return {
          title,
          content: cleanedContent,
          metadata: {
            url,
            timestamp: new Date(),
            contentLength: cleanedContent.length,
            hasImages: imgRegex.test(html),
            hasNumbers: numberRegex.test(cleanedContent)
          }
        };
      
    } catch (error) {
      throw new Error(`Fallback scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
} 