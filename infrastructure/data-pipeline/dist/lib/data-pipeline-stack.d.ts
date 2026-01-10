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
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as timestream from "aws-cdk-lib/aws-timestream";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
interface DataPipelineConfig {
    environment: "dev" | "staging" | "prod";
    region: string;
    enableJapanScrapers: boolean;
    kinesisShardCount: number;
    firehoseBufferSeconds: number;
    firehoseBufferMB: number;
}
export declare class DataPipelineStack extends cdk.Stack {
    readonly dataBucket: s3.Bucket;
    readonly priceStream: kinesis.Stream;
    readonly listingStream: kinesis.Stream;
    readonly salesStream: kinesis.Stream;
    readonly signalStream: kinesis.Stream;
    readonly currentPricesTable: dynamodb.Table;
    readonly arbitrageTable: dynamodb.Table;
    readonly cardCatalogTable: dynamodb.Table;
    readonly timestreamDatabase: timestream.CfnDatabase;
    readonly priceHistoryTable: timestream.CfnTable;
    readonly marketSpreadsTable: timestream.CfnTable;
    readonly tcgplayerCollector: lambda.Function;
    readonly cardmarketCollector: lambda.Function;
    readonly ebayCollector: lambda.Function;
    readonly japanCollector: lambda.Function;
    readonly socialCollector: lambda.Function;
    readonly streamProcessor: lambda.Function;
    readonly collectorRole: iam.Role;
    readonly firehoseRole: iam.Role;
    readonly apiSecretsArn: string;
    constructor(scope: Construct, id: string, config?: DataPipelineConfig);
}
export {};
