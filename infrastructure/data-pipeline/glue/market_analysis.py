"""
Market Analysis Glue ETL Job

Performs deep cross-market analysis to identify:
- Arbitrage opportunities
- Market efficiency metrics
- Regional price disparities
- Liquidity analysis
- Market trends and cycles

Schedule: Daily at 6 AM UTC
Input: s3://bucket/processed/
Output: s3://bucket/analytics/
"""

import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from pyspark.sql import functions as F
from pyspark.sql.window import Window
from datetime import datetime, timedelta
import json

# Initialize Glue context
args = getResolvedOptions(
    sys.argv,
    [
        "JOB_NAME",
        "S3_PROCESSED_PATH",
        "S3_ANALYTICS_PATH",
        "CATALOG_DATABASE",
        "ANALYSIS_DATE",
    ],
)

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)

# Configuration
PROCESSED_PATH = args["S3_PROCESSED_PATH"]
ANALYTICS_PATH = args["S3_ANALYTICS_PATH"]
DATABASE = args["CATALOG_DATABASE"]
ANALYSIS_DATE = args.get("ANALYSIS_DATE", datetime.now().strftime("%Y-%m-%d"))

# Market definitions
MARKETS = {
    "US": ["tcgplayer", "ebay_us"],
    "EU": ["cardmarket", "ebay_gb", "ebay_de"],
    "JP": ["yahoo_jp", "mercari_jp"],
}

# Platform fee structure for profit calculations
PLATFORM_FEES = {
    "tcgplayer": {"seller_fee": 0.1025, "buyer_fee": 0, "fixed_fee": 0.30},
    "cardmarket": {"seller_fee": 0.05, "buyer_fee": 0, "fixed_fee": 0},
    "ebay_us": {"seller_fee": 0.1325, "buyer_fee": 0, "fixed_fee": 0.30},
    "ebay_gb": {"seller_fee": 0.1325, "buyer_fee": 0, "fixed_fee": 0.30},
    "ebay_de": {"seller_fee": 0.1325, "buyer_fee": 0, "fixed_fee": 0.30},
    "yahoo_jp": {"seller_fee": 0.088, "buyer_fee": 0, "fixed_fee": 0},
    "mercari_jp": {"seller_fee": 0.10, "buyer_fee": 0, "fixed_fee": 0},
}

# Shipping costs between regions
SHIPPING_COSTS = {
    ("US", "US"): 4,
    ("EU", "EU"): 3,
    ("JP", "JP"): 5,
    ("US", "EU"): 8,
    ("EU", "US"): 8,
    ("JP", "US"): 15,
    ("US", "JP"): 12,
    ("JP", "EU"): 18,
    ("EU", "JP"): 15,
}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def get_region(source):
    """Get region for a source."""
    for region, sources in MARKETS.items():
        if source in sources:
            return region
    return "OTHER"


# Register UDF
get_region_udf = F.udf(get_region)


# =============================================================================
# ARBITRAGE ANALYSIS
# =============================================================================


def calculate_arbitrage_opportunities(prices_df):
    """Calculate all cross-market arbitrage opportunities."""

    # Filter to NM condition only for arbitrage
    nm_prices = prices_df.filter(F.col("condition") == "NM")

    # Get latest price per card/source
    window = Window.partitionBy("card_id", "source").orderBy(F.col("date").desc())
    latest_prices = (
        nm_prices.withColumn("rank", F.row_number().over(window))
        .filter(F.col("rank") == 1)
        .select("card_id", "source", "avg_price", "total_listings")
    )

    # Add region
    latest_prices = latest_prices.withColumn("region", get_region_udf(F.col("source")))

    # Self-join to compare all pairs
    buy_prices = latest_prices.alias("buy")
    sell_prices = latest_prices.alias("sell")

    pairs = buy_prices.join(
        sell_prices,
        (F.col("buy.card_id") == F.col("sell.card_id"))
        & (F.col("buy.source") != F.col("sell.source")),
    ).select(
        F.col("buy.card_id").alias("card_id"),
        F.col("buy.source").alias("buy_source"),
        F.col("sell.source").alias("sell_source"),
        F.col("buy.region").alias("buy_region"),
        F.col("sell.region").alias("sell_region"),
        F.col("buy.avg_price").alias("buy_price"),
        F.col("sell.avg_price").alias("sell_price"),
        F.col("buy.total_listings").alias("buy_listings"),
        F.col("sell.total_listings").alias("sell_listings"),
    )

    # Calculate spreads and profits
    arbitrage = pairs.withColumn(
        "raw_spread", (F.col("sell_price") - F.col("buy_price")) / F.col("sell_price")
    )

    # Filter to positive spreads only
    arbitrage = arbitrage.filter(F.col("raw_spread") > 0)

    # Calculate net profit (simplified - would use lookup for exact fees)
    # Assuming average fees and shipping
    arbitrage = arbitrage.withColumn(
        "estimated_fees",
        F.col("sell_price") * 0.12 + F.col("buy_price") * 0.02 + F.lit(0.30),  # Seller fees  # Buyer fees  # Fixed fees
    ).withColumn(
        "estimated_shipping",
        F.when(
            F.col("buy_region") == F.col("sell_region"), F.lit(4)  # Same region
        ).otherwise(F.lit(12)),  # Cross region
    )

    arbitrage = arbitrage.withColumn(
        "net_profit",
        F.col("sell_price")
        - F.col("buy_price")
        - F.col("estimated_fees")
        - F.col("estimated_shipping"),
    ).withColumn("roi", F.col("net_profit") / F.col("buy_price"))

    # Filter to profitable opportunities
    profitable = arbitrage.filter(F.col("net_profit") > 0)

    # Add urgency classification
    profitable = profitable.withColumn(
        "urgency",
        F.when(F.col("roi") > 0.30, "immediate")
        .when(F.col("roi") > 0.20, "high")
        .when(F.col("roi") > 0.15, "medium")
        .otherwise("low"),
    )

    # Add liquidity score
    profitable = profitable.withColumn(
        "liquidity_score",
        F.log1p(F.col("buy_listings")) * F.log1p(F.col("sell_listings")),
    )

    return profitable


# =============================================================================
# MARKET EFFICIENCY ANALYSIS
# =============================================================================


def analyze_market_efficiency(prices_df):
    """Analyze market efficiency and price convergence."""

    # Get average price per card across all sources
    card_prices = prices_df.groupBy("card_id", "date").agg(
        F.avg("avg_price").alias("market_avg"),
        F.stddev("avg_price").alias("market_std"),
        F.min("avg_price").alias("market_min"),
        F.max("avg_price").alias("market_max"),
        F.count("source").alias("source_count"),
    )

    # Calculate efficiency metrics
    efficiency = card_prices.withColumn(
        "price_dispersion", F.col("market_std") / F.col("market_avg")
    ).withColumn(
        "price_range",
        (F.col("market_max") - F.col("market_min")) / F.col("market_avg"),
    )

    # Market efficiency score (lower dispersion = more efficient)
    efficiency = efficiency.withColumn(
        "efficiency_score", 1 / (1 + F.col("price_dispersion"))
    )

    # Aggregate by date for market-wide metrics
    daily_efficiency = efficiency.groupBy("date").agg(
        F.avg("efficiency_score").alias("avg_efficiency"),
        F.avg("price_dispersion").alias("avg_dispersion"),
        F.count("*").alias("cards_tracked"),
        F.sum(F.when(F.col("efficiency_score") > 0.9, 1).otherwise(0)).alias(
            "efficient_cards"
        ),
        F.sum(F.when(F.col("efficiency_score") < 0.7, 1).otherwise(0)).alias(
            "inefficient_cards"
        ),
    )

    daily_efficiency = daily_efficiency.withColumn(
        "efficient_pct", F.col("efficient_cards") / F.col("cards_tracked")
    )

    return efficiency, daily_efficiency


# =============================================================================
# REGIONAL ANALYSIS
# =============================================================================


def analyze_regional_prices(prices_df):
    """Analyze price differences between regions."""

    # Add region to prices
    regional = prices_df.withColumn("region", get_region_udf(F.col("source")))

    # Average price by card and region
    by_region = regional.groupBy("card_id", "region", "date").agg(
        F.avg("avg_price").alias("region_avg"),
        F.sum("total_listings").alias("region_listings"),
    )

    # Pivot to compare regions
    pivoted = (
        by_region.groupBy("card_id", "date")
        .pivot("region")
        .agg(F.first("region_avg"), F.first("region_listings"))
    )

    # Calculate regional spreads
    if "US_first(region_avg)" in pivoted.columns and "EU_first(region_avg)" in pivoted.columns:
        pivoted = pivoted.withColumn(
            "us_eu_spread",
            (F.col("US_first(region_avg)") - F.col("EU_first(region_avg)"))
            / F.greatest(F.col("US_first(region_avg)"), F.col("EU_first(region_avg)")),
        )

    if "US_first(region_avg)" in pivoted.columns and "JP_first(region_avg)" in pivoted.columns:
        pivoted = pivoted.withColumn(
            "us_jp_spread",
            (F.col("US_first(region_avg)") - F.col("JP_first(region_avg)"))
            / F.greatest(F.col("US_first(region_avg)"), F.col("JP_first(region_avg)")),
        )

    if "EU_first(region_avg)" in pivoted.columns and "JP_first(region_avg)" in pivoted.columns:
        pivoted = pivoted.withColumn(
            "eu_jp_spread",
            (F.col("EU_first(region_avg)") - F.col("JP_first(region_avg)"))
            / F.greatest(F.col("EU_first(region_avg)"), F.col("JP_first(region_avg)")),
        )

    # Daily regional summary
    daily_regional = regional.groupBy("region", "date").agg(
        F.avg("avg_price").alias("avg_price"),
        F.sum("total_listings").alias("total_listings"),
        F.countDistinct("card_id").alias("unique_cards"),
    )

    return pivoted, daily_regional


# =============================================================================
# LIQUIDITY ANALYSIS
# =============================================================================


def analyze_liquidity(prices_df):
    """Analyze market liquidity by source and card."""

    # Liquidity by source and date
    source_liquidity = prices_df.groupBy("source", "date").agg(
        F.sum("total_listings").alias("total_listings"),
        F.countDistinct("card_id").alias("unique_cards"),
        F.avg("total_listings").alias("avg_listings_per_card"),
    )

    # Add region
    source_liquidity = source_liquidity.withColumn("region", get_region_udf(F.col("source")))

    # Card-level liquidity
    card_liquidity = prices_df.groupBy("card_id", "date").agg(
        F.sum("total_listings").alias("total_listings"),
        F.countDistinct("source").alias("source_coverage"),
    )

    # Liquidity score
    card_liquidity = card_liquidity.withColumn(
        "liquidity_score",
        F.log1p(F.col("total_listings")) * F.col("source_coverage"),
    )

    # Classify liquidity
    card_liquidity = card_liquidity.withColumn(
        "liquidity_tier",
        F.when(F.col("liquidity_score") > 10, "high")
        .when(F.col("liquidity_score") > 5, "medium")
        .otherwise("low"),
    )

    return source_liquidity, card_liquidity


# =============================================================================
# MARKET CYCLE ANALYSIS
# =============================================================================


def analyze_market_cycles(prices_df, window_days=30):
    """Analyze market cycles and trends."""

    # Daily market totals
    daily_market = prices_df.groupBy("date").agg(
        F.sum("avg_price").alias("total_value"),
        F.avg("avg_price").alias("avg_price"),
        F.sum("total_listings").alias("total_listings"),
        F.countDistinct("card_id").alias("active_cards"),
    )

    # Sort by date
    daily_market = daily_market.orderBy("date")

    # Calculate moving averages
    window = Window.orderBy("date").rowsBetween(-window_days + 1, 0)

    daily_market = daily_market.withColumn(
        "avg_price_ma", F.avg("avg_price").over(window)
    ).withColumn("listings_ma", F.avg("total_listings").over(window))

    # Detect trend
    daily_market = daily_market.withColumn(
        "price_trend",
        F.when(F.col("avg_price") > F.col("avg_price_ma") * 1.05, "bullish")
        .when(F.col("avg_price") < F.col("avg_price_ma") * 0.95, "bearish")
        .otherwise("neutral"),
    )

    # Volume trend
    daily_market = daily_market.withColumn(
        "volume_trend",
        F.when(F.col("total_listings") > F.col("listings_ma") * 1.1, "high")
        .when(F.col("total_listings") < F.col("listings_ma") * 0.9, "low")
        .otherwise("normal"),
    )

    # Market phase classification
    daily_market = daily_market.withColumn(
        "market_phase",
        F.when(
            (F.col("price_trend") == "bullish") & (F.col("volume_trend") == "high"),
            "markup",
        )
        .when(
            (F.col("price_trend") == "bullish") & (F.col("volume_trend") == "low"),
            "distribution",
        )
        .when(
            (F.col("price_trend") == "bearish") & (F.col("volume_trend") == "high"),
            "markdown",
        )
        .when(
            (F.col("price_trend") == "bearish") & (F.col("volume_trend") == "low"),
            "accumulation",
        )
        .otherwise("consolidation"),
    )

    return daily_market


# =============================================================================
# MAIN
# =============================================================================


def main():
    print(f"Analysis date: {ANALYSIS_DATE}")
    print(f"Input path: {PROCESSED_PATH}")
    print(f"Output path: {ANALYTICS_PATH}")

    # Load processed data
    print("Loading processed data...")
    prices_df = spark.read.parquet(f"{PROCESSED_PATH}/daily_aggregates/")
    prices_df.cache()

    total_records = prices_df.count()
    print(f"Loaded {total_records} price records")

    # Arbitrage analysis
    print("\nAnalyzing arbitrage opportunities...")
    arbitrage = calculate_arbitrage_opportunities(prices_df)
    arbitrage_count = arbitrage.count()
    print(f"  Found {arbitrage_count} arbitrage opportunities")

    arbitrage.write.mode("overwrite").partitionBy("urgency").parquet(
        f"{ANALYTICS_PATH}/arbitrage_opportunities/"
    )

    # Market efficiency analysis
    print("\nAnalyzing market efficiency...")
    efficiency, daily_efficiency = analyze_market_efficiency(prices_df)

    efficiency.write.mode("overwrite").partitionBy("date").parquet(
        f"{ANALYTICS_PATH}/market_efficiency/"
    )
    daily_efficiency.write.mode("overwrite").parquet(
        f"{ANALYTICS_PATH}/daily_efficiency/"
    )

    # Regional analysis
    print("\nAnalyzing regional prices...")
    regional_prices, daily_regional = analyze_regional_prices(prices_df)

    regional_prices.write.mode("overwrite").partitionBy("date").parquet(
        f"{ANALYTICS_PATH}/regional_prices/"
    )
    daily_regional.write.mode("overwrite").partitionBy("region").parquet(
        f"{ANALYTICS_PATH}/daily_regional/"
    )

    # Liquidity analysis
    print("\nAnalyzing market liquidity...")
    source_liquidity, card_liquidity = analyze_liquidity(prices_df)

    source_liquidity.write.mode("overwrite").partitionBy("region").parquet(
        f"{ANALYTICS_PATH}/source_liquidity/"
    )
    card_liquidity.write.mode("overwrite").partitionBy("liquidity_tier").parquet(
        f"{ANALYTICS_PATH}/card_liquidity/"
    )

    # Market cycle analysis
    print("\nAnalyzing market cycles...")
    market_cycles = analyze_market_cycles(prices_df)

    market_cycles.write.mode("overwrite").parquet(f"{ANALYTICS_PATH}/market_cycles/")

    # Generate summary report
    print("\nGenerating summary report...")
    summary = {
        "analysis_date": ANALYSIS_DATE,
        "total_price_records": total_records,
        "arbitrage_opportunities": arbitrage_count,
        "high_urgency_arbitrage": arbitrage.filter(F.col("urgency") == "immediate").count(),
        "avg_efficiency": daily_efficiency.agg(F.avg("avg_efficiency")).collect()[0][0],
    }

    # Top arbitrage opportunities
    top_arbitrage = (
        arbitrage.orderBy(F.col("net_profit").desc())
        .limit(10)
        .select("card_id", "buy_source", "sell_source", "net_profit", "roi")
        .collect()
    )
    summary["top_arbitrage"] = [row.asDict() for row in top_arbitrage]

    # Save summary
    summary_df = spark.createDataFrame(
        [(ANALYSIS_DATE, json.dumps(summary))], ["date", "summary_json"]
    )
    summary_df.write.mode("append").parquet(f"{ANALYTICS_PATH}/daily_summary/")

    print("\nMarket analysis complete!")
    print(f"  Arbitrage opportunities: {arbitrage_count}")
    print(f"  High urgency: {summary['high_urgency_arbitrage']}")
    print(f"  Avg market efficiency: {summary['avg_efficiency']:.2%}")

    # Cleanup
    prices_df.unpersist()


if __name__ == "__main__":
    main()
    job.commit()
