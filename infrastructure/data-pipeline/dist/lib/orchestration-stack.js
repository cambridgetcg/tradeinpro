"use strict";
/**
 * Orchestration Stack
 *
 * Defines Step Functions state machines for orchestrating:
 * - Daily ETL pipeline
 * - Weekly training pipeline
 * - On-demand retraining
 * - Data quality monitoring
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
exports.OrchestrationStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const sfn = __importStar(require("aws-cdk-lib/aws-stepfunctions"));
const tasks = __importStar(require("aws-cdk-lib/aws-stepfunctions-tasks"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
class OrchestrationStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // =========================================================================
        // DAILY ETL PIPELINE
        // =========================================================================
        // Step 1: Run Data Quality Check
        const dataQualityStep = new tasks.GlueStartJobRun(this, "DataQualityJob", {
            glueJobName: props.dataQualityJob,
            integrationPattern: sfn.IntegrationPattern.RUN_JOB,
            arguments: sfn.TaskInput.fromObject({
                "--S3_INPUT_PATH": `s3://${props.dataBucketName}/raw`,
                "--S3_OUTPUT_PATH": `s3://${props.dataBucketName}/validated`,
                "--S3_QUARANTINE_PATH": `s3://${props.dataBucketName}/quarantine`,
                "--S3_METRICS_PATH": `s3://${props.dataBucketName}/metrics`,
            }),
            resultPath: "$.dataQualityResult",
        });
        // Step 2: Run Price Aggregation
        const priceAggregationStep = new tasks.GlueStartJobRun(this, "PriceAggregationJob", {
            glueJobName: props.priceAggregationJob,
            integrationPattern: sfn.IntegrationPattern.RUN_JOB,
            arguments: sfn.TaskInput.fromObject({
                "--S3_INPUT_PATH": `s3://${props.dataBucketName}/validated`,
                "--S3_OUTPUT_PATH": `s3://${props.dataBucketName}/processed`,
                "--CATALOG_DATABASE": "tcg_data_lake",
                "--PROCESSING_DATE.$": "$$.Execution.Input.processingDate",
            }),
            resultPath: "$.priceAggregationResult",
        });
        // Step 3: Run Feature Engineering
        const featureEngineeringStep = new tasks.GlueStartJobRun(this, "FeatureEngineeringJob", {
            glueJobName: props.featureEngineeringJob,
            integrationPattern: sfn.IntegrationPattern.RUN_JOB,
            arguments: sfn.TaskInput.fromObject({
                "--S3_PROCESSED_PATH": `s3://${props.dataBucketName}/processed`,
                "--S3_FEATURES_PATH": `s3://${props.dataBucketName}/features`,
                "--CATALOG_DATABASE": "tcg_data_lake",
                "--TRAINING_WINDOW_DAYS": "90",
            }),
            resultPath: "$.featureEngineeringResult",
        });
        // Step 4: Run Market Analysis
        const marketAnalysisStep = new tasks.GlueStartJobRun(this, "MarketAnalysisJob", {
            glueJobName: props.marketAnalysisJob,
            integrationPattern: sfn.IntegrationPattern.RUN_JOB,
            arguments: sfn.TaskInput.fromObject({
                "--S3_PROCESSED_PATH": `s3://${props.dataBucketName}/processed`,
                "--S3_ANALYTICS_PATH": `s3://${props.dataBucketName}/analytics`,
                "--CATALOG_DATABASE": "tcg_data_lake",
                "--ANALYSIS_DATE.$": "$$.Execution.Input.processingDate",
            }),
            resultPath: "$.marketAnalysisResult",
        });
        // Success notification
        const successNotification = new tasks.SnsPublish(this, "DailyPipelineSuccess", {
            topic: props.alertTopic,
            subject: "[TCG Pipeline] Daily ETL Completed Successfully",
            message: sfn.TaskInput.fromObject({
                status: "SUCCESS",
                executionId: sfn.JsonPath.stringAt("$$.Execution.Id"),
                completedAt: sfn.JsonPath.stringAt("$$.State.EnteredTime"),
            }),
        });
        // Failure notification
        const failureNotification = new tasks.SnsPublish(this, "DailyPipelineFailure", {
            topic: props.alertTopic,
            subject: "[TCG Pipeline] Daily ETL Failed",
            message: sfn.TaskInput.fromObject({
                status: "FAILED",
                executionId: sfn.JsonPath.stringAt("$$.Execution.Id"),
                error: sfn.JsonPath.stringAt("$.error"),
            }),
        });
        // Define daily pipeline
        const dailyPipelineDefinition = dataQualityStep
            .addCatch(failureNotification, { resultPath: "$.error" })
            .next(priceAggregationStep)
            .addCatch(failureNotification, { resultPath: "$.error" })
            .next(new sfn.Parallel(this, "ParallelProcessing")
            .branch(featureEngineeringStep)
            .branch(marketAnalysisStep)
            .addCatch(failureNotification, { resultPath: "$.error" }))
            .next(successNotification);
        this.dailyPipeline = new sfn.StateMachine(this, "DailyETLPipeline", {
            definition: dailyPipelineDefinition,
            timeout: cdk.Duration.hours(6),
            stateMachineName: "tcg-daily-etl-pipeline",
        });
        // Schedule daily at 2 AM UTC
        new events.Rule(this, "DailyETLSchedule", {
            schedule: events.Schedule.cron({ hour: "2", minute: "0" }),
            targets: [
                new targets.SfnStateMachine(this.dailyPipeline, {
                    input: events.RuleTargetInput.fromObject({
                        processingDate: events.EventField.time,
                    }),
                }),
            ],
        });
        // =========================================================================
        // WEEKLY TRAINING PIPELINE
        // =========================================================================
        // Step 1: Check if new training data is available
        const checkTrainingData = new sfn.Pass(this, "CheckTrainingData", {
            result: sfn.Result.fromObject({ hasNewData: true }),
            resultPath: "$.dataCheck",
        });
        // Step 2: Start SageMaker Pipeline
        const startTraining = new tasks.CallAwsService(this, "StartSageMakerPipeline", {
            service: "sagemaker",
            action: "startPipelineExecution",
            parameters: {
                PipelineName: props.trainingPipelineName,
                PipelineExecutionDisplayName: sfn.JsonPath.format("weekly-training-{}", sfn.JsonPath.stringAt("$$.Execution.Name")),
                PipelineParameters: [
                    { Name: "ProcessingInstanceType", Value: "ml.m5.xlarge" },
                    { Name: "TrainingInstanceType", Value: "ml.m5.xlarge" },
                    { Name: "ModelApprovalStatus", Value: "PendingManualApproval" },
                ],
            },
            iamResources: ["*"],
            resultPath: "$.trainingResult",
        });
        // Step 3: Wait for training completion
        const waitForTraining = new sfn.Wait(this, "WaitForTraining", {
            time: sfn.WaitTime.duration(cdk.Duration.minutes(30)),
        });
        // Step 4: Check training status
        const checkTrainingStatus = new tasks.CallAwsService(this, "CheckTrainingStatus", {
            service: "sagemaker",
            action: "describePipelineExecution",
            parameters: {
                PipelineExecutionArn: sfn.JsonPath.stringAt("$.trainingResult.PipelineExecutionArn"),
            },
            iamResources: ["*"],
            resultPath: "$.pipelineStatus",
        });
        // Choice: Is training complete?
        const isTrainingComplete = new sfn.Choice(this, "IsTrainingComplete")
            .when(sfn.Condition.stringEquals("$.pipelineStatus.PipelineExecutionStatus", "Succeeded"), new tasks.SnsPublish(this, "TrainingSuccess", {
            topic: props.alertTopic,
            subject: "[TCG Pipeline] Weekly Training Completed",
            message: sfn.TaskInput.fromText("Model training completed successfully"),
        }))
            .when(sfn.Condition.stringEquals("$.pipelineStatus.PipelineExecutionStatus", "Failed"), new tasks.SnsPublish(this, "TrainingFailed", {
            topic: props.alertTopic,
            subject: "[TCG Pipeline] Weekly Training Failed",
            message: sfn.TaskInput.fromJsonPathAt("$.pipelineStatus"),
        }))
            .otherwise(waitForTraining.next(checkTrainingStatus));
        // Define training pipeline
        const trainingPipelineDefinition = checkTrainingData
            .next(startTraining)
            .next(waitForTraining)
            .next(checkTrainingStatus)
            .next(isTrainingComplete);
        this.trainingPipeline = new sfn.StateMachine(this, "WeeklyTrainingPipeline", {
            definition: trainingPipelineDefinition,
            timeout: cdk.Duration.hours(12),
            stateMachineName: "tcg-weekly-training-pipeline",
        });
        // Schedule weekly on Sunday at 6 AM UTC
        new events.Rule(this, "WeeklyTrainingSchedule", {
            schedule: events.Schedule.cron({ weekDay: "SUN", hour: "6", minute: "0" }),
            targets: [new targets.SfnStateMachine(this.trainingPipeline)],
        });
        // =========================================================================
        // ON-DEMAND FULL PIPELINE
        // =========================================================================
        // Combines data collection, ETL, and training in one pipeline
        const collectDataStep = new sfn.Parallel(this, "CollectData")
            .branch(new tasks.LambdaInvoke(this, "InvokeTCGplayer", {
            lambdaFunction: lambda.Function.fromFunctionArn(this, "TCGplayerFn", props.collectorsArns[0] || ""),
            resultPath: "$.tcgplayerResult",
        }))
            .branch(new tasks.LambdaInvoke(this, "InvokeCardmarket", {
            lambdaFunction: lambda.Function.fromFunctionArn(this, "CardmarketFn", props.collectorsArns[1] || ""),
            resultPath: "$.cardmarketResult",
        }))
            .branch(new tasks.LambdaInvoke(this, "InvokeEbay", {
            lambdaFunction: lambda.Function.fromFunctionArn(this, "EbayFn", props.collectorsArns[2] || ""),
            resultPath: "$.ebayResult",
        }));
        // Wait for data to settle
        const waitForData = new sfn.Wait(this, "WaitForDataSettling", {
            time: sfn.WaitTime.duration(cdk.Duration.minutes(5)),
        });
        // Choice: Should retrain?
        const shouldRetrainChoice = new sfn.Choice(this, "ShouldRetrain")
            .when(sfn.Condition.booleanEquals("$.retrain", true), new sfn.Pass(this, "PrepareForRetraining"))
            .otherwise(new tasks.SnsPublish(this, "OnDemandComplete", {
            topic: props.alertTopic,
            subject: "[TCG Pipeline] On-Demand Pipeline Complete",
            message: sfn.TaskInput.fromText("On-demand data refresh completed"),
        }));
        // Define on-demand pipeline
        const onDemandDefinition = collectDataStep
            .next(waitForData)
            .next(dataQualityStep)
            .next(priceAggregationStep)
            .next(featureEngineeringStep)
            .next(marketAnalysisStep)
            .next(shouldRetrainChoice);
        this.onDemandPipeline = new sfn.StateMachine(this, "OnDemandPipeline", {
            definition: onDemandDefinition,
            timeout: cdk.Duration.hours(8),
            stateMachineName: "tcg-on-demand-pipeline",
        });
        // =========================================================================
        // OUTPUTS
        // =========================================================================
        new cdk.CfnOutput(this, "DailyPipelineArn", {
            value: this.dailyPipeline.stateMachineArn,
            description: "Daily ETL Pipeline ARN",
        });
        new cdk.CfnOutput(this, "TrainingPipelineArn", {
            value: this.trainingPipeline.stateMachineArn,
            description: "Weekly Training Pipeline ARN",
        });
        new cdk.CfnOutput(this, "OnDemandPipelineArn", {
            value: this.onDemandPipeline.stateMachineArn,
            description: "On-Demand Pipeline ARN",
        });
    }
}
exports.OrchestrationStack = OrchestrationStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JjaGVzdHJhdGlvbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL2xpYi9vcmNoZXN0cmF0aW9uLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7R0FRRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsaURBQW1DO0FBQ25DLG1FQUFxRDtBQUNyRCwyRUFBNkQ7QUFDN0QsK0RBQWlEO0FBRWpELCtEQUFpRDtBQUNqRCx3RUFBMEQ7QUF5QjFELE1BQWEsa0JBQW1CLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFLL0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUE4QjtRQUN0RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qiw0RUFBNEU7UUFDNUUscUJBQXFCO1FBQ3JCLDRFQUE0RTtRQUU1RSxpQ0FBaUM7UUFDakMsTUFBTSxlQUFlLEdBQUcsSUFBSSxLQUFLLENBQUMsZUFBZSxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4RSxXQUFXLEVBQUUsS0FBSyxDQUFDLGNBQWM7WUFDakMsa0JBQWtCLEVBQUUsR0FBRyxDQUFDLGtCQUFrQixDQUFDLE9BQU87WUFDbEQsU0FBUyxFQUFFLEdBQUcsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDO2dCQUNsQyxpQkFBaUIsRUFBRSxRQUFRLEtBQUssQ0FBQyxjQUFjLE1BQU07Z0JBQ3JELGtCQUFrQixFQUFFLFFBQVEsS0FBSyxDQUFDLGNBQWMsWUFBWTtnQkFDNUQsc0JBQXNCLEVBQUUsUUFBUSxLQUFLLENBQUMsY0FBYyxhQUFhO2dCQUNqRSxtQkFBbUIsRUFBRSxRQUFRLEtBQUssQ0FBQyxjQUFjLFVBQVU7YUFDNUQsQ0FBQztZQUNGLFVBQVUsRUFBRSxxQkFBcUI7U0FDbEMsQ0FBQyxDQUFDO1FBRUgsZ0NBQWdDO1FBQ2hDLE1BQU0sb0JBQW9CLEdBQUcsSUFBSSxLQUFL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RUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUM3QyxLQUFLLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLGVBQWU7WUFDNUMsV0FBVyxFQUFFLDhCQUE4QjtTQUM1QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQzdDLEtBQUssRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsZUFBZTtZQUM1QyxXQUFXLEVBQUUsd0JBQXdCO1NBQ3RDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXBTRCxnREFvU0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9yY2hlc3RyYXRpb24gU3RhY2tcbiAqXG4gKiBEZWZpbmVzIFN0ZXAgRnVuY3Rpb25zIHN0YXRlIG1hY2hpbmVzIGZvciBvcmNoZXN0cmF0aW5nOlxuICogLSBEYWlseSBFVEwgcGlwZWxpbmVcbiAqIC0gV2Vla2x5IHRyYWluaW5nIHBpcGVsaW5lXG4gKiAtIE9uLWRlbWFuZCByZXRyYWluaW5nXG4gKiAtIERhdGEgcXVhbGl0eSBtb25pdG9yaW5nXG4gKi9cblxuaW1wb3J0ICogYXMgY2RrIGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0ICogYXMgc2ZuIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9uc1wiO1xuaW1wb3J0ICogYXMgdGFza3MgZnJvbSBcImF3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zLXRhc2tzXCI7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGFcIjtcbmltcG9ydCAqIGFzIGdsdWUgZnJvbSBcImF3cy1jZGstbGliL2F3cy1nbHVlXCI7XG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1ldmVudHNcIjtcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0c1wiO1xuaW1wb3J0ICogYXMgc25zIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc25zXCI7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5cbmludGVyZmFjZSBPcmNoZXN0cmF0aW9uU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLy8gR2x1ZSBqb2JzXG4gIHByaWNlQWdncmVnYXRpb25Kb2I6IHN0cmluZztcbiAgZmVhdHVyZUVuZ2luZWVyaW5nSm9iOiBzdHJpbmc7XG4gIGRhdGFRdWFsaXR5Sm9iOiBzdHJpbmc7XG4gIG1hcmtldEFuYWx5c2lzSm9iOiBzdHJpbmc7XG5cbiAgLy8gTGFtYmRhIGZ1bmN0aW9uc1xuICBjb2xsZWN0b3JzQXJuczogc3RyaW5nW107XG5cbiAgLy8gU2FnZU1ha2VyXG4gIHRyYWluaW5nUGlwZWxpbmVOYW1lOiBzdHJpbmc7XG5cbiAgLy8gTm90aWZpY2F0aW9uc1xuICBhbGVydFRvcGljOiBzbnMuSVRvcGljO1xuXG4gIC8vIFMzXG4gIGRhdGFCdWNrZXROYW1lOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBPcmNoZXN0cmF0aW9uU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgZGFpbHlQaXBlbGluZTogc2ZuLlN0YXRlTWFjaGluZTtcbiAgcHVibGljIHJlYWRvbmx5IHRyYWluaW5nUGlwZWxpbmU6IHNmbi5TdGF0ZU1hY2hpbmU7XG4gIHB1YmxpYyByZWFkb25seSBvbkRlbWFuZFBpcGVsaW5lOiBzZm4uU3RhdGVNYWNoaW5lO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBPcmNoZXN0cmF0aW9uU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIERBSUxZIEVUTCBQSVBFTElORVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIFN0ZXAgMTogUnVuIERhdGEgUXVhbGl0eSBDaGVja1xuICAgIGNvbnN0IGRhdGFRdWFsaXR5U3RlcCA9IG5ldyB0YXNrcy5HbHVlU3RhcnRKb2JSdW4odGhpcywgXCJEYXRhUXVhbGl0eUpvYlwiLCB7XG4gICAgICBnbHVlSm9iTmFtZTogcHJvcHMuZGF0YVF1YWxpdHlKb2IsXG4gICAgICBpbnRlZ3JhdGlvblBhdHRlcm46IHNmbi5JbnRlZ3JhdGlvblBhdHRlcm4uUlVOX0pPQixcbiAgICAgIGFyZ3VtZW50czogc2ZuLlRhc2tJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgXCItLVMzX0lOUFVUX1BBVEhcIjogYHMzOi8vJHtwcm9wcy5kYXRhQnVja2V0TmFtZX0vcmF3YCxcbiAgICAgICAgXCItLVMzX09VVFBVVF9QQVRIXCI6IGBzMzovLyR7cHJvcHMuZGF0YUJ1Y2tldE5hbWV9L3ZhbGlkYXRlZGAsXG4gICAgICAgIFwiLS1TM19RVUFSQU5USU5FX1BBVEhcIjogYHMzOi8vJHtwcm9wcy5kYXRhQnVja2V0TmFtZX0vcXVhcmFudGluZWAsXG4gICAgICAgIFwiLS1TM19NRVRSSUNTX1BBVEhcIjogYHMzOi8vJHtwcm9wcy5kYXRhQnVja2V0TmFtZX0vbWV0cmljc2AsXG4gICAgICB9KSxcbiAgICAgIHJlc3VsdFBhdGg6IFwiJC5kYXRhUXVhbGl0eVJlc3VsdFwiLFxuICAgIH0pO1xuXG4gICAgLy8gU3RlcCAyOiBSdW4gUHJpY2UgQWdncmVnYXRpb25cbiAgICBjb25zdCBwcmljZUFnZ3JlZ2F0aW9uU3RlcCA9IG5ldyB0YXNrcy5HbHVlU3RhcnRKb2JSdW4odGhpcywgXCJQcmljZUFnZ3JlZ2F0aW9uSm9iXCIsIHtcbiAgICAgIGdsdWVKb2JOYW1lOiBwcm9wcy5wcmljZUFnZ3JlZ2F0aW9uSm9iLFxuICAgICAgaW50ZWdyYXRpb25QYXR0ZXJuOiBzZm4uSW50ZWdyYXRpb25QYXR0ZXJuLlJVTl9KT0IsXG4gICAgICBhcmd1bWVudHM6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIFwiLS1TM19JTlBVVF9QQVRIXCI6IGBzMzovLyR7cHJvcHMuZGF0YUJ1Y2tldE5hbWV9L3ZhbGlkYXRlZGAsXG4gICAgICAgIFwiLS1TM19PVVRQVVRfUEFUSFwiOiBgczM6Ly8ke3Byb3BzLmRhdGFCdWNrZXROYW1lfS9wcm9jZXNzZWRgLFxuICAgICAgICBcIi0tQ0FUQUxPR19EQVRBQkFTRVwiOiBcInRjZ19kYXRhX2xha2VcIixcbiAgICAgICAgXCItLVBST0NFU1NJTkdfREFURS4kXCI6IFwiJCQuRXhlY3V0aW9uLklucHV0LnByb2Nlc3NpbmdEYXRlXCIsXG4gICAgICB9KSxcbiAgICAgIHJlc3VsdFBhdGg6IFwiJC5wcmljZUFnZ3JlZ2F0aW9uUmVzdWx0XCIsXG4gICAgfSk7XG5cbiAgICAvLyBTdGVwIDM6IFJ1biBGZWF0dXJlIEVuZ2luZWVyaW5nXG4gICAgY29uc3QgZmVhdHVyZUVuZ2luZWVyaW5nU3RlcCA9IG5ldyB0YXNrcy5HbHVlU3RhcnRKb2JSdW4odGhpcywgXCJGZWF0dXJlRW5naW5lZXJpbmdKb2JcIiwge1xuICAgICAgZ2x1ZUpvYk5hbWU6IHByb3BzLmZlYXR1cmVFbmdpbmVlcmluZ0pvYixcbiAgICAgIGludGVncmF0aW9uUGF0dGVybjogc2ZuLkludGVncmF0aW9uUGF0dGVybi5SVU5fSk9CLFxuICAgICAgYXJndW1lbnRzOiBzZm4uVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBcIi0tUzNfUFJPQ0VTU0VEX1BBVEhcIjogYHMzOi8vJHtwcm9wcy5kYXRhQnVja2V0TmFtZX0vcHJvY2Vzc2VkYCxcbiAgICAgICAgXCItLVMzX0ZFQVRVUkVTX1BBVEhcIjogYHMzOi8vJHtwcm9wcy5kYXRhQnVja2V0TmFtZX0vZmVhdHVyZXNgLFxuICAgICAgICBcIi0tQ0FUQUxPR19EQVRBQkFTRVwiOiBcInRjZ19kYXRhX2xha2VcIixcbiAgICAgICAgXCItLVRSQUlOSU5HX1dJTkRPV19EQVlTXCI6IFwiOTBcIixcbiAgICAgIH0pLFxuICAgICAgcmVzdWx0UGF0aDogXCIkLmZlYXR1cmVFbmdpbmVlcmluZ1Jlc3VsdFwiLFxuICAgIH0pO1xuXG4gICAgLy8gU3RlcCA0OiBSdW4gTWFya2V0IEFuYWx5c2lzXG4gICAgY29uc3QgbWFya2V0QW5hbHlzaXNTdGVwID0gbmV3IHRhc2tzLkdsdWVTdGFydEpvYlJ1bih0aGlzLCBcIk1hcmtldEFuYWx5c2lzSm9iXCIsIHtcbiAgICAgIGdsdWVKb2JOYW1lOiBwcm9wcy5tYXJrZXRBbmFseXNpc0pvYixcbiAgICAgIGludGVncmF0aW9uUGF0dGVybjogc2ZuLkludGVncmF0aW9uUGF0dGVybi5SVU5fSk9CLFxuICAgICAgYXJndW1lbnRzOiBzZm4uVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBcIi0tUzNfUFJPQ0VTU0VEX1BBVEhcIjogYHMzOi8vJHtwcm9wcy5kYXRhQnVja2V0TmFtZX0vcHJvY2Vzc2VkYCxcbiAgICAgICAgXCItLVMzX0FOQUxZVElDU19QQVRIXCI6IGBzMzovLyR7cHJvcHMuZGF0YUJ1Y2tldE5hbWV9L2FuYWx5dGljc2AsXG4gICAgICAgIFwiLS1DQVRBTE9HX0RBVEFCQVNFXCI6IFwidGNnX2RhdGFfbGFrZVwiLFxuICAgICAgICBcIi0tQU5BTFlTSVNfREFURS4kXCI6IFwiJCQuRXhlY3V0aW9uLklucHV0LnByb2Nlc3NpbmdEYXRlXCIsXG4gICAgICB9KSxcbiAgICAgIHJlc3VsdFBhdGg6IFwiJC5tYXJrZXRBbmFseXNpc1Jlc3VsdFwiLFxuICAgIH0pO1xuXG4gICAgLy8gU3VjY2VzcyBub3RpZmljYXRpb25cbiAgICBjb25zdCBzdWNjZXNzTm90aWZpY2F0aW9uID0gbmV3IHRhc2tzLlNuc1B1Ymxpc2godGhpcywgXCJEYWlseVBpcGVsaW5lU3VjY2Vzc1wiLCB7XG4gICAgICB0b3BpYzogcHJvcHMuYWxlcnRUb3BpYyxcbiAgICAgIHN1YmplY3Q6IFwiW1RDRyBQaXBlbGluZV0gRGFpbHkgRVRMIENvbXBsZXRlZCBTdWNjZXNzZnVsbHlcIixcbiAgICAgIG1lc3NhZ2U6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIHN0YXR1czogXCJTVUNDRVNTXCIsXG4gICAgICAgIGV4ZWN1dGlvbklkOiBzZm4uSnNvblBhdGguc3RyaW5nQXQoXCIkJC5FeGVjdXRpb24uSWRcIiksXG4gICAgICAgIGNvbXBsZXRlZEF0OiBzZm4uSnNvblBhdGguc3RyaW5nQXQoXCIkJC5TdGF0ZS5FbnRlcmVkVGltZVwiKSxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgLy8gRmFpbHVyZSBub3RpZmljYXRpb25cbiAgICBjb25zdCBmYWlsdXJlTm90aWZpY2F0aW9uID0gbmV3IHRhc2tzLlNuc1B1Ymxpc2godGhpcywgXCJEYWlseVBpcGVsaW5lRmFpbHVyZVwiLCB7XG4gICAgICB0b3BpYzogcHJvcHMuYWxlcnRUb3BpYyxcbiAgICAgIHN1YmplY3Q6IFwiW1RDRyBQaXBlbGluZV0gRGFpbHkgRVRMIEZhaWxlZFwiLFxuICAgICAgbWVzc2FnZTogc2ZuLlRhc2tJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgc3RhdHVzOiBcIkZBSUxFRFwiLFxuICAgICAgICBleGVjdXRpb25JZDogc2ZuLkpzb25QYXRoLnN0cmluZ0F0KFwiJCQuRXhlY3V0aW9uLklkXCIpLFxuICAgICAgICBlcnJvcjogc2ZuLkpzb25QYXRoLnN0cmluZ0F0KFwiJC5lcnJvclwiKSxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgLy8gRGVmaW5lIGRhaWx5IHBpcGVsaW5lXG4gICAgY29uc3QgZGFpbHlQaXBlbGluZURlZmluaXRpb24gPSBkYXRhUXVhbGl0eVN0ZXBcbiAgICAgIC5hZGRDYXRjaChmYWlsdXJlTm90aWZpY2F0aW9uLCB7IHJlc3VsdFBhdGg6IFwiJC5lcnJvclwiIH0pXG4gICAgICAubmV4dChwcmljZUFnZ3JlZ2F0aW9uU3RlcClcbiAgICAgIC5hZGRDYXRjaChmYWlsdXJlTm90aWZpY2F0aW9uLCB7IHJlc3VsdFBhdGg6IFwiJC5lcnJvclwiIH0pXG4gICAgICAubmV4dChcbiAgICAgICAgbmV3IHNmbi5QYXJhbGxlbCh0aGlzLCBcIlBhcmFsbGVsUHJvY2Vzc2luZ1wiKVxuICAgICAgICAgIC5icmFuY2goZmVhdHVyZUVuZ2luZWVyaW5nU3RlcClcbiAgICAgICAgICAuYnJhbmNoKG1hcmtldEFuYWx5c2lzU3RlcClcbiAgICAgICAgICAuYWRkQ2F0Y2goZmFpbHVyZU5vdGlmaWNhdGlvbiwgeyByZXN1bHRQYXRoOiBcIiQuZXJyb3JcIiB9KVxuICAgICAgKVxuICAgICAgLm5leHQoc3VjY2Vzc05vdGlmaWNhdGlvbik7XG5cbiAgICB0aGlzLmRhaWx5UGlwZWxpbmUgPSBuZXcgc2ZuLlN0YXRlTWFjaGluZSh0aGlzLCBcIkRhaWx5RVRMUGlwZWxpbmVcIiwge1xuICAgICAgZGVmaW5pdGlvbjogZGFpbHlQaXBlbGluZURlZmluaXRpb24sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uaG91cnMoNiksXG4gICAgICBzdGF0ZU1hY2hpbmVOYW1lOiBcInRjZy1kYWlseS1ldGwtcGlwZWxpbmVcIixcbiAgICB9KTtcblxuICAgIC8vIFNjaGVkdWxlIGRhaWx5IGF0IDIgQU0gVVRDXG4gICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsIFwiRGFpbHlFVExTY2hlZHVsZVwiLCB7XG4gICAgICBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLmNyb24oeyBob3VyOiBcIjJcIiwgbWludXRlOiBcIjBcIiB9KSxcbiAgICAgIHRhcmdldHM6IFtcbiAgICAgICAgbmV3IHRhcmdldHMuU2ZuU3RhdGVNYWNoaW5lKHRoaXMuZGFpbHlQaXBlbGluZSwge1xuICAgICAgICAgIGlucHV0OiBldmVudHMuUnVsZVRhcmdldElucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICAgICAgcHJvY2Vzc2luZ0RhdGU6IGV2ZW50cy5FdmVudEZpZWxkLnRpbWUsXG4gICAgICAgICAgfSksXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBXRUVLTFkgVFJBSU5JTkcgUElQRUxJTkVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBTdGVwIDE6IENoZWNrIGlmIG5ldyB0cmFpbmluZyBkYXRhIGlzIGF2YWlsYWJsZVxuICAgIGNvbnN0IGNoZWNrVHJhaW5pbmdEYXRhID0gbmV3IHNmbi5QYXNzKHRoaXMsIFwiQ2hlY2tUcmFpbmluZ0RhdGFcIiwge1xuICAgICAgcmVzdWx0OiBzZm4uUmVzdWx0LmZyb21PYmplY3QoeyBoYXNOZXdEYXRhOiB0cnVlIH0pLFxuICAgICAgcmVzdWx0UGF0aDogXCIkLmRhdGFDaGVja1wiLFxuICAgIH0pO1xuXG4gICAgLy8gU3RlcCAyOiBTdGFydCBTYWdlTWFrZXIgUGlwZWxpbmVcbiAgICBjb25zdCBzdGFydFRyYWluaW5nID0gbmV3IHRhc2tzLkNhbGxBd3NTZXJ2aWNlKHRoaXMsIFwiU3RhcnRTYWdlTWFrZXJQaXBlbGluZVwiLCB7XG4gICAgICBzZXJ2aWNlOiBcInNhZ2VtYWtlclwiLFxuICAgICAgYWN0aW9uOiBcInN0YXJ0UGlwZWxpbmVFeGVjdXRpb25cIixcbiAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgUGlwZWxpbmVOYW1lOiBwcm9wcy50cmFpbmluZ1BpcGVsaW5lTmFtZSxcbiAgICAgICAgUGlwZWxpbmVFeGVjdXRpb25EaXNwbGF5TmFtZTogc2ZuLkpzb25QYXRoLmZvcm1hdChcbiAgICAgICAgICBcIndlZWtseS10cmFpbmluZy17fVwiLFxuICAgICAgICAgIHNmbi5Kc29uUGF0aC5zdHJpbmdBdChcIiQkLkV4ZWN1dGlvbi5OYW1lXCIpXG4gICAgICAgICksXG4gICAgICAgIFBpcGVsaW5lUGFyYW1ldGVyczogW1xuICAgICAgICAgIHsgTmFtZTogXCJQcm9jZXNzaW5nSW5zdGFuY2VUeXBlXCIsIFZhbHVlOiBcIm1sLm01LnhsYXJnZVwiIH0sXG4gICAgICAgICAgeyBOYW1lOiBcIlRyYWluaW5nSW5zdGFuY2VUeXBlXCIsIFZhbHVlOiBcIm1sLm01LnhsYXJnZVwiIH0sXG4gICAgICAgICAgeyBOYW1lOiBcIk1vZGVsQXBwcm92YWxTdGF0dXNcIiwgVmFsdWU6IFwiUGVuZGluZ01hbnVhbEFwcHJvdmFsXCIgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICBpYW1SZXNvdXJjZXM6IFtcIipcIl0sXG4gICAgICByZXN1bHRQYXRoOiBcIiQudHJhaW5pbmdSZXN1bHRcIixcbiAgICB9KTtcblxuICAgIC8vIFN0ZXAgMzogV2FpdCBmb3IgdHJhaW5pbmcgY29tcGxldGlvblxuICAgIGNvbnN0IHdhaXRGb3JUcmFpbmluZyA9IG5ldyBzZm4uV2FpdCh0aGlzLCBcIldhaXRGb3JUcmFpbmluZ1wiLCB7XG4gICAgICB0aW1lOiBzZm4uV2FpdFRpbWUuZHVyYXRpb24oY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMzApKSxcbiAgICB9KTtcblxuICAgIC8vIFN0ZXAgNDogQ2hlY2sgdHJhaW5pbmcgc3RhdHVzXG4gICAgY29uc3QgY2hlY2tUcmFpbmluZ1N0YXR1cyA9IG5ldyB0YXNrcy5DYWxsQXdzU2VydmljZSh0aGlzLCBcIkNoZWNrVHJhaW5pbmdTdGF0dXNcIiwge1xuICAgICAgc2VydmljZTogXCJzYWdlbWFrZXJcIixcbiAgICAgIGFjdGlvbjogXCJkZXNjcmliZVBpcGVsaW5lRXhlY3V0aW9uXCIsXG4gICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgIFBpcGVsaW5lRXhlY3V0aW9uQXJuOiBzZm4uSnNvblBhdGguc3RyaW5nQXQoXCIkLnRyYWluaW5nUmVzdWx0LlBpcGVsaW5lRXhlY3V0aW9uQXJuXCIpLFxuICAgICAgfSxcbiAgICAgIGlhbVJlc291cmNlczogW1wiKlwiXSxcbiAgICAgIHJlc3VsdFBhdGg6IFwiJC5waXBlbGluZVN0YXR1c1wiLFxuICAgIH0pO1xuXG4gICAgLy8gQ2hvaWNlOiBJcyB0cmFpbmluZyBjb21wbGV0ZT9cbiAgICBjb25zdCBpc1RyYWluaW5nQ29tcGxldGUgPSBuZXcgc2ZuLkNob2ljZSh0aGlzLCBcIklzVHJhaW5pbmdDb21wbGV0ZVwiKVxuICAgICAgLndoZW4oXG4gICAgICAgIHNmbi5Db25kaXRpb24uc3RyaW5nRXF1YWxzKFwiJC5waXBlbGluZVN0YXR1cy5QaXBlbGluZUV4ZWN1dGlvblN0YXR1c1wiLCBcIlN1Y2NlZWRlZFwiKSxcbiAgICAgICAgbmV3IHRhc2tzLlNuc1B1Ymxpc2godGhpcywgXCJUcmFpbmluZ1N1Y2Nlc3NcIiwge1xuICAgICAgICAgIHRvcGljOiBwcm9wcy5hbGVydFRvcGljLFxuICAgICAgICAgIHN1YmplY3Q6IFwiW1RDRyBQaXBlbGluZV0gV2Vla2x5IFRyYWluaW5nIENvbXBsZXRlZFwiLFxuICAgICAgICAgIG1lc3NhZ2U6IHNmbi5UYXNrSW5wdXQuZnJvbVRleHQoXCJNb2RlbCB0cmFpbmluZyBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5XCIpLFxuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLndoZW4oXG4gICAgICAgIHNmbi5Db25kaXRpb24uc3RyaW5nRXF1YWxzKFwiJC5waXBlbGluZVN0YXR1cy5QaXBlbGluZUV4ZWN1dGlvblN0YXR1c1wiLCBcIkZhaWxlZFwiKSxcbiAgICAgICAgbmV3IHRhc2tzLlNuc1B1Ymxpc2godGhpcywgXCJUcmFpbmluZ0ZhaWxlZFwiLCB7XG4gICAgICAgICAgdG9waWM6IHByb3BzLmFsZXJ0VG9waWMsXG4gICAgICAgICAgc3ViamVjdDogXCJbVENHIFBpcGVsaW5lXSBXZWVrbHkgVHJhaW5pbmcgRmFpbGVkXCIsXG4gICAgICAgICAgbWVzc2FnZTogc2ZuLlRhc2tJbnB1dC5mcm9tSnNvblBhdGhBdChcIiQucGlwZWxpbmVTdGF0dXNcIiksXG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICAub3RoZXJ3aXNlKHdhaXRGb3JUcmFpbmluZy5uZXh0KGNoZWNrVHJhaW5pbmdTdGF0dXMpKTtcblxuICAgIC8vIERlZmluZSB0cmFpbmluZyBwaXBlbGluZVxuICAgIGNvbnN0IHRyYWluaW5nUGlwZWxpbmVEZWZpbml0aW9uID0gY2hlY2tUcmFpbmluZ0RhdGFcbiAgICAgIC5uZXh0KHN0YXJ0VHJhaW5pbmcpXG4gICAgICAubmV4dCh3YWl0Rm9yVHJhaW5pbmcpXG4gICAgICAubmV4dChjaGVja1RyYWluaW5nU3RhdHVzKVxuICAgICAgLm5leHQoaXNUcmFpbmluZ0NvbXBsZXRlKTtcblxuICAgIHRoaXMudHJhaW5pbmdQaXBlbGluZSA9IG5ldyBzZm4uU3RhdGVNYWNoaW5lKHRoaXMsIFwiV2Vla2x5VHJhaW5pbmdQaXBlbGluZVwiLCB7XG4gICAgICBkZWZpbml0aW9uOiB0cmFpbmluZ1BpcGVsaW5lRGVmaW5pdGlvbixcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5ob3VycygxMiksXG4gICAgICBzdGF0ZU1hY2hpbmVOYW1lOiBcInRjZy13ZWVrbHktdHJhaW5pbmctcGlwZWxpbmVcIixcbiAgICB9KTtcblxuICAgIC8vIFNjaGVkdWxlIHdlZWtseSBvbiBTdW5kYXkgYXQgNiBBTSBVVENcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgXCJXZWVrbHlUcmFpbmluZ1NjaGVkdWxlXCIsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7IHdlZWtEYXk6IFwiU1VOXCIsIGhvdXI6IFwiNlwiLCBtaW51dGU6IFwiMFwiIH0pLFxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLlNmblN0YXRlTWFjaGluZSh0aGlzLnRyYWluaW5nUGlwZWxpbmUpXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPTi1ERU1BTkQgRlVMTCBQSVBFTElORVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIENvbWJpbmVzIGRhdGEgY29sbGVjdGlvbiwgRVRMLCBhbmQgdHJhaW5pbmcgaW4gb25lIHBpcGVsaW5lXG4gICAgY29uc3QgY29sbGVjdERhdGFTdGVwID0gbmV3IHNmbi5QYXJhbGxlbCh0aGlzLCBcIkNvbGxlY3REYXRhXCIpXG4gICAgICAuYnJhbmNoKFxuICAgICAgICBuZXcgdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsIFwiSW52b2tlVENHcGxheWVyXCIsIHtcbiAgICAgICAgICBsYW1iZGFGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uLmZyb21GdW5jdGlvbkFybihcbiAgICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgICBcIlRDR3BsYXllckZuXCIsXG4gICAgICAgICAgICBwcm9wcy5jb2xsZWN0b3JzQXJuc1swXSB8fCBcIlwiXG4gICAgICAgICAgKSxcbiAgICAgICAgICByZXN1bHRQYXRoOiBcIiQudGNncGxheWVyUmVzdWx0XCIsXG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICAuYnJhbmNoKFxuICAgICAgICBuZXcgdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsIFwiSW52b2tlQ2FyZG1hcmtldFwiLCB7XG4gICAgICAgICAgbGFtYmRhRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbi5mcm9tRnVuY3Rpb25Bcm4oXG4gICAgICAgICAgICB0aGlzLFxuICAgICAgICAgICAgXCJDYXJkbWFya2V0Rm5cIixcbiAgICAgICAgICAgIHByb3BzLmNvbGxlY3RvcnNBcm5zWzFdIHx8IFwiXCJcbiAgICAgICAgICApLFxuICAgICAgICAgIHJlc3VsdFBhdGg6IFwiJC5jYXJkbWFya2V0UmVzdWx0XCIsXG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICAuYnJhbmNoKFxuICAgICAgICBuZXcgdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsIFwiSW52b2tlRWJheVwiLCB7XG4gICAgICAgICAgbGFtYmRhRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbi5mcm9tRnVuY3Rpb25Bcm4oXG4gICAgICAgICAgICB0aGlzLFxuICAgICAgICAgICAgXCJFYmF5Rm5cIixcbiAgICAgICAgICAgIHByb3BzLmNvbGxlY3RvcnNBcm5zWzJdIHx8IFwiXCJcbiAgICAgICAgICApLFxuICAgICAgICAgIHJlc3VsdFBhdGg6IFwiJC5lYmF5UmVzdWx0XCIsXG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgLy8gV2FpdCBmb3IgZGF0YSB0byBzZXR0bGVcbiAgICBjb25zdCB3YWl0Rm9yRGF0YSA9IG5ldyBzZm4uV2FpdCh0aGlzLCBcIldhaXRGb3JEYXRhU2V0dGxpbmdcIiwge1xuICAgICAgdGltZTogc2ZuLldhaXRUaW1lLmR1cmF0aW9uKGNkay5EdXJhdGlvbi5taW51dGVzKDUpKSxcbiAgICB9KTtcblxuICAgIC8vIENob2ljZTogU2hvdWxkIHJldHJhaW4/XG4gICAgY29uc3Qgc2hvdWxkUmV0cmFpbkNob2ljZSA9IG5ldyBzZm4uQ2hvaWNlKHRoaXMsIFwiU2hvdWxkUmV0cmFpblwiKVxuICAgICAgLndoZW4oXG4gICAgICAgIHNmbi5Db25kaXRpb24uYm9vbGVhbkVxdWFscyhcIiQucmV0cmFpblwiLCB0cnVlKSxcbiAgICAgICAgbmV3IHNmbi5QYXNzKHRoaXMsIFwiUHJlcGFyZUZvclJldHJhaW5pbmdcIilcbiAgICAgIClcbiAgICAgIC5vdGhlcndpc2UoXG4gICAgICAgIG5ldyB0YXNrcy5TbnNQdWJsaXNoKHRoaXMsIFwiT25EZW1hbmRDb21wbGV0ZVwiLCB7XG4gICAgICAgICAgdG9waWM6IHByb3BzLmFsZXJ0VG9waWMsXG4gICAgICAgICAgc3ViamVjdDogXCJbVENHIFBpcGVsaW5lXSBPbi1EZW1hbmQgUGlwZWxpbmUgQ29tcGxldGVcIixcbiAgICAgICAgICBtZXNzYWdlOiBzZm4uVGFza0lucHV0LmZyb21UZXh0KFwiT24tZGVtYW5kIGRhdGEgcmVmcmVzaCBjb21wbGV0ZWRcIiksXG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgLy8gRGVmaW5lIG9uLWRlbWFuZCBwaXBlbGluZVxuICAgIGNvbnN0IG9uRGVtYW5kRGVmaW5pdGlvbiA9IGNvbGxlY3REYXRhU3RlcFxuICAgICAgLm5leHQod2FpdEZvckRhdGEpXG4gICAgICAubmV4dChkYXRhUXVhbGl0eVN0ZXApXG4gICAgICAubmV4dChwcmljZUFnZ3JlZ2F0aW9uU3RlcClcbiAgICAgIC5uZXh0KGZlYXR1cmVFbmdpbmVlcmluZ1N0ZXApXG4gICAgICAubmV4dChtYXJrZXRBbmFseXNpc1N0ZXApXG4gICAgICAubmV4dChzaG91bGRSZXRyYWluQ2hvaWNlKTtcblxuICAgIHRoaXMub25EZW1hbmRQaXBlbGluZSA9IG5ldyBzZm4uU3RhdGVNYWNoaW5lKHRoaXMsIFwiT25EZW1hbmRQaXBlbGluZVwiLCB7XG4gICAgICBkZWZpbml0aW9uOiBvbkRlbWFuZERlZmluaXRpb24sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uaG91cnMoOCksXG4gICAgICBzdGF0ZU1hY2hpbmVOYW1lOiBcInRjZy1vbi1kZW1hbmQtcGlwZWxpbmVcIixcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPVVRQVVRTXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJEYWlseVBpcGVsaW5lQXJuXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmRhaWx5UGlwZWxpbmUuc3RhdGVNYWNoaW5lQXJuLFxuICAgICAgZGVzY3JpcHRpb246IFwiRGFpbHkgRVRMIFBpcGVsaW5lIEFSTlwiLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJUcmFpbmluZ1BpcGVsaW5lQXJuXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnRyYWluaW5nUGlwZWxpbmUuc3RhdGVNYWNoaW5lQXJuLFxuICAgICAgZGVzY3JpcHRpb246IFwiV2Vla2x5IFRyYWluaW5nIFBpcGVsaW5lIEFSTlwiLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJPbkRlbWFuZFBpcGVsaW5lQXJuXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9uRGVtYW5kUGlwZWxpbmUuc3RhdGVNYWNoaW5lQXJuLFxuICAgICAgZGVzY3JpcHRpb246IFwiT24tRGVtYW5kIFBpcGVsaW5lIEFSTlwiLFxuICAgIH0pO1xuICB9XG59XG4iXX0=