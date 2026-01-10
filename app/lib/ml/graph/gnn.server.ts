/**
 * Graph Neural Network (GNN) for Market Topology
 *
 * Architecture: GraphSAGE with Attention Aggregation
 * Purpose: Model relationships between cards, sets, and market dynamics
 *
 * Training Status: AWAITING TRAINING DATA
 * Data Requirements:
 *   - 10K+ card nodes
 *   - 365 days price history
 *   - Tournament deck data
 *
 * @see docs/AI_MODELS_FOR_TCG_ARBITRAGE.md Section 4 - M4
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

export const GNN_CONFIG = {
  modelId: "graphsage-tcg-market",
  version: "1.0.0-stub",

  // Architecture
  architecture: {
    nodeEmbeddingDim: 64,
    numLayers: 3,
    hiddenDims: [256, 128, 64],
    aggregator: "attention", // mean, pool, attention
    dropout: 0.3,
    activation: "relu",
  },

  // Graph structure
  graph: {
    nodeTypes: ["card", "set", "character", "platform", "time_period"],
    edgeTypes: [
      "same_set",
      "same_character",
      "price_correlation",
      "substitute_card",
      "complement_card",
      "deck_co_occurrence",
    ],
    minCorrelation: 0.5, // Minimum Pearson correlation for price_correlation edges
    correlationWindow: 30, // Days for correlation calculation
  },

  // Node features
  nodeFeatures: {
    card: [
      "current_price",
      "price_7d",
      "price_30d",
      "price_90d",
      "volatility",
      "volume",
      "rarity_encoded",
      "color_encoded",
      "card_type_encoded",
      "meta_relevance",
    ],
    set: ["release_date_encoded", "total_value", "set_momentum", "reprint_status"],
    character: ["popularity_score", "card_count"],
  },

  // Training
  training: {
    requiredNodes: 10000,
    requiredEdges: 100000,
    epochs: 100,
    learningRate: 0.001,
    batchSize: 256,
    negSamplingRatio: 5, // For link prediction training
  },
};

// =============================================================================
// TYPES
// =============================================================================

export interface GraphNode {
  id: string;
  type: "card" | "set" | "character" | "platform" | "time_period";
  features: number[];
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeIndex: Map<string, number>; // id -> index mapping
}

export interface GNNPrediction {
  nodeEmbeddings: Map<string, number[]>;
  correlationPredictions: Array<{
    card1: string;
    card2: string;
    predictedCorrelation: number;
    confidence: number;
  }>;
  marketRegime: "accumulation" | "markup" | "distribution" | "markdown";
  anomalousNodes: Array<{
    nodeId: string;
    anomalyScore: number;
    reason: string;
  }>;
}

export interface GNNModelConfig {
  modelPath?: string;
  useGPU?: boolean;
}

// =============================================================================
// GNN MODEL SERVICE
// =============================================================================

export class GraphNeuralNetworkModel {
  readonly name = "GraphSAGE Market Topology";
  readonly version = GNN_CONFIG.version;

  private modelLoaded: boolean = false;
  private graph: Graph | null = null;
  private embeddings: Map<string, number[]> = new Map();

  constructor(private config: GNNModelConfig = {}) {}

  /**
   * Load the GNN model
   *
   * TODO: Implement actual model loading when trained
   */
  async load(): Promise<void> {
    console.log("[GNN] Loading Graph Neural Network model...");
    console.log("[GNN] Status: MODEL NOT YET TRAINED");
    console.log("[GNN] Required: 10K+ nodes with price history");

    await new Promise((resolve) => setTimeout(resolve, 100));

    this.modelLoaded = true;
    console.log("[GNN] Model loaded in STUB mode");
  }

  /**
   * Check if model is loaded
   */
  isLoaded(): boolean {
    return this.modelLoaded;
  }

  /**
   * Build graph from data
   */
  async buildGraph(
    cards: Array<{
      cardId: string;
      setCode: string;
      character?: string;
      features: number[];
    }>,
    priceCorrelations: Array<{
      card1: string;
      card2: string;
      correlation: number;
    }>,
    deckData?: Array<{
      deckId: string;
      cardIds: string[];
    }>
  ): Promise<Graph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIndex = new Map<string, number>();

    // Add card nodes
    cards.forEach((card, idx) => {
      nodes.push({
        id: card.cardId,
        type: "card",
        features: card.features,
      });
      nodeIndex.set(card.cardId, idx);
    });

    // Extract unique sets and add set nodes
    const sets = [...new Set(cards.map((c) => c.setCode))];
    sets.forEach((setCode) => {
      const setIdx = nodes.length;
      nodes.push({
        id: `set:${setCode}`,
        type: "set",
        features: [0, 0, 0, 0], // Placeholder
      });
      nodeIndex.set(`set:${setCode}`, setIdx);
    });

    // Add same_set edges
    cards.forEach((card) => {
      edges.push({
        source: card.cardId,
        target: `set:${card.setCode}`,
        type: "same_set",
        weight: 1.0,
      });
    });

    // Add price_correlation edges
    priceCorrelations
      .filter((pc) => Math.abs(pc.correlation) >= GNN_CONFIG.graph.minCorrelation)
      .forEach((pc) => {
        edges.push({
          source: pc.card1,
          target: pc.card2,
          type: "price_correlation",
          weight: pc.correlation,
        });
      });

    // Add deck_co_occurrence edges
    if (deckData) {
      const coOccurrence = new Map<string, number>();

      deckData.forEach((deck) => {
        for (let i = 0; i < deck.cardIds.length; i++) {
          for (let j = i + 1; j < deck.cardIds.length; j++) {
            const key = [deck.cardIds[i], deck.cardIds[j]].sort().join("-");
            coOccurrence.set(key, (coOccurrence.get(key) ?? 0) + 1);
          }
        }
      });

      coOccurrence.forEach((count, key) => {
        if (count >= 3) {
          // Minimum 3 co-occurrences
          const [card1, card2] = key.split("-");
          edges.push({
            source: card1,
            target: card2,
            type: "deck_co_occurrence",
            weight: count,
          });
        }
      });
    }

    this.graph = { nodes, edges, nodeIndex };
    return this.graph;
  }

  /**
   * Generate node embeddings
   *
   * TODO: Replace with actual GraphSAGE forward pass when trained
   */
  async generateEmbeddings(): Promise<Map<string, number[]>> {
    if (!this.graph) {
      throw new Error("Graph not built. Call buildGraph() first.");
    }

    // STUB: Generate random embeddings
    // In production: Run GraphSAGE forward pass
    const embeddings = new Map<string, number[]>();

    this.graph.nodes.forEach((node) => {
      // Generate 64-dim embedding (random for stub)
      const embedding = Array(GNN_CONFIG.architecture.nodeEmbeddingDim)
        .fill(0)
        .map(() => Math.random() * 2 - 1);
      embeddings.set(node.id, embedding);
    });

    this.embeddings = embeddings;
    return embeddings;
  }

  /**
   * Predict future price correlations (link prediction)
   */
  async predictCorrelations(
    cardPairs: Array<{ card1: string; card2: string }>
  ): Promise<
    Array<{
      card1: string;
      card2: string;
      predictedCorrelation: number;
      confidence: number;
    }>
  > {
    if (this.embeddings.size === 0) {
      await this.generateEmbeddings();
    }

    // STUB: Calculate cosine similarity of embeddings as correlation proxy
    return cardPairs.map(({ card1, card2 }) => {
      const emb1 = this.embeddings.get(card1);
      const emb2 = this.embeddings.get(card2);

      if (!emb1 || !emb2) {
        return {
          card1,
          card2,
          predictedCorrelation: 0,
          confidence: 0,
        };
      }

      // Cosine similarity
      const dotProduct = emb1.reduce((sum, v, i) => sum + v * emb2[i], 0);
      const norm1 = Math.sqrt(emb1.reduce((sum, v) => sum + v * v, 0));
      const norm2 = Math.sqrt(emb2.reduce((sum, v) => sum + v * v, 0));
      const similarity = dotProduct / (norm1 * norm2);

      return {
        card1,
        card2,
        predictedCorrelation: similarity,
        confidence: 0.5, // Low confidence = model not trained
      };
    });
  }

  /**
   * Detect market regime from graph structure
   */
  async detectMarketRegime(): Promise<{
    regime: "accumulation" | "markup" | "distribution" | "markdown";
    confidence: number;
    indicators: Record<string, number>;
  }> {
    // STUB: Random regime
    const regimes = ["accumulation", "markup", "distribution", "markdown"] as const;
    const regime = regimes[Math.floor(Math.random() * regimes.length)];

    return {
      regime,
      confidence: 0.5,
      indicators: {
        clusteringCoefficient: 0.3 + Math.random() * 0.4,
        avgNodeDegree: 5 + Math.random() * 10,
        modularity: 0.4 + Math.random() * 0.3,
      },
    };
  }

  /**
   * Find structurally anomalous nodes
   */
  async findAnomalousNodes(
    topK: number = 10
  ): Promise<
    Array<{
      nodeId: string;
      anomalyScore: number;
      reason: string;
    }>
  > {
    if (!this.graph) {
      return [];
    }

    // STUB: Random anomaly scores
    const scored = this.graph.nodes
      .filter((n) => n.type === "card")
      .map((node) => ({
        nodeId: node.id,
        anomalyScore: Math.random(),
        reason: "Structural deviation from neighbors (model not trained)",
      }))
      .sort((a, b) => b.anomalyScore - a.anomalyScore);

    return scored.slice(0, topK);
  }

  /**
   * Get card embedding for downstream tasks
   */
  getEmbedding(cardId: string): number[] | null {
    return this.embeddings.get(cardId) ?? null;
  }

  /**
   * Unload model
   */
  async unload(): Promise<void> {
    this.graph = null;
    this.embeddings.clear();
    this.modelLoaded = false;
    console.log("[GNN] Model unloaded");
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let gnnInstance: GraphNeuralNetworkModel | null = null;

export function getGraphNeuralNetwork(config?: GNNModelConfig): GraphNeuralNetworkModel {
  if (!gnnInstance) {
    gnnInstance = new GraphNeuralNetworkModel(config);
  }
  return gnnInstance;
}

export function resetGraphNeuralNetwork(): void {
  if (gnnInstance) {
    gnnInstance.unload();
  }
  gnnInstance = null;
}

// =============================================================================
// TRAINING DATA SCHEMA
// =============================================================================

export interface GNNTrainingData {
  // Nodes
  cardNodes: Array<{
    cardId: string;
    setCode: string;
    character?: string;
    rarity: string;
    color: string;
    cardType: string;
    priceHistory: Array<{ date: string; price: number }>;
    volume: number;
    metaRelevance: number;
  }>;

  // Edge labels for link prediction
  knownCorrelations: Array<{
    card1: string;
    card2: string;
    correlation: number;
    window: "7d" | "30d" | "90d";
  }>;

  // Tournament data for deck edges
  tournamentDecks: Array<{
    deckId: string;
    tournament: string;
    placement: number;
    cardIds: string[];
    date: string;
  }>;

  // Market regime labels (if available)
  regimeLabels?: Array<{
    dateRange: { start: string; end: string };
    regime: "accumulation" | "markup" | "distribution" | "markdown";
  }>;
}

export interface GNNTrainingStats {
  totalNodes: number;
  totalEdges: number;
  avgNodeDegree: number;
  connectedComponents: number;
  graphDensity: number;
  edgeTypeDistribution: Record<string, number>;
  lastUpdated: Date;
}

export function calculateGNNTrainingReadiness(stats: GNNTrainingStats): {
  ready: boolean;
  completionPercentage: number;
  missingRequirements: string[];
} {
  const requirements = GNN_CONFIG.training;
  const missing: string[] = [];

  const nodeCompletion = stats.totalNodes / requirements.requiredNodes;
  if (nodeCompletion < 1) {
    missing.push(
      `Need ${requirements.requiredNodes - stats.totalNodes} more nodes (${Math.round(nodeCompletion * 100)}% complete)`
    );
  }

  const edgeCompletion = stats.totalEdges / requirements.requiredEdges;
  if (edgeCompletion < 1) {
    missing.push(
      `Need ${requirements.requiredEdges - stats.totalEdges} more edges (${Math.round(edgeCompletion * 100)}% complete)`
    );
  }

  if (stats.avgNodeDegree < 5) {
    missing.push(`Average node degree ${stats.avgNodeDegree.toFixed(1)} is below minimum 5`);
  }

  return {
    ready: missing.length === 0,
    completionPercentage: Math.min(100, Math.round(((nodeCompletion + edgeCompletion) / 2) * 100)),
    missingRequirements: missing,
  };
}
