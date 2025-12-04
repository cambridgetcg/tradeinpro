-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_prices" (
    "card_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "market_price" DECIMAL(10,2) NOT NULL,
    "tradein_price" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "game" VARCHAR(50) NOT NULL,
    "shopify_product_id" VARCHAR(255),
    "last_updated" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "is_alternate_art" BOOLEAN DEFAULT false,
    "variant_type" VARCHAR(50),
    "rarity" VARCHAR(50),
    "printing" VARCHAR(50) DEFAULT 'Normal',
    "market_price_gbp" DECIMAL(10,2),
    "tradein_price_gbp" DECIMAL(10,2),
    "exchange_rate" DECIMAL(10,6),
    "tcgplayer_price_usd" DECIMAL(10,2),
    "tcgplayer_price_gbp" DECIMAL(10,2),
    "cardmarket_price_eur" DECIMAL(10,2),
    "cardmarket_price_gbp" DECIMAL(10,2),

    CONSTRAINT "card_prices_pkey" PRIMARY KEY ("card_id")
);

-- CreateTable
CREATE TABLE "inventory_alt_art" (
    "id" SERIAL NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "card_type" VARCHAR(20) NOT NULL,
    "release_set" VARCHAR(20) NOT NULL,
    "original_set" VARCHAR(20) NOT NULL,
    "card_number" VARCHAR(10) NOT NULL,
    "original_card_id" VARCHAR(20) NOT NULL,
    "jpy_price" DECIMAL(10,2),
    "gbp_cost" DECIMAL(10,2),
    "gbp_selling" DECIMAL(10,2),
    "ebay_item_number" BIGINT,
    "tcgplayer_price_usd" DECIMAL(10,2),
    "tcgplayer_price_gbp" DECIMAL(10,2),
    "cardmarket_price_eur" DECIMAL(10,2),
    "cardmarket_price_gbp" DECIMAL(10,2),
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "last_updated" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_alt_art_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardPrice" (
    "id" TEXT NOT NULL,
    "cardName" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "setCode" TEXT,
    "rarity" TEXT,
    "cardNumber" TEXT,
    "variant" TEXT,
    "priceNM" INTEGER NOT NULL DEFAULT 0,
    "priceLP" INTEGER NOT NULL DEFAULT 0,
    "priceMP" INTEGER NOT NULL DEFAULT 0,
    "priceHP" INTEGER NOT NULL DEFAULT 0,
    "priceDMG" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutMethod" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bankName" TEXT,
    "accountName" TEXT,
    "bsb" TEXT,
    "accountNumber" TEXT,
    "paypalEmail" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeInSubmission" (
    "id" TEXT NOT NULL,
    "submissionNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "payoutType" TEXT NOT NULL DEFAULT 'STORE_CREDIT',
    "quotedTotal" INTEGER NOT NULL DEFAULT 0,
    "finalTotal" INTEGER,
    "bonusAmount" INTEGER NOT NULL DEFAULT 0,
    "shippingMethod" TEXT,
    "trackingNumber" TEXT,
    "labelUrl" TEXT,
    "submittedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "gradedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeInSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeInItem" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "cardPriceId" TEXT,
    "cardName" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "setCode" TEXT,
    "variant" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "conditionClaimed" TEXT NOT NULL,
    "conditionActual" TEXT,
    "quotedPrice" INTEGER NOT NULL DEFAULT 0,
    "finalPrice" INTEGER,
    "adjustmentReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeInItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionNote" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorName" TEXT,
    "message" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "bonusAmount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "giftCardId" TEXT,
    "giftCardCode" TEXT,
    "bankReference" TEXT,
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeInSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "minimumSubmissionValue" INTEGER NOT NULL DEFAULT 500,
    "requiresApprovalAbove" INTEGER NOT NULL DEFAULT 5000,
    "autoApproveBelow" INTEGER NOT NULL DEFAULT 2000,
    "maxItemsPerSubmission" INTEGER NOT NULL DEFAULT 100,
    "storeCreditBonusPercent" INTEGER NOT NULL DEFAULT 10,
    "cashPayoutPercent" INTEGER NOT NULL DEFAULT 100,
    "conditionMultiplierNM" DOUBLE PRECISION NOT NULL DEFAULT 0.70,
    "conditionMultiplierLP" DOUBLE PRECISION NOT NULL DEFAULT 0.55,
    "conditionMultiplierMP" DOUBLE PRECISION NOT NULL DEFAULT 0.40,
    "conditionMultiplierHP" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "conditionMultiplierDMG" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "freeShippingMinimum" INTEGER NOT NULL DEFAULT 5000,
    "shippingLabelEnabled" BOOLEAN NOT NULL DEFAULT true,
    "returnAddress" TEXT,
    "notifyOnSubmission" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnReceived" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnGraded" BOOLEAN NOT NULL DEFAULT true,
    "termsAndConditions" TEXT,
    "gradingGuideUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeInSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_card_prices_game" ON "card_prices"("game");

-- CreateIndex
CREATE INDEX "idx_card_prices_source" ON "card_prices"("source");

-- CreateIndex
CREATE INDEX "idx_card_prices_last_updated" ON "card_prices"("last_updated");

-- CreateIndex
CREATE INDEX "idx_card_prices_shopify" ON "card_prices"("shopify_product_id");

-- CreateIndex
CREATE INDEX "idx_card_prices_alt_art" ON "card_prices"("is_alternate_art");

-- CreateIndex
CREATE INDEX "idx_card_prices_variant" ON "card_prices"("variant_type");

-- CreateIndex
CREATE INDEX "idx_card_prices_market_gbp" ON "card_prices"("market_price_gbp");

-- CreateIndex
CREATE INDEX "idx_card_prices_tradein_gbp" ON "card_prices"("tradein_price_gbp");

-- CreateIndex
CREATE INDEX "idx_card_prices_tcgplayer_gbp" ON "card_prices"("tcgplayer_price_gbp");

-- CreateIndex
CREATE INDEX "idx_card_prices_cardmarket_gbp" ON "card_prices"("cardmarket_price_gbp");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_alt_art_sku_key" ON "inventory_alt_art"("sku");

-- CreateIndex
CREATE INDEX "idx_inventory_alt_art_card_type" ON "inventory_alt_art"("card_type");

-- CreateIndex
CREATE INDEX "idx_inventory_alt_art_release_set" ON "inventory_alt_art"("release_set");

-- CreateIndex
CREATE INDEX "idx_inventory_alt_art_original_card_id" ON "inventory_alt_art"("original_card_id");

-- CreateIndex
CREATE INDEX "CardPrice_cardName_idx" ON "CardPrice"("cardName");

-- CreateIndex
CREATE INDEX "CardPrice_setName_idx" ON "CardPrice"("setName");

-- CreateIndex
CREATE INDEX "CardPrice_setCode_idx" ON "CardPrice"("setCode");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shopifyCustomerId_key" ON "Customer"("shopifyCustomerId");

-- CreateIndex
CREATE INDEX "PayoutMethod_customerId_idx" ON "PayoutMethod"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeInSubmission_submissionNumber_key" ON "TradeInSubmission"("submissionNumber");

-- CreateIndex
CREATE INDEX "TradeInSubmission_customerId_idx" ON "TradeInSubmission"("customerId");

-- CreateIndex
CREATE INDEX "TradeInSubmission_status_idx" ON "TradeInSubmission"("status");

-- CreateIndex
CREATE INDEX "TradeInSubmission_submissionNumber_idx" ON "TradeInSubmission"("submissionNumber");

-- CreateIndex
CREATE INDEX "TradeInItem_submissionId_idx" ON "TradeInItem"("submissionId");

-- CreateIndex
CREATE INDEX "TradeInItem_cardPriceId_idx" ON "TradeInItem"("cardPriceId");

-- CreateIndex
CREATE INDEX "SubmissionNote_submissionId_idx" ON "SubmissionNote"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_submissionId_key" ON "Payout"("submissionId");

-- CreateIndex
CREATE INDEX "Payout_customerId_idx" ON "Payout"("customerId");

-- CreateIndex
CREATE INDEX "Payout_status_idx" ON "Payout"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TradeInSettings_shop_key" ON "TradeInSettings"("shop");

-- AddForeignKey
ALTER TABLE "PayoutMethod" ADD CONSTRAINT "PayoutMethod_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeInSubmission" ADD CONSTRAINT "TradeInSubmission_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeInItem" ADD CONSTRAINT "TradeInItem_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "TradeInSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeInItem" ADD CONSTRAINT "TradeInItem_cardPriceId_fkey" FOREIGN KEY ("cardPriceId") REFERENCES "CardPrice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionNote" ADD CONSTRAINT "SubmissionNote_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "TradeInSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "TradeInSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

