/**
 * PRISM - Price Index 3D Crystal Visualization
 *
 * Interactive 3D visualization of card price correlations and market dynamics.
 * Uses Three.js for rendering the neural network crystal structure.
 */

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useState, useCallback, useEffect, Suspense, lazy } from "react";
import { Page, Card, Layout, Text, Button, ButtonGroup, Select, Badge, Banner, Spinner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getCrystalData, type CrystalNode } from "../lib/price-index.server";
import { formatPrice } from "../lib/constants";

// Lazy load the 3D component to avoid SSR issues with Three.js
const CrystalVisualization3D = lazy(() => import("../components/CrystalVisualization3D"));

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const game = url.searchParams.get("game") || "onepiece";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "150"), 500);

  try {
    const crystalData = await getCrystalData(game, limit);

    return {
      data: crystalData,
      game,
      limit,
      nodeCount: crystalData.nodes.length,
      edgeCount: crystalData.edges.length,
      clusterCount: crystalData.clusters.length,
    };
  } catch (error) {
    console.error("Failed to load crystal data:", error);
    return {
      data: { nodes: [], edges: [], clusters: [] },
      game,
      limit,
      nodeCount: 0,
      edgeCount: 0,
      clusterCount: 0,
      error: "Failed to load visualization data",
    };
  }
}

export default function PrismPage() {
  const { data, game, limit, nodeCount, edgeCount, clusterCount, error } = useLoaderData<typeof loader>();

  const [selectedNode, setSelectedNode] = useState<CrystalNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<CrystalNode | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [minCorrelation, setMinCorrelation] = useState("0.3");
  const [visualizationWidth, setVisualizationWidth] = useState(1200);

  // Calculate width on client side
  useEffect(() => {
    const updateWidth = () => {
      setVisualizationWidth(Math.max(800, window.innerWidth - 320));
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const handleNodeClick = useCallback((node: CrystalNode) => {
    setSelectedNode(node);
  }, []);

  const handleNodeHover = useCallback((node: CrystalNode | null) => {
    setHoveredNode(node);
  }, []);

  const displayNode = hoveredNode || selectedNode;

  return (
    <Page
      title="PRISM"
      subtitle="Price Index 3D Crystal Visualization"
      secondaryActions={[
        {
          content: showLabels ? "Hide Labels" : "Show Labels",
          onAction: () => setShowLabels(!showLabels),
        },
        {
          content: showEdges ? "Hide Edges" : "Show Edges",
          onAction: () => setShowEdges(!showEdges),
        },
      ]}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Stats Bar */}
        <Layout.Section>
          <Card>
            <div style={{ display: "flex", gap: 24, alignItems: "center", padding: 16 }}>
              <div>
                <Text variant="headingMd" as="h3">
                  {nodeCount}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Cards
                </Text>
              </div>
              <div>
                <Text variant="headingMd" as="h3">
                  {edgeCount}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Correlations
                </Text>
              </div>
              <div>
                <Text variant="headingMd" as="h3">
                  {clusterCount}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Sets
                </Text>
              </div>
              <div style={{ marginLeft: "auto" }}>
                <Select
                  label="Min Correlation"
                  labelInline
                  options={[
                    { label: "0.1", value: "0.1" },
                    { label: "0.2", value: "0.2" },
                    { label: "0.3", value: "0.3" },
                    { label: "0.5", value: "0.5" },
                    { label: "0.7", value: "0.7" },
                  ]}
                  value={minCorrelation}
                  onChange={setMinCorrelation}
                />
              </div>
            </div>
          </Card>
        </Layout.Section>

        {/* Main Visualization */}
        <Layout.Section>
          <Card padding="0">
            <div style={{ position: "relative" }}>
              <Suspense
                fallback={
                  <div
                    style={{
                      width: "100%",
                      height: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#0f172a",
                    }}
                  >
                    <Spinner size="large" />
                  </div>
                }
              >
                <CrystalVisualization3D
                  data={data}
                  width={visualizationWidth}
                  height={600}
                  showLabels={showLabels}
                  showEdges={showEdges}
                  minCorrelation={parseFloat(minCorrelation)}
                  onNodeClick={handleNodeClick}
                  onNodeHover={handleNodeHover}
                />
              </Suspense>

              {/* Overlay info panel */}
              {displayNode && (
                <div
                  style={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    background: "rgba(15, 23, 42, 0.95)",
                    padding: 16,
                    borderRadius: 8,
                    color: "white",
                    minWidth: 200,
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                  }}
                >
                  <Text variant="headingMd" as="h3">
                    {displayNode.name}
                  </Text>
                  <div style={{ marginTop: 8 }}>
                    <Text variant="bodySm" tone="subdued">
                      Set: {displayNode.setCode || "Unknown"}
                    </Text>
                  </div>
                  <div>
                    <Text variant="bodySm" tone="subdued">
                      Rarity: {displayNode.rarity || "Unknown"}
                    </Text>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Text variant="headingLg" as="p">
                      {formatPrice(displayNode.price * 100)}
                    </Text>
                  </div>
                  <div>
                    <Badge
                      tone={
                        displayNode.change > 0.01
                          ? "success"
                          : displayNode.change < -0.01
                            ? "critical"
                            : "info"
                      }
                    >
                      {displayNode.change > 0 ? "+" : ""}
                      {(displayNode.change * 100).toFixed(2)}%
                    </Badge>
                  </div>
                </div>
              )}

              {/* Controls legend */}
              <div
                style={{
                  position: "absolute",
                  bottom: 16,
                  left: 16,
                  background: "rgba(15, 23, 42, 0.8)",
                  padding: 12,
                  borderRadius: 8,
                  color: "#94a3b8",
                  fontSize: 12,
                }}
              >
                <div>Drag to rotate | Scroll to zoom | Right-click to pan</div>
              </div>
            </div>
          </Card>
        </Layout.Section>

        {/* Color Legend */}
        <Layout.Section>
          <Card>
            <Text variant="headingMd" as="h3">
              Color Legend
            </Text>
            <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#00ff88" }} />
                <Text variant="bodySm">&gt; +10%</Text>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#4ade80" }} />
                <Text variant="bodySm">+5% to +10%</Text>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#86efac" }} />
                <Text variant="bodySm">+1% to +5%</Text>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#94a3b8" }} />
                <Text variant="bodySm">-1% to +1%</Text>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fca5a5" }} />
                <Text variant="bodySm">-5% to -1%</Text>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#f87171" }} />
                <Text variant="bodySm">-10% to -5%</Text>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#ff4444" }} />
                <Text variant="bodySm">&lt; -10%</Text>
              </div>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
