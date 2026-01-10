"use strict";
/**
 * API Gateway Stack
 *
 * Defines the REST API for accessing:
 * - Price data
 * - Predictions
 * - Market analysis
 * - Arbitrage opportunities
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
exports.ApiStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const lambdaNode = __importStar(require("aws-cdk-lib/aws-lambda-nodejs"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const waf = __importStar(require("aws-cdk-lib/aws-wafv2"));
class ApiStack extends cdk.Stack {
    constructor(scope, id, props) {
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
        this.pricesLambda.addToRolePolicy(new iam.PolicyStatement({
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
        }));
        this.pricesLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["timestream:Select", "timestream:DescribeEndpoints"],
            resources: ["*"],
        }));
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
        this.predictionsLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["sagemaker:InvokeEndpoint"],
            resources: [
                `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/*`,
            ],
        }));
        this.predictionsLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["dynamodb:GetItem", "dynamodb:Query"],
            resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.currentPricesTable}`,
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.currentPricesTable}/index/*`,
            ],
        }));
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
exports.ApiStack = ApiStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vbGliL2FwaS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7O0dBUUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILGlEQUFtQztBQUNuQyx1RUFBeUQ7QUFDekQsK0RBQWlEO0FBQ2pELDBFQUE0RDtBQUM1RCx5REFBMkM7QUFFM0MsMkRBQTZDO0FBa0I3QyxNQUFhLFFBQVMsU0FBUSxHQUFHLENBQUMsS0FBSztJQUtyQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQW9CO1FBQzVELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDRFQUE0RTtRQUM1RSxtQkFBbUI7UUFDbkIsNEVBQTRFO1FBRTVFLG9CQUFvQjtRQUNwQixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksVUFBVSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RFLEtBQUssRUFBRSxzQkFBc0I7WUFDN0IsT0FBTyxFQUFFLFNBQVM7WUFDbEIsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztZQUNuQyxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ2pDLFVBQVUsRUFBRSxHQUFHO1lBQ2YsV0FBVyxFQUFFO2dCQUNYLG9CQUFvQixFQUFFLEtBQUssQ0FBQyxrQkFBa0I7Z0JBQzlDLGVBQWUsRUFBRSxLQUFLLENBQUMsY0FBYztnQkFDckMsbUJBQW1CLEVBQUUsS0FBSyxDQUFDLGtCQUFrQjthQUM5QztZQUNELFFBQVEsRUFBRTtnQkFDUixNQUFNLEVBQUUsSUFBSTtnQkFDWixTQUFTLEVBQUUsSUFBSTthQUNoQjtTQUNGLENBQUMsQ0FBQztRQUVILG9CQUFvQjtRQUNwQixJQUFJLENBQUMsWUFBWSxDQUFDLGVBQWUsQ0FD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IjpbIi8qKlxuICogQVBJIEdhdGV3YXkgU3RhY2tcbiAqXG4gKiBEZWZpbmVzIHRoZSBSRVNUIEFQSSBmb3IgYWNjZXNzaW5nOlxuICogLSBQcmljZSBkYXRhXG4gKiAtIFByZWRpY3Rpb25zXG4gKiAtIE1hcmtldCBhbmFseXNpc1xuICogLSBBcmJpdHJhZ2Ugb3Bwb3J0dW5pdGllc1xuICovXG5cbmltcG9ydCAqIGFzIGNkayBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSBcImF3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5XCI7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGFcIjtcbmltcG9ydCAqIGFzIGxhbWJkYU5vZGUgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XG5pbXBvcnQgKiBhcyB3YWYgZnJvbSBcImF3cy1jZGstbGliL2F3cy13YWZ2MlwiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcblxuaW50ZXJmYWNlIEFwaVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIC8vIER5bmFtb0RCIHRhYmxlc1xuICBjdXJyZW50UHJpY2VzVGFibGU6IHN0cmluZztcbiAgYXJiaXRyYWdlVGFibGU6IHN0cmluZztcbiAgcHJlZGljdGlvbnNUYWJsZT86IHN0cmluZztcblxuICAvLyBUaW1lc3RyZWFtXG4gIHRpbWVzdHJlYW1EYXRhYmFzZTogc3RyaW5nO1xuXG4gIC8vIFNhZ2VNYWtlciBlbmRwb2ludHNcbiAgZGVtYW5kRW5kcG9pbnQ/OiBzdHJpbmc7XG4gIGFub21hbHlFbmRwb2ludD86IHN0cmluZztcbiAgdGltaW5nRW5kcG9pbnQ/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBBcGlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBhcGk6IGFwaWdhdGV3YXkuUmVzdEFwaTtcbiAgcHVibGljIHJlYWRvbmx5IHByaWNlc0xhbWJkYTogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgcHJlZGljdGlvbnNMYW1iZGE6IGxhbWJkYS5GdW5jdGlvbjtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQXBpU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIExBTUJEQSBGVU5DVElPTlNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBQcmljZXMgQVBJIExhbWJkYVxuICAgIHRoaXMucHJpY2VzTGFtYmRhID0gbmV3IGxhbWJkYU5vZGUuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJQcmljZXNMYW1iZGFcIiwge1xuICAgICAgZW50cnk6IFwibGFtYmRhL2FwaS9wcmljZXMudHNcIixcbiAgICAgIGhhbmRsZXI6IFwiaGFuZGxlclwiLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBDVVJSRU5UX1BSSUNFU19UQUJMRTogcHJvcHMuY3VycmVudFByaWNlc1RhYmxlLFxuICAgICAgICBBUkJJVFJBR0VfVEFCTEU6IHByb3BzLmFyYml0cmFnZVRhYmxlLFxuICAgICAgICBUSU1FU1RSRUFNX0RBVEFCQVNFOiBwcm9wcy50aW1lc3RyZWFtRGF0YWJhc2UsXG4gICAgICB9LFxuICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgICBzb3VyY2VNYXA6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcbiAgICB0aGlzLnByaWNlc0xhbWJkYS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICBcImR5bmFtb2RiOkdldEl0ZW1cIixcbiAgICAgICAgICBcImR5bmFtb2RiOlF1ZXJ5XCIsXG4gICAgICAgICAgXCJkeW5hbW9kYjpTY2FuXCIsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS8ke3Byb3BzLmN1cnJlbnRQcmljZXNUYWJsZX1gLFxuICAgICAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS8ke3Byb3BzLmN1cnJlbnRQcmljZXNUYWJsZX0vaW5kZXgvKmAsXG4gICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlLyR7cHJvcHMuYXJiaXRyYWdlVGFibGV9YCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIHRoaXMucHJpY2VzTGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1widGltZXN0cmVhbTpTZWxlY3RcIiwgXCJ0aW1lc3RyZWFtOkRlc2NyaWJlRW5kcG9pbnRzXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFtcIipcIl0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBQcmVkaWN0aW9ucyBBUEkgTGFtYmRhXG4gICAgdGhpcy5wcmVkaWN0aW9uc0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiUHJlZGljdGlvbnNMYW1iZGFcIiwge1xuICAgICAgZW50cnk6IFwibGFtYmRhL2FwaS9wcmVkaWN0aW9ucy50c1wiLFxuICAgICAgaGFuZGxlcjogXCJoYW5kbGVyXCIsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIENVUlJFTlRfUFJJQ0VTX1RBQkxFOiBwcm9wcy5jdXJyZW50UHJpY2VzVGFibGUsXG4gICAgICAgIFBSRURJQ1RJT05TX0NBQ0hFX1RBQkxFOiBwcm9wcy5wcmVkaWN0aW9uc1RhYmxlIHx8IFwiXCIsXG4gICAgICAgIERFTUFORF9FTkRQT0lOVDogcHJvcHMuZGVtYW5kRW5kcG9pbnQgfHwgXCJ0Y2ctZGVtYW5kLWVuZHBvaW50XCIsXG4gICAgICAgIEFOT01BTFlfRU5EUE9JTlQ6IHByb3BzLmFub21hbHlFbmRwb2ludCB8fCBcInRjZy1hbm9tYWx5LWVuZHBvaW50XCIsXG4gICAgICAgIFRJTUlOR19FTkRQT0lOVDogcHJvcHMudGltaW5nRW5kcG9pbnQgfHwgXCJ0Y2ctdGltaW5nLWVuZHBvaW50XCIsXG4gICAgICB9LFxuICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgICBzb3VyY2VNYXA6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgU2FnZU1ha2VyIGludm9rZSBwZXJtaXNzaW9uc1xuICAgIHRoaXMucHJlZGljdGlvbnNMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXCJzYWdlbWFrZXI6SW52b2tlRW5kcG9pbnRcIl0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOnNhZ2VtYWtlcjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06ZW5kcG9pbnQvKmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICB0aGlzLnByZWRpY3Rpb25zTGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1wiZHluYW1vZGI6R2V0SXRlbVwiLCBcImR5bmFtb2RiOlF1ZXJ5XCJdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvJHtwcm9wcy5jdXJyZW50UHJpY2VzVGFibGV9YCxcbiAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvJHtwcm9wcy5jdXJyZW50UHJpY2VzVGFibGV9L2luZGV4LypgLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEFQSSBHQVRFV0FZXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIFJFU1QgQVBJXG4gICAgdGhpcy5hcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsIFwiVGNnRGF0YUFwaVwiLCB7XG4gICAgICByZXN0QXBpTmFtZTogXCJUQ0cgRGF0YSBBUElcIixcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFQSSBmb3IgVENHIHByaWNlIGRhdGEgYW5kIE1MIHByZWRpY3Rpb25zXCIsXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogXCJ2MVwiLFxuICAgICAgICB0aHJvdHRsaW5nUmF0ZUxpbWl0OiAxMDAsXG4gICAgICAgIHRocm90dGxpbmdCdXJzdExpbWl0OiAyMDAsXG4gICAgICAgIGxvZ2dpbmdMZXZlbDogYXBpZ2F0ZXdheS5NZXRob2RMb2dnaW5nTGV2ZWwuSU5GTyxcbiAgICAgICAgZGF0YVRyYWNlRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgbWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxuICAgICAgICBhbGxvd01ldGhvZHM6IGFwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbXCJDb250ZW50LVR5cGVcIiwgXCJBdXRob3JpemF0aW9uXCIsIFwiWC1BcGktS2V5XCJdLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFQSSBLZXkgYW5kIFVzYWdlIFBsYW5cbiAgICBjb25zdCBhcGlLZXkgPSB0aGlzLmFwaS5hZGRBcGlLZXkoXCJUY2dBcGlLZXlcIiwge1xuICAgICAgYXBpS2V5TmFtZTogXCJ0Y2ctZGF0YS1hcGkta2V5XCIsXG4gICAgICBkZXNjcmlwdGlvbjogXCJBUEkga2V5IGZvciBUQ0cgRGF0YSBBUElcIixcbiAgICB9KTtcblxuICAgIGNvbnN0IHVzYWdlUGxhbiA9IHRoaXMuYXBpLmFkZFVzYWdlUGxhbihcIlRjZ1VzYWdlUGxhblwiLCB7XG4gICAgICBuYW1lOiBcIlN0YW5kYXJkXCIsXG4gICAgICB0aHJvdHRsZToge1xuICAgICAgICByYXRlTGltaXQ6IDUwLFxuICAgICAgICBidXJzdExpbWl0OiAxMDAsXG4gICAgICB9LFxuICAgICAgcXVvdGE6IHtcbiAgICAgICAgbGltaXQ6IDEwMDAwLFxuICAgICAgICBwZXJpb2Q6IGFwaWdhdGV3YXkuUGVyaW9kLkRBWSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB1c2FnZVBsYW4uYWRkQXBpS2V5KGFwaUtleSk7XG4gICAgdXNhZ2VQbGFuLmFkZEFwaVN0YWdlKHsgc3RhZ2U6IHRoaXMuYXBpLmRlcGxveW1lbnRTdGFnZSB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBQUklDRVMgRU5EUE9JTlRTXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgcHJpY2VzUmVzb3VyY2UgPSB0aGlzLmFwaS5yb290LmFkZFJlc291cmNlKFwicHJpY2VzXCIpO1xuICAgIGNvbnN0IHByaWNlc0ludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24odGhpcy5wcmljZXNMYW1iZGEpO1xuXG4gICAgLy8gR0VUIC9wcmljZXMvc2VhcmNoXG4gICAgY29uc3Qgc2VhcmNoUmVzb3VyY2UgPSBwcmljZXNSZXNvdXJjZS5hZGRSZXNvdXJjZShcInNlYXJjaFwiKTtcbiAgICBzZWFyY2hSZXNvdXJjZS5hZGRNZXRob2QoXCJHRVRcIiwgcHJpY2VzSW50ZWdyYXRpb24sIHtcbiAgICAgIGFwaUtleVJlcXVpcmVkOiB0cnVlLFxuICAgICAgcmVxdWVzdFBhcmFtZXRlcnM6IHtcbiAgICAgICAgXCJtZXRob2QucmVxdWVzdC5xdWVyeXN0cmluZy5xXCI6IHRydWUsXG4gICAgICAgIFwibWV0aG9kLnJlcXVlc3QucXVlcnlzdHJpbmcubGltaXRcIjogZmFsc2UsXG4gICAgICB9LFxuICAgICAgcmVxdWVzdFZhbGlkYXRvck9wdGlvbnM6IHtcbiAgICAgICAgdmFsaWRhdGVSZXF1ZXN0UGFyYW1ldGVyczogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBHRVQgL3ByaWNlcy9tYXJrZXRcbiAgICBjb25zdCBtYXJrZXRSZXNvdXJjZSA9IHByaWNlc1Jlc291cmNlLmFkZFJlc291cmNlKFwibWFya2V0XCIpO1xuICAgIG1hcmtldFJlc291cmNlLmFkZE1ldGhvZChcIkdFVFwiLCBwcmljZXNJbnRlZ3JhdGlvbiwge1xuICAgICAgYXBpS2V5UmVxdWlyZWQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBHRVQgL3ByaWNlcy9hcmJpdHJhZ2VcbiAgICBjb25zdCBhcmJpdHJhZ2VSZXNvdXJjZSA9IHByaWNlc1Jlc291cmNlLmFkZFJlc291cmNlKFwiYXJiaXRyYWdlXCIpO1xuICAgIGFyYml0cmFnZVJlc291cmNlLmFkZE1ldGhvZChcIkdFVFwiLCBwcmljZXNJbnRlZ3JhdGlvbiwge1xuICAgICAgYXBpS2V5UmVxdWlyZWQ6IHRydWUsXG4gICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICBcIm1ldGhvZC5yZXF1ZXN0LnF1ZXJ5c3RyaW5nLmxpbWl0XCI6IGZhbHNlLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEdFVCAvcHJpY2VzL3tjYXJkSWR9XG4gICAgY29uc3QgY2FyZFByaWNlUmVzb3VyY2UgPSBwcmljZXNSZXNvdXJjZS5hZGRSZXNvdXJjZShcIntjYXJkSWR9XCIpO1xuICAgIGNhcmRQcmljZVJlc291cmNlLmFkZE1ldGhvZChcIkdFVFwiLCBwcmljZXNJbnRlZ3JhdGlvbiwge1xuICAgICAgYXBpS2V5UmVxdWlyZWQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBHRVQgL3ByaWNlcy97Y2FyZElkfS9oaXN0b3J5XG4gICAgY29uc3QgaGlzdG9yeVJlc291cmNlID0gY2FyZFByaWNlUmVzb3VyY2UuYWRkUmVzb3VyY2UoXCJoaXN0b3J5XCIpO1xuICAgIGhpc3RvcnlSZXNvdXJjZS5hZGRNZXRob2QoXCJHRVRcIiwgcHJpY2VzSW50ZWdyYXRpb24sIHtcbiAgICAgIGFwaUtleVJlcXVpcmVkOiB0cnVlLFxuICAgICAgcmVxdWVzdFBhcmFtZXRlcnM6IHtcbiAgICAgICAgXCJtZXRob2QucmVxdWVzdC5xdWVyeXN0cmluZy5kYXlzXCI6IGZhbHNlLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBQUkVESUNUSU9OUyBFTkRQT0lOVFNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCBwcmVkaWN0aW9uc1Jlc291cmNlID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZShcInByZWRpY3Rpb25zXCIpO1xuICAgIGNvbnN0IHByZWRpY3Rpb25zSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbih0aGlzLnByZWRpY3Rpb25zTGFtYmRhKTtcblxuICAgIC8vIEdFVCAvcHJlZGljdGlvbnMve2NhcmRJZH1cbiAgICBjb25zdCBjYXJkUHJlZGljdGlvblJlc291cmNlID0gcHJlZGljdGlvbnNSZXNvdXJjZS5hZGRSZXNvdXJjZShcIntjYXJkSWR9XCIpO1xuICAgIGNhcmRQcmVkaWN0aW9uUmVzb3VyY2UuYWRkTWV0aG9kKFwiR0VUXCIsIHByZWRpY3Rpb25zSW50ZWdyYXRpb24sIHtcbiAgICAgIGFwaUtleVJlcXVpcmVkOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gR0VUIC9wcmVkaWN0aW9ucy97Y2FyZElkfS9kZW1hbmRcbiAgICBjb25zdCBkZW1hbmRSZXNvdXJjZSA9IGNhcmRQcmVkaWN0aW9uUmVzb3VyY2UuYWRkUmVzb3VyY2UoXCJkZW1hbmRcIik7XG4gICAgZGVtYW5kUmVzb3VyY2UuYWRkTWV0aG9kKFwiR0VUXCIsIHByZWRpY3Rpb25zSW50ZWdyYXRpb24sIHtcbiAgICAgIGFwaUtleVJlcXVpcmVkOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gR0VUIC9wcmVkaWN0aW9ucy97Y2FyZElkfS9hbm9tYWx5XG4gICAgY29uc3QgYW5vbWFseVJlc291cmNlID0gY2FyZFByZWRpY3Rpb25SZXNvdXJjZS5hZGRSZXNvdXJjZShcImFub21hbHlcIik7XG4gICAgYW5vbWFseVJlc291cmNlLmFkZE1ldGhvZChcIkdFVFwiLCBwcmVkaWN0aW9uc0ludGVncmF0aW9uLCB7XG4gICAgICBhcGlLZXlSZXF1aXJlZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEdFVCAvcHJlZGljdGlvbnMve2NhcmRJZH0vdGltaW5nXG4gICAgY29uc3QgdGltaW5nUmVzb3VyY2UgPSBjYXJkUHJlZGljdGlvblJlc291cmNlLmFkZFJlc291cmNlKFwidGltaW5nXCIpO1xuICAgIHRpbWluZ1Jlc291cmNlLmFkZE1ldGhvZChcIkdFVFwiLCBwcmVkaWN0aW9uc0ludGVncmF0aW9uLCB7XG4gICAgICBhcGlLZXlSZXF1aXJlZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBXQUYgKFdlYiBBcHBsaWNhdGlvbiBGaXJld2FsbClcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCB3ZWJBY2wgPSBuZXcgd2FmLkNmbldlYkFDTCh0aGlzLCBcIkFwaVdlYkFjbFwiLCB7XG4gICAgICBzY29wZTogXCJSRUdJT05BTFwiLFxuICAgICAgZGVmYXVsdEFjdGlvbjogeyBhbGxvdzoge30gfSxcbiAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICBtZXRyaWNOYW1lOiBcIlRjZ0FwaVdhZlwiLFxuICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHJ1bGVzOiBbXG4gICAgICAgIC8vIFJhdGUgbGltaXRpbmcgcnVsZVxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogXCJSYXRlTGltaXRSdWxlXCIsXG4gICAgICAgICAgcHJpb3JpdHk6IDEsXG4gICAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgICByYXRlQmFzZWRTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgbGltaXQ6IDIwMDAsIC8vIDIwMDAgcmVxdWVzdHMgcGVyIDUgbWludXRlc1xuICAgICAgICAgICAgICBhZ2dyZWdhdGVLZXlUeXBlOiBcIklQXCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYWN0aW9uOiB7IGJsb2NrOiB7fSB9LFxuICAgICAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6IFwiUmF0ZUxpbWl0UnVsZVwiLFxuICAgICAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICAvLyBBV1MgTWFuYWdlZCBSdWxlcyAtIENvbW1vbiBSdWxlIFNldFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogXCJBV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0XCIsXG4gICAgICAgICAgcHJpb3JpdHk6IDIsXG4gICAgICAgICAgb3ZlcnJpZGVBY3Rpb246IHsgbm9uZToge30gfSxcbiAgICAgICAgICBzdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgIG1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgdmVuZG9yTmFtZTogXCJBV1NcIixcbiAgICAgICAgICAgICAgbmFtZTogXCJBV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0XCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogXCJBV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0XCIsXG4gICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIC8vIEJsb2NrIGJhZCBib3RzXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiBcIkFXU01hbmFnZWRSdWxlc0JvdENvbnRyb2xSdWxlU2V0XCIsXG4gICAgICAgICAgcHJpb3JpdHk6IDMsXG4gICAgICAgICAgb3ZlcnJpZGVBY3Rpb246IHsgbm9uZToge30gfSxcbiAgICAgICAgICBzdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgIG1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgdmVuZG9yTmFtZTogXCJBV1NcIixcbiAgICAgICAgICAgICAgbmFtZTogXCJBV1NNYW5hZ2VkUnVsZXNCb3RDb250cm9sUnVsZVNldFwiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6IFwiQVdTTWFuYWdlZFJ1bGVzQm90Q29udHJvbFJ1bGVTZXRcIixcbiAgICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBBc3NvY2lhdGUgV0FGIHdpdGggQVBJIEdhdGV3YXlcbiAgICBuZXcgd2FmLkNmbldlYkFDTEFzc29jaWF0aW9uKHRoaXMsIFwiQXBpV2FmQXNzb2NpYXRpb25cIiwge1xuICAgICAgcmVzb3VyY2VBcm46IHRoaXMuYXBpLmRlcGxveW1lbnRTdGFnZS5zdGFnZUFybixcbiAgICAgIHdlYkFjbEFybjogd2ViQWNsLmF0dHJBcm4sXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gT1VUUFVUU1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiQXBpRW5kcG9pbnRcIiwge1xuICAgICAgdmFsdWU6IHRoaXMuYXBpLnVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFQSSBHYXRld2F5IGVuZHBvaW50IFVSTFwiLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBcGlLZXlJZFwiLCB7XG4gICAgICB2YWx1ZTogYXBpS2V5LmtleUlkLFxuICAgICAgZGVzY3JpcHRpb246IFwiQVBJIEtleSBJRCAocmV0cmlldmUgdmFsdWUgZnJvbSBBV1MgQ29uc29sZSlcIixcbiAgICB9KTtcbiAgfVxufVxuIl19