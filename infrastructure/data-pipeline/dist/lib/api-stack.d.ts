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
import { Construct } from "constructs";
interface ApiStackProps extends cdk.StackProps {
    currentPricesTable: string;
    arbitrageTable: string;
    predictionsTable?: string;
    timestreamDatabase: string;
    demandEndpoint?: string;
    anomalyEndpoint?: string;
    timingEndpoint?: string;
}
export declare class ApiStack extends cdk.Stack {
    readonly api: apigateway.RestApi;
    readonly pricesLambda: lambda.Function;
    readonly predictionsLambda: lambda.Function;
    constructor(scope: Construct, id: string, props: ApiStackProps);
}
export {};
