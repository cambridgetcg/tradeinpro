/**
 * AWS CDK Stack for TCG Data Pipeline Infrastructure
 *
 * This stack provisions all AWS resources needed for the data pipeline:
 * - S3 Data Lake buckets
 * - Kinesis Data Streams for real-time ingestion
 * - Kinesis Firehose for S3 delivery
 * - DynamoDB tables for real-time lookups
 * - Timestream database for time series data
 * - IAM roles and policies
 * - Lambda functions for data collection
 * - EventBridge rules for scheduling
 * - CloudWatch dashboards and alarms
 */

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kinesis from "aws-cdk-lib/aws-kinesis";
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as timestream from "aws-cdk-lib/aws-timestream";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sns from "aws-cdk-lib/aws-sns";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

// =============================================================================
// CONFIGURATION
// =============================================================================

interface DataPipelineConfig {
  environment: "dev" | "staging" | "prod";
  region: string;
  enableJapanScrapers: boolean;
  kinesisShardCount: number;
  firehoseBufferSeconds: number;
  firehoseBufferMB: number;
}

const DEFAULT_CONFIG: DataPipelineConfig = {
  environment: "dev",
  region: "us-east-1",
  enableJapanScrapers: true,
  kinesisShardCount: 2, // Scale up for prod
  firehoseBufferSeconds: 60,
  firehoseBufferMB: 5,
};

// =============================================================================
// MAIN STACK
// =============================================================================

export class DataPipelineStack extends cdk.Stack {
  // S3 Buckets
  public readonly dataBucket: s3.Bucket;

  // Kinesis Streams
  public readonly priceStream: kinesis.Stream;
  public readonly listingStream: kinesis.Stream;
  public readonly salesStream: kinesis.Stream;
  public readonly signalStream: kinesis.Stream;

  // DynamoDB Tables
  public readonly currentPricesTable: dynamodb.Table;
  public readonly arbitrageTable: dynamodb.Table;
  public readonly cardCatalogTable: dynamodb.Table;

  // Timestream
  public readonly timestreamDatabase: timestream.CfnDatabase;
  public readonly priceHistoryTable: timestream.CfnTable;
  public readonly marketSpreadsTable: timestream.CfnTable;

  // Lambda Functions
  public readonly tcgplayerCollector: lambda.Function;
  public readonly cardmarketCollector: lambda.Function;
  public readonly ebayCollector: lambda.Function;
  public readonly japanCollector: lambda.Function;
  public readonly socialCollector: lambda.Function;
  public readonly streamProcessor: lambda.Function;

  // IAM Roles
  public readonly collectorRole: iam.Role;
  public readonly firehoseRole: iam.Role;

  // Secrets
  public readonly apiSecretsArn: string;

  constructor(scope: Construct, id: string, config: DataPipelineConfig = DEFAULT_CONFIG) {
    super(scope, id, {
      env: { region: config.region },
    });

    const envPrefix = `tcg-${config.environment}`;

    // =========================================================================
    // SECRETS MANAGER
    // =========================================================================

    const apiSecrets = new secretsmanager.Secret(this, "APISecrets", {
      secretName: `${envPrefix}/api-credentials`,
      description: "API credentials for TCG data sources",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          tcgplayer_api_key: "",
          tcgplayer_access_token: "",
          cardmarket_app_token: "",
          cardmarket_app_secret: "",
          ebay_client_id: "",
          ebay_client_secret: "",
          proxy_username: "",
          proxy_password: "",
        }),
        generateStringKey: "placeholder",
      },
    });
    this.apiSecretsArn = apiSecrets.secretArn;

    // =========================================================================
    // S3 DATA LAKE
    // =========================================================================

    this.dataBucket = new s3.Bucket(this, "DataLakeBucket", {
      bucketName: `${envPrefix}-data-lake`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: "raw-to-ia",
          prefix: "raw/",
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(180),
            },
          ],
        },
        {
          id: "processed-to-ia",
          prefix: "processed/",
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(60),
            },
          ],
        },
        {
          id: "delete-failed",
          prefix: "failed/",
          expiration: cdk.Duration.days(30),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
      removalPolicy:
        config.environment === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.environment !== "prod",
    });

    // Create folder structure using bucket deployment or just document it
    // Folders: raw/, processed/, features/, training/, models/, images/

    // =========================================================================
    // KINESIS DATA STREAMS
    // =========================================================================

    // Price events stream (highest volume)
    this.priceStream = new kinesis.Stream(this, "PriceStream", {
      streamName: `${envPrefix}-price-events`,
      shardCount: config.kinesisShardCount * 2, // More shards for prices
      retentionPeriod: cdk.Duration.hours(24),
      streamMode: kinesis.StreamMode.PROVISIONED,
      encryption: kinesis.StreamEncryption.MANAGED,
    });

    // Listing events stream
    this.listingStream = new kinesis.Stream(this, "ListingStream", {
      streamName: `${envPrefix}-listing-events`,
      shardCount: config.kinesisShardCount,
      retentionPeriod: cdk.Duration.hours(24),
      encryption: kinesis.StreamEncryption.MANAGED,
    });

    // Sales/transaction events stream
    this.salesStream = new kinesis.Stream(this, "SalesStream", {
      streamName: `${envPrefix}-sales-events`,
      shardCount: config.kinesisShardCount,
      retentionPeriod: cdk.Duration.days(7), // Longer retention for sales
      encryption: kinesis.StreamEncryption.MANAGED,
    });

    // Social signals stream
    this.signalStream = new kinesis.Stream(this, "SignalStream", {
      streamName: `${envPrefix}-signal-events`,
      shardCount: 1, // Lower volume
      retentionPeriod: cdk.Duration.hours(24),
      encryption: kinesis.StreamEncryption.MANAGED,
    });

    // =========================================================================
    // KINESIS FIREHOSE (S3 Delivery)
    // =========================================================================

    // Firehose IAM Role
    this.firehoseRole = new iam.Role(this, "FirehoseRole", {
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    });

    this.dataBucket.grantReadWrite(this.firehoseRole);

    // Price stream to S3
    new firehose.CfnDeliveryStream(this, "PriceFirehose", {
      deliveryStreamName: `${envPrefix}-price-to-s3`,
      deliveryStreamType: "KinesisStreamAsSource",
      kinesisStreamSourceConfiguration: {
        kinesisStreamArn: this.priceStream.streamArn,
        roleArn: this.firehoseRole.roleArn,
      },
      extendedS3DestinationConfiguration: {
        bucketArn: this.dataBucket.bucketArn,
        prefix: "raw/prices/source=!{partitionKeyFromQuery:source}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/",
        errorOutputPrefix: "failed/prices/!{firehose:error-output-type}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/",
        bufferingHints: {
          intervalInSeconds: config.firehoseBufferSeconds,
          sizeInMBs: config.firehoseBufferMB,
        },
        compressionFormat: "GZIP",
        roleArn: this.firehoseRole.roleArn,
        dynamicPartitioningConfiguration: {
          enabled: true,
        },
        processingConfiguration: {
          enabled: true,
          processors: [
            {
              type: "MetadataExtraction",
              parameters: [
                {
                  parameterName: "MetadataExtractionQuery",
                  parameterValue: "{source:.source}",
                },
                {
                  parameterName: "JsonParsingEngine",
                  parameterValue: "JQ-1.6",
                },
              ],
            },
          ],
        },
      },
    });

    // Sales stream to S3
    new firehose.CfnDeliveryStream(this, "SalesFirehose", {
      deliveryStreamName: `${envPrefix}-sales-to-s3`,
      deliveryStreamType: "KinesisStreamAsSource",
      kinesisStreamSourceConfiguration: {
        kinesisStreamArn: this.salesStream.streamArn,
        roleArn: this.firehoseRole.roleArn,
      },
      extendedS3DestinationConfiguration: {
        bucketArn: this.dataBucket.bucketArn,
        prefix: "raw/sales/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/",
        errorOutputPrefix: "failed/sales/!{firehose:error-output-type}/",
        bufferingHints: {
          intervalInSeconds: 120,
          sizeInMBs: 10,
        },
        compressionFormat: "GZIP",
        roleArn: this.firehoseRole.roleArn,
      },
    });

    // =========================================================================
    // DYNAMODB TABLES
    // =========================================================================

    // Current prices (real-time lookup)
    this.currentPricesTable = new dynamodb.Table(this, "CurrentPricesTable", {
      tableName: `${envPrefix}-current-prices`,
      partitionKey: { name: "card_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "source_condition", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      timeToLiveAttribute: "ttl",
      removalPolicy:
        config.environment === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI for querying by source
    this.currentPricesTable.addGlobalSecondaryIndex({
      indexName: "source-price-index",
      partitionKey: { name: "source", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "price_usd", type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Arbitrage opportunities
    this.arbitrageTable = new dynamodb.Table(this, "ArbitrageTable", {
      tableName: `${envPrefix}-arbitrage-opportunities`,
      partitionKey: { name: "card_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl", // Auto-expire after 24 hours
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Card catalog (master data)
    this.cardCatalogTable = new dynamodb.Table(this, "CardCatalogTable", {
      tableName: `${envPrefix}-card-catalog`,
      partitionKey: { name: "card_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy:
        config.environment === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI for searching by name
    this.cardCatalogTable.addGlobalSecondaryIndex({
      indexName: "name-index",
      partitionKey: { name: "game", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "name_lower", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // =========================================================================
    // AMAZON TIMESTREAM
    // =========================================================================

    this.timestreamDatabase = new timestream.CfnDatabase(this, "TimestreamDB", {
      databaseName: `${envPrefix.replace(/-/g, "_")}_prices`,
    });

    this.priceHistoryTable = new timestream.CfnTable(this, "PriceHistoryTable", {
      databaseName: this.timestreamDatabase.ref,
      tableName: "price_history",
      retentionProperties: {
        memoryStoreRetentionPeriodInHours: "168", // 7 days in memory
        magneticStoreRetentionPeriodInDays: "730", // 2 years on disk
      },
      magneticStoreWriteProperties: {
        enableMagneticStoreWrites: true,
      },
    });

    this.marketSpreadsTable = new timestream.CfnTable(this, "MarketSpreadsTable", {
      databaseName: this.timestreamDatabase.ref,
      tableName: "market_spreads",
      retentionProperties: {
        memoryStoreRetentionPeriodInHours: "168",
        magneticStoreRetentionPeriodInDays: "365",
      },
    });

    // =========================================================================
    // IAM ROLES FOR LAMBDAS
    // =========================================================================

    this.collectorRole = new iam.Role(this, "CollectorRole", {
      roleName: `${envPrefix}-collector-role`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    // Grant access to Kinesis
    this.priceStream.grantWrite(this.collectorRole);
    this.listingStream.grantWrite(this.collectorRole);
    this.salesStream.grantWrite(this.collectorRole);
    this.signalStream.grantWrite(this.collectorRole);

    // Grant access to DynamoDB
    this.currentPricesTable.grantReadWriteData(this.collectorRole);
    this.arbitrageTable.grantReadWriteData(this.collectorRole);
    this.cardCatalogTable.grantReadData(this.collectorRole);

    // Grant access to Secrets
    apiSecrets.grantRead(this.collectorRole);

    // Grant access to Timestream
    this.collectorRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["timestream:WriteRecords", "timestream:DescribeEndpoints"],
        resources: ["*"],
      })
    );

    // =========================================================================
    // LAMBDA LAYER (Shared dependencies)
    // =========================================================================

    const sharedLayer = new lambda.LayerVersion(this, "SharedLayer", {
      layerVersionName: `${envPrefix}-shared-deps`,
      description: "Shared dependencies for collectors",
      code: lambda.Code.fromAsset("lambda/layers/shared"),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    });

    // =========================================================================
    // LAMBDA FUNCTIONS - COLLECTORS
    // =========================================================================

    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      role: this.collectorRole,
      layers: [sharedLayer],
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        PRICE_STREAM_NAME: this.priceStream.streamName,
        LISTING_STREAM_NAME: this.listingStream.streamName,
        SALES_STREAM_NAME: this.salesStream.streamName,
        SIGNAL_STREAM_NAME: this.signalStream.streamName,
        CURRENT_PRICES_TABLE: this.currentPricesTable.tableName,
        ARBITRAGE_TABLE: this.arbitrageTable.tableName,
        CARD_CATALOG_TABLE: this.cardCatalogTable.tableName,
        TIMESTREAM_DATABASE: this.timestreamDatabase.ref,
        SECRETS_ARN: apiSecrets.secretArn,
        ENVIRONMENT: config.environment,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    };

    // TCGplayer Collector (real-time)
    this.tcgplayerCollector = new lambda.Function(this, "TCGplayerCollector", {
      ...commonLambdaProps,
      functionName: `${envPrefix}-tcgplayer-collector`,
      description: "Collects price and sales data from TCGplayer API",
      handler: "tcgplayer.handler",
      code: lambda.Code.fromAsset("lambda/collectors/tcgplayer"),
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
    });

    // TCGplayer Daily Archive (JustTCG API -> RDS)
    const tcgplayerArchive = new lambda.Function(this, "TCGplayerArchive", {
      ...commonLambdaProps,
      functionName: `${envPrefix}-tcgplayer-archive`,
      description: "Daily price archive from JustTCG API to RDS (One Piece, Pokemon, Lorcana)",
      handler: "handler.handler",
      code: lambda.Code.fromAsset("lambda/collectors/tcgplayer-archive"),
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048, // Higher memory for batch processing
      environment: {
        ...commonLambdaProps.environment,
        DATABASE_URL: process.env.DATABASE_URL || "",
        JUSTTCG_API_KEY: process.env.JUSTTCG_API_KEY || "",
      },
    });

    // Cardmarket Collector
    this.cardmarketCollector = new lambda.Function(this, "CardmarketCollector", {
      ...commonLambdaProps,
      functionName: `${envPrefix}-cardmarket-collector`,
      description: "Collects price data from Cardmarket API",
      handler: "cardmarket.handler",
      code: lambda.Code.fromAsset("lambda/collectors/cardmarket"),
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
    });

    // eBay Collector
    this.ebayCollector = new lambda.Function(this, "EbayCollector", {
      ...commonLambdaProps,
      functionName: `${envPrefix}-ebay-collector`,
      description: "Collects listings and sales from eBay API",
      handler: "ebay.handler",
      code: lambda.Code.fromAsset("lambda/collectors/ebay"),
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
    });

    // Japan Collector (Yahoo/Mercari scraper)
    this.japanCollector = new lambda.Function(this, "JapanCollector", {
      ...commonLambdaProps,
      functionName: `${envPrefix}-japan-collector`,
      description: "Scrapes Yahoo Auctions JP and Mercari JP",
      handler: "japan.handler",
      code: lambda.Code.fromAsset("lambda/collectors/japan"),
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048, // More memory for scraping
    });

    // Social Signal Collector
    this.socialCollector = new lambda.Function(this, "SocialCollector", {
      ...commonLambdaProps,
      functionName: `${envPrefix}-social-collector`,
      description: "Collects social signals from Twitter, YouTube, etc.",
      handler: "social.handler",
      code: lambda.Code.fromAsset("lambda/collectors/social"),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
    });

    // Stream Processor (real-time calculations)
    this.streamProcessor = new lambda.Function(this, "StreamProcessor", {
      ...commonLambdaProps,
      functionName: `${envPrefix}-stream-processor`,
      description: "Processes price events for real-time calculations",
      handler: "processor.handler",
      code: lambda.Code.fromAsset("lambda/processors/stream"),
      timeout: cdk.Duration.minutes(1),
      memorySize: 1024,
    });

    // Add Kinesis event source to stream processor
    this.streamProcessor.addEventSource(
      new cdk.aws_lambda_event_sources.KinesisEventSource(this.priceStream, {
        batchSize: 100,
        startingPosition: lambda.StartingPosition.LATEST,
        maxBatchingWindow: cdk.Duration.seconds(5),
        parallelizationFactor: 2,
      })
    );

    // =========================================================================
    // EVENTBRIDGE SCHEDULES
    // =========================================================================

    // TCGplayer - every 5 minutes
    new events.Rule(this, "TCGplayerSchedule", {
      ruleName: `${envPrefix}-tcgplayer-schedule`,
      description: "Trigger TCGplayer collector every 5 minutes",
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(this.tcgplayerCollector)],
    });

    // TCGplayer Daily Archive - 8 AM UTC daily
    new events.Rule(this, "TCGplayerArchiveSchedule", {
      ruleName: `${envPrefix}-tcgplayer-archive-schedule`,
      description: "Trigger TCGplayer daily archive at 8 AM UTC",
      schedule: events.Schedule.cron({ hour: "8", minute: "0" }),
      targets: [new targets.LambdaFunction(tcgplayerArchive)],
    });

    // Cardmarket - every 15 minutes
    new events.Rule(this, "CardmarketSchedule", {
      ruleName: `${envPrefix}-cardmarket-schedule`,
      description: "Trigger Cardmarket collector every 15 minutes",
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(this.cardmarketCollector)],
    });

    // eBay - every 5 minutes
    new events.Rule(this, "EbaySchedule", {
      ruleName: `${envPrefix}-ebay-schedule`,
      description: "Trigger eBay collector every 5 minutes",
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(this.ebayCollector)],
    });

    // Japan - every 30 minutes (to avoid rate limiting)
    if (config.enableJapanScrapers) {
      new events.Rule(this, "JapanSchedule", {
        ruleName: `${envPrefix}-japan-schedule`,
        description: "Trigger Japan scraper every 30 minutes",
        schedule: events.Schedule.rate(cdk.Duration.minutes(30)),
        targets: [new targets.LambdaFunction(this.japanCollector)],
      });
    }

    // Social - hourly
    new events.Rule(this, "SocialSchedule", {
      ruleName: `${envPrefix}-social-schedule`,
      description: "Trigger social collector hourly",
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new targets.LambdaFunction(this.socialCollector)],
    });

    // =========================================================================
    // SNS TOPICS FOR ALERTS
    // =========================================================================

    const alertTopic = new sns.Topic(this, "AlertTopic", {
      topicName: `${envPrefix}-alerts`,
      displayName: "TCG Data Pipeline Alerts",
    });

    // =========================================================================
    // CLOUDWATCH DASHBOARD
    // =========================================================================

    const dashboard = new cloudwatch.Dashboard(this, "PipelineDashboard", {
      dashboardName: `${envPrefix}-data-pipeline`,
    });

    // Add widgets
    dashboard.addWidgets(
      // Collector invocations
      new cloudwatch.GraphWidget({
        title: "Collector Invocations",
        left: [
          this.tcgplayerCollector.metricInvocations(),
          this.cardmarketCollector.metricInvocations(),
          this.ebayCollector.metricInvocations(),
          this.japanCollector.metricInvocations(),
        ],
        width: 12,
      }),
      // Collector errors
      new cloudwatch.GraphWidget({
        title: "Collector Errors",
        left: [
          this.tcgplayerCollector.metricErrors(),
          this.cardmarketCollector.metricErrors(),
          this.ebayCollector.metricErrors(),
          this.japanCollector.metricErrors(),
        ],
        width: 12,
      })
    );

    dashboard.addWidgets(
      // Kinesis metrics
      new cloudwatch.GraphWidget({
        title: "Kinesis Incoming Records",
        left: [
          this.priceStream.metricIncomingRecords(),
          this.listingStream.metricIncomingRecords(),
          this.salesStream.metricIncomingRecords(),
        ],
        width: 12,
      }),
      // DynamoDB metrics
      new cloudwatch.GraphWidget({
        title: "DynamoDB Consumed Capacity",
        left: [
          this.currentPricesTable.metricConsumedReadCapacityUnits(),
          this.currentPricesTable.metricConsumedWriteCapacityUnits(),
        ],
        width: 12,
      })
    );

    // =========================================================================
    // CLOUDWATCH ALARMS
    // =========================================================================

    // Collector error alarm
    new cloudwatch.Alarm(this, "TCGplayerErrorAlarm", {
      metric: this.tcgplayerCollector.metricErrors(),
      threshold: 3,
      evaluationPeriods: 2,
      alarmDescription: "TCGplayer collector errors",
      actionsEnabled: true,
    });

    new cloudwatch.Alarm(this, "CardmarketErrorAlarm", {
      metric: this.cardmarketCollector.metricErrors(),
      threshold: 3,
      evaluationPeriods: 2,
      alarmDescription: "Cardmarket collector errors",
    });

    // TCGplayer Archive error alarm
    new cloudwatch.Alarm(this, "TCGplayerArchiveErrorAlarm", {
      metric: tcgplayerArchive.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: "TCGplayer daily archive errors - critical for historical data",
    });

    // Stream processor error alarm
    new cloudwatch.Alarm(this, "StreamProcessorErrorAlarm", {
      metric: this.streamProcessor.metricErrors(),
      threshold: 10,
      evaluationPeriods: 1,
      alarmDescription: "Stream processor high error rate",
    });

    // =========================================================================
    // OUTPUTS
    // =========================================================================

    new cdk.CfnOutput(this, "DataBucketName", {
      value: this.dataBucket.bucketName,
      description: "S3 bucket for data lake",
      exportName: `${envPrefix}-data-bucket`,
    });

    new cdk.CfnOutput(this, "PriceStreamArn", {
      value: this.priceStream.streamArn,
      description: "Kinesis price stream ARN",
      exportName: `${envPrefix}-price-stream-arn`,
    });

    new cdk.CfnOutput(this, "CurrentPricesTableName", {
      value: this.currentPricesTable.tableName,
      description: "DynamoDB current prices table",
      exportName: `${envPrefix}-current-prices-table`,
    });

    new cdk.CfnOutput(this, "TimestreamDatabaseName", {
      value: this.timestreamDatabase.ref,
      description: "Timestream database name",
      exportName: `${envPrefix}-timestream-db`,
    });

    new cdk.CfnOutput(this, "SecretsArn", {
      value: apiSecrets.secretArn,
      description: "API secrets ARN",
      exportName: `${envPrefix}-secrets-arn`,
    });
  }
}

// =============================================================================
// APP ENTRY POINT
// =============================================================================

const app = new cdk.App();

// Development stack
new DataPipelineStack(app, "TCGDataPipeline-Dev", {
  environment: "dev",
  region: "us-east-1",
  enableJapanScrapers: true,
  kinesisShardCount: 1,
  firehoseBufferSeconds: 60,
  firehoseBufferMB: 5,
});

// Production stack (uncomment when ready)
// new DataPipelineStack(app, "TCGDataPipeline-Prod", {
//   environment: "prod",
//   region: "us-east-1",
//   enableJapanScrapers: true,
//   kinesisShardCount: 4,
//   firehoseBufferSeconds: 60,
//   firehoseBufferMB: 10,
// });

app.synth();
