/**
 * API Gateway Stack
 *
 * Defines the REST API for accessing:
 * - Price data
 * - Predictions
 * - Market analysis
 * - Arbitrage opportunities
 */

import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as waf from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

interface ApiStackProps extends cdk.StackProps {
  // DynamoDB tables
  currentPricesTable: string;
  arbitrageTable: string;
  predictionsTable?: string;

  // Timestream
  timestreamDatabase: string;

  // SageMaker endpoints
  demandEndpoint?: string;
  anomalyEndpoint?: string;
  timingEndpoint?: string;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly pricesLambda: lambda.Function;
  public readonly predictionsLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // =========================================================================
    // LAMBDA FUNCTIONS
    // =========================================================================

    // Prices API Lambda
    this.pricesLambda = new lambdaNode.NodejsFunction(this, "PricesLambda", {
      entry: "lambda/api/prices.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        CURRENT_PRICES_TABLE: props.currentPricesTable,
        ARBITRAGE_TABLE: props.arbitrageTable,
        TIMESTREAM_DATABASE: props.timestreamDatabase,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant permissions
    this.pricesLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.currentPricesTable}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.currentPricesTable}/index/*`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.arbitrageTable}`,
        ],
      })
    );

    this.pricesLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["timestream:Select", "timestream:DescribeEndpoints"],
        resources: ["*"],
      })
    );

    // Predictions API Lambda
    this.predictionsLambda = new lambdaNode.NodejsFunction(this, "PredictionsLambda", {
      entry: "lambda/api/predictions.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        CURRENT_PRICES_TABLE: props.currentPricesTable,
        PREDICTIONS_CACHE_TABLE: props.predictionsTable || "",
        DEMAND_ENDPOINT: props.demandEndpoint || "tcg-demand-endpoint",
        ANOMALY_ENDPOINT: props.anomalyEndpoint || "tcg-anomaly-endpoint",
        TIMING_ENDPOINT: props.timingEndpoint || "tcg-timing-endpoint",
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant SageMaker invoke permissions
    this.predictionsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sagemaker:InvokeEndpoint"],
        resources: [
          `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/*`,
        ],
      })
    );

    this.predictionsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:Query"],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.currentPricesTable}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.currentPricesTable}/index/*`,
        ],
      })
    );

    // =========================================================================
    // API GATEWAY
    // =========================================================================

    // Create REST API
    this.api = new apigateway.RestApi(this, "TcgDataApi", {
      restApiName: "TCG Data API",
      description: "API for TCG price data and ML predictions",
      deployOptions: {
        stageName: "v1",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization", "X-Api-Key"],
      },
    });

    // API Key and Usage Plan
    const apiKey = this.api.addApiKey("TcgApiKey", {
      apiKeyName: "tcg-data-api-key",
      description: "API key for TCG Data API",
    });

    const usagePlan = this.api.addUsagePlan("TcgUsagePlan", {
      name: "Standard",
      throttle: {
        rateLimit: 50,
        burstLimit: 100,
      },
      quota: {
        limit: 10000,
        period: apigateway.Period.DAY,
      },
    });

    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: this.api.deploymentStage });

    // =========================================================================
    // PRICES ENDPOINTS
    // =========================================================================

    const pricesResource = this.api.root.addResource("prices");
    const pricesIntegration = new apigateway.LambdaIntegration(this.pricesLambda);

    // GET /prices/search
    const searchResource = pricesResource.addResource("search");
    searchResource.addMethod("GET", pricesIntegration, {
      apiKeyRequired: true,
      requestParameters: {
        "method.request.querystring.q": true,
        "method.request.querystring.limit": false,
      },
      requestValidatorOptions: {
        validateRequestParameters: true,
      },
    });

    // GET /prices/market
    const marketResource = pricesResource.addResource("market");
    marketResource.addMethod("GET", pricesIntegration, {
      apiKeyRequired: true,
    });

    // GET /prices/arbitrage
    const arbitrageResource = pricesResource.addResource("arbitrage");
    arbitrageResource.addMethod("GET", pricesIntegration, {
      apiKeyRequired: true,
      requestParameters: {
        "method.request.querystring.limit": false,
      },
    });

    // GET /prices/{cardId}
    const cardPriceResource = pricesResource.addResource("{cardId}");
    cardPriceResource.addMethod("GET", pricesIntegration, {
      apiKeyRequired: true,
    });

    // GET /prices/{cardId}/history
    const historyResource = cardPriceResource.addResource("history");
    historyResource.addMethod("GET", pricesIntegration, {
      apiKeyRequired: true,
      requestParameters: {
        "method.request.querystring.days": false,
      },
    });

    // =========================================================================
    // PREDICTIONS ENDPOINTS
    // =========================================================================

    const predictionsResource = this.api.root.addResource("predictions");
    const predictionsIntegration = new apigateway.LambdaIntegration(this.predictionsLambda);

    // GET /predictions/{cardId}
    const cardPredictionResource = predictionsResource.addResource("{cardId}");
    cardPredictionResource.addMethod("GET", predictionsIntegration, {
      apiKeyRequired: true,
    });

    // GET /predictions/{cardId}/demand
    const demandResource = cardPredictionResource.addResource("demand");
    demandResource.addMethod("GET", predictionsIntegration, {
      apiKeyRequired: true,
    });

    // GET /predictions/{cardId}/anomaly
    const anomalyResource = cardPredictionResource.addResource("anomaly");
    anomalyResource.addMethod("GET", predictionsIntegration, {
      apiKeyRequired: true,
    });

    // GET /predictions/{cardId}/timing
    const timingResource = cardPredictionResource.addResource("timing");
    timingResource.addMethod("GET", predictionsIntegration, {
      apiKeyRequired: true,
    });

    // =========================================================================
    // WAF (Web Application Firewall)
    // =========================================================================

    const webAcl = new waf.CfnWebACL(this, "ApiWebAcl", {
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "TcgApiWaf",
        sampledRequestsEnabled: true,
      },
      rules: [
        // Rate limiting rule
        {
          name: "RateLimitRule",
          priority: 1,
          statement: {
            rateBasedStatement: {
              limit: 2000, // 2000 requests per 5 minutes
              aggregateKeyType: "IP",
            },
          },
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "RateLimitRule",
            sampledRequestsEnabled: true,
          },
        },
        // AWS Managed Rules - Common Rule Set
        {
          name: "AWSManagedRulesCommonRuleSet",
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesCommonRuleSet",
            sampledRequestsEnabled: true,
          },
        },
        // Block bad bots
        {
          name: "AWSManagedRulesBotControlRuleSet",
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesBotControlRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesBotControlRuleSet",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // Associate WAF with API Gateway
    new waf.CfnWebACLAssociation(this, "ApiWafAssociation", {
      resourceArn: this.api.deploymentStage.stageArn,
      webAclArn: webAcl.attrArn,
    });

    // =========================================================================
    // OUTPUTS
    // =========================================================================

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: this.api.url,
      description: "API Gateway endpoint URL",
    });

    new cdk.CfnOutput(this, "ApiKeyId", {
      value: apiKey.keyId,
      description: "API Key ID (retrieve value from AWS Console)",
    });
  }
}
