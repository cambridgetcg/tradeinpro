/**
 * AWS CDK Stack for CardMarket Price Pipeline
 *
 * Deploys:
 * - ECR Repository
 * - ECS Fargate Task
 * - EventBridge Schedule
 * - CloudWatch Alarms
 * - IAM Roles
 *
 * Usage:
 *   npx cdk deploy CardMarketPipelineStack
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface CardMarketPipelineStackProps extends cdk.StackProps {
  vpcId?: string;
  alertEmail?: string;
  brightdataToken?: string;
  databaseUrl?: string;
}

export class CardMarketPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: CardMarketPipelineStackProps) {
    super(scope, id, props);

    // ========================================================================
    // VPC - Use existing or create new
    // ========================================================================
    const vpc = props?.vpcId
      ? ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: props.vpcId })
      : new ec2.Vpc(this, 'ScraperVpc', {
          maxAzs: 2,
          natGateways: 1,
          subnetConfiguration: [
            {
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
              cidrMask: 24,
            },
            {
              name: 'Private',
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
              cidrMask: 24,
            },
          ],
        });

    // ========================================================================
    // Secrets Manager
    // ========================================================================
    const brightdataSecret = new secretsmanager.Secret(this, 'BrightDataSecret', {
      secretName: 'cardmarket-scraper/brightdata',
      description: 'Bright Data API credentials for CardMarket scraper',
      secretObjectValue: {
        API_TOKEN: cdk.SecretValue.unsafePlainText(props?.brightdataToken || 'REPLACE_ME'),
      },
    });

    const databaseSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: 'cardmarket-scraper/database',
      description: 'Database connection string for CardMarket scraper',
      secretObjectValue: {
        DATABASE_URL: cdk.SecretValue.unsafePlainText(props?.databaseUrl || 'REPLACE_ME'),
      },
    });

    // ========================================================================
    // ECR Repository
    // ========================================================================
    const repository = new ecr.Repository(this, 'ScraperRepository', {
      repositoryName: 'cardmarket-scraper',
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 5,
          description: 'Keep only 5 most recent images',
        },
      ],
    });

    // ========================================================================
    // ECS Cluster
    // ========================================================================
    const cluster = new ecs.Cluster(this, 'ScraperCluster', {
      vpc,
      clusterName: 'cardmarket-cluster',
      containerInsights: true,
    });

    // ========================================================================
    // CloudWatch Log Group
    // ========================================================================
    const logGroup = new logs.LogGroup(this, 'ScraperLogGroup', {
      logGroupName: '/ecs/cardmarket-scraper',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ========================================================================
    // ECS Task Definition
    // ========================================================================
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ScraperTaskDef', {
      family: 'cardmarket-scraper',
      memoryLimitMiB: 1024,
      cpu: 512,
    });

    // Add container
    const container = taskDefinition.addContainer('scraper', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: 'scraper',
      }),
      secrets: {
        BRIGHTDATA_TOKEN: ecs.Secret.fromSecretsManager(brightdataSecret, 'API_TOKEN'),
        DATABASE_URL: ecs.Secret.fromSecretsManager(databaseSecret, 'DATABASE_URL'),
      },
      environment: {
        NODE_ENV: 'production',
        AWS_REGION: this.region,
        ENVIRONMENT: 'production',
      },
    });

    // Grant secrets access
    brightdataSecret.grantRead(taskDefinition.taskRole);
    databaseSecret.grantRead(taskDefinition.taskRole);

    // Grant CloudWatch metrics permission
    taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'CardMarket/Scraper',
          },
        },
      })
    );

    // ========================================================================
    // Security Group
    // ========================================================================
    const securityGroup = new ec2.SecurityGroup(this, 'ScraperSecurityGroup', {
      vpc,
      description: 'Security group for CardMarket scraper',
      allowAllOutbound: true,
    });

    // ========================================================================
    // EventBridge Schedule (Daily at 2 AM UTC)
    // ========================================================================
    const scheduleRule = new events.Rule(this, 'DailySchedule', {
      ruleName: 'cardmarket-daily-archive',
      description: 'Trigger CardMarket scraper daily at 2 AM UTC',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '2',
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    // Add ECS task as target
    scheduleRule.addTarget(
      new targets.EcsTask({
        cluster,
        taskDefinition,
        taskCount: 1,
        subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [securityGroup],
      })
    );

    // ========================================================================
    // SNS Topic for Alerts
    // ========================================================================
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'cardmarket-scraper-alerts',
      displayName: 'CardMarket Scraper Alerts',
    });

    // Add email subscription if provided
    if (props?.alertEmail) {
      alertTopic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
    }

    // ========================================================================
    // CloudWatch Alarms
    // ========================================================================

    // Alarm: Task Failed
    const taskFailedMetric = new cloudwatch.Metric({
      namespace: 'AWS/ECS',
      metricName: 'TaskCount',
      dimensionsMap: {
        ClusterName: cluster.clusterName,
        ServiceName: 'cardmarket-scraper',
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // Alarm: High Error Rate
    const errorRateAlarm = new cloudwatch.Alarm(this, 'HighErrorRateAlarm', {
      alarmName: 'cardmarket-scraper-high-error-rate',
      alarmDescription: 'CardMarket scraper has high error rate',
      metric: new cloudwatch.Metric({
        namespace: 'CardMarket/Scraper',
        metricName: 'ErrorCount',
        statistic: 'Sum',
        period: cdk.Duration.hours(1),
      }),
      threshold: 50,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    errorRateAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alertTopic));

    // Alarm: Long Duration
    const durationAlarm = new cloudwatch.Alarm(this, 'LongDurationAlarm', {
      alarmName: 'cardmarket-scraper-long-duration',
      alarmDescription: 'CardMarket scraper running longer than 7 hours',
      metric: new cloudwatch.Metric({
        namespace: 'CardMarket/Scraper',
        metricName: 'DurationSeconds',
        statistic: 'Maximum',
        period: cdk.Duration.hours(1),
      }),
      threshold: 7 * 60 * 60, // 7 hours
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    durationAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alertTopic));

    // ========================================================================
    // CloudWatch Dashboard
    // ========================================================================
    const dashboard = new cloudwatch.Dashboard(this, 'ScraperDashboard', {
      dashboardName: 'CardMarket-Scraper',
    });

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '# CardMarket Scraper Dashboard',
        width: 24,
        height: 1,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'Cards Scraped (24h)',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'CardMarket/Scraper',
            metricName: 'CardsScraped',
            statistic: 'Sum',
            period: cdk.Duration.hours(24),
          }),
        ],
        width: 6,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Errors (24h)',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'CardMarket/Scraper',
            metricName: 'ErrorCount',
            statistic: 'Sum',
            period: cdk.Duration.hours(24),
          }),
        ],
        width: 6,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'API Calls (24h)',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'CardMarket/Scraper',
            metricName: 'APICallsCount',
            statistic: 'Sum',
            period: cdk.Duration.hours(24),
          }),
        ],
        width: 6,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Last Duration (min)',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'CardMarket/Scraper',
            metricName: 'DurationSeconds',
            statistic: 'Maximum',
            period: cdk.Duration.hours(24),
          }),
        ],
        width: 6,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Cards Scraped Over Time',
        left: [
          new cloudwatch.Metric({
            namespace: 'CardMarket/Scraper',
            metricName: 'CardsScraped',
            statistic: 'Sum',
            period: cdk.Duration.hours(1),
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Errors Over Time',
        left: [
          new cloudwatch.Metric({
            namespace: 'CardMarket/Scraper',
            metricName: 'ErrorCount',
            statistic: 'Sum',
            period: cdk.Duration.hours(1),
          }),
        ],
        width: 12,
      })
    );

    // ========================================================================
    // Outputs
    // ========================================================================
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI',
    });

    new cdk.CfnOutput(this, 'ClusterArn', {
      value: cluster.clusterArn,
      description: 'ECS Cluster ARN',
    });

    new cdk.CfnOutput(this, 'TaskDefinitionArn', {
      value: taskDefinition.taskDefinitionArn,
      description: 'Task Definition ARN',
    });

    new cdk.CfnOutput(this, 'LogGroupName', {
      value: logGroup.logGroupName,
      description: 'CloudWatch Log Group',
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=CardMarket-Scraper`,
      description: 'CloudWatch Dashboard URL',
    });
  }
}

// ============================================================================
// CDK App Entry Point
// ============================================================================
const app = new cdk.App();

new CardMarketPipelineStack(app, 'CardMarketPipelineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  alertEmail: process.env.ALERT_EMAIL,
  // Secrets should be set via AWS Console or CLI, not here
});

app.synth();
