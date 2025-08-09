import type { ProcessedChunk, TextChunk } from './types';

export class TextProcessingService {
  
  /**
   * Extract relevant text chunks from content
   */
  async extractRelevantChunks(
    content: string, 
    metric: string, 
    sourceUrl: string
  ): Promise<TextChunk[]> {
    
    if (!content || content.trim().length === 0) {
      return [];
    }

    // Split content into sentences
    const sentences = this.splitIntoSentences(content);
    
    // Create overlapping chunks for better context
    const chunks: TextChunk[] = [];
    const chunkSize = 3; // 3 sentences per chunk
    const overlap = 1; // 1 sentence overlap
    
    for (let i = 0; i < sentences.length; i += (chunkSize - overlap)) {
      const chunkSentences = sentences.slice(i, i + chunkSize);
      
      if (chunkSentences.length === 0) break;
      
      const text = chunkSentences.join(' ').trim();
      
      // Skip very short chunks
      if (text.length < 50) continue;
      
      // Create context (surrounding sentences)
      const contextStart = Math.max(0, i - 2);
      const contextEnd = Math.min(sentences.length, i + chunkSize + 2);
      const context = sentences.slice(contextStart, contextEnd).join(' ');
      
      chunks.push({
        text,
        source_url: sourceUrl,
        context,
        position: i
      });
    }
    
    // Also create paragraph-based chunks for longer content
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 100);
    
    paragraphs.forEach((paragraph, index) => {
      if (paragraph.length > 200) {
        chunks.push({
          text: paragraph.trim(),
          source_url: sourceUrl,
          context: paragraph.trim(),
          position: sentences.length + index
        });
      }
    });
    
    console.log(`📝 Extracted ${chunks.length} text chunks from ${sourceUrl}`);
    return chunks;
  }

  /**
   * Score text chunks by relevance to the metric
   */
  async scoreRelevance(chunks: TextChunk[], metric: string): Promise<ProcessedChunk[]> {
    const metricKeywords = this.extractMetricKeywords(metric);
    
    const scoredChunks: ProcessedChunk[] = chunks.map(chunk => {
      const relevanceScore = this.calculateRelevanceScore(chunk.text, metricKeywords, metric);
      
      return {
        text: chunk.text,
        relevance_score: relevanceScore,
        source_url: chunk.source_url,
        context: chunk.context
      };
    });

    // Filter out very low relevance chunks
    const filteredChunks = scoredChunks.filter(chunk => chunk.relevance_score > 0.1);
    
    console.log(`🎯 Scored ${filteredChunks.length}/${chunks.length} chunks as relevant`);
    
    return filteredChunks;
  }

  /**
   * Extract keywords from the metric name
   */
  private extractMetricKeywords(metric: string): string[] {
    // Convert to lowercase and split into words
    const words = metric.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
    
    // Add common variations and synonyms
    const keywords = new Set(words);
    
    // Add metric-specific synonyms
    if (metric.toLowerCase().includes('population')) {
      keywords.add('people');
      keywords.add('inhabitants');
      keywords.add('residents');
      keywords.add('citizens');
      keywords.add('demographic');
    }
    
    if (metric.toLowerCase().includes('gdp')) {
      keywords.add('economy');
      keywords.add('economic');
      keywords.add('gross');
      keywords.add('domestic');
      keywords.add('product');
    }
    
    if (metric.toLowerCase().includes('temperature')) {
      keywords.add('celsius');
      keywords.add('fahrenheit');
      keywords.add('degrees');
      keywords.add('climate');
      keywords.add('weather');
    }
    
    return Array.from(keywords);
  }

  /**
   * Calculate relevance score for a text chunk
   */
  private calculateRelevanceScore(text: string, keywords: string[], metric: string): number {
    const lowerText = text.toLowerCase();
    let score = 0;
    
    // 1. Keyword matching (40% of score)
    const keywordMatches = keywords.filter(keyword => lowerText.includes(keyword));
    const keywordScore = (keywordMatches.length / keywords.length) * 0.4;
    score += keywordScore;
    
    // 2. Exact metric phrase matching (30% of score)
    const metricPhrase = metric.toLowerCase();
    if (lowerText.includes(metricPhrase)) {
      score += 0.3;
    } else {
      // Partial phrase matching
      const metricWords = metricPhrase.split(/\s+/);
      const partialMatches = metricWords.filter(word => lowerText.includes(word));
      score += (partialMatches.length / metricWords.length) * 0.15;
    }
    
    // 3. Number/data presence (20% of score)
    const hasNumbers = /\d+([,.\d]*\d+)?/.test(text);
    const hasPercentage = /%/.test(text);
    const hasCurrency = /(\$|USD|EUR|GBP|¥|£)/i.test(text);
    const hasUnits = /(billion|million|thousand|km|miles|meters|kg|pounds|people|residents)/i.test(text);
    
    let dataScore = 0;
    if (hasNumbers) dataScore += 0.1;
    if (hasPercentage) dataScore += 0.05;
    if (hasCurrency) dataScore += 0.05;
    if (hasUnits) dataScore += 0.05;
    score += Math.min(dataScore, 0.2);
    
    // 4. Temporal relevance (10% of score)
    const currentYear = new Date().getFullYear();
    const recentYears = [currentYear, currentYear - 1, currentYear - 2];
    const hasRecentDate = recentYears.some(year => lowerText.includes(year.toString()));
    const hasTemporalWords = /(current|latest|recent|today|now|as of)/i.test(text);
    
    if (hasRecentDate) score += 0.05;
    if (hasTemporalWords) score += 0.05;
    
    // 5. Authority indicators (bonus points)
    const authorityWords = /(official|government|bureau|institute|agency|organization|report|study|survey)/i;
    if (authorityWords.test(text)) {
      score += 0.1;
    }
    
    // Normalize score to 0-1 range
    return Math.min(Math.max(score, 0), 1);
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    // Simple sentence splitting - could be enhanced with NLP library
    return text
      .split(/[.!?]+/)
      .map(sentence => sentence.trim())
      .filter(sentence => sentence.length > 10) // Filter out very short fragments
      .map(sentence => {
        // Ensure sentence ends with punctuation
        if (!/[.!?]$/.test(sentence)) {
          sentence += '.';
        }
        return sentence;
      });
  }

  /**
   * Clean and normalize text
   */
  cleanText(text: string): string {
    return text
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove excessive punctuation
      .replace(/[.]{3,}/g, '...')
      // Remove HTML entities
      .replace(/&[a-zA-Z0-9#]+;/g, ' ')
      // Remove control characters
      .replace(/[\x00-\x1F\x7F]/g, '')
      // Trim
      .trim();
  }

  /**
   * Extract specific data patterns (numbers, dates, etc.)
   */
  extractDataPatterns(text: string): {
    numbers: string[];
    dates: string[];
    percentages: string[];
    currencies: string[];
  } {
    const patterns = {
      numbers: text.match(/\d+([,.\d]*\d+)?/g) || [],
      dates: text.match(/\b\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\w+\s+\d{1,2},?\s+\d{4}\b/g) || [],
      percentages: text.match(/\d+([,.\d]*\d+)?%/g) || [],
      currencies: text.match(/\$\d+([,.\d]*\d+)?|\d+([,.\d]*\d+)?\s*(USD|EUR|GBP|JPY)/gi) || []
    };
    
    return patterns;
  }
} 