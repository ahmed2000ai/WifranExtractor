export type OcrRateLimitQueueConfig = {
  requestsPerSecondLimit: number;
  minRequestIntervalMs: number;
  tokensPerMinuteLimit: number;
  tpmSafetyRatio: number;
  estimatedTokensPerPage: number;
  estimatedTokensPerDensePage: number;
};

export type OcrRateLimitWaitInfo = {
  waitMs: number;
  reason: 'request_interval' | 'token_budget' | 'retry_after' | 'none';
  message: string;
};

export class OcrRateLimitQueue {
  private config: OcrRateLimitQueueConfig;
  private lastRequestAt: number = 0;
  private tokenUsageHistory: Array<{ timestamp: number; tokens: number }> = [];

  constructor(config: OcrRateLimitQueueConfig) {
    this.config = config;
  }

  private cleanHistory() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    this.tokenUsageHistory = this.tokenUsageHistory.filter(h => h.timestamp > oneMinuteAgo);
  }

  private getUsedTokensInCurrentWindow(): number {
    this.cleanHistory();
    return this.tokenUsageHistory.reduce((sum, h) => sum + h.tokens, 0);
  }

  public async waitBeforeNextRequest(input: {
    chunkId: string;
    pageCount: number;
    dense?: boolean;
    retryAfterMs?: number | null;
    onWait?: (info: OcrRateLimitWaitInfo) => void;
  }): Promise<void> {
    const now = Date.now();
    let waitMs = 0;
    let reason: OcrRateLimitWaitInfo['reason'] = 'none';
    let message = '';

    // 1. Retry-After takes precedence
    if (input.retryAfterMs && input.retryAfterMs > 0) {
      waitMs = input.retryAfterMs;
      reason = 'retry_after';
      message = `Mistral rate limit reached. Respecting Retry-After: ${Math.round(waitMs / 1000)} seconds.`;
    } else {
      // 2. Minimum Request Interval
      const timeSinceLastRequest = now - this.lastRequestAt;
      if (timeSinceLastRequest < this.config.minRequestIntervalMs) {
        waitMs = this.config.minRequestIntervalMs - timeSinceLastRequest;
        reason = 'request_interval';
        message = `Waiting ${Math.round(waitMs / 1000)} seconds before next Mistral OCR request.`;
      }

      // 3. Token Budget
      const estimatedTokens = input.dense
        ? this.config.estimatedTokensPerDensePage * input.pageCount
        : this.config.estimatedTokensPerPage * input.pageCount;

      const safeTokensPerMinute = this.config.tokensPerMinuteLimit * this.config.tpmSafetyRatio;
      const usedTokens = this.getUsedTokensInCurrentWindow();

      if (usedTokens + estimatedTokens > safeTokensPerMinute) {
        // Find how long we need to wait for enough tokens to fall out of the 60s window
        const targetUsage = safeTokensPerMinute - estimatedTokens;
        if (targetUsage < 0) {
           // We can never fit this chunk. Wait 60s to completely flush
           const tokenWaitMs = 60000;
           if (tokenWaitMs > waitMs) {
             waitMs = tokenWaitMs;
             reason = 'token_budget';
             message = `Token budget wait: waiting ${Math.round(waitMs / 1000)} seconds before next request.`;
           }
        } else {
           let currentSum = usedTokens;
           let neededWaitMs = 0;
           for (const entry of this.tokenUsageHistory) {
             currentSum -= entry.tokens;
             if (currentSum <= targetUsage) {
               neededWaitMs = (entry.timestamp + 60000) - now;
               break;
             }
           }
           if (neededWaitMs > waitMs) {
             waitMs = neededWaitMs;
             reason = 'token_budget';
             message = `Token budget wait: waiting ${Math.round(waitMs / 1000)} seconds before next request.`;
           }
        }
      }
    }

    // Add a tiny jitter (100-300ms) to avoid perfectly synchronized retries hitting exactly on the boundary
    if (waitMs > 0) {
      waitMs += Math.floor(Math.random() * 200) + 100;
    }

    if (waitMs > 0 && input.onWait) {
      input.onWait({ waitMs, reason, message });
    }

    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    this.lastRequestAt = Date.now();
  }

  public recordUsage(input: {
    chunkId: string;
    estimatedTokens: number;
    actualTokens?: number | null;
  }): void {
    const tokens = input.actualTokens != null ? input.actualTokens : input.estimatedTokens;
    this.tokenUsageHistory.push({
      timestamp: Date.now(),
      tokens
    });
    this.cleanHistory();
  }

  public getSnapshot(): {
    usedTokensInCurrentWindow: number;
    safeTokensPerMinute: number;
    lastRequestAt: string | null;
  } {
    return {
      usedTokensInCurrentWindow: this.getUsedTokensInCurrentWindow(),
      safeTokensPerMinute: this.config.tokensPerMinuteLimit * this.config.tpmSafetyRatio,
      lastRequestAt: this.lastRequestAt > 0 ? new Date(this.lastRequestAt).toISOString() : null
    };
  }
}
