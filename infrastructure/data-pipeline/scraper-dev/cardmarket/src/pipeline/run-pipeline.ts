/**
 * CardMarket Pipeline Runner
 *
 * Orchestrates the complete data pipeline:
 * 1. Scrape prices from CardMarket (V2/V3 variants)
 * 2. Transform and validate data
 * 3. Write to RDS (MarketPriceEU, CardPriceV2, PriceHistoryDaily)
 * 4. Upload raw data to S3
 * 5. Export training datasets
 *
 * Usage:
 *   npx tsx src/pipeline/run-pipeline.ts              # Full pipeline
 *   npx tsx src/pipeline/run-pipeline.ts --test       # Test mode (3 cards)
 *   npx tsx src/pipeline/run-pipeline.ts --export     # Export training only
 */

import { TargetedScraper, ScrapeReport } from '../services/targeted-scraper';
import { DataIntegration } from './data-integration';
import { TrainingExporter } from './training-exporter';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface PipelineConfig {
  mode: 'full' | 'test' | 'export-only';
  testLimit: number;
  enableRds: boolean;
  enableS3: boolean;
  enableTraining: boolean;
  dryRun: boolean;
}

const DEFAULT_CONFIG: PipelineConfig = {
  mode: 'full',
  testLimit: 5,
  enableRds: true,
  enableS3: true,
  enableTraining: true,
  dryRun: false,
};

// =============================================================================
// PIPELINE RUNNER
// =============================================================================

export class PipelineRunner {
  private config: PipelineConfig;
  private scraper: TargetedScraper;
  private integration: DataIntegration;

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scraper = new TargetedScraper();
    this.integration = new DataIntegration({
      enableRds: this.config.enableRds && !this.config.dryRun,
      enableS3: this.config.enableS3 && !this.config.dryRun,
      enableTrainingExport: this.config.enableTraining,
    });
  }

  /**
   * Run the complete pipeline
   */
  async run(): Promise<PipelineResult> {
    const startTime = Date.now();

    console.log('═'.repeat(60));
    console.log('🚀 CARDMARKET DATA PIPELINE');
    console.log('═'.repeat(60));
    console.log(`Mode: ${this.config.mode.toUpperCase()}`);
    console.log(`RDS: ${this.config.enableRds ? '✅' : '❌'}`);
    console.log(`S3:  ${this.config.enableS3 ? '✅' : '❌'}`);
    console.log(`Dry Run: ${this.config.dryRun ? '⚠️ YES' : 'No'}`);
    console.log('═'.repeat(60));

    const result: PipelineResult = {
      stage: 'init',
      success: false,
      scrapeResult: null,
      integrationResult: null,
      trainingResult: null,
      duration: 0,
      errors: [],
    };

    try {
      // Stage 1: Scrape (unless export-only)
      if (this.config.mode !== 'export-only') {
        result.stage = 'scrape';
        console.log('\n📡 STAGE 1: SCRAPING\n');

        let scrapeReport: ScrapeReport;

        if (this.config.mode === 'test') {
          scrapeReport = await this.scraper.testScrape(this.config.testLimit);
        } else {
          scrapeReport = await this.scraper.runDailyScrape();
        }

        result.scrapeResult = {
          cardsScraped: scrapeReport.cardsScraped,
          cardsSkipped: scrapeReport.cardsSkipped,
          errors: scrapeReport.errors.length,
        };

        if (scrapeReport.cardsScraped === 0) {
          throw new Error('No cards were scraped');
        }

        // Stage 2: Integration
        result.stage = 'integration';
        console.log('\n💾 STAGE 2: DATA INTEGRATION\n');

        await this.integration.initialize();
        const integrationResult = await this.integration.processScrapeReport(scrapeReport);

        result.integrationResult = {
          rdsRecords: integrationResult.rdsRecords,
          s3Records: integrationResult.s3Records,
          trainingRecords: integrationResult.trainingRecords,
          errors: integrationResult.errors.length,
        };

        if (integrationResult.errors.length > 0) {
          result.errors.push(...integrationResult.errors);
        }
      }

      // Stage 3: Training Export (optional, separate stage)
      if (this.config.enableTraining && this.config.mode !== 'test') {
        result.stage = 'training';
        console.log('\n🧠 STAGE 3: TRAINING EXPORT\n');

        try {
          const exporter = new TrainingExporter();
          await exporter.initialize();
          const exportResult = await exporter.buildTrainingDataset();

          result.trainingResult = {
            trainExamples: exportResult.trainExamples,
            validationExamples: exportResult.validationExamples,
            testExamples: exportResult.testExamples,
            s3Keys: exportResult.s3Keys.length,
          };

          await exporter.close();
        } catch (error) {
          // Training export is optional - don't fail the whole pipeline
          console.warn('Training export skipped:', error);
          result.errors.push(`Training export: ${error}`);
        }
      }

      result.stage = 'complete';
      result.success = true;

    } catch (error) {
      result.errors.push(`${result.stage}: ${error}`);
      console.error(`\n❌ Pipeline failed at stage: ${result.stage}`);
      console.error(error);

    } finally {
      await this.integration.close();
      result.duration = Date.now() - startTime;
    }

    // Print summary
    this.printSummary(result);

    return result;
  }

  /**
   * Print pipeline summary
   */
  private printSummary(result: PipelineResult): void {
    console.log('\n' + '═'.repeat(60));
    console.log('📊 PIPELINE SUMMARY');
    console.log('═'.repeat(60));

    console.log(`\nStatus: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

    if (result.scrapeResult) {
      console.log(`\nScraping:`);
      console.log(`  Cards scraped: ${result.scrapeResult.cardsScraped}`);
      console.log(`  Cards skipped: ${result.scrapeResult.cardsSkipped}`);
      if (result.scrapeResult.errors > 0) {
        console.log(`  Errors: ${result.scrapeResult.errors}`);
      }
    }

    if (result.integrationResult) {
      console.log(`\nIntegration:`);
      console.log(`  RDS records: ${result.integrationResult.rdsRecords}`);
      console.log(`  S3 records: ${result.integrationResult.s3Records}`);
      console.log(`  Training points: ${result.integrationResult.trainingRecords}`);
    }

    if (result.trainingResult) {
      console.log(`\nTraining Export:`);
      console.log(`  Train examples: ${result.trainingResult.trainExamples}`);
      console.log(`  Validation: ${result.trainingResult.validationExamples}`);
      console.log(`  Test: ${result.trainingResult.testExamples}`);
      console.log(`  S3 files: ${result.trainingResult.s3Keys}`);
    }

    if (result.errors.length > 0) {
      console.log(`\n⚠️ Errors (${result.errors.length}):`);
      result.errors.forEach(e => console.log(`  - ${e}`));
    }

    console.log('\n' + '═'.repeat(60));
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface PipelineResult {
  stage: 'init' | 'scrape' | 'integration' | 'training' | 'complete';
  success: boolean;
  scrapeResult: {
    cardsScraped: number;
    cardsSkipped: number;
    errors: number;
  } | null;
  integrationResult: {
    rdsRecords: number;
    s3Records: number;
    trainingRecords: number;
    errors: number;
  } | null;
  trainingResult: {
    trainExamples: number;
    validationExamples: number;
    testExamples: number;
    s3Keys: number;
  } | null;
  duration: number;
  errors: string[];
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  const config: Partial<PipelineConfig> = {
    mode: 'full',
    dryRun: false,
  };

  // Parse arguments
  if (args.includes('--test')) {
    config.mode = 'test';
    const limitArg = args.find(a => a.startsWith('--limit='));
    if (limitArg) {
      config.testLimit = parseInt(limitArg.split('=')[1], 10);
    }
  }

  if (args.includes('--export')) {
    config.mode = 'export-only';
  }

  if (args.includes('--dry-run')) {
    config.dryRun = true;
  }

  if (args.includes('--no-rds')) {
    config.enableRds = false;
  }

  if (args.includes('--no-s3')) {
    config.enableS3 = false;
  }

  if (args.includes('--no-training')) {
    config.enableTraining = false;
  }

  // Run pipeline
  const runner = new PipelineRunner(config);
  const result = await runner.run();

  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}

// Run if executed directly
const isMainModule = typeof process !== 'undefined' && process.argv[1]?.includes('run-pipeline');
if (isMainModule) {
  main().catch(console.error);
}
