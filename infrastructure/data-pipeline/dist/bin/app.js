#!/usr/bin/env node
"use strict";
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
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const data_pipeline_stack_1 = require("../lib/data-pipeline-stack");
const api_stack_1 = require("../lib/api-stack");
const orchestration_stack_1 = require("../lib/orchestration-stack");
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
const dataPipelineStack = new data_pipeline_stack_1.DataPipelineStack(app, "TcgDataPipelineStack", {
    env,
    description: "TCG Data Pipeline - Data collection, storage, and processing infrastructure",
    tags,
});
// =============================================================================
// API STACK
// =============================================================================
const apiStack = new api_stack_1.ApiStack(app, "TcgApiStack", {
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
const orchestrationStack = new orchestration_stack_1.OrchestrationStack(app, "TcgOrchestrationStack", {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vYmluL2FwcC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUNBOzs7Ozs7Ozs7Ozs7O0dBYUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsdUNBQXFDO0FBQ3JDLGlEQUFtQztBQUNuQyxvRUFBK0Q7QUFDL0QsZ0RBQTRDO0FBQzVDLG9FQUFnRTtBQUVoRSxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUUxQiw0QkFBNEI7QUFDNUIsTUFBTSxHQUFHLEdBQUc7SUFDVixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWM7SUFDdEUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVztDQUN0RCxDQUFDO0FBRUYsaUNBQWlDO0FBQ2pDLE1BQU0sSUFBSSxHQUFHO0lBQ1gsT0FBTyxFQUFFLGtCQUFrQjtJQUMzQixXQUFXLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksYUFBYTtJQUNyRCxTQUFTLEVBQUUsS0FBSztDQUNqQixDQUFDO0FBRUYsZ0ZBQWdGO0FBQ2hGLHNCQUFzQjtBQUN0QixnRkFBZ0Y7QUFFaEYsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLHVDQUFpQixDQUFDLEdBQUcsRUFBRSxzQkFBc0IsRUFBRTtJQUMzRSxHQUFHO0lBQ0gsV0FBVyxFQUFFLDZFQUE2RTtJQUMxRixJQUFJO0NBQ0wsQ0FBQyxDQUFDO0FBRUgsZ0ZBQWdGO0FBQ2hGLFlBQVk7QUFDWixnRkFBZ0Y7QUFFaEYsTUFBTSxRQUFRLEdBQUcsSUFBSSxvQkFBUSxDQUFDLEdBQUcsRUFBRSxhQUFhLEVBQUU7SUFDaEQsR0FBRztJQUNILFdBQVcsRUFBRSw2REFBNkQ7SUFDMUUsSUFBSTtJQUVKLCtDQUErQztJQUMvQyxrQkFBa0IsRUFBRSxpQkFBaUIsQ0FBQyxrQkFBa0IsQ0FBQyxTQUFTO0lBQ2xFLGNBQWMsRUFBRSxpQkFBaUIsQ0FBQyxjQUFjLENBQUMsU0FBUztJQUMxRCxrQkFBa0IsRUFBRSxpQkFBaUIsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHO0lBRTVELDhEQUE4RDtJQUM5RCxjQUFjLEVBQUUscUJBQXFCO0lBQ3JDLGVBQWUsRUFBRSxzQkFBc0I7SUFDdkMsY0FBYyxFQUFFLHFCQUFxQjtDQUN0QyxDQUFDLENBQUM7QUFFSCwrQ0FBK0M7QUFDL0MsUUFBUSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0FBRTFDLGdGQUFnRjtBQUNoRixzQkFBc0I7QUFDdEIsZ0ZBQWdGO0FBRWhGLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSx3Q0FBa0IsQ0FBQyxHQUFHLEVBQUUsdUJBQXVCLEVBQUU7SUFDOUUsR0FBRztJQUNILFdBQVcsRUFBRSx1RUFBdUU7SUFDcEYsSUFBSTtJQUVKLGlCQUFpQjtJQUNqQixtQkFBbUIsRUFBRSx1QkFBdUI7SUFDNUMscUJBQXFCLEVBQUUseUJBQXlCO0lBQ2hELGNBQWMsRUFBRSxrQkFBa0I7SUFDbEMsaUJBQWlCLEVBQUUscUJBQXFCO0lBRXhDLHdCQUF3QjtJQUN4QixjQUFjLEVBQUU7UUFDZCxpQkFBaUIsQ0FBQyxrQkFBa0IsQ0FBQyxXQUFXO1FBQ2hELGlCQUFpQixDQUFDLG1CQUFtQixDQUFDLFdBQVc7UUFDakQsaUJBQWlCLENBQUMsYUFBYSxDQUFDLFdBQVc7UUFDM0MsaUJBQWlCLENBQUMsY0FBYyxDQUFDLFdBQVc7S0FDN0M7SUFFRCxxQkFBcUI7SUFDckIsb0JBQW9CLEVBQUUsMEJBQTBCO0lBRWhELGdCQUFnQjtJQUNoQixVQUFVLEVBQUUsaUJBQWlCLENBQUMsVUFBVTtJQUV4QyxLQUFLO0lBQ0wsY0FBYyxFQUFFLGlCQUFpQixDQUFDLFVBQVUsQ0FBQyxVQUFVO0NBQ3hELENBQUMsQ0FBQztBQUVILHlEQUF5RDtBQUN6RCxrQkFBa0IsQ0FBQyxhQUFhLENBQUMsaUJBQWlCLENBQUMsQ0FBQztBQUVwRCxnRkFBZ0Y7QUFDaEYsd0JBQXdCO0FBQ3hCLGdGQUFnRjtBQUVoRix3Q0FBd0M7QUFDeEMsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLGlCQUFpQixFQUFFLGVBQWUsRUFBRTtJQUNwRCxLQUFLLEVBQUUsaUJBQWlCLENBQUMsVUFBVSxDQUFDLFNBQVM7SUFDN0MsVUFBVSxFQUFFLGtCQUFrQjtDQUMvQixDQUFDLENBQUM7QUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsaUJBQWlCLEVBQUUsZ0JBQWdCLEVBQUU7SUFDckQsS0FBSyxFQUFFLGlCQUFpQixDQUFDLFdBQVcsQ0FBQyxTQUFTO0lBQzlDLFVBQVUsRUFBRSxtQkFBbUI7Q0FDaEMsQ0FBQyxDQUFDO0FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSxRQUFRLEVBQUU7SUFDcEMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRztJQUN2QixVQUFVLEVBQUUsV0FBVztDQUN4QixDQUFDLENBQUM7QUFFSCxnRkFBZ0Y7QUFDaEYsY0FBYztBQUNkLGdGQUFnRjtBQUVoRixnREFBZ0Q7QUFDaEQsR0FBRyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsa0JBQWtCLENBQUMsQ0FBQyxDQUFDO0FBQ3BFLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFFekQscUJBQXFCO0FBQ3JCLEdBQUcsQ0FBQyxLQUFLLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbi8qKlxuICogVENHIERhdGEgUGlwZWxpbmUgQ0RLIEFwcGxpY2F0aW9uXG4gKlxuICogRGVwbG95cyB0aGUgY29tcGxldGUgTUwtcG93ZXJlZCBwcmljaW5nIGluZnJhc3RydWN0dXJlOlxuICogLSBEYXRhIFBpcGVsaW5lIFN0YWNrIChTMywgS2luZXNpcywgRHluYW1vREIsIFRpbWVzdHJlYW0sIExhbWJkYSBjb2xsZWN0b3JzKVxuICogLSBBUEkgU3RhY2sgKEFQSSBHYXRld2F5LCBXQUYpXG4gKiAtIE9yY2hlc3RyYXRpb24gU3RhY2sgKFN0ZXAgRnVuY3Rpb25zKVxuICpcbiAqIFVzYWdlOlxuICogICBjZGsgZGVwbG95IC0tYWxsXG4gKiAgIGNkayBkZXBsb3kgVGNnRGF0YVBpcGVsaW5lU3RhY2tcbiAqICAgY2RrIGRlcGxveSBUY2dBcGlTdGFja1xuICogICBjZGsgZGVwbG95IFRjZ09yY2hlc3RyYXRpb25TdGFja1xuICovXG5cbmltcG9ydCBcInNvdXJjZS1tYXAtc3VwcG9ydC9yZWdpc3RlclwiO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgRGF0YVBpcGVsaW5lU3RhY2sgfSBmcm9tIFwiLi4vbGliL2RhdGEtcGlwZWxpbmUtc3RhY2tcIjtcbmltcG9ydCB7IEFwaVN0YWNrIH0gZnJvbSBcIi4uL2xpYi9hcGktc3RhY2tcIjtcbmltcG9ydCB7IE9yY2hlc3RyYXRpb25TdGFjayB9IGZyb20gXCIuLi9saWIvb3JjaGVzdHJhdGlvbi1zdGFja1wiO1xuXG5jb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuXG4vLyBFbnZpcm9ubWVudCBjb25maWd1cmF0aW9uXG5jb25zdCBlbnYgPSB7XG4gIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQgfHwgcHJvY2Vzcy5lbnYuQVdTX0FDQ09VTlRfSUQsXG4gIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OIHx8IFwidXMtZWFzdC0xXCIsXG59O1xuXG4vLyBUYWdzIHRvIGFwcGx5IHRvIGFsbCByZXNvdXJjZXNcbmNvbnN0IHRhZ3MgPSB7XG4gIFByb2plY3Q6IFwiVENHLURhdGFQaXBlbGluZVwiLFxuICBFbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuRU5WSVJPTk1FTlQgfHwgXCJkZXZlbG9wbWVudFwiLFxuICBNYW5hZ2VkQnk6IFwiQ0RLXCIsXG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gREFUQSBQSVBFTElORSBTVEFDS1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuY29uc3QgZGF0YVBpcGVsaW5lU3RhY2sgPSBuZXcgRGF0YVBpcGVsaW5lU3RhY2soYXBwLCBcIlRjZ0RhdGFQaXBlbGluZVN0YWNrXCIsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogXCJUQ0cgRGF0YSBQaXBlbGluZSAtIERhdGEgY29sbGVjdGlvbiwgc3RvcmFnZSwgYW5kIHByb2Nlc3NpbmcgaW5mcmFzdHJ1Y3R1cmVcIixcbiAgdGFncyxcbn0pO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQVBJIFNUQUNLXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5jb25zdCBhcGlTdGFjayA9IG5ldyBBcGlTdGFjayhhcHAsIFwiVGNnQXBpU3RhY2tcIiwge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiBcIlRDRyBEYXRhIFBpcGVsaW5lIC0gUkVTVCBBUEkgZm9yIHByaWNlIGRhdGEgYW5kIHByZWRpY3Rpb25zXCIsXG4gIHRhZ3MsXG5cbiAgLy8gUmVmZXJlbmNlIHJlc291cmNlcyBmcm9tIGRhdGEgcGlwZWxpbmUgc3RhY2tcbiAgY3VycmVudFByaWNlc1RhYmxlOiBkYXRhUGlwZWxpbmVTdGFjay5jdXJyZW50UHJpY2VzVGFibGUudGFibGVOYW1lLFxuICBhcmJpdHJhZ2VUYWJsZTogZGF0YVBpcGVsaW5lU3RhY2suYXJiaXRyYWdlVGFibGUudGFibGVOYW1lLFxuICB0aW1lc3RyZWFtRGF0YWJhc2U6IGRhdGFQaXBlbGluZVN0YWNrLnRpbWVzdHJlYW1EYXRhYmFzZS5yZWYsXG5cbiAgLy8gU2FnZU1ha2VyIGVuZHBvaW50cyAod2lsbCBiZSBjcmVhdGVkIGJ5IFNhZ2VNYWtlciBQaXBlbGluZSlcbiAgZGVtYW5kRW5kcG9pbnQ6IFwidGNnLWRlbWFuZC1lbmRwb2ludFwiLFxuICBhbm9tYWx5RW5kcG9pbnQ6IFwidGNnLWFub21hbHktZW5kcG9pbnRcIixcbiAgdGltaW5nRW5kcG9pbnQ6IFwidGNnLXRpbWluZy1lbmRwb2ludFwiLFxufSk7XG5cbi8vIEVuc3VyZSBBUEkgc3RhY2sgZGVwbG95cyBhZnRlciBkYXRhIHBpcGVsaW5lXG5hcGlTdGFjay5hZGREZXBlbmRlbmN5KGRhdGFQaXBlbGluZVN0YWNrKTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE9SQ0hFU1RSQVRJT04gU1RBQ0tcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmNvbnN0IG9yY2hlc3RyYXRpb25TdGFjayA9IG5ldyBPcmNoZXN0cmF0aW9uU3RhY2soYXBwLCBcIlRjZ09yY2hlc3RyYXRpb25TdGFja1wiLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246IFwiVENHIERhdGEgUGlwZWxpbmUgLSBTdGVwIEZ1bmN0aW9ucyBvcmNoZXN0cmF0aW9uIGZvciBFVEwgYW5kIHRyYWluaW5nXCIsXG4gIHRhZ3MsXG5cbiAgLy8gR2x1ZSBqb2IgbmFtZXNcbiAgcHJpY2VBZ2dyZWdhdGlvbkpvYjogXCJ0Y2ctcHJpY2UtYWdncmVnYXRpb25cIixcbiAgZmVhdHVyZUVuZ2luZWVyaW5nSm9iOiBcInRjZy1mZWF0dXJlLWVuZ2luZWVyaW5nXCIsXG4gIGRhdGFRdWFsaXR5Sm9iOiBcInRjZy1kYXRhLXF1YWxpdHlcIixcbiAgbWFya2V0QW5hbHlzaXNKb2I6IFwidGNnLW1hcmtldC1hbmFseXNpc1wiLFxuXG4gIC8vIExhbWJkYSBjb2xsZWN0b3IgQVJOc1xuICBjb2xsZWN0b3JzQXJuczogW1xuICAgIGRhdGFQaXBlbGluZVN0YWNrLnRjZ3BsYXllckNvbGxlY3Rvci5mdW5jdGlvbkFybixcbiAgICBkYXRhUGlwZWxpbmVTdGFjay5jYXJkbWFya2V0Q29sbGVjdG9yLmZ1bmN0aW9uQXJuLFxuICAgIGRhdGFQaXBlbGluZVN0YWNrLmViYXlDb2xsZWN0b3IuZnVuY3Rpb25Bcm4sXG4gICAgZGF0YVBpcGVsaW5lU3RhY2suamFwYW5Db2xsZWN0b3IuZnVuY3Rpb25Bcm4sXG4gIF0sXG5cbiAgLy8gU2FnZU1ha2VyIHBpcGVsaW5lXG4gIHRyYWluaW5nUGlwZWxpbmVOYW1lOiBcInRjZy1tbC10cmFpbmluZy1waXBlbGluZVwiLFxuXG4gIC8vIE5vdGlmaWNhdGlvbnNcbiAgYWxlcnRUb3BpYzogZGF0YVBpcGVsaW5lU3RhY2suYWxlcnRUb3BpYyxcblxuICAvLyBTM1xuICBkYXRhQnVja2V0TmFtZTogZGF0YVBpcGVsaW5lU3RhY2suZGF0YUJ1Y2tldC5idWNrZXROYW1lLFxufSk7XG5cbi8vIEVuc3VyZSBvcmNoZXN0cmF0aW9uIHN0YWNrIGRlcGxveXMgYWZ0ZXIgZGF0YSBwaXBlbGluZVxub3JjaGVzdHJhdGlvblN0YWNrLmFkZERlcGVuZGVuY3koZGF0YVBpcGVsaW5lU3RhY2spO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU1RBQ0sgT1VUUFVUUyBTVU1NQVJZXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBBZGQgY3Jvc3Mtc3RhY2sgcmVmZXJlbmNlcyBhcyBvdXRwdXRzXG5uZXcgY2RrLkNmbk91dHB1dChkYXRhUGlwZWxpbmVTdGFjaywgXCJEYXRhQnVja2V0QXJuXCIsIHtcbiAgdmFsdWU6IGRhdGFQaXBlbGluZVN0YWNrLmRhdGFCdWNrZXQuYnVja2V0QXJuLFxuICBleHBvcnROYW1lOiBcIlRjZ0RhdGFCdWNrZXRBcm5cIixcbn0pO1xuXG5uZXcgY2RrLkNmbk91dHB1dChkYXRhUGlwZWxpbmVTdGFjaywgXCJQcmljZVN0cmVhbUFyblwiLCB7XG4gIHZhbHVlOiBkYXRhUGlwZWxpbmVTdGFjay5wcmljZVN0cmVhbS5zdHJlYW1Bcm4sXG4gIGV4cG9ydE5hbWU6IFwiVGNnUHJpY2VTdHJlYW1Bcm5cIixcbn0pO1xuXG5uZXcgY2RrLkNmbk91dHB1dChhcGlTdGFjaywgXCJBcGlVcmxcIiwge1xuICB2YWx1ZTogYXBpU3RhY2suYXBpLnVybCxcbiAgZXhwb3J0TmFtZTogXCJUY2dBcGlVcmxcIixcbn0pO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ0RLIEFTUEVDVFNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIEFkZCBhc3BlY3RzIGZvciBjb21wbGlhbmNlIGFuZCBiZXN0IHByYWN0aWNlc1xuY2RrLkFzcGVjdHMub2YoYXBwKS5hZGQobmV3IGNkay5UYWcoXCJQcm9qZWN0XCIsIFwiVENHLURhdGFQaXBlbGluZVwiKSk7XG5jZGsuQXNwZWN0cy5vZihhcHApLmFkZChuZXcgY2RrLlRhZyhcIk1hbmFnZWRCeVwiLCBcIkNES1wiKSk7XG5cbi8vIFN5bnRoZXNpemUgdGhlIGFwcFxuYXBwLnN5bnRoKCk7XG4iXX0=