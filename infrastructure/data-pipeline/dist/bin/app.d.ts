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
