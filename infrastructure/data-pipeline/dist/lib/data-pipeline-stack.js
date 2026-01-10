"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataPipelineStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const kinesis = __importStar(require("aws-cdk-lib/aws-kinesis"));
const firehose = __importStar(require("aws-cdk-lib/aws-kinesisfirehose"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const timestream = __importStar(require("aws-cdk-lib/aws-timestream"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const DEFAULT_CONFIG = {
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
class DataPipelineStack extends cdk.Stack {
    constructor(scope, id, config = DEFAULT_CONFIG) {
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
            removalPolicy: config.environment === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
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
            removalPolicy: config.environment === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
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
            removalPolicy: config.environment === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
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
        this.collectorRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["timestream:WriteRecords", "timestream:DescribeEndpoints"],
            resources: ["*"],
        }));
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
        // TCGplayer Collector
        this.tcgplayerCollector = new lambda.Function(this, "TCGplayerCollector", {
            ...commonLambdaProps,
            functionName: `${envPrefix}-tcgplayer-collector`,
            description: "Collects price and sales data from TCGplayer API",
            handler: "tcgplayer.handler",
            code: lambda.Code.fromAsset("lambda/collectors/tcgplayer"),
            timeout: cdk.Duration.minutes(10),
            memorySize: 1024,
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
        this.streamProcessor.addEventSource(new cdk.aws_lambda_event_sources.KinesisEventSource(this.priceStream, {
            batchSize: 100,
            startingPosition: lambda.StartingPosition.LATEST,
            maxBatchingWindow: cdk.Duration.seconds(5),
            parallelizationFactor: 2,
        }));
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
        }));
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
        }));
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
exports.DataPipelineStack = DataPipelineStack;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1waXBlbGluZS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL2xpYi9kYXRhLXBpcGVsaW5lLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7OztHQWFHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCxpREFBbUM7QUFDbkMsdURBQXlDO0FBQ3pDLHlEQUEyQztBQUMzQyxpRUFBbUQ7QUFDbkQsMEVBQTREO0FBQzVELG1FQUFxRDtBQUNyRCx1RUFBeUQ7QUFDekQsK0RBQWlEO0FBQ2pELCtEQUFpRDtBQUNqRCx3RUFBMEQ7QUFDMUQsMkRBQTZDO0FBQzdDLHVFQUF5RDtBQUN6RCx5REFBMkM7QUFDM0MsK0VBQWlFO0FBZ0JqRSxNQUFNLGNBQWMsR0FBdUI7SUFDekMsV0FBVyxFQUFFLEtBQUs7SUFDbEIsTUFBTSxFQUFFLFdBQVc7SUFDbkIsbUJBQW1CLEVBQUUsSUFBSTtJQUN6QixpQkFBaUIsRUFBRSxDQUFDLEVBQUUsb0JBQW9CO0lBQzFDLHFCQUFxQixFQUFFLEVBQUU7SUFDekIsZ0JBQWdCLEVBQUUsQ0FBQztDQUNwQixDQUFDO0FBRUYsZ0ZBQWdGO0FBQ2hGLGFBQWE7QUFDYixnRkFBZ0Y7QUFFaEYsTUFBYSxpQkFBa0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQW1DOUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxTQUE2QixjQUFjO1FBQ25GLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFO1lBQ2YsR0FBRyxFQUFFLEVBQUUsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNLEVBQUU7U0FDL0IsQ0FBQyxDQUFDO1FBRUgsTUFBTSxTQUFTLEdBQUcsT0FBTyxNQUFNLENBQUMsV0FBVyxFQUFFLENBQUM7UUFFOUMsNEVBQTRFO1FBQzVFLGtCQUFrQjtRQUNsQiw0RUFBNEU7UUFFNUUsTUFBTSxVQUFVLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxD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LHlCQUF5QjtBQUN6Qix5QkFBeUI7QUFDekIsK0JBQStCO0FBQy9CLDBCQUEwQjtBQUMxQiwrQkFBK0I7QUFDL0IsMEJBQTBCO0FBQzFCLE1BQU07QUFFTixHQUFHLENBQUMsS0FBSyxFQUFFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEFXUyBDREsgU3RhY2sgZm9yIFRDRyBEYXRhIFBpcGVsaW5lIEluZnJhc3RydWN0dXJlXG4gKlxuICogVGhpcyBzdGFjayBwcm92aXNpb25zIGFsbCBBV1MgcmVzb3VyY2VzIG5lZWRlZCBmb3IgdGhlIGRhdGEgcGlwZWxpbmU6XG4gKiAtIFMzIERhdGEgTGFrZSBidWNrZXRzXG4gKiAtIEtpbmVzaXMgRGF0YSBTdHJlYW1zIGZvciByZWFsLXRpbWUgaW5nZXN0aW9uXG4gKiAtIEtpbmVzaXMgRmlyZWhvc2UgZm9yIFMzIGRlbGl2ZXJ5XG4gKiAtIER5bmFtb0RCIHRhYmxlcyBmb3IgcmVhbC10aW1lIGxvb2t1cHNcbiAqIC0gVGltZXN0cmVhbSBkYXRhYmFzZSBmb3IgdGltZSBzZXJpZXMgZGF0YVxuICogLSBJQU0gcm9sZXMgYW5kIHBvbGljaWVzXG4gKiAtIExhbWJkYSBmdW5jdGlvbnMgZm9yIGRhdGEgY29sbGVjdGlvblxuICogLSBFdmVudEJyaWRnZSBydWxlcyBmb3Igc2NoZWR1bGluZ1xuICogLSBDbG91ZFdhdGNoIGRhc2hib2FyZHMgYW5kIGFsYXJtc1xuICovXG5cbmltcG9ydCAqIGFzIGNkayBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIHMzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtczNcIjtcbmltcG9ydCAqIGFzIGlhbSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0ICogYXMga2luZXNpcyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWtpbmVzaXNcIjtcbmltcG9ydCAqIGFzIGZpcmVob3NlIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mta2luZXNpc2ZpcmVob3NlXCI7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiXCI7XG5pbXBvcnQgKiBhcyB0aW1lc3RyZWFtIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtdGltZXN0cmVhbVwiO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhXCI7XG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1ldmVudHNcIjtcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0c1wiO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxvZ3NcIjtcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2ggZnJvbSBcImF3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoXCI7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1zbnNcIjtcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXJcIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDT05GSUdVUkFUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5pbnRlcmZhY2UgRGF0YVBpcGVsaW5lQ29uZmlnIHtcbiAgZW52aXJvbm1lbnQ6IFwiZGV2XCIgfCBcInN0YWdpbmdcIiB8IFwicHJvZFwiO1xuICByZWdpb246IHN0cmluZztcbiAgZW5hYmxlSmFwYW5TY3JhcGVyczogYm9vbGVhbjtcbiAga2luZXNpc1NoYXJkQ291bnQ6IG51bWJlcjtcbiAgZmlyZWhvc2VCdWZmZXJTZWNvbmRzOiBudW1iZXI7XG4gIGZpcmVob3NlQnVmZmVyTUI6IG51bWJlcjtcbn1cblxuY29uc3QgREVGQVVMVF9DT05GSUc6IERhdGFQaXBlbGluZUNvbmZpZyA9IHtcbiAgZW52aXJvbm1lbnQ6IFwiZGV2XCIsXG4gIHJlZ2lvbjogXCJ1cy1lYXN0LTFcIixcbiAgZW5hYmxlSmFwYW5TY3JhcGVyczogdHJ1ZSxcbiAga2luZXNpc1NoYXJkQ291bnQ6IDIsIC8vIFNjYWxlIHVwIGZvciBwcm9kXG4gIGZpcmVob3NlQnVmZmVyU2Vjb25kczogNjAsXG4gIGZpcmVob3NlQnVmZmVyTUI6IDUsXG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTUFJTiBTVEFDS1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGNsYXNzIERhdGFQaXBlbGluZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgLy8gUzMgQnVja2V0c1xuICBwdWJsaWMgcmVhZG9ubHkgZGF0YUJ1Y2tldDogczMuQnVja2V0O1xuXG4gIC8vIEtpbmVzaXMgU3RyZWFtc1xuICBwdWJsaWMgcmVhZG9ubHkgcHJpY2VTdHJlYW06IGtpbmVzaXMuU3RyZWFtO1xuICBwdWJsaWMgcmVhZG9ubHkgbGlzdGluZ1N0cmVhbToga2luZXNpcy5TdHJlYW07XG4gIHB1YmxpYyByZWFkb25seSBzYWxlc1N0cmVhbToga2luZXNpcy5TdHJlYW07XG4gIHB1YmxpYyByZWFkb25seSBzaWduYWxTdHJlYW06IGtpbmVzaXMuU3RyZWFtO1xuXG4gIC8vIER5bmFtb0RCIFRhYmxlc1xuICBwdWJsaWMgcmVhZG9ubHkgY3VycmVudFByaWNlc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGFyYml0cmFnZVRhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGNhcmRDYXRhbG9nVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuXG4gIC8vIFRpbWVzdHJlYW1cbiAgcHVibGljIHJlYWRvbmx5IHRpbWVzdHJlYW1EYXRhYmFzZTogdGltZXN0cmVhbS5DZm5EYXRhYmFzZTtcbiAgcHVibGljIHJlYWRvbmx5IHByaWNlSGlzdG9yeVRhYmxlOiB0aW1lc3RyZWFtLkNmblRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgbWFya2V0U3ByZWFkc1RhYmxlOiB0aW1lc3RyZWFtLkNmblRhYmxlO1xuXG4gIC8vIExhbWJkYSBGdW5jdGlvbnNcbiAgcHVibGljIHJlYWRvbmx5IHRjZ3BsYXllckNvbGxlY3RvcjogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgY2FyZG1hcmtldENvbGxlY3RvcjogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgZWJheUNvbGxlY3RvcjogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgamFwYW5Db2xsZWN0b3I6IGxhbWJkYS5GdW5jdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IHNvY2lhbENvbGxlY3RvcjogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgc3RyZWFtUHJvY2Vzc29yOiBsYW1iZGEuRnVuY3Rpb247XG5cbiAgLy8gSUFNIFJvbGVzXG4gIHB1YmxpYyByZWFkb25seSBjb2xsZWN0b3JSb2xlOiBpYW0uUm9sZTtcbiAgcHVibGljIHJlYWRvbmx5IGZpcmVob3NlUm9sZTogaWFtLlJvbGU7XG5cbiAgLy8gU2VjcmV0c1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpU2VjcmV0c0Fybjogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIGNvbmZpZzogRGF0YVBpcGVsaW5lQ29uZmlnID0gREVGQVVMVF9DT05GSUcpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHtcbiAgICAgIGVudjogeyByZWdpb246IGNvbmZpZy5yZWdpb24gfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGVudlByZWZpeCA9IGB0Y2ctJHtjb25maWcuZW52aXJvbm1lbnR9YDtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTRUNSRVRTIE1BTkFHRVJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCBhcGlTZWNyZXRzID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCBcIkFQSVNlY3JldHNcIiwge1xuICAgICAgc2VjcmV0TmFtZTogYCR7ZW52UHJlZml4fS9hcGktY3JlZGVudGlhbHNgLFxuICAgICAgZGVzY3JpcHRpb246IFwiQVBJIGNyZWRlbnRpYWxzIGZvciBUQ0cgZGF0YSBzb3VyY2VzXCIsXG4gICAgICBnZW5lcmF0ZVNlY3JldFN0cmluZzoge1xuICAgICAgICBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIHRjZ3BsYXllcl9hcGlfa2V5OiBcIlwiLFxuICAgICAgICAgIHRjZ3BsYXllcl9hY2Nlc3NfdG9rZW46IFwiXCIsXG4gICAgICAgICAgY2FyZG1hcmtldF9hcHBfdG9rZW46IFwiXCIsXG4gICAgICAgICAgY2FyZG1hcmtldF9hcHBfc2VjcmV0OiBcIlwiLFxuICAgICAgICAgIGViYXlfY2xpZW50X2lkOiBcIlwiLFxuICAgICAgICAgIGViYXlfY2xpZW50X3NlY3JldDogXCJcIixcbiAgICAgICAgICBwcm94eV91c2VybmFtZTogXCJcIixcbiAgICAgICAgICBwcm94eV9wYXNzd29yZDogXCJcIixcbiAgICAgICAgfSksXG4gICAgICAgIGdlbmVyYXRlU3RyaW5nS2V5OiBcInBsYWNlaG9sZGVyXCIsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRoaXMuYXBpU2VjcmV0c0FybiA9IGFwaVNlY3JldHMuc2VjcmV0QXJuO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFMzIERBVEEgTEFLRVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIHRoaXMuZGF0YUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgXCJEYXRhTGFrZUJ1Y2tldFwiLCB7XG4gICAgICBidWNrZXROYW1lOiBgJHtlbnZQcmVmaXh9LWRhdGEtbGFrZWAsXG4gICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcInJhdy10by1pYVwiLFxuICAgICAgICAgIHByZWZpeDogXCJyYXcvXCIsXG4gICAgICAgICAgdHJhbnNpdGlvbnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuSU5GUkVRVUVOVF9BQ0NFU1MsXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoMzApLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuR0xBQ0lFUixcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cygxODApLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwicHJvY2Vzc2VkLXRvLWlhXCIsXG4gICAgICAgICAgcHJlZml4OiBcInByb2Nlc3NlZC9cIixcbiAgICAgICAgICB0cmFuc2l0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTlRFTExJR0VOVF9USUVSSU5HLFxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDYwKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcImRlbGV0ZS1mYWlsZWRcIixcbiAgICAgICAgICBwcmVmaXg6IFwiZmFpbGVkL1wiLFxuICAgICAgICAgIGV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBjb3JzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogW3MzLkh0dHBNZXRob2RzLkdFVCwgczMuSHR0cE1ldGhvZHMuUFVUXSxcbiAgICAgICAgICBhbGxvd2VkT3JpZ2luczogW1wiKlwiXSxcbiAgICAgICAgICBhbGxvd2VkSGVhZGVyczogW1wiKlwiXSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICByZW1vdmFsUG9saWN5OlxuICAgICAgICBjb25maWcuZW52aXJvbm1lbnQgPT09IFwicHJvZFwiID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiBjb25maWcuZW52aXJvbm1lbnQgIT09IFwicHJvZFwiLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIGZvbGRlciBzdHJ1Y3R1cmUgdXNpbmcgYnVja2V0IGRlcGxveW1lbnQgb3IganVzdCBkb2N1bWVudCBpdFxuICAgIC8vIEZvbGRlcnM6IHJhdy8sIHByb2Nlc3NlZC8sIGZlYXR1cmVzLywgdHJhaW5pbmcvLCBtb2RlbHMvLCBpbWFnZXMvXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gS0lORVNJUyBEQVRBIFNUUkVBTVNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBQcmljZSBldmVudHMgc3RyZWFtIChoaWdoZXN0IHZvbHVtZSlcbiAgICB0aGlzLnByaWNlU3RyZWFtID0gbmV3IGtpbmVzaXMuU3RyZWFtKHRoaXMsIFwiUHJpY2VTdHJlYW1cIiwge1xuICAgICAgc3RyZWFtTmFtZTogYCR7ZW52UHJlZml4fS1wcmljZS1ldmVudHNgLFxuICAgICAgc2hhcmRDb3VudDogY29uZmlnLmtpbmVzaXNTaGFyZENvdW50ICogMiwgLy8gTW9yZSBzaGFyZHMgZm9yIHByaWNlc1xuICAgICAgcmV0ZW50aW9uUGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMjQpLFxuICAgICAgc3RyZWFtTW9kZToga2luZXNpcy5TdHJlYW1Nb2RlLlBST1ZJU0lPTkVELFxuICAgICAgZW5jcnlwdGlvbjoga2luZXNpcy5TdHJlYW1FbmNyeXB0aW9uLk1BTkFHRUQsXG4gICAgfSk7XG5cbiAgICAvLyBMaXN0aW5nIGV2ZW50cyBzdHJlYW1cbiAgICB0aGlzLmxpc3RpbmdTdHJlYW0gPSBuZXcga2luZXNpcy5TdHJlYW0odGhpcywgXCJMaXN0aW5nU3RyZWFtXCIsIHtcbiAgICAgIHN0cmVhbU5hbWU6IGAke2VudlByZWZpeH0tbGlzdGluZy1ldmVudHNgLFxuICAgICAgc2hhcmRDb3VudDogY29uZmlnLmtpbmVzaXNTaGFyZENvdW50LFxuICAgICAgcmV0ZW50aW9uUGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMjQpLFxuICAgICAgZW5jcnlwdGlvbjoga2luZXNpcy5TdHJlYW1FbmNyeXB0aW9uLk1BTkFHRUQsXG4gICAgfSk7XG5cbiAgICAvLyBTYWxlcy90cmFuc2FjdGlvbiBldmVudHMgc3RyZWFtXG4gICAgdGhpcy5zYWxlc1N0cmVhbSA9IG5ldyBraW5lc2lzLlN0cmVhbSh0aGlzLCBcIlNhbGVzU3RyZWFtXCIsIHtcbiAgICAgIHN0cmVhbU5hbWU6IGAke2VudlByZWZpeH0tc2FsZXMtZXZlbnRzYCxcbiAgICAgIHNoYXJkQ291bnQ6IGNvbmZpZy5raW5lc2lzU2hhcmRDb3VudCxcbiAgICAgIHJldGVudGlvblBlcmlvZDogY2RrLkR1cmF0aW9uLmRheXMoNyksIC8vIExvbmdlciByZXRlbnRpb24gZm9yIHNhbGVzXG4gICAgICBlbmNyeXB0aW9uOiBraW5lc2lzLlN0cmVhbUVuY3J5cHRpb24uTUFOQUdFRCxcbiAgICB9KTtcblxuICAgIC8vIFNvY2lhbCBzaWduYWxzIHN0cmVhbVxuICAgIHRoaXMuc2lnbmFsU3RyZWFtID0gbmV3IGtpbmVzaXMuU3RyZWFtKHRoaXMsIFwiU2lnbmFsU3RyZWFtXCIsIHtcbiAgICAgIHN0cmVhbU5hbWU6IGAke2VudlByZWZpeH0tc2lnbmFsLWV2ZW50c2AsXG4gICAgICBzaGFyZENvdW50OiAxLCAvLyBMb3dlciB2b2x1bWVcbiAgICAgIHJldGVudGlvblBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDI0KSxcbiAgICAgIGVuY3J5cHRpb246IGtpbmVzaXMuU3RyZWFtRW5jcnlwdGlvbi5NQU5BR0VELFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEtJTkVTSVMgRklSRUhPU0UgKFMzIERlbGl2ZXJ5KVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIEZpcmVob3NlIElBTSBSb2xlXG4gICAgdGhpcy5maXJlaG9zZVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgXCJGaXJlaG9zZVJvbGVcIiwge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJmaXJlaG9zZS5hbWF6b25hd3MuY29tXCIpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5kYXRhQnVja2V0LmdyYW50UmVhZFdyaXRlKHRoaXMuZmlyZWhvc2VSb2xlKTtcblxuICAgIC8vIFByaWNlIHN0cmVhbSB0byBTM1xuICAgIG5ldyBmaXJlaG9zZS5DZm5EZWxpdmVyeVN0cmVhbSh0aGlzLCBcIlByaWNlRmlyZWhvc2VcIiwge1xuICAgICAgZGVsaXZlcnlTdHJlYW1OYW1lOiBgJHtlbnZQcmVmaXh9LXByaWNlLXRvLXMzYCxcbiAgICAgIGRlbGl2ZXJ5U3RyZWFtVHlwZTogXCJLaW5lc2lzU3RyZWFtQXNTb3VyY2VcIixcbiAgICAgIGtpbmVzaXNTdHJlYW1Tb3VyY2VDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIGtpbmVzaXNTdHJlYW1Bcm46IHRoaXMucHJpY2VTdHJlYW0uc3RyZWFtQXJuLFxuICAgICAgICByb2xlQXJuOiB0aGlzLmZpcmVob3NlUm9sZS5yb2xlQXJuLFxuICAgICAgfSxcbiAgICAgIGV4dGVuZGVkUzNEZXN0aW5hdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgYnVja2V0QXJuOiB0aGlzLmRhdGFCdWNrZXQuYnVja2V0QXJuLFxuICAgICAgICBwcmVmaXg6IFwicmF3L3ByaWNlcy9zb3VyY2U9IXtwYXJ0aXRpb25LZXlGcm9tUXVlcnk6c291cmNlfS95ZWFyPSF7dGltZXN0YW1wOnl5eXl9L21vbnRoPSF7dGltZXN0YW1wOk1NfS9kYXk9IXt0aW1lc3RhbXA6ZGR9L2hvdXI9IXt0aW1lc3RhbXA6SEh9L1wiLFxuICAgICAgICBlcnJvck91dHB1dFByZWZpeDogXCJmYWlsZWQvcHJpY2VzLyF7ZmlyZWhvc2U6ZXJyb3Itb3V0cHV0LXR5cGV9L3llYXI9IXt0aW1lc3RhbXA6eXl5eX0vbW9udGg9IXt0aW1lc3RhbXA6TU19L2RheT0he3RpbWVzdGFtcDpkZH0vXCIsXG4gICAgICAgIGJ1ZmZlcmluZ0hpbnRzOiB7XG4gICAgICAgICAgaW50ZXJ2YWxJblNlY29uZHM6IGNvbmZpZy5maXJlaG9zZUJ1ZmZlclNlY29uZHMsXG4gICAgICAgICAgc2l6ZUluTUJzOiBjb25maWcuZmlyZWhvc2VCdWZmZXJNQixcbiAgICAgICAgfSxcbiAgICAgICAgY29tcHJlc3Npb25Gb3JtYXQ6IFwiR1pJUFwiLFxuICAgICAgICByb2xlQXJuOiB0aGlzLmZpcmVob3NlUm9sZS5yb2xlQXJuLFxuICAgICAgICBkeW5hbWljUGFydGl0aW9uaW5nQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHByb2Nlc3NpbmdDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBwcm9jZXNzb3JzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHR5cGU6IFwiTWV0YWRhdGFFeHRyYWN0aW9uXCIsXG4gICAgICAgICAgICAgIHBhcmFtZXRlcnM6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJOYW1lOiBcIk1ldGFkYXRhRXh0cmFjdGlvblF1ZXJ5XCIsXG4gICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJWYWx1ZTogXCJ7c291cmNlOi5zb3VyY2V9XCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJOYW1lOiBcIkpzb25QYXJzaW5nRW5naW5lXCIsXG4gICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJWYWx1ZTogXCJKUS0xLjZcIixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIFNhbGVzIHN0cmVhbSB0byBTM1xuICAgIG5ldyBmaXJlaG9zZS5DZm5EZWxpdmVyeVN0cmVhbSh0aGlzLCBcIlNhbGVzRmlyZWhvc2VcIiwge1xuICAgICAgZGVsaXZlcnlTdHJlYW1OYW1lOiBgJHtlbnZQcmVmaXh9LXNhbGVzLXRvLXMzYCxcbiAgICAgIGRlbGl2ZXJ5U3RyZWFtVHlwZTogXCJLaW5lc2lzU3RyZWFtQXNTb3VyY2VcIixcbiAgICAgIGtpbmVzaXNTdHJlYW1Tb3VyY2VDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIGtpbmVzaXNTdHJlYW1Bcm46IHRoaXMuc2FsZXNTdHJlYW0uc3RyZWFtQXJuLFxuICAgICAgICByb2xlQXJuOiB0aGlzLmZpcmVob3NlUm9sZS5yb2xlQXJuLFxuICAgICAgfSxcbiAgICAgIGV4dGVuZGVkUzNEZXN0aW5hdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgYnVja2V0QXJuOiB0aGlzLmRhdGFCdWNrZXQuYnVja2V0QXJuLFxuICAgICAgICBwcmVmaXg6IFwicmF3L3NhbGVzL3llYXI9IXt0aW1lc3RhbXA6eXl5eX0vbW9udGg9IXt0aW1lc3RhbXA6TU19L2RheT0he3RpbWVzdGFtcDpkZH0vXCIsXG4gICAgICAgIGVycm9yT3V0cHV0UHJlZml4OiBcImZhaWxlZC9zYWxlcy8he2ZpcmVob3NlOmVycm9yLW91dHB1dC10eXBlfS9cIixcbiAgICAgICAgYnVmZmVyaW5nSGludHM6IHtcbiAgICAgICAgICBpbnRlcnZhbEluU2Vjb25kczogMTIwLFxuICAgICAgICAgIHNpemVJbk1CczogMTAsXG4gICAgICAgIH0sXG4gICAgICAgIGNvbXByZXNzaW9uRm9ybWF0OiBcIkdaSVBcIixcbiAgICAgICAgcm9sZUFybjogdGhpcy5maXJlaG9zZVJvbGUucm9sZUFybixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRFlOQU1PREIgVEFCTEVTXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3VycmVudCBwcmljZXMgKHJlYWwtdGltZSBsb29rdXApXG4gICAgdGhpcy5jdXJyZW50UHJpY2VzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJDdXJyZW50UHJpY2VzVGFibGVcIiwge1xuICAgICAgdGFibGVOYW1lOiBgJHtlbnZQcmVmaXh9LWN1cnJlbnQtcHJpY2VzYCxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcImNhcmRfaWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogXCJzb3VyY2VfY29uZGl0aW9uXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcbiAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6IFwidHRsXCIsXG4gICAgICByZW1vdmFsUG9saWN5OlxuICAgICAgICBjb25maWcuZW52aXJvbm1lbnQgPT09IFwicHJvZFwiID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIEdTSSBmb3IgcXVlcnlpbmcgYnkgc291cmNlXG4gICAgdGhpcy5jdXJyZW50UHJpY2VzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiBcInNvdXJjZS1wcmljZS1pbmRleFwiLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwic291cmNlXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwicHJpY2VfdXNkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gQXJiaXRyYWdlIG9wcG9ydHVuaXRpZXNcbiAgICB0aGlzLmFyYml0cmFnZVRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsIFwiQXJiaXRyYWdlVGFibGVcIiwge1xuICAgICAgdGFibGVOYW1lOiBgJHtlbnZQcmVmaXh9LWFyYml0cmFnZS1vcHBvcnR1bml0aWVzYCxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcImNhcmRfaWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogXCJ0aW1lc3RhbXBcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5OVU1CRVIgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiBcInR0bFwiLCAvLyBBdXRvLWV4cGlyZSBhZnRlciAyNCBob3Vyc1xuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIENhcmQgY2F0YWxvZyAobWFzdGVyIGRhdGEpXG4gICAgdGhpcy5jYXJkQ2F0YWxvZ1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsIFwiQ2FyZENhdGFsb2dUYWJsZVwiLCB7XG4gICAgICB0YWJsZU5hbWU6IGAke2VudlByZWZpeH0tY2FyZC1jYXRhbG9nYCxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcImNhcmRfaWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTpcbiAgICAgICAgY29uZmlnLmVudmlyb25tZW50ID09PSBcInByb2RcIiA/IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTiA6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyBHU0kgZm9yIHNlYXJjaGluZyBieSBuYW1lXG4gICAgdGhpcy5jYXJkQ2F0YWxvZ1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogXCJuYW1lLWluZGV4XCIsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJnYW1lXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwibmFtZV9sb3dlclwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBBTUFaT04gVElNRVNUUkVBTVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIHRoaXMudGltZXN0cmVhbURhdGFiYXNlID0gbmV3IHRpbWVzdHJlYW0uQ2ZuRGF0YWJhc2UodGhpcywgXCJUaW1lc3RyZWFtREJcIiwge1xuICAgICAgZGF0YWJhc2VOYW1lOiBgJHtlbnZQcmVmaXgucmVwbGFjZSgvLS9nLCBcIl9cIil9X3ByaWNlc2AsXG4gICAgfSk7XG5cbiAgICB0aGlzLnByaWNlSGlzdG9yeVRhYmxlID0gbmV3IHRpbWVzdHJlYW0uQ2ZuVGFibGUodGhpcywgXCJQcmljZUhpc3RvcnlUYWJsZVwiLCB7XG4gICAgICBkYXRhYmFzZU5hbWU6IHRoaXMudGltZXN0cmVhbURhdGFiYXNlLnJlZixcbiAgICAgIHRhYmxlTmFtZTogXCJwcmljZV9oaXN0b3J5XCIsXG4gICAgICByZXRlbnRpb25Qcm9wZXJ0aWVzOiB7XG4gICAgICAgIG1lbW9yeVN0b3JlUmV0ZW50aW9uUGVyaW9kSW5Ib3VyczogXCIxNjhcIiwgLy8gNyBkYXlzIGluIG1lbW9yeVxuICAgICAgICBtYWduZXRpY1N0b3JlUmV0ZW50aW9uUGVyaW9kSW5EYXlzOiBcIjczMFwiLCAvLyAyIHllYXJzIG9uIGRpc2tcbiAgICAgIH0sXG4gICAgICBtYWduZXRpY1N0b3JlV3JpdGVQcm9wZXJ0aWVzOiB7XG4gICAgICAgIGVuYWJsZU1hZ25ldGljU3RvcmVXcml0ZXM6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5tYXJrZXRTcHJlYWRzVGFibGUgPSBuZXcgdGltZXN0cmVhbS5DZm5UYWJsZSh0aGlzLCBcIk1hcmtldFNwcmVhZHNUYWJsZVwiLCB7XG4gICAgICBkYXRhYmFzZU5hbWU6IHRoaXMudGltZXN0cmVhbURhdGFiYXNlLnJlZixcbiAgICAgIHRhYmxlTmFtZTogXCJtYXJrZXRfc3ByZWFkc1wiLFxuICAgICAgcmV0ZW50aW9uUHJvcGVydGllczoge1xuICAgICAgICBtZW1vcnlTdG9yZVJldGVudGlvblBlcmlvZEluSG91cnM6IFwiMTY4XCIsXG4gICAgICAgIG1hZ25ldGljU3RvcmVSZXRlbnRpb25QZXJpb2RJbkRheXM6IFwiMzY1XCIsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIElBTSBST0xFUyBGT1IgTEFNQkRBU1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIHRoaXMuY29sbGVjdG9yUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCBcIkNvbGxlY3RvclJvbGVcIiwge1xuICAgICAgcm9sZU5hbWU6IGAke2VudlByZWZpeH0tY29sbGVjdG9yLXJvbGVgLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJsYW1iZGEuYW1hem9uYXdzLmNvbVwiKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCIpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IGFjY2VzcyB0byBLaW5lc2lzXG4gICAgdGhpcy5wcmljZVN0cmVhbS5ncmFudFdyaXRlKHRoaXMuY29sbGVjdG9yUm9sZSk7XG4gICAgdGhpcy5saXN0aW5nU3RyZWFtLmdyYW50V3JpdGUodGhpcy5jb2xsZWN0b3JSb2xlKTtcbiAgICB0aGlzLnNhbGVzU3RyZWFtLmdyYW50V3JpdGUodGhpcy5jb2xsZWN0b3JSb2xlKTtcbiAgICB0aGlzLnNpZ25hbFN0cmVhbS5ncmFudFdyaXRlKHRoaXMuY29sbGVjdG9yUm9sZSk7XG5cbiAgICAvLyBHcmFudCBhY2Nlc3MgdG8gRHluYW1vREJcbiAgICB0aGlzLmN1cnJlbnRQcmljZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodGhpcy5jb2xsZWN0b3JSb2xlKTtcbiAgICB0aGlzLmFyYml0cmFnZVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh0aGlzLmNvbGxlY3RvclJvbGUpO1xuICAgIHRoaXMuY2FyZENhdGFsb2dUYWJsZS5ncmFudFJlYWREYXRhKHRoaXMuY29sbGVjdG9yUm9sZSk7XG5cbiAgICAvLyBHcmFudCBhY2Nlc3MgdG8gU2VjcmV0c1xuICAgIGFwaVNlY3JldHMuZ3JhbnRSZWFkKHRoaXMuY29sbGVjdG9yUm9sZSk7XG5cbiAgICAvLyBHcmFudCBhY2Nlc3MgdG8gVGltZXN0cmVhbVxuICAgIHRoaXMuY29sbGVjdG9yUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXCJ0aW1lc3RyZWFtOldyaXRlUmVjb3Jkc1wiLCBcInRpbWVzdHJlYW06RGVzY3JpYmVFbmRwb2ludHNcIl0sXG4gICAgICAgIHJlc291cmNlczogW1wiKlwiXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBMQU1CREEgTEFZRVIgKFNoYXJlZCBkZXBlbmRlbmNpZXMpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3Qgc2hhcmVkTGF5ZXIgPSBuZXcgbGFtYmRhLkxheWVyVmVyc2lvbih0aGlzLCBcIlNoYXJlZExheWVyXCIsIHtcbiAgICAgIGxheWVyVmVyc2lvbk5hbWU6IGAke2VudlByZWZpeH0tc2hhcmVkLWRlcHNgLFxuICAgICAgZGVzY3JpcHRpb246IFwiU2hhcmVkIGRlcGVuZGVuY2llcyBmb3IgY29sbGVjdG9yc1wiLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KFwibGFtYmRhL2xheWVycy9zaGFyZWRcIiksXG4gICAgICBjb21wYXRpYmxlUnVudGltZXM6IFtsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWF0sXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gTEFNQkRBIEZVTkNUSU9OUyAtIENPTExFQ1RPUlNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCBjb21tb25MYW1iZGFQcm9wcyA9IHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgcm9sZTogdGhpcy5jb2xsZWN0b3JSb2xlLFxuICAgICAgbGF5ZXJzOiBbc2hhcmVkTGF5ZXJdLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBQUklDRV9TVFJFQU1fTkFNRTogdGhpcy5wcmljZVN0cmVhbS5zdHJlYW1OYW1lLFxuICAgICAgICBMSVNUSU5HX1NUUkVBTV9OQU1FOiB0aGlzLmxpc3RpbmdTdHJlYW0uc3RyZWFtTmFtZSxcbiAgICAgICAgU0FMRVNfU1RSRUFNX05BTUU6IHRoaXMuc2FsZXNTdHJlYW0uc3RyZWFtTmFtZSxcbiAgICAgICAgU0lHTkFMX1NUUkVBTV9OQU1FOiB0aGlzLnNpZ25hbFN0cmVhbS5zdHJlYW1OYW1lLFxuICAgICAgICBDVVJSRU5UX1BSSUNFU19UQUJMRTogdGhpcy5jdXJyZW50UHJpY2VzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBBUkJJVFJBR0VfVEFCTEU6IHRoaXMuYXJiaXRyYWdlVGFibGUudGFibGVOYW1lLFxuICAgICAgICBDQVJEX0NBVEFMT0dfVEFCTEU6IHRoaXMuY2FyZENhdGFsb2dUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIFRJTUVTVFJFQU1fREFUQUJBU0U6IHRoaXMudGltZXN0cmVhbURhdGFiYXNlLnJlZixcbiAgICAgICAgU0VDUkVUU19BUk46IGFwaVNlY3JldHMuc2VjcmV0QXJuLFxuICAgICAgICBFTlZJUk9OTUVOVDogY29uZmlnLmVudmlyb25tZW50LFxuICAgICAgfSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLlRXT19XRUVLUyxcbiAgICB9O1xuXG4gICAgLy8gVENHcGxheWVyIENvbGxlY3RvclxuICAgIHRoaXMudGNncGxheWVyQ29sbGVjdG9yID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBcIlRDR3BsYXllckNvbGxlY3RvclwiLCB7XG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcbiAgICAgIGZ1bmN0aW9uTmFtZTogYCR7ZW52UHJlZml4fS10Y2dwbGF5ZXItY29sbGVjdG9yYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkNvbGxlY3RzIHByaWNlIGFuZCBzYWxlcyBkYXRhIGZyb20gVENHcGxheWVyIEFQSVwiLFxuICAgICAgaGFuZGxlcjogXCJ0Y2dwbGF5ZXIuaGFuZGxlclwiLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KFwibGFtYmRhL2NvbGxlY3RvcnMvdGNncGxheWVyXCIpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLFxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICB9KTtcblxuICAgIC8vIENhcmRtYXJrZXQgQ29sbGVjdG9yXG4gICAgdGhpcy5jYXJkbWFya2V0Q29sbGVjdG9yID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBcIkNhcmRtYXJrZXRDb2xsZWN0b3JcIiwge1xuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXG4gICAgICBmdW5jdGlvbk5hbWU6IGAke2VudlByZWZpeH0tY2FyZG1hcmtldC1jb2xsZWN0b3JgLFxuICAgICAgZGVzY3JpcHRpb246IFwiQ29sbGVjdHMgcHJpY2UgZGF0YSBmcm9tIENhcmRtYXJrZXQgQVBJXCIsXG4gICAgICBoYW5kbGVyOiBcImNhcmRtYXJrZXQuaGFuZGxlclwiLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KFwibGFtYmRhL2NvbGxlY3RvcnMvY2FyZG1hcmtldFwiKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKSxcbiAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgfSk7XG5cbiAgICAvLyBlQmF5IENvbGxlY3RvclxuICAgIHRoaXMuZWJheUNvbGxlY3RvciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgXCJFYmF5Q29sbGVjdG9yXCIsIHtcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxuICAgICAgZnVuY3Rpb25OYW1lOiBgJHtlbnZQcmVmaXh9LWViYXktY29sbGVjdG9yYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkNvbGxlY3RzIGxpc3RpbmdzIGFuZCBzYWxlcyBmcm9tIGVCYXkgQVBJXCIsXG4gICAgICBoYW5kbGVyOiBcImViYXkuaGFuZGxlclwiLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KFwibGFtYmRhL2NvbGxlY3RvcnMvZWJheVwiKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKSxcbiAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgfSk7XG5cbiAgICAvLyBKYXBhbiBDb2xsZWN0b3IgKFlhaG9vL01lcmNhcmkgc2NyYXBlcilcbiAgICB0aGlzLmphcGFuQ29sbGVjdG9yID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBcIkphcGFuQ29sbGVjdG9yXCIsIHtcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxuICAgICAgZnVuY3Rpb25OYW1lOiBgJHtlbnZQcmVmaXh9LWphcGFuLWNvbGxlY3RvcmAsXG4gICAgICBkZXNjcmlwdGlvbjogXCJTY3JhcGVzIFlhaG9vIEF1Y3Rpb25zIEpQIGFuZCBNZXJjYXJpIEpQXCIsXG4gICAgICBoYW5kbGVyOiBcImphcGFuLmhhbmRsZXJcIixcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChcImxhbWJkYS9jb2xsZWN0b3JzL2phcGFuXCIpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgbWVtb3J5U2l6ZTogMjA0OCwgLy8gTW9yZSBtZW1vcnkgZm9yIHNjcmFwaW5nXG4gICAgfSk7XG5cbiAgICAvLyBTb2NpYWwgU2lnbmFsIENvbGxlY3RvclxuICAgIHRoaXMuc29jaWFsQ29sbGVjdG9yID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBcIlNvY2lhbENvbGxlY3RvclwiLCB7XG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcbiAgICAgIGZ1bmN0aW9uTmFtZTogYCR7ZW52UHJlZml4fS1zb2NpYWwtY29sbGVjdG9yYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkNvbGxlY3RzIHNvY2lhbCBzaWduYWxzIGZyb20gVHdpdHRlciwgWW91VHViZSwgZXRjLlwiLFxuICAgICAgaGFuZGxlcjogXCJzb2NpYWwuaGFuZGxlclwiLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KFwibGFtYmRhL2NvbGxlY3RvcnMvc29jaWFsXCIpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgfSk7XG5cbiAgICAvLyBTdHJlYW0gUHJvY2Vzc29yIChyZWFsLXRpbWUgY2FsY3VsYXRpb25zKVxuICAgIHRoaXMuc3RyZWFtUHJvY2Vzc29yID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBcIlN0cmVhbVByb2Nlc3NvclwiLCB7XG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcbiAgICAgIGZ1bmN0aW9uTmFtZTogYCR7ZW52UHJlZml4fS1zdHJlYW0tcHJvY2Vzc29yYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlByb2Nlc3NlcyBwcmljZSBldmVudHMgZm9yIHJlYWwtdGltZSBjYWxjdWxhdGlvbnNcIixcbiAgICAgIGhhbmRsZXI6IFwicHJvY2Vzc29yLmhhbmRsZXJcIixcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChcImxhbWJkYS9wcm9jZXNzb3JzL3N0cmVhbVwiKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBLaW5lc2lzIGV2ZW50IHNvdXJjZSB0byBzdHJlYW0gcHJvY2Vzc29yXG4gICAgdGhpcy5zdHJlYW1Qcm9jZXNzb3IuYWRkRXZlbnRTb3VyY2UoXG4gICAgICBuZXcgY2RrLmF3c19sYW1iZGFfZXZlbnRfc291cmNlcy5LaW5lc2lzRXZlbnRTb3VyY2UodGhpcy5wcmljZVN0cmVhbSwge1xuICAgICAgICBiYXRjaFNpemU6IDEwMCxcbiAgICAgICAgc3RhcnRpbmdQb3NpdGlvbjogbGFtYmRhLlN0YXJ0aW5nUG9zaXRpb24uTEFURVNULFxuICAgICAgICBtYXhCYXRjaGluZ1dpbmRvdzogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICAgIHBhcmFsbGVsaXphdGlvbkZhY3RvcjogMixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBFVkVOVEJSSURHRSBTQ0hFRFVMRVNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBUQ0dwbGF5ZXIgLSBldmVyeSA1IG1pbnV0ZXNcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgXCJUQ0dwbGF5ZXJTY2hlZHVsZVwiLCB7XG4gICAgICBydWxlTmFtZTogYCR7ZW52UHJlZml4fS10Y2dwbGF5ZXItc2NoZWR1bGVgLFxuICAgICAgZGVzY3JpcHRpb246IFwiVHJpZ2dlciBUQ0dwbGF5ZXIgY29sbGVjdG9yIGV2ZXJ5IDUgbWludXRlc1wiLFxuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5yYXRlKGNkay5EdXJhdGlvbi5taW51dGVzKDUpKSxcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih0aGlzLnRjZ3BsYXllckNvbGxlY3RvcildLFxuICAgIH0pO1xuXG4gICAgLy8gQ2FyZG1hcmtldCAtIGV2ZXJ5IDE1IG1pbnV0ZXNcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgXCJDYXJkbWFya2V0U2NoZWR1bGVcIiwge1xuICAgICAgcnVsZU5hbWU6IGAke2VudlByZWZpeH0tY2FyZG1hcmtldC1zY2hlZHVsZWAsXG4gICAgICBkZXNjcmlwdGlvbjogXCJUcmlnZ2VyIENhcmRtYXJrZXQgY29sbGVjdG9yIGV2ZXJ5IDE1IG1pbnV0ZXNcIixcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUucmF0ZShjZGsuRHVyYXRpb24ubWludXRlcygxNSkpLFxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHRoaXMuY2FyZG1hcmtldENvbGxlY3RvcildLFxuICAgIH0pO1xuXG4gICAgLy8gZUJheSAtIGV2ZXJ5IDUgbWludXRlc1xuICAgIG5ldyBldmVudHMuUnVsZSh0aGlzLCBcIkViYXlTY2hlZHVsZVwiLCB7XG4gICAgICBydWxlTmFtZTogYCR7ZW52UHJlZml4fS1lYmF5LXNjaGVkdWxlYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlRyaWdnZXIgZUJheSBjb2xsZWN0b3IgZXZlcnkgNSBtaW51dGVzXCIsXG4gICAgICBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLnJhdGUoY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSkpLFxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHRoaXMuZWJheUNvbGxlY3RvcildLFxuICAgIH0pO1xuXG4gICAgLy8gSmFwYW4gLSBldmVyeSAzMCBtaW51dGVzICh0byBhdm9pZCByYXRlIGxpbWl0aW5nKVxuICAgIGlmIChjb25maWcuZW5hYmxlSmFwYW5TY3JhcGVycykge1xuICAgICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsIFwiSmFwYW5TY2hlZHVsZVwiLCB7XG4gICAgICAgIHJ1bGVOYW1lOiBgJHtlbnZQcmVmaXh9LWphcGFuLXNjaGVkdWxlYCxcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVHJpZ2dlciBKYXBhbiBzY3JhcGVyIGV2ZXJ5IDMwIG1pbnV0ZXNcIixcbiAgICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5yYXRlKGNkay5EdXJhdGlvbi5taW51dGVzKDMwKSksXG4gICAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih0aGlzLmphcGFuQ29sbGVjdG9yKV0sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBTb2NpYWwgLSBob3VybHlcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgXCJTb2NpYWxTY2hlZHVsZVwiLCB7XG4gICAgICBydWxlTmFtZTogYCR7ZW52UHJlZml4fS1zb2NpYWwtc2NoZWR1bGVgLFxuICAgICAgZGVzY3JpcHRpb246IFwiVHJpZ2dlciBzb2NpYWwgY29sbGVjdG9yIGhvdXJseVwiLFxuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5yYXRlKGNkay5EdXJhdGlvbi5ob3VycygxKSksXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24odGhpcy5zb2NpYWxDb2xsZWN0b3IpXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTTlMgVE9QSUNTIEZPUiBBTEVSVFNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCBhbGVydFRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCBcIkFsZXJ0VG9waWNcIiwge1xuICAgICAgdG9waWNOYW1lOiBgJHtlbnZQcmVmaXh9LWFsZXJ0c2AsXG4gICAgICBkaXNwbGF5TmFtZTogXCJUQ0cgRGF0YSBQaXBlbGluZSBBbGVydHNcIixcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDTE9VRFdBVENIIERBU0hCT0FSRFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIGNvbnN0IGRhc2hib2FyZCA9IG5ldyBjbG91ZHdhdGNoLkRhc2hib2FyZCh0aGlzLCBcIlBpcGVsaW5lRGFzaGJvYXJkXCIsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6IGAke2VudlByZWZpeH0tZGF0YS1waXBlbGluZWAsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgd2lkZ2V0c1xuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgLy8gQ29sbGVjdG9yIGludm9jYXRpb25zXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkNvbGxlY3RvciBJbnZvY2F0aW9uc1wiLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgdGhpcy50Y2dwbGF5ZXJDb2xsZWN0b3IubWV0cmljSW52b2NhdGlvbnMoKSxcbiAgICAgICAgICB0aGlzLmNhcmRtYXJrZXRDb2xsZWN0b3IubWV0cmljSW52b2NhdGlvbnMoKSxcbiAgICAgICAgICB0aGlzLmViYXlDb2xsZWN0b3IubWV0cmljSW52b2NhdGlvbnMoKSxcbiAgICAgICAgICB0aGlzLmphcGFuQ29sbGVjdG9yLm1ldHJpY0ludm9jYXRpb25zKCksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pLFxuICAgICAgLy8gQ29sbGVjdG9yIGVycm9yc1xuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogXCJDb2xsZWN0b3IgRXJyb3JzXCIsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICB0aGlzLnRjZ3BsYXllckNvbGxlY3Rvci5tZXRyaWNFcnJvcnMoKSxcbiAgICAgICAgICB0aGlzLmNhcmRtYXJrZXRDb2xsZWN0b3IubWV0cmljRXJyb3JzKCksXG4gICAgICAgICAgdGhpcy5lYmF5Q29sbGVjdG9yLm1ldHJpY0Vycm9ycygpLFxuICAgICAgICAgIHRoaXMuamFwYW5Db2xsZWN0b3IubWV0cmljRXJyb3JzKCksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgLy8gS2luZXNpcyBtZXRyaWNzXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIktpbmVzaXMgSW5jb21pbmcgUmVjb3Jkc1wiLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgdGhpcy5wcmljZVN0cmVhbS5tZXRyaWNJbmNvbWluZ1JlY29yZHMoKSxcbiAgICAgICAgICB0aGlzLmxpc3RpbmdTdHJlYW0ubWV0cmljSW5jb21pbmdSZWNvcmRzKCksXG4gICAgICAgICAgdGhpcy5zYWxlc1N0cmVhbS5tZXRyaWNJbmNvbWluZ1JlY29yZHMoKSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgfSksXG4gICAgICAvLyBEeW5hbW9EQiBtZXRyaWNzXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkR5bmFtb0RCIENvbnN1bWVkIENhcGFjaXR5XCIsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICB0aGlzLmN1cnJlbnRQcmljZXNUYWJsZS5tZXRyaWNDb25zdW1lZFJlYWRDYXBhY2l0eVVuaXRzKCksXG4gICAgICAgICAgdGhpcy5jdXJyZW50UHJpY2VzVGFibGUubWV0cmljQ29uc3VtZWRXcml0ZUNhcGFjaXR5VW5pdHMoKSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENMT1VEV0FUQ0ggQUxBUk1TXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ29sbGVjdG9yIGVycm9yIGFsYXJtXG4gICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgXCJUQ0dwbGF5ZXJFcnJvckFsYXJtXCIsIHtcbiAgICAgIG1ldHJpYzogdGhpcy50Y2dwbGF5ZXJDb2xsZWN0b3IubWV0cmljRXJyb3JzKCksXG4gICAgICB0aHJlc2hvbGQ6IDMsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246IFwiVENHcGxheWVyIGNvbGxlY3RvciBlcnJvcnNcIixcbiAgICAgIGFjdGlvbnNFbmFibGVkOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgXCJDYXJkbWFya2V0RXJyb3JBbGFybVwiLCB7XG4gICAgICBtZXRyaWM6IHRoaXMuY2FyZG1hcmtldENvbGxlY3Rvci5tZXRyaWNFcnJvcnMoKSxcbiAgICAgIHRocmVzaG9sZDogMyxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogXCJDYXJkbWFya2V0IGNvbGxlY3RvciBlcnJvcnNcIixcbiAgICB9KTtcblxuICAgIC8vIFN0cmVhbSBwcm9jZXNzb3IgZXJyb3IgYWxhcm1cbiAgICBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCBcIlN0cmVhbVByb2Nlc3NvckVycm9yQWxhcm1cIiwge1xuICAgICAgbWV0cmljOiB0aGlzLnN0cmVhbVByb2Nlc3Nvci5tZXRyaWNFcnJvcnMoKSxcbiAgICAgIHRocmVzaG9sZDogMTAsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246IFwiU3RyZWFtIHByb2Nlc3NvciBoaWdoIGVycm9yIHJhdGVcIixcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPVVRQVVRTXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJEYXRhQnVja2V0TmFtZVwiLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kYXRhQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogXCJTMyBidWNrZXQgZm9yIGRhdGEgbGFrZVwiLFxuICAgICAgZXhwb3J0TmFtZTogYCR7ZW52UHJlZml4fS1kYXRhLWJ1Y2tldGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlByaWNlU3RyZWFtQXJuXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnByaWNlU3RyZWFtLnN0cmVhbUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiBcIktpbmVzaXMgcHJpY2Ugc3RyZWFtIEFSTlwiLFxuICAgICAgZXhwb3J0TmFtZTogYCR7ZW52UHJlZml4fS1wcmljZS1zdHJlYW0tYXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiQ3VycmVudFByaWNlc1RhYmxlTmFtZVwiLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jdXJyZW50UHJpY2VzVGFibGUudGFibGVOYW1lLFxuICAgICAgZGVzY3JpcHRpb246IFwiRHluYW1vREIgY3VycmVudCBwcmljZXMgdGFibGVcIixcbiAgICAgIGV4cG9ydE5hbWU6IGAke2VudlByZWZpeH0tY3VycmVudC1wcmljZXMtdGFibGVgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJUaW1lc3RyZWFtRGF0YWJhc2VOYW1lXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnRpbWVzdHJlYW1EYXRhYmFzZS5yZWYsXG4gICAgICBkZXNjcmlwdGlvbjogXCJUaW1lc3RyZWFtIGRhdGFiYXNlIG5hbWVcIixcbiAgICAgIGV4cG9ydE5hbWU6IGAke2VudlByZWZpeH0tdGltZXN0cmVhbS1kYmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlNlY3JldHNBcm5cIiwge1xuICAgICAgdmFsdWU6IGFwaVNlY3JldHMuc2VjcmV0QXJuLFxuICAgICAgZGVzY3JpcHRpb246IFwiQVBJIHNlY3JldHMgQVJOXCIsXG4gICAgICBleHBvcnROYW1lOiBgJHtlbnZQcmVmaXh9LXNlY3JldHMtYXJuYCxcbiAgICB9KTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQVBQIEVOVFJZIFBPSU5UXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5jb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuXG4vLyBEZXZlbG9wbWVudCBzdGFja1xubmV3IERhdGFQaXBlbGluZVN0YWNrKGFwcCwgXCJUQ0dEYXRhUGlwZWxpbmUtRGV2XCIsIHtcbiAgZW52aXJvbm1lbnQ6IFwiZGV2XCIsXG4gIHJlZ2lvbjogXCJ1cy1lYXN0LTFcIixcbiAgZW5hYmxlSmFwYW5TY3JhcGVyczogdHJ1ZSxcbiAga2luZXNpc1NoYXJkQ291bnQ6IDEsXG4gIGZpcmVob3NlQnVmZmVyU2Vjb25kczogNjAsXG4gIGZpcmVob3NlQnVmZmVyTUI6IDUsXG59KTtcblxuLy8gUHJvZHVjdGlvbiBzdGFjayAodW5jb21tZW50IHdoZW4gcmVhZHkpXG4vLyBuZXcgRGF0YVBpcGVsaW5lU3RhY2soYXBwLCBcIlRDR0RhdGFQaXBlbGluZS1Qcm9kXCIsIHtcbi8vICAgZW52aXJvbm1lbnQ6IFwicHJvZFwiLFxuLy8gICByZWdpb246IFwidXMtZWFzdC0xXCIsXG4vLyAgIGVuYWJsZUphcGFuU2NyYXBlcnM6IHRydWUsXG4vLyAgIGtpbmVzaXNTaGFyZENvdW50OiA0LFxuLy8gICBmaXJlaG9zZUJ1ZmZlclNlY29uZHM6IDYwLFxuLy8gICBmaXJlaG9zZUJ1ZmZlck1COiAxMCxcbi8vIH0pO1xuXG5hcHAuc3ludGgoKTtcbiJdfQ==