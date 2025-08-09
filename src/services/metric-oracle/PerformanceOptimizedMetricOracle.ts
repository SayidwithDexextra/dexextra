import { MetricResolution, MetricInput } from './types';
import { WebScrapingService } from './WebScrapingService';
import { AIResolverService } from './AIResolverService';
import { TextProcessingService } from './TextProcessingService';
import { ScreenshotStorageService } from './ScreenshotStorageService';
import { MetricOracleDatabase } from './MetricOracleDatabase';
import { ScrapedSource, ProcessedChunk } from './types';
import puppeteer, { Browser } from 'puppeteer';

interface CacheEntry {
  content: string;
  title: string;
  screenshot_url?: string;
  timestamp: Date;
  hash: string;
}

interface ProcessingJob {
  id: string;
  input: MetricInput;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  result?: MetricResolution;
  error?: string;
  startTime: Date;
}

export class PerformanceOptimizedMetricOracle {
  private aiResolver: AIResolverService;
  private textProcessor: TextProcessingService;
  private screenshotStorage: ScreenshotStorageService;
  private database: MetricOracleDatabase;
  
  // Performance optimizations
  private browserPool: Browser[] = [];
  private maxBrowsers = 3;
  private contentCache = new Map<string, CacheEntry>();
  private cacheMaxAge = 30 * 60 * 1000; // 30 minutes
  private processingJobs = new Map<string, ProcessingJob>();
  
  constructor() {
    this.aiResolver = new AIResolverService();
    this.textProcessor = new TextProcessingService();
    this.screenshotStorage = new ScreenshotStorageService();
    this.database = new MetricOracleDatabase();
    
    // Pre-warm browser pool
    this.initializeBrowserPool();
  }

  /**
   * Ultra-fast metric resolution with aggressive optimization
   */
  async resolveMetricFast(input: MetricInput): Promise<MetricResolution> {
    const startTime = Date.now();
    console.log(`🚀 FAST: Starting optimized metric resolution for: "${input.metric}"`);

    try {
      // Step 1: Check cache first (fastest path)
      const cachedResult = await this.checkCache(input);
      if (cachedResult) {
        console.log(`⚡ CACHE HIT: Returned in ${Date.now() - startTime}ms`);
        return cachedResult;
      }

      // Step 2: Parallel scraping with browser pool + streaming uploads
      console.log('🚄 FAST: Parallel scraping with browser pool...');
      const scrapingPromise = this.parallelScrapeWithPool(input.urls, input.metric);
      
      // Step 3: Start AI pre-processing while scraping (pipeline optimization)
      const aiReadyPromise = this.prepareAIContext(input.metric);
      
      // Step 4: Wait for scraping to complete
      const scrapedSources = await scrapingPromise;
      const aiContext = await aiReadyPromise;
      
      // Step 5: Fast content processing (pre-filtered)
      console.log('⚡ FAST: Speed-optimized content processing...');
      const processedChunks = await this.fastProcessContent(scrapedSources, input.metric);
      
      // Step 6: Parallel AI resolution + background storage
      console.log('🧠 FAST: Parallel AI resolution + background ops...');
      const [resolution] = await Promise.all([
        this.aiResolver.resolveMetric({
          metric: input.metric,
          description: input.description,
          sources: processedChunks,
          scrapedSources
        }),
        // Background operations (don't wait for these)
        this.backgroundOperations(input, scrapedSources)
      ]);

      // Cache the result for future requests
      this.cacheResult(input, resolution);

      const totalTime = Date.now() - startTime;
      console.log(`🏁 FAST: Completed in ${totalTime}ms (${(totalTime/1000).toFixed(2)}s)`);
      
      return resolution;

    } catch (error) {
      console.error('❌ FAST: Optimized resolution failed:', error);
      throw new Error(`Fast resolution failed for "${input.metric}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Background processing for non-critical operations
   */
  async resolveMetricBackground(input: MetricInput): Promise<string> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const job: ProcessingJob = {
      id: jobId,
      input,
      status: 'processing',
      progress: 0,
      startTime: new Date()
    };
    
    this.processingJobs.set(jobId, job);
    
    // Start background processing (don't await)
    this.processInBackground(jobId).catch(error => {
      console.error(`Background job ${jobId} failed:`, error);
      job.status = 'failed';
      job.error = error.message;
    });
    
    return jobId;
  }

  /**
   * Get status of background job
   */
  getJobStatus(jobId: string) {
    return this.processingJobs.get(jobId);
  }

  /**
   * High-performance parallel scraping with browser pool
   */
  private async parallelScrapeWithPool(urls: string[], metricName: string): Promise<ScrapedSource[]> {
    const maxConcurrent = Math.min(urls.length, this.maxBrowsers);
    const results: ScrapedSource[] = [];
    
    // Split URLs into batches for browser pool
    const urlBatches = this.chunkArray(urls, maxConcurrent);
    
    for (const batch of urlBatches) {
      const batchPromises = batch.map(async (url, index) => {
        const browser = await this.getBrowserFromPool();
        
        try {
          // Check cache first
          const cached = this.getCachedContent(url);
          if (cached) {
            console.log(`💾 CACHE: Using cached content for ${url}`);
            return {
              url,
              title: cached.title,
              content: cached.content,
              screenshot_url: cached.screenshot_url,
              timestamp: new Date()
            } as ScrapedSource;
          }

          // Fast scraping with timeout
          const page = await browser.newPage();
          
          try {
            // Set more reasonable timeouts for data loading
            page.setDefaultTimeout(20000); // 20s max
            page.setDefaultNavigationTimeout(20000);
            
            // Navigate and wait for content to load properly
            await page.goto(url, { 
              waitUntil: 'networkidle2', // Wait for network activity to settle
              timeout: 20000 
            });
            
            // Additional wait for dynamic content to load
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Robust content extraction with fallbacks
            const content = await page.evaluate(() => {
              try {
                // Remove scripts, styles, navigation elements
                const elementsToRemove = document.querySelectorAll('script, style, nav, header, footer, aside, .advertisement, .ads, .popup');
                elementsToRemove.forEach(el => el.remove());
                
                // Extract text content with multiple fallbacks
                let textContent = '';
                if (document.body) {
                  textContent = document.body.innerText || document.body.textContent || '';
                }
                
                // If no content, try to get content from main content areas
                if (!textContent.trim()) {
                  const contentSelectors = ['main', '[role="main"]', '.content', '#content', '.article', 'article'];
                  for (const selector of contentSelectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                      textContent = element.innerText || element.textContent || '';
                      if (textContent.trim()) break;
                    }
                  }
                }
                
                return {
                  title: document.title || 'No title',
                  content: textContent.trim(),
                  contentLength: textContent.trim().length,
                  url: window.location.href
                };
              } catch (error) {
                return {
                  title: 'Extraction failed',
                  content: 'Failed to extract content: ' + error.message,
                  contentLength: 0,
                  url: window.location.href
                };
              }
            });

            // Take screenshot before closing page
            let screenshot_url: string | undefined;
            try {
              screenshot_url = await this.fastScreenshot(page, url, metricName);
            } catch (screenshotError) {
              console.error(`⚠️ Screenshot failed for ${url}:`, screenshotError);
            }
            
            await page.close();
            
            // Cache the result
            this.cacheContent(url, content.title, content.content, screenshot_url);
            
            return {
              url,
              title: content.title,
              content: content.content,
              screenshot_url,
              timestamp: new Date()
            } as ScrapedSource;
            
          } finally {
            if (!page.isClosed()) {
              await page.close();
            }
          }
          
        } catch (error) {
          console.error(`⚠️ FAST: Failed to scrape ${url}:`, error);
          return {
            url,
            title: '',
            content: '',
            error: error instanceof Error ? error.message : 'Fast scraping failed',
            timestamp: new Date()
          } as ScrapedSource;
        } finally {
          this.returnBrowserToPool(browser);
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    console.log(`🚄 FAST: Parallel scraping completed: ${results.filter(r => !r.error).length}/${urls.length} successful`);
    return results;
  }

  /**
   * Speed-optimized content processing
   */
  private async fastProcessContent(sources: ScrapedSource[], metric: string): Promise<ProcessedChunk[]> {
    const chunks: ProcessedChunk[] = [];
    const metricKeywords = this.extractMetricKeywords(metric);
    
    // Parallel processing with early filtering
    const chunkPromises = sources.map(async (source) => {
      if (source.error || !source.content) return [];
      
      try {
        // Pre-filter content for relevance (much faster than full processing)
        const quickScore = this.quickRelevanceScore(source.content, metricKeywords);
        if (quickScore < 0.1) {
          console.log(`⏭️ SKIP: Low relevance content from ${source.url}`);
          return [];
        }
        
        // Fast chunking (fewer, larger chunks)
        const sentences = source.content.split(/[.!?]+/).filter(s => s.trim().length > 20);
        const fastChunks: ProcessedChunk[] = [];
        
        // Create larger chunks (10 sentences each, no overlap for speed)
        for (let i = 0; i < sentences.length; i += 10) {
          const chunkText = sentences.slice(i, i + 10).join('. ').trim();
          
          if (chunkText.length > 100) {
            const relevanceScore = this.quickRelevanceScore(chunkText, metricKeywords);
            
            if (relevanceScore > 0.2) { // Only keep relevant chunks
              fastChunks.push({
                text: chunkText,
                source_url: source.url,
                relevance_score: relevanceScore,
                position: i
              });
            }
          }
        }
        
        return fastChunks;
        
      } catch (error) {
        console.error(`⚠️ FAST: Content processing failed for ${source.url}:`, error);
        return [];
      }
    });
    
    const allChunkArrays = await Promise.all(chunkPromises);
    const allChunks = allChunkArrays.flat();
    
    // Quick sort and limit (top 15 for speed)
    const topChunks = allChunks
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, 15);
    
    console.log(`⚡ FAST: Content processing: ${topChunks.length} chunks (speed-optimized)`);
    return topChunks;
  }

  /**
   * Browser pool management
   */
  private async initializeBrowserPool() {
    console.log('🏊 Initializing browser pool...');
    
    for (let i = 0; i < this.maxBrowsers; i++) {
      try {
        const browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920x1080'
          ]
        });
        
        this.browserPool.push(browser);
      } catch (error) {
        console.error(`Failed to create browser ${i}:`, error);
      }
    }
    
    console.log(`🏊 Browser pool ready: ${this.browserPool.length} browsers`);
  }

  private async getBrowserFromPool(): Promise<Browser> {
    if (this.browserPool.length > 0) {
      return this.browserPool.pop()!;
    }
    
    // Fallback: create new browser if pool is empty
    return await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  private returnBrowserToPool(browser: Browser) {
    if (this.browserPool.length < this.maxBrowsers) {
      this.browserPool.push(browser);
    } else {
      // Pool is full, close this browser
      browser.close().catch(console.error);
    }
  }

  /**
   * Cache management
   */
  private generateCacheKey(input: MetricInput): string {
    const urlsHash = input.urls.sort().join('|');
    return `${input.metric}:${urlsHash}`;
  }

  private async checkCache(input: MetricInput): Promise<MetricResolution | null> {
    const cacheKey = this.generateCacheKey(input);
    
    try {
      // Check in-memory cache first
      const memoryEntry = this.contentCache.get(cacheKey);
      if (memoryEntry && Date.now() - memoryEntry.timestamp.getTime() < this.cacheMaxAge) {
        // TODO: Return cached resolution if we stored full results
      }
      
      // Check database cache
      const dbResults = await this.database.findSimilarResolutions(
        input.metric, 
        input.urls, 
        0.5 // 30 minutes
      );
      
      if (dbResults.length > 0) {
        const cached = dbResults[0];
        return JSON.parse(cached.resolution_data as string) as MetricResolution;
      }
      
    } catch (error) {
      console.error('Cache check failed:', error);
    }
    
    return null;
  }

  private cacheContent(url: string, title: string, content: string, screenshot_url?: string) {
    const hash = Buffer.from(url).toString('base64');
    this.contentCache.set(url, {
      content,
      title,
      screenshot_url,
      timestamp: new Date(),
      hash
    });
  }

  private getCachedContent(url: string): CacheEntry | null {
    const cached = this.contentCache.get(url);
    if (cached && Date.now() - cached.timestamp.getTime() < this.cacheMaxAge) {
      return cached;
    }
    return null;
  }

  private cacheResult(input: MetricInput, resolution: MetricResolution) {
    const cacheKey = this.generateCacheKey(input);
    // TODO: Cache full resolution result
  }

  /**
   * Utility functions
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private extractMetricKeywords(metric: string): string[] {
    const words = metric.toLowerCase().split(/\s+/);
    const keywords = [...words];
    
    // Add common metric-related terms
    keywords.push('current', 'total', 'live', 'count', 'value', 'rate', 'price');
    
    return keywords;
  }

  private quickRelevanceScore(text: string, keywords: string[]): number {
    const lowerText = text.toLowerCase();
    let score = 0;
    
    // Quick keyword matching
    for (const keyword of keywords) {
      const matches = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
      score += matches * 0.1;
    }
    
    // Bonus for numbers
    const numberMatches = (text.match(/\d{1,3}(,\d{3})*(\.\d+)?/g) || []).length;
    score += numberMatches * 0.2;
    
    return Math.min(score, 1.0);
  }

  private async fastScreenshot(page: any, url: string, metricContext: string): Promise<string | undefined> {
    try {
      // Wait for page to be fully loaded before screenshot
      await page.waitForFunction(() => document.readyState === 'complete');
      
      // Additional wait for dynamic content and JavaScript
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const timestamp = Date.now();
      const hash = Buffer.from(url).toString('base64').substring(0, 10);
      const filename = `fast_${timestamp}_${hash}.png`;
      
      // Take screenshot with error handling
      await page.screenshot({
        path: `/tmp/${filename}`,
        type: 'png',
        clip: { x: 0, y: 0, width: 1200, height: 800 },
        timeout: 10000 // 10s timeout for screenshot
      });
      
      // Background upload (don't await)
      this.screenshotStorage.uploadScreenshot(`/tmp/${filename}`, `fast/${filename}`)
        .then(url => {
          console.log(`📸 Screenshot uploaded: ${url}`);
          return url;
        })
        .catch(error => console.error('Background upload failed:', error));
      
      return `fast/${filename}`;
      
    } catch (error) {
      console.error('❌ Fast screenshot failed:', error);
      return undefined;
    }
  }

  private async prepareAIContext(metric: string): Promise<any> {
    // Pre-load AI context or warm up connections
    return {};
  }

  private async backgroundOperations(input: MetricInput, sources: ScrapedSource[]): Promise<void> {
    // Don't await these - run in background
    Promise.all([
      this.database.storeResolution(input, {} as MetricResolution).catch(console.error),
      this.cleanupOldCache().catch(console.error),
      this.optimizeBrowserPool().catch(console.error)
    ]);
  }

  private async processInBackground(jobId: string): Promise<void> {
    const job = this.processingJobs.get(jobId);
    if (!job) return;
    
    try {
      job.progress = 25;
      const result = await this.resolveMetricFast(job.input);
      
      job.status = 'completed';
      job.result = result;
      job.progress = 100;
      
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  private async cleanupOldCache(): Promise<void> {
    const cutoff = Date.now() - this.cacheMaxAge;
    
    for (const [key, entry] of this.contentCache.entries()) {
      if (entry.timestamp.getTime() < cutoff) {
        this.contentCache.delete(key);
      }
    }
  }

  private async optimizeBrowserPool(): Promise<void> {
    // Remove any disconnected browsers from pool
    const validBrowsers: Browser[] = [];
    
    for (const browser of this.browserPool) {
      try {
        await browser.version(); // Test if browser is still connected
        validBrowsers.push(browser);
      } catch (error) {
        // Browser is disconnected, close it
        browser.close().catch(console.error);
      }
    }
    
    this.browserPool = validBrowsers;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up optimized metric oracle...');
    
    // Close all browsers
    await Promise.all(
      this.browserPool.map(browser => browser.close().catch(console.error))
    );
    
    this.browserPool = [];
    this.contentCache.clear();
    this.processingJobs.clear();
  }
} 