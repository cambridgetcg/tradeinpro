/**
 * Daily CardMarket Scraper Job
 *
 * Scheduled job that runs the complete CardMarket pipeline daily at 3 AM UTC.
 * Designed to run as:
 * - AWS Lambda with EventBridge trigger
 * - Local cron job
 * - GitHub Actions scheduled workflow
 *
 * Schedule: 0 3 * * * (3 AM UTC daily)
 *
 * The job:
 * 1. Scrapes all V2/V3 variant cards from CardMarket
 * 2. Writes to RDS (MarketPriceEU, CardPriceV2, PriceHistoryDaily)
 * 3. Uploads raw data to S3
 * 4. Generates training data for ML models
 */

import { PipelineRunner, PipelineResult } from '../pipeline/run-pipeline';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface JobConfig {
  jobName: string;
  schedule: string;
  timezone: string;
  maxRetries: number;
  retryDelayMs: number;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  slackWebhook?: string;
  emailRecipients?: string[];
}

const DEFAULT_JOB_CONFIG: JobConfig = {
  jobName: 'cardmarket-daily-sync',
  schedule: '0 3 * * *', // 3 AM UTC
  timezone: 'UTC',
  maxRetries: 2,
  retryDelayMs: 60000, // 1 minute
  notifyOnSuccess: false,
  notifyOnFailure: true,
  slackWebhook: process.env.SLACK_WEBHOOK_URL,
  emailRecipients: ['ops@cambridgetcg.com'],
};

// =============================================================================
// JOB RUNNER
// =============================================================================

export class DailyJobRunner {
  private config: JobConfig;

  constructor(config: Partial<JobConfig> = {}) {
    this.config = { ...DEFAULT_JOB_CONFIG, ...config };
  }

  /**
   * Execute the daily job with retry logic
   */
  async execute(): Promise<JobResult> {
    const jobStart = new Date();

    console.log('═'.repeat(60));
    console.log(`🌅 ${this.config.jobName.toUpperCase()}`);
    console.log('═'.repeat(60));
    console.log(`Start Time: ${jobStart.toISOString()}`);
    console.log(`Schedule: ${this.config.schedule} (${this.config.timezone})`);
    console.log('═'.repeat(60));

    let lastError: Error | null = null;
    let attempts = 0;
    let pipelineResult: PipelineResult | null = null;

    while (attempts <= this.config.maxRetries) {
      attempts++;

      try {
        console.log(`\n📍 Attempt ${attempts}/${this.config.maxRetries + 1}`);

        const runner = new PipelineRunner({
          mode: 'full',
          enableRds: true,
          enableS3: true,
          enableTraining: true,
        });

        pipelineResult = await runner.run();

        if (pipelineResult.success) {
          // Success!
          const jobResult = this.buildJobResult(jobStart, pipelineResult, attempts, null);
          await this.sendNotification(jobResult);
          return jobResult;
        }

        // Pipeline ran but reported failure
        lastError = new Error(pipelineResult.errors.join(', '));

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`Attempt ${attempts} failed:`, lastError.message);
      }

      // Retry delay (except on last attempt)
      if (attempts <= this.config.maxRetries) {
        console.log(`⏳ Waiting ${this.config.retryDelayMs / 1000}s before retry...`);
        await this.sleep(this.config.retryDelayMs);
      }
    }

    // All retries exhausted
    const jobResult = this.buildJobResult(jobStart, pipelineResult, attempts, lastError);
    await this.sendNotification(jobResult);
    return jobResult;
  }

  /**
   * Build the final job result
   */
  private buildJobResult(
    startTime: Date,
    pipelineResult: PipelineResult | null,
    attempts: number,
    error: Error | null
  ): JobResult {
    const endTime = new Date();

    return {
      jobName: this.config.jobName,
      success: pipelineResult?.success || false,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - startTime.getTime(),
      attempts,
      pipelineResult,
      error: error?.message || null,
    };
  }

  /**
   * Send notification (Slack/Email)
   */
  private async sendNotification(result: JobResult): Promise<void> {
    if (result.success && !this.config.notifyOnSuccess) return;
    if (!result.success && !this.config.notifyOnFailure) return;

    const emoji = result.success ? '✅' : '❌';
    const status = result.success ? 'SUCCESS' : 'FAILED';

    // Build message
    const message = this.buildNotificationMessage(result);

    // Send to Slack
    if (this.config.slackWebhook) {
      try {
        await fetch(this.config.slackWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `${emoji} *${this.config.jobName}*: ${status}`,
            blocks: [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: message }
              }
            ]
          })
        });
        console.log('📤 Slack notification sent');
      } catch (e) {
        console.warn('Failed to send Slack notification:', e);
      }
    }

    // Log the message
    console.log('\n📧 Notification:');
    console.log(message);
  }

  /**
   * Build notification message
   */
  private buildNotificationMessage(result: JobResult): string {
    const lines: string[] = [];

    lines.push(`*Job*: ${result.jobName}`);
    lines.push(`*Status*: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    lines.push(`*Duration*: ${(result.durationMs / 1000).toFixed(1)}s`);
    lines.push(`*Attempts*: ${result.attempts}`);

    if (result.pipelineResult?.scrapeResult) {
      const sr = result.pipelineResult.scrapeResult;
      lines.push(`*Cards Scraped*: ${sr.cardsScraped}`);
    }

    if (result.pipelineResult?.integrationResult) {
      const ir = result.pipelineResult.integrationResult;
      lines.push(`*RDS Records*: ${ir.rdsRecords}`);
      lines.push(`*S3 Records*: ${ir.s3Records}`);
    }

    if (result.error) {
      lines.push(`*Error*: ${result.error}`);
    }

    return lines.join('\n');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface JobResult {
  jobName: string;
  success: boolean;
  startTime: string;
  endTime: string;
  durationMs: number;
  attempts: number;
  pipelineResult: PipelineResult | null;
  error: string | null;
}

// =============================================================================
// LAMBDA HANDLER (for AWS Lambda deployment)
// =============================================================================

export async function handler(event: any): Promise<{ statusCode: number; body: string }> {
  console.log('Lambda invoked:', JSON.stringify(event));

  const runner = new DailyJobRunner();
  const result = await runner.execute();

  return {
    statusCode: result.success ? 200 : 500,
    body: JSON.stringify(result),
  };
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  const config: Partial<JobConfig> = {};

  if (args.includes('--notify-success')) {
    config.notifyOnSuccess = true;
  }

  if (args.includes('--no-notify')) {
    config.notifyOnSuccess = false;
    config.notifyOnFailure = false;
  }

  const retryArg = args.find(a => a.startsWith('--retries='));
  if (retryArg) {
    config.maxRetries = parseInt(retryArg.split('=')[1], 10);
  }

  const runner = new DailyJobRunner(config);
  const result = await runner.execute();

  console.log('\n📋 Final Result:', JSON.stringify(result, null, 2));

  process.exit(result.success ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { DailyJobRunner, JobResult };
