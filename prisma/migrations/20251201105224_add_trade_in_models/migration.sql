-- CreateTable
CREATE TABLE "CardPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyCustomerId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PayoutMethod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bankName" TEXT,
    "accountName" TEXT,
    "bsb" TEXT,
    "accountNumber" TEXT,
    "paypalEmail" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayoutMethod_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeInSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "submittedAt" DATETIME,
    "receivedAt" DATETIME,
    "gradedAt" DATETIME,
    "approvedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeInSubmission_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeInItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeInItem_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "TradeInSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradeInItem_cardPriceId_fkey" FOREIGN KEY ("cardPriceId") REFERENCES "CardPrice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubmissionNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorName" TEXT,
    "message" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubmissionNote_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "TradeInSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "processedAt" DATETIME,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payout_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "TradeInSubmission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payout_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeInSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "storeCreditBonusPct" INTEGER NOT NULL DEFAULT 10,
    "minSubmissionValue" INTEGER NOT NULL DEFAULT 2000,
    "maxItemsPerSubmission" INTEGER NOT NULL DEFAULT 100,
    "autoApproveThreshold" INTEGER NOT NULL DEFAULT 500,
    "holdPeriodDays" INTEGER NOT NULL DEFAULT 3,
    "freeShippingMinimum" INTEGER NOT NULL DEFAULT 5000,
    "returnAddress" TEXT,
    "termsAndConditions" TEXT,
    "gradingGuideUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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
