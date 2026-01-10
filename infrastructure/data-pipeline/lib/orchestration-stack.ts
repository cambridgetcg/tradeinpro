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
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as glue from "aws-cdk-lib/aws-glue";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface OrchestrationStackProps extends cdk.StackProps {
  // Glue jobs
  priceAggregationJob: string;
  featureEngineeringJob: string;
  dataQualityJob: string;
  marketAnalysisJob: string;

  // Lambda functions
  collectorsArns: string[];

  // SageMaker
  trainingPipelineName: string;

  // Notifications
  alertTopic: sns.ITopic;

  // S3
  dataBucketName: string;
}

export class OrchestrationStack extends cdk.Stack {
  public readonly dailyPipeline: sfn.StateMachine;
  public readonly trainingPipeline: sfn.StateMachine;
  public readonly onDemandPipeline: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: OrchestrationStackProps) {
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
      .next(
        new sfn.Parallel(this, "ParallelProcessing")
          .branch(featureEngineeringStep)
          .branch(marketAnalysisStep)
          .addCatch(failureNotification, { resultPath: "$.error" })
      )
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
        PipelineExecutionDisplayName: sfn.JsonPath.format(
          "weekly-training-{}",
          sfn.JsonPath.stringAt("$$.Execution.Name")
        ),
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
      .when(
        sfn.Condition.stringEquals("$.pipelineStatus.PipelineExecutionStatus", "Succeeded"),
        new tasks.SnsPublish(this, "TrainingSuccess", {
          topic: props.alertTopic,
          subject: "[TCG Pipeline] Weekly Training Completed",
          message: sfn.TaskInput.fromText("Model training completed successfully"),
        })
      )
      .when(
        sfn.Condition.stringEquals("$.pipelineStatus.PipelineExecutionStatus", "Failed"),
        new tasks.SnsPublish(this, "TrainingFailed", {
          topic: props.alertTopic,
          subject: "[TCG Pipeline] Weekly Training Failed",
          message: sfn.TaskInput.fromJsonPathAt("$.pipelineStatus"),
        })
      )
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
      .branch(
        new tasks.LambdaInvoke(this, "InvokeTCGplayer", {
          lambdaFunction: lambda.Function.fromFunctionArn(
            this,
            "TCGplayerFn",
            props.collectorsArns[0] || ""
          ),
          resultPath: "$.tcgplayerResult",
        })
      )
      .branch(
        new tasks.LambdaInvoke(this, "InvokeCardmarket", {
          lambdaFunction: lambda.Function.fromFunctionArn(
            this,
            "CardmarketFn",
            props.collectorsArns[1] || ""
          ),
          resultPath: "$.cardmarketResult",
        })
      )
      .branch(
        new tasks.LambdaInvoke(this, "InvokeEbay", {
          lambdaFunction: lambda.Function.fromFunctionArn(
            this,
            "EbayFn",
            props.collectorsArns[2] || ""
          ),
          resultPath: "$.ebayResult",
        })
      );

    // Wait for data to settle
    const waitForData = new sfn.Wait(this, "WaitForDataSettling", {
      time: sfn.WaitTime.duration(cdk.Duration.minutes(5)),
    });

    // Choice: Should retrain?
    const shouldRetrainChoice = new sfn.Choice(this, "ShouldRetrain")
      .when(
        sfn.Condition.booleanEquals("$.retrain", true),
        new sfn.Pass(this, "PrepareForRetraining")
      )
      .otherwise(
        new tasks.SnsPublish(this, "OnDemandComplete", {
          topic: props.alertTopic,
          subject: "[TCG Pipeline] On-Demand Pipeline Complete",
          message: sfn.TaskInput.fromText("On-demand data refresh completed"),
        })
      );

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
