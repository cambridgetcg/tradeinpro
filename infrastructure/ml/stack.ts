/**
 * AWS CDK Stack for ML Infrastructure
 *
 * Defines all AWS resources needed for the ML system:
 * - S3 buckets for data and models
 * - SageMaker endpoints for GPU models
 * - Lambda functions for lightweight models
 * - IAM roles and policies
 * - CloudWatch monitoring
 *
 * Usage:
 *   npx cdk deploy TCGMLStack --profile your-aws-profile
 */

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sagemaker from "aws-cdk-lib/aws-sagemaker";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";

// =============================================================================
// CONFIGURATION
// =============================================================================

interface MLStackConfig {
  environment: "dev" | "staging" | "prod";
  region: string;
  visionModelImage: string;
  enableGPUEndpoint: boolean;
}

const DEFAULT_CONFIG: MLStackConfig = {
  environment: "dev",
  region: "us-east-1",
  visionModelImage: "763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:2.0-gpu-py310",
  enableGPUEndpoint: false, // Set to true when ready for production
};

// =============================================================================
// MAIN STACK
// =============================================================================

export class TCGMLStack extends cdk.Stack {
  // S3 Buckets
  public readonly dataBucket: s3.Bucket;
  public readonly modelBucket: s3.Bucket;

  // SageMaker Resources
  public readonly visionEndpoint?: sagemaker.CfnEndpoint;
  public readonly sagemakerRole: iam.Role;

  // Lambda Functions
  public readonly qualityFunction: lambda.Function;
  public readonly anomalyFunction: lambda.Function;

  // API Gateway
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, config: MLStackConfig = DEFAULT_CONFIG) {
    super(scope, id, {
      env: {
        region: config.region,
      },
    });

    // =========================================================================
    // S3 BUCKETS
    // =========================================================================

    // Data bucket for training data, features, predictions
    this.dataBucket = new s3.Bucket(this, "DataBucket", {
      bucketName: `tcg-ml-data-${config.environment}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: "archive-old-data",
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(180),
            },
          ],
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

    // Model bucket for trained models
    this.modelBucket = new s3.Bucket(this, "ModelBucket", {
      bucketName: `tcg-ml-models-${config.environment}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy:
        config.environment === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.environment !== "prod",
    });

    // =========================================================================
    // IAM ROLES
    // =========================================================================

    // SageMaker execution role
    this.sagemakerRole = new iam.Role(this, "SageMakerRole", {
      assumedBy: new iam.ServicePrincipal("sagemaker.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSageMakerFullAccess"),
      ],
    });

    // Grant S3 access
    this.dataBucket.grantReadWrite(this.sagemakerRole);
    this.modelBucket.grantReadWrite(this.sagemakerRole);

    // Lambda execution role
    const lambdaRole = new iam.Role(this, "LambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    this.dataBucket.grantRead(lambdaRole);
    this.modelBucket.grantRead(lambdaRole);

    // =========================================================================
    // SAGEMAKER VISION ENDPOINT
    // =========================================================================

    if (config.enableGPUEndpoint) {
      // Model definition
      const visionModel = new sagemaker.CfnModel(this, "VisionModel", {
        executionRoleArn: this.sagemakerRole.roleArn,
        primaryContainer: {
          image: config.visionModelImage,
          modelDataUrl: `s3://${this.modelBucket.bucketName}/vision/model.tar.gz`,
          environment: {
            SAGEMAKER_PROGRAM: "inference.py",
            SAGEMAKER_SUBMIT_DIRECTORY: "/opt/ml/model/code",
          },
        },
      });

      // Endpoint configuration
      const visionEndpointConfig = new sagemaker.CfnEndpointConfig(this, "VisionEndpointConfig", {
        productionVariants: [
          {
            initialInstanceCount: 1,
            instanceType: "ml.g4dn.xlarge", // 1 T4 GPU
            modelName: visionModel.attrModelName,
            variantName: "primary",
            initialVariantWeight: 1,
          },
        ],
      });

      // Endpoint
      this.visionEndpoint = new sagemaker.CfnEndpoint(this, "VisionEndpoint", {
        endpointConfigName: visionEndpointConfig.attrEndpointConfigName,
        endpointName: `tcg-vision-${config.environment}`,
      });

      // Auto-scaling (optional - uncomment when ready)
      // const scaling = new applicationautoscaling.ScalableTarget(this, "VisionScaling", {
      //   serviceNamespace: applicationautoscaling.ServiceNamespace.SAGEMAKER,
      //   resourceId: `endpoint/${this.visionEndpoint.endpointName}/variant/primary`,
      //   scalableDimension: "sagemaker:variant:DesiredInstanceCount",
      //   minCapacity: 1,
      //   maxCapacity: 5,
      // });
    }

    // =========================================================================
    // LAMBDA FUNCTIONS
    // =========================================================================

    // Quality scoring function
    this.qualityFunction = new lambda.Function(this, "QualityFunction", {
      functionName: `tcg-quality-scorer-${config.environment}`,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "handler.lambda_handler",
      code: lambda.Code.fromAsset("lambda/quality"),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      role: lambdaRole,
      environment: {
        MODEL_BUCKET: this.modelBucket.bucketName,
        MODEL_KEY: "quality/model.pkl",
      },
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          "SklearnLayer",
          `arn:aws:lambda:${config.region}:770693421928:layer:Klayers-p311-scikit-learn:1`
        ),
      ],
    });

    // Anomaly detection function
    this.anomalyFunction = new lambda.Function(this, "AnomalyFunction", {
      functionName: `tcg-anomaly-detector-${config.environment}`,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: "handler.lambda_handler",
      code: lambda.Code.fromAsset("lambda/anomaly"),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      role: lambdaRole,
      environment: {
        MODEL_BUCKET: this.modelBucket.bucketName,
        MODEL_KEY: "anomaly/model.pkl",
      },
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          "SklearnLayerAnomaly",
          `arn:aws:lambda:${config.region}:770693421928:layer:Klayers-p311-scikit-learn:1`
        ),
      ],
    });

    // =========================================================================
    // API GATEWAY
    // =========================================================================

    this.api = new apigateway.RestApi(this, "MLAPI", {
      restApiName: `tcg-ml-api-${config.environment}`,
      description: "TCG ML Model Inference API",
      deployOptions: {
        stageName: config.environment,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // API Resources
    const v1 = this.api.root.addResource("v1");

    // Quality endpoint
    const qualityResource = v1.addResource("quality");
    qualityResource.addMethod("POST", new apigateway.LambdaIntegration(this.qualityFunction));

    // Anomaly endpoint
    const anomalyResource = v1.addResource("anomaly");
    anomalyResource.addMethod("POST", new apigateway.LambdaIntegration(this.anomalyFunction));

    // Vision endpoint (if enabled)
    if (config.enableGPUEndpoint && this.visionEndpoint) {
      const visionResource = v1.addResource("vision");

      // Would need a Lambda proxy to call SageMaker endpoint
      // Or use SageMaker's built-in HTTP endpoint
    }

    // =========================================================================
    // CLOUDWATCH MONITORING
    // =========================================================================

    // Quality function dashboard
    const dashboard = new cloudwatch.Dashboard(this, "MLDashboard", {
      dashboardName: `tcg-ml-${config.environment}`,
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Lambda Invocations",
        left: [
          this.qualityFunction.metricInvocations(),
          this.anomalyFunction.metricInvocations(),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: "Lambda Errors",
        left: [this.qualityFunction.metricErrors(), this.anomalyFunction.metricErrors()],
      }),
      new cloudwatch.GraphWidget({
        title: "Lambda Duration",
        left: [this.qualityFunction.metricDuration(), this.anomalyFunction.metricDuration()],
      })
    );

    // Alarms
    new cloudwatch.Alarm(this, "QualityErrorAlarm", {
      metric: this.qualityFunction.metricErrors(),
      threshold: 5,
      evaluationPeriods: 1,
      alarmDescription: "Quality scoring Lambda error rate too high",
    });

    new cloudwatch.Alarm(this, "AnomalyErrorAlarm", {
      metric: this.anomalyFunction.metricErrors(),
      threshold: 5,
      evaluationPeriods: 1,
      alarmDescription: "Anomaly detection Lambda error rate too high",
    });

    // =========================================================================
    // OUTPUTS
    // =========================================================================

    new cdk.CfnOutput(this, "DataBucketName", {
      value: this.dataBucket.bucketName,
      description: "S3 bucket for ML data",
    });

    new cdk.CfnOutput(this, "ModelBucketName", {
      value: this.modelBucket.bucketName,
      description: "S3 bucket for ML models",
    });

    new cdk.CfnOutput(this, "QualityFunctionArn", {
      value: this.qualityFunction.functionArn,
      description: "Quality scoring Lambda ARN",
    });

    new cdk.CfnOutput(this, "AnomalyFunctionArn", {
      value: this.anomalyFunction.functionArn,
      description: "Anomaly detection Lambda ARN",
    });

    new cdk.CfnOutput(this, "APIEndpoint", {
      value: this.api.url,
      description: "ML API endpoint URL",
    });

    if (this.visionEndpoint) {
      new cdk.CfnOutput(this, "VisionEndpointName", {
        value: this.visionEndpoint.endpointName!,
        description: "SageMaker Vision endpoint name",
      });
    }
  }
}

// =============================================================================
// APP ENTRY POINT
// =============================================================================

const app = new cdk.App();

// Development stack
new TCGMLStack(app, "TCGMLStack-Dev", {
  environment: "dev",
  region: "us-east-1",
  visionModelImage: "763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:2.0-gpu-py310",
  enableGPUEndpoint: false, // Keep disabled for dev to save costs
});

// Production stack (uncomment when ready)
// new TCGMLStack(app, "TCGMLStack-Prod", {
//   environment: "prod",
//   region: "us-east-1",
//   visionModelImage: "763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:2.0-gpu-py310",
//   enableGPUEndpoint: true,
// });

app.synth();
