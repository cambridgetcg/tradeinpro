/**
 * Orchestration Stack
 *
 * Defines Step Functions state machines for orchestrating:
 * - Daily ETL pipeline
 * - Weekly training pipeline
 * - On-demand retraining
 * - Data quality monitoring
 */
import * as cdk from "aws-cdk-lib";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";
interface OrchestrationStackProps extends cdk.StackProps {
    priceAggregationJob: string;
    featureEngineeringJob: string;
    dataQualityJob: string;
    marketAnalysisJob: string;
    collectorsArns: string[];
    trainingPipelineName: string;
    alertTopic: sns.ITopic;
    dataBucketName: string;
}
export declare class OrchestrationStack extends cdk.Stack {
    readonly dailyPipeline: sfn.StateMachine;
    readonly trainingPipeline: sfn.StateMachine;
    readonly onDemandPipeline: sfn.StateMachine;
    constructor(scope: Construct, id: string, props: OrchestrationStackProps);
}
export {};
