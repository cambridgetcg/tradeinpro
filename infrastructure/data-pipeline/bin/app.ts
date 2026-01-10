#!/usr/bin/env node
/**
 * TCG Data Pipeline CDK Application
 *
 * Deploys the complete ML-powered pricing infrastructure:
 * - Data Pipeline Stack (S3, Kinesis, DynamoDB, Timestream, Lambda collectors)
 * - API Stack (API Gateway, WAF)
 * - Orchestration Stack (Step Functions)
 *
 * Usage:
 *   cdk deploy --all
 *   cdk deploy TcgDataPipelineStack
 *   cdk deploy TcgApiStack
 *   cdk deploy TcgOrchestrationStack
 */

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DataPipelineStack } from "../lib/data-pipeline-stack";
import { ApiStack } from "../lib/api-stack";
import { OrchestrationStack } from "../lib/orchestration-stack";

const app = new cdk.App();

// Environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || "us-east-1",
};

// Tags to apply to all resources
const tags = {
  Project: "TCG-DataPipeline",
  Environment: process.env.ENVIRONMENT || "development",
  ManagedBy: "CDK",
};

// =============================================================================
// DATA PIPELINE STACK
// =============================================================================

const dataPipelineStack = new DataPipelineStack(app, "TcgDataPipelineStack", {
  env,
  description: "TCG Data Pipeline - Data collection, storage, and processing infrastructure",
  tags,
});

// =============================================================================
// API STACK
// =============================================================================

const apiStack = new ApiStack(app, "TcgApiStack", {
  env,
  description: "TCG Data Pipeline - REST API for price data and predictions",
  tags,

  // Reference resources from data pipeline stack
  currentPricesTable: dataPipelineStack.currentPricesTable.tableName,
  arbitrageTable: dataPipelineStack.arbitrageTable.tableName,
  timestreamDatabase: dataPipelineStack.timestreamDatabase.ref,

  // SageMaker endpoints (will be created by SageMaker Pipeline)
  demandEndpoint: "tcg-demand-endpoint",
  anomalyEndpoint: "tcg-anomaly-endpoint",
  timingEndpoint: "tcg-timing-endpoint",
});

// Ensure API stack deploys after data pipeline
apiStack.addDependency(dataPipelineStack);

// =============================================================================
// ORCHESTRATION STACK
// =============================================================================

const orchestrationStack = new OrchestrationStack(app, "TcgOrchestrationStack", {
  env,
  description: "TCG Data Pipeline - Step Functions orchestration for ETL and training",
  tags,

  // Glue job names
  priceAggregationJob: "tcg-price-aggregation",
  featureEngineeringJob: "tcg-feature-engineering",
  dataQualityJob: "tcg-data-quality",
  marketAnalysisJob: "tcg-market-analysis",

  // Lambda collector ARNs
  collectorsArns: [
    dataPipelineStack.tcgplayerCollector.functionArn,
    dataPipelineStack.cardmarketCollector.functionArn,
    dataPipelineStack.ebayCollector.functionArn,
    dataPipelineStack.japanCollector.functionArn,
  ],

  // SageMaker pipeline
  trainingPipelineName: "tcg-ml-training-pipeline",

  // Notifications
  alertTopic: dataPipelineStack.alertTopic,

  // S3
  dataBucketName: dataPipelineStack.dataBucket.bucketName,
});

// Ensure orchestration stack deploys after data pipeline
orchestrationStack.addDependency(dataPipelineStack);

// =============================================================================
// STACK OUTPUTS SUMMARY
// =============================================================================

// Add cross-stack references as outputs
new cdk.CfnOutput(dataPipelineStack, "DataBucketArn", {
  value: dataPipelineStack.dataBucket.bucketArn,
  exportName: "TcgDataBucketArn",
});

new cdk.CfnOutput(dataPipelineStack, "PriceStreamArn", {
  value: dataPipelineStack.priceStream.streamArn,
  exportName: "TcgPriceStreamArn",
});

new cdk.CfnOutput(apiStack, "ApiUrl", {
  value: apiStack.api.url,
  exportName: "TcgApiUrl",
});

// =============================================================================
// CDK ASPECTS
// =============================================================================

// Add aspects for compliance and best practices
cdk.Aspects.of(app).add(new cdk.Tag("Project", "TCG-DataPipeline"));
cdk.Aspects.of(app).add(new cdk.Tag("ManagedBy", "CDK"));

// Synthesize the app
app.synth();
