"""
SageMaker Training Pipeline Definition

Orchestrates the complete ML training workflow:
1. Data preparation
2. Feature engineering
3. Model training (Demand, Anomaly, Timing)
4. Model evaluation
5. Model registration

Run via SageMaker Pipelines
"""

import sagemaker
from sagemaker.workflow.pipeline import Pipeline
from sagemaker.workflow.steps import ProcessingStep, TrainingStep, CreateModelStep
from sagemaker.workflow.step_collections import RegisterModel
from sagemaker.workflow.parameters import ParameterInteger, ParameterString, ParameterFloat
from sagemaker.workflow.conditions import ConditionLessThanOrEqualTo, ConditionGreaterThanOrEqualTo
from sagemaker.workflow.condition_step import ConditionStep
from sagemaker.workflow.functions import JsonGet
from sagemaker.workflow.properties import PropertyFile
from sagemaker.processing import ProcessingInput, ProcessingOutput, ScriptProcessor
from sagemaker.inputs import TrainingInput
from sagemaker.estimator import Estimator
from sagemaker.sklearn.processing import SKLearnProcessor
from sagemaker.xgboost import XGBoost
from sagemaker.model import Model
from sagemaker.model_metrics import MetricsSource, ModelMetrics


def create_training_pipeline(
    role: str,
    bucket: str,
    region: str,
    pipeline_name: str = "tcg-ml-training-pipeline",
) -> Pipeline:
    """Create SageMaker training pipeline."""

    # Pipeline parameters
    processing_instance_type = ParameterString(
        name="ProcessingInstanceType",
        default_value="ml.m5.xlarge",
    )
    training_instance_type = ParameterString(
        name="TrainingInstanceType",
        default_value="ml.m5.xlarge",
    )
    model_approval_status = ParameterString(
        name="ModelApprovalStatus",
        default_value="PendingManualApproval",
    )

    # Hyperparameters
    demand_n_estimators = ParameterInteger(name="DemandNEstimators", default_value=500)
    demand_max_depth = ParameterInteger(name="DemandMaxDepth", default_value=6)
    demand_learning_rate = ParameterFloat(name="DemandLearningRate", default_value=0.05)

    anomaly_contamination = ParameterFloat(name="AnomalyContamination", default_value=0.05)
    anomaly_n_estimators = ParameterInteger(name="AnomalyNEstimators", default_value=200)

    # S3 paths
    s3_prefix = f"s3://{bucket}/tcg-data-pipeline"
    features_path = f"{s3_prefix}/features/training_data"
    models_path = f"{s3_prefix}/models"

    # ==========================================================================
    # Step 1: Data Preparation
    # ==========================================================================

    sklearn_processor = SKLearnProcessor(
        framework_version="1.2-1",
        role=role,
        instance_type=processing_instance_type,
        instance_count=1,
        base_job_name="tcg-data-prep",
    )

    data_prep_step = ProcessingStep(
        name="DataPreparation",
        processor=sklearn_processor,
        inputs=[
            ProcessingInput(
                source=f"{s3_prefix}/processed/daily_aggregates",
                destination="/opt/ml/processing/input/prices",
            ),
            ProcessingInput(
                source=f"{s3_prefix}/processed/signals",
                destination="/opt/ml/processing/input/signals",
            ),
        ],
        outputs=[
            ProcessingOutput(
                output_name="train",
                source="/opt/ml/processing/output/train",
                destination=f"{features_path}/train",
            ),
            ProcessingOutput(
                output_name="validation",
                source="/opt/ml/processing/output/validation",
                destination=f"{features_path}/validation",
            ),
            ProcessingOutput(
                output_name="test",
                source="/opt/ml/processing/output/test",
                destination=f"{features_path}/test",
            ),
        ],
        code="processing/prepare_data.py",
    )

    # ==========================================================================
    # Step 2: Train Demand Model (XGBoost)
    # ==========================================================================

    xgb_estimator = XGBoost(
        entry_point="training/train_demand.py",
        framework_version="1.7-1",
        py_version="py3",
        role=role,
        instance_type=training_instance_type,
        instance_count=1,
        output_path=f"{models_path}/demand",
        base_job_name="tcg-demand-model",
        hyperparameters={
            "n-estimators": demand_n_estimators,
            "max-depth": demand_max_depth,
            "learning-rate": demand_learning_rate,
            "subsample": 0.8,
            "colsample-bytree": 0.8,
        },
    )

    demand_train_step = TrainingStep(
        name="TrainDemandModel",
        estimator=xgb_estimator,
        inputs={
            "train": TrainingInput(
                s3_data=data_prep_step.properties.ProcessingOutputConfig.Outputs["train"].S3Output.S3Uri,
                content_type="application/x-parquet",
            ),
            "validation": TrainingInput(
                s3_data=data_prep_step.properties.ProcessingOutputConfig.Outputs["validation"].S3Output.S3Uri,
                content_type="application/x-parquet",
            ),
        },
    )

    # ==========================================================================
    # Step 3: Train Anomaly Model (Isolation Forest)
    # ==========================================================================

    sklearn_estimator = sagemaker.sklearn.SKLearn(
        entry_point="training/train_anomaly.py",
        framework_version="1.2-1",
        py_version="py3",
        role=role,
        instance_type=training_instance_type,
        instance_count=1,
        output_path=f"{models_path}/anomaly",
        base_job_name="tcg-anomaly-model",
        hyperparameters={
            "n-estimators": anomaly_n_estimators,
            "contamination": anomaly_contamination,
        },
    )

    anomaly_train_step = TrainingStep(
        name="TrainAnomalyModel",
        estimator=sklearn_estimator,
        inputs={
            "train": TrainingInput(
                s3_data=data_prep_step.properties.ProcessingOutputConfig.Outputs["train"].S3Output.S3Uri,
                content_type="application/x-parquet",
            ),
        },
    )

    # ==========================================================================
    # Step 4: Train Timing Model (Prophet)
    # ==========================================================================

    timing_estimator = sagemaker.sklearn.SKLearn(
        entry_point="training/train_timing.py",
        framework_version="1.2-1",
        py_version="py3",
        role=role,
        instance_type=training_instance_type,
        instance_count=1,
        output_path=f"{models_path}/timing",
        base_job_name="tcg-timing-model",
        hyperparameters={
            "changepoint-prior-scale": 0.05,
            "seasonality-prior-scale": 10.0,
            "holdout-days": 14,
        },
    )

    timing_train_step = TrainingStep(
        name="TrainTimingModel",
        estimator=timing_estimator,
        inputs={
            "train": TrainingInput(
                s3_data=data_prep_step.properties.ProcessingOutputConfig.Outputs["train"].S3Output.S3Uri,
                content_type="application/x-parquet",
            ),
        },
    )

    # ==========================================================================
    # Step 5: Model Evaluation
    # ==========================================================================

    evaluation_processor = SKLearnProcessor(
        framework_version="1.2-1",
        role=role,
        instance_type=processing_instance_type,
        instance_count=1,
        base_job_name="tcg-model-eval",
    )

    evaluation_report = PropertyFile(
        name="EvaluationReport",
        output_name="evaluation",
        path="evaluation_report.json",
    )

    evaluation_step = ProcessingStep(
        name="ModelEvaluation",
        processor=evaluation_processor,
        inputs=[
            ProcessingInput(
                source=demand_train_step.properties.ModelArtifacts.S3ModelArtifacts,
                destination="/opt/ml/processing/model/demand",
            ),
            ProcessingInput(
                source=anomaly_train_step.properties.ModelArtifacts.S3ModelArtifacts,
                destination="/opt/ml/processing/model/anomaly",
            ),
            ProcessingInput(
                source=timing_train_step.properties.ModelArtifacts.S3ModelArtifacts,
                destination="/opt/ml/processing/model/timing",
            ),
            ProcessingInput(
                source=data_prep_step.properties.ProcessingOutputConfig.Outputs["test"].S3Output.S3Uri,
                destination="/opt/ml/processing/test",
            ),
        ],
        outputs=[
            ProcessingOutput(
                output_name="evaluation",
                source="/opt/ml/processing/evaluation",
                destination=f"{models_path}/evaluation",
            ),
        ],
        code="processing/evaluate_models.py",
        property_files=[evaluation_report],
    )

    # ==========================================================================
    # Step 6: Conditional Model Registration
    # ==========================================================================

    # Condition: Only register if demand model R2 > 0.5
    cond_register = ConditionGreaterThanOrEqualTo(
        left=JsonGet(
            step_name=evaluation_step.name,
            property_file=evaluation_report,
            json_path="demand_r2",
        ),
        right=0.5,
    )

    # Register Demand Model
    demand_model = Model(
        image_uri=sagemaker.image_uris.retrieve("xgboost", region, version="1.7-1"),
        model_data=demand_train_step.properties.ModelArtifacts.S3ModelArtifacts,
        role=role,
    )

    demand_model_metrics = ModelMetrics(
        model_statistics=MetricsSource(
            s3_uri=f"{models_path}/evaluation/demand_metrics.json",
            content_type="application/json",
        ),
    )

    register_demand_step = RegisterModel(
        name="RegisterDemandModel",
        estimator=xgb_estimator,
        model_data=demand_train_step.properties.ModelArtifacts.S3ModelArtifacts,
        content_types=["application/json"],
        response_types=["application/json"],
        inference_instances=["ml.t2.medium", "ml.m5.large"],
        transform_instances=["ml.m5.large"],
        model_package_group_name="tcg-demand-models",
        approval_status=model_approval_status,
        model_metrics=demand_model_metrics,
    )

    # Register Anomaly Model
    register_anomaly_step = RegisterModel(
        name="RegisterAnomalyModel",
        estimator=sklearn_estimator,
        model_data=anomaly_train_step.properties.ModelArtifacts.S3ModelArtifacts,
        content_types=["application/json"],
        response_types=["application/json"],
        inference_instances=["ml.t2.medium", "ml.m5.large"],
        transform_instances=["ml.m5.large"],
        model_package_group_name="tcg-anomaly-models",
        approval_status=model_approval_status,
    )

    # Conditional step
    condition_step = ConditionStep(
        name="CheckModelQuality",
        conditions=[cond_register],
        if_steps=[register_demand_step, register_anomaly_step],
        else_steps=[],
    )

    # ==========================================================================
    # Create Pipeline
    # ==========================================================================

    pipeline = Pipeline(
        name=pipeline_name,
        parameters=[
            processing_instance_type,
            training_instance_type,
            model_approval_status,
            demand_n_estimators,
            demand_max_depth,
            demand_learning_rate,
            anomaly_contamination,
            anomaly_n_estimators,
        ],
        steps=[
            data_prep_step,
            demand_train_step,
            anomaly_train_step,
            timing_train_step,
            evaluation_step,
            condition_step,
        ],
    )

    return pipeline


def main():
    """Create and optionally run the pipeline."""
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--role", type=str, required=True)
    parser.add_argument("--bucket", type=str, required=True)
    parser.add_argument("--region", type=str, default="us-east-1")
    parser.add_argument("--pipeline-name", type=str, default="tcg-ml-training-pipeline")
    parser.add_argument("--execute", action="store_true")

    args = parser.parse_args()

    # Create pipeline
    pipeline = create_training_pipeline(
        role=args.role,
        bucket=args.bucket,
        region=args.region,
        pipeline_name=args.pipeline_name,
    )

    # Upsert pipeline definition
    pipeline.upsert(role_arn=args.role)
    print(f"Pipeline '{args.pipeline_name}' created/updated")

    # Optionally execute
    if args.execute:
        execution = pipeline.start()
        print(f"Pipeline execution started: {execution.arn}")


if __name__ == "__main__":
    main()
