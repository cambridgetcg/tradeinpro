import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Form, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Box,
  Select,
  Checkbox,
  Banner,
  ChoiceList,
  FormLayout,
  TextField,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { SubmissionStatus, formatPrice } from "../lib/constants";

// ============================================================================
// Types
// ============================================================================

interface ExportConfig {
  format: "csv" | "json";
  type: "submissions" | "items" | "customers" | "payouts";
  period: string;
  includeFields: string[];
}

interface LoaderData {
  availableFields: Record<string, string[]>;
}

interface ActionData {
  success?: boolean;
  error?: string;
  downloadUrl?: string;
  filename?: string;
  content?: string;
  contentType?: string;
}

// ============================================================================
// Available Export Fields
// ============================================================================

const EXPORT_FIELDS = {
  submissions: [
    "submissionNumber",
    "status",
    "customerEmail",
    "customerName",
    "payoutType",
    "quotedTotal",
    "finalTotal",
    "itemCount",
    "createdAt",
    "submittedAt",
    "receivedAt",
    "completedAt",
    "trackingNumber",
  ],
  items: [
    "submissionNumber",
    "cardName",
    "setName",
    "setCode",
    "variant",
    "conditionClaimed",
    "conditionActual",
    "quantity",
    "quotedPrice",
    "finalPrice",
    "status",
  ],
  customers: [
    "email",
    "firstName",
    "lastName",
    "shopifyCustomerId",
    "totalSubmissions",
    "totalValue",
    "createdAt",
  ],
  payouts: [
    "submissionNumber",
    "type",
    "amount",
    "bonusAmount",
    "totalAmount",
    "status",
    "createdAt",
    "processedAt",
  ],
};

const FIELD_LABELS: Record<string, string> = {
  submissionNumber: "Submission #",
  status: "Status",
  customerEmail: "Customer Email",
  customerName: "Customer Name",
  payoutType: "Payout Type",
  quotedTotal: "Quoted Total",
  finalTotal: "Final Total",
  itemCount: "Item Count",
  createdAt: "Created At",
  submittedAt: "Submitted At",
  receivedAt: "Received At",
  completedAt: "Completed At",
  trackingNumber: "Tracking Number",
  cardName: "Card Name",
  setName: "Set Name",
  setCode: "Set Code",
  variant: "Variant",
  conditionClaimed: "Condition (Claimed)",
  conditionActual: "Condition (Actual)",
  quantity: "Quantity",
  quotedPrice: "Quoted Price",
  finalPrice: "Final Price",
  email: "Email",
  firstName: "First Name",
  lastName: "Last Name",
  shopifyCustomerId: "Shopify ID",
  totalSubmissions: "Total Submissions",
  totalValue: "Total Value",
  type: "Type",
  amount: "Amount",
  bonusAmount: "Bonus Amount",
  totalAmount: "Total Amount",
  processedAt: "Processed At",
};

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    console.log("[app.reports.export] Auth OK, shop:", session?.shop);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  return {
    availableFields: EXPORT_FIELDS,
  };
};

// ============================================================================
// Action (Generate Export)
// ============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    await authenticate.admin(request);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  const formData = await request.formData();
  const format = formData.get("format") as "csv" | "json";
  const type = formData.get("type") as string;
  const period = formData.get("period") as string;
  const fieldsRaw = formData.get("fields") as string;
  const fields = fieldsRaw ? fieldsRaw.split(",") : [];

  // Validate inputs
  if (!format || !["csv", "json"].includes(format)) {
    return { error: "Invalid format" };
  }
  if (!type || !["submissions", "items", "customers", "payouts"].includes(type)) {
    return { error: "Invalid export type" };
  }
  if (fields.length === 0) {
    return { error: "Please select at least one field to export" };
  }

  // Calculate date range
  const endDate = new Date();
  let startDate = new Date();

  switch (period) {
    case "7d":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "30d":
      startDate.setDate(startDate.getDate() - 30);
      break;
    case "90d":
      startDate.setDate(startDate.getDate() - 90);
      break;
    case "year":
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case "all":
      startDate = new Date(0);
      break;
    default:
      startDate.setDate(startDate.getDate() - 30);
  }

  const dateFilter = period === "all" ? {} : { createdAt: { gte: startDate, lte: endDate } };

  try {
    let data: any[] = [];
    let filename = "";

    switch (type) {
      case "submissions":
        data = await exportSubmissions(dateFilter, fields);
        filename = `submissions_export_${new Date().toISOString().split("T")[0]}`;
        break;
      case "items":
        data = await exportItems(dateFilter, fields);
        filename = `items_export_${new Date().toISOString().split("T")[0]}`;
        break;
      case "customers":
        data = await exportCustomers(dateFilter, fields);
        filename = `customers_export_${new Date().toISOString().split("T")[0]}`;
        break;
      case "payouts":
        data = await exportPayouts(dateFilter, fields);
        filename = `payouts_export_${new Date().toISOString().split("T")[0]}`;
        break;
    }

    // Format output
    let content: string;
    let contentType: string;

    if (format === "json") {
      content = JSON.stringify(data, null, 2);
      contentType = "application/json";
      filename += ".json";
    } else {
      content = formatCSV(data, fields);
      contentType = "text/csv";
      filename += ".csv";
    }

    return {
      success: true,
      content,
      contentType,
      filename,
    };
  } catch (error) {
    console.error("Export error:", error);
    return {
      error: error instanceof Error ? error.message : "Export failed",
    };
  }
};

// ============================================================================
// Export Functions
// ============================================================================

async function exportSubmissions(
  dateFilter: any,
  fields: string[]
): Promise<any[]> {
  const submissions = await prisma.tradeInSubmission.findMany({
    where: {
      ...dateFilter,
      status: { not: SubmissionStatus.DRAFT },
    },
    include: {
      customer: true,
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return submissions.map((sub) => {
    const row: Record<string, any> = {};

    if (fields.includes("submissionNumber")) row.submissionNumber = sub.submissionNumber;
    if (fields.includes("status")) row.status = sub.status;
    if (fields.includes("customerEmail")) row.customerEmail = sub.customer?.email || "";
    if (fields.includes("customerName")) {
      row.customerName = sub.customer
        ? `${sub.customer.firstName || ""} ${sub.customer.lastName || ""}`.trim()
        : "";
    }
    if (fields.includes("payoutType")) row.payoutType = sub.payoutType;
    if (fields.includes("quotedTotal")) row.quotedTotal = (sub.quotedTotal / 100).toFixed(2);
    if (fields.includes("finalTotal")) row.finalTotal = sub.finalTotal ? (sub.finalTotal / 100).toFixed(2) : "";
    if (fields.includes("itemCount")) row.itemCount = sub._count.items;
    if (fields.includes("createdAt")) row.createdAt = sub.createdAt.toISOString();
    if (fields.includes("submittedAt")) row.submittedAt = sub.submittedAt?.toISOString() || "";
    if (fields.includes("receivedAt")) row.receivedAt = sub.receivedAt?.toISOString() || "";
    if (fields.includes("completedAt")) row.completedAt = sub.completedAt?.toISOString() || "";
    if (fields.includes("trackingNumber")) row.trackingNumber = sub.trackingNumber || "";

    return row;
  });
}

async function exportItems(dateFilter: any, fields: string[]): Promise<any[]> {
  const items = await prisma.tradeInItem.findMany({
    where: {
      submission: {
        ...dateFilter,
        status: { not: SubmissionStatus.DRAFT },
      },
    },
    include: {
      submission: {
        select: { submissionNumber: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return items.map((item) => {
    const row: Record<string, any> = {};

    if (fields.includes("submissionNumber")) row.submissionNumber = item.submission.submissionNumber;
    if (fields.includes("cardName")) row.cardName = item.cardName;
    if (fields.includes("setName")) row.setName = item.setName;
    if (fields.includes("setCode")) row.setCode = item.setCode || "";
    if (fields.includes("variant")) row.variant = item.variant || "";
    if (fields.includes("conditionClaimed")) row.conditionClaimed = item.conditionClaimed;
    if (fields.includes("conditionActual")) row.conditionActual = item.conditionActual || "";
    if (fields.includes("quantity")) row.quantity = item.quantity;
    if (fields.includes("quotedPrice")) row.quotedPrice = (item.quotedPrice / 100).toFixed(2);
    if (fields.includes("finalPrice")) row.finalPrice = item.finalPrice ? (item.finalPrice / 100).toFixed(2) : "";
    if (fields.includes("status")) row.status = item.status;

    return row;
  });
}

async function exportCustomers(dateFilter: any, fields: string[]): Promise<any[]> {
  const customers = await prisma.customer.findMany({
    where: dateFilter,
    include: {
      _count: {
        select: {
          submissions: {
            where: { status: { not: SubmissionStatus.DRAFT } },
          },
        },
      },
      submissions: {
        where: { status: SubmissionStatus.COMPLETED },
        select: { finalTotal: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return customers.map((cust) => {
    const totalValue = cust.submissions.reduce(
      (sum, sub) => sum + (sub.finalTotal || 0),
      0
    );

    const row: Record<string, any> = {};

    if (fields.includes("email")) row.email = cust.email;
    if (fields.includes("firstName")) row.firstName = cust.firstName || "";
    if (fields.includes("lastName")) row.lastName = cust.lastName || "";
    if (fields.includes("shopifyCustomerId")) row.shopifyCustomerId = cust.shopifyCustomerId || "";
    if (fields.includes("totalSubmissions")) row.totalSubmissions = cust._count.submissions;
    if (fields.includes("totalValue")) row.totalValue = (totalValue / 100).toFixed(2);
    if (fields.includes("createdAt")) row.createdAt = cust.createdAt.toISOString();

    return row;
  });
}

async function exportPayouts(dateFilter: any, fields: string[]): Promise<any[]> {
  const payouts = await prisma.payout.findMany({
    where: dateFilter,
    include: {
      submission: {
        select: { submissionNumber: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return payouts.map((payout) => {
    const row: Record<string, any> = {};

    if (fields.includes("submissionNumber")) row.submissionNumber = payout.submission?.submissionNumber || "";
    if (fields.includes("type")) row.type = payout.type;
    if (fields.includes("amount")) row.amount = (payout.amount / 100).toFixed(2);
    if (fields.includes("bonusAmount")) row.bonusAmount = (payout.bonusAmount / 100).toFixed(2);
    if (fields.includes("totalAmount")) row.totalAmount = (payout.totalAmount / 100).toFixed(2);
    if (fields.includes("status")) row.status = payout.status;
    if (fields.includes("createdAt")) row.createdAt = payout.createdAt.toISOString();
    if (fields.includes("processedAt")) row.processedAt = payout.processedAt?.toISOString() || "";

    return row;
  });
}

function formatCSV(data: any[], fields: string[]): string {
  if (data.length === 0) return "";

  // Get headers from field labels
  const headers = fields.map((f) => FIELD_LABELS[f] || f);

  // Escape CSV value
  const escapeCSV = (value: any): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Build CSV
  const lines = [headers.join(",")];

  for (const row of data) {
    const values = fields.map((field) => escapeCSV(row[field]));
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

// ============================================================================
// Component
// ============================================================================

export default function ExportPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  // Handle Response objects from auth
  if (!data || "status" in data) {
    return null;
  }

  const isSubmitting = navigation.state === "submitting";

  const [format, setFormat] = useState("csv");
  const [exportType, setExportType] = useState("submissions");
  const [period, setPeriod] = useState("30d");
  const [selectedFields, setSelectedFields] = useState<string[]>(
    EXPORT_FIELDS.submissions
  );

  // Handle export type change
  const handleTypeChange = useCallback((value: string) => {
    setExportType(value);
    setSelectedFields(EXPORT_FIELDS[value as keyof typeof EXPORT_FIELDS] || []);
  }, []);

  // Handle field selection
  const handleFieldChange = useCallback((value: string[]) => {
    setSelectedFields(value);
  }, []);

  // Download trigger
  const handleDownload = useCallback(() => {
    if (actionData?.success && actionData.content && actionData.filename) {
      const blob = new Blob([actionData.content], {
        type: actionData.contentType || "text/plain",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = actionData.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [actionData]);

  // Auto-download on success
  if (actionData?.success && actionData.content) {
    setTimeout(handleDownload, 100);
  }

  const formatOptions = [
    { label: "CSV", value: "csv" },
    { label: "JSON", value: "json" },
  ];

  const typeOptions = [
    { label: "Submissions", value: "submissions" },
    { label: "Items", value: "items" },
    { label: "Customers", value: "customers" },
    { label: "Payouts", value: "payouts" },
  ];

  const periodOptions = [
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "Last 90 days", value: "90d" },
    { label: "Last year", value: "year" },
    { label: "All time", value: "all" },
  ];

  const availableFields = EXPORT_FIELDS[exportType as keyof typeof EXPORT_FIELDS] || [];
  const fieldChoices = availableFields.map((f) => ({
    label: FIELD_LABELS[f] || f,
    value: f,
  }));

  return (
    <Page
      title="Export Data"
      backAction={{ content: "Reports", url: "/app/reports" }}
    >
      <BlockStack gap="500">
        {actionData?.error && (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        {actionData?.success && (
          <Banner tone="success">
            <p>Export generated successfully! Your download should start automatically.</p>
            <Box paddingBlockStart="200">
              <Button onClick={handleDownload}>Download Again</Button>
            </Box>
          </Banner>
        )}

        <Card>
          <Form method="post">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Export Configuration</Text>

              <FormLayout>
                <FormLayout.Group>
                  <Select
                    label="Export Format"
                    options={formatOptions}
                    value={format}
                    onChange={(value) => setFormat(value)}
                    name="format"
                  />

                  <Select
                    label="Data Type"
                    options={typeOptions}
                    value={exportType}
                    onChange={handleTypeChange}
                    name="type"
                  />

                  <Select
                    label="Time Period"
                    options={periodOptions}
                    value={period}
                    onChange={(value) => setPeriod(value)}
                    name="period"
                  />
                </FormLayout.Group>
              </FormLayout>

              <Text as="h3" variant="headingSm">Fields to Include</Text>

              <ChoiceList
                title="Select fields"
                titleHidden
                allowMultiple
                choices={fieldChoices}
                selected={selectedFields}
                onChange={handleFieldChange}
              />

              <input type="hidden" name="fields" value={selectedFields.join(",")} />

              <InlineStack gap="200" align="start">
                <Button
                  variant="plain"
                  onClick={() => setSelectedFields(availableFields)}
                >
                  Select All
                </Button>
                <Button
                  variant="plain"
                  onClick={() => setSelectedFields([])}
                >
                  Clear All
                </Button>
              </InlineStack>

              <InlineStack gap="200" align="end">
                <Button url="/app/reports">Cancel</Button>
                <Button
                  variant="primary"
                  submit
                  loading={isSubmitting}
                  disabled={selectedFields.length === 0}
                >
                  Generate Export
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Export Tips</Text>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                <strong>CSV Format:</strong> Best for spreadsheet applications like Excel or Google Sheets.
              </Text>
              <Text as="p" variant="bodySm">
                <strong>JSON Format:</strong> Best for programmatic access or importing into other systems.
              </Text>
              <Text as="p" variant="bodySm">
                <strong>Large Exports:</strong> For very large datasets, consider exporting in smaller time periods.
              </Text>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
