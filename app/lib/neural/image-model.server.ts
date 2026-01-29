/**
 * Card Image Recognition CNN Model
 *
 * A convolutional neural network for identifying trading cards from photos.
 * Uses transfer learning concepts with a custom architecture optimized for
 * card recognition with data augmentation for real-world photo handling.
 */

// TEMPORARILY DISABLED - TensorFlow exceeds Vercel's 250MB serverless limit
// import * as tf from "@tensorflow/tfjs-node";
// TODO: Re-enable when using dedicated compute (Lambda/EC2) for ML inference
const tf = null as any; // Stub to allow compilation
import * as fs from "fs";
import * as path from "path";

// Model configuration
export const IMAGE_CONFIG = {
  // Input dimensions (resize cards to this size for training)
  inputWidth: 224,
  inputHeight: 312, // Maintain card aspect ratio (600:838 ≈ 224:312)
  channels: 3,

  // Training hyperparameters
  batchSize: 16,
  epochs: 50,
  learningRate: 0.001,
  validationSplit: 0.2,

  // Model architecture
  convFilters: [32, 64, 128, 256],
  denseUnits: [512, 256],
  dropoutRate: 0.4,

  // Paths
  modelDir: "./models/image-recognition",
  imageBaseDir: "/Users/alex/Desktop/TCG/OnePiece/Official Sample-EN",
};

export interface CardLabel {
  cardId: string;
  setCode: string;
  imagePath: string;
  labelIndex: number;
}

export interface ImageModelMetrics {
  accuracy: number;
  loss: number;
  topKAccuracy: number;
  confusionMatrix?: number[][];
  perClassAccuracy?: Record<string, number>;
}

export interface ImageTrainingResult {
  modelVersion: string;
  trainedAt: Date;
  epochs: number;
  trainingTime: number;
  numClasses: number;
  trainingSamples: number;
  validationSamples: number;
  metrics: ImageModelMetrics;
  history: {
    loss: number[];
    accuracy: number[];
    valLoss: number[];
    valAccuracy: number[];
  };
}

/**
 * Build the CNN model architecture for card recognition
 */
export function buildImageModel(numClasses: number): tf.LayersModel {
  const { inputWidth, inputHeight, channels, convFilters, denseUnits, dropoutRate } =
    IMAGE_CONFIG;

  const model = tf.sequential();

  // Input layer with normalization
  model.add(
    tf.layers.rescaling({
      scale: 1 / 255,
      inputShape: [inputHeight, inputWidth, channels],
    })
  );

  // Convolutional blocks with increasing filter depth
  for (let i = 0; i < convFilters.length; i++) {
    const filters = convFilters[i];

    // First conv layer in block
    model.add(
      tf.layers.conv2d({
        filters,
        kernelSize: 3,
        padding: "same",
        activation: "relu",
        kernelInitializer: "heNormal",
      })
    );

    // Batch normalization
    model.add(tf.layers.batchNormalization());

    // Second conv layer in block
    model.add(
      tf.layers.conv2d({
        filters,
        kernelSize: 3,
        padding: "same",
        activation: "relu",
        kernelInitializer: "heNormal",
      })
    );

    // Batch normalization
    model.add(tf.layers.batchNormalization());

    // Max pooling to reduce spatial dimensions
    model.add(tf.layers.maxPooling2d({ poolSize: 2 }));

    // Dropout for regularization (increase with depth)
    model.add(tf.layers.dropout({ rate: dropoutRate * (0.5 + i * 0.15) }));
  }

  // Global average pooling
  model.add(tf.layers.globalAveragePooling2d({}));

  // Dense layers for classification
  for (const units of denseUnits) {
    model.add(
      tf.layers.dense({
        units,
        activation: "relu",
        kernelInitializer: "heNormal",
        kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      })
    );
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.dropout({ rate: dropoutRate }));
  }

  // Output layer
  model.add(
    tf.layers.dense({
      units: numClasses,
      activation: "softmax",
      kernelInitializer: "glorotUniform",
    })
  );

  return model;
}

/**
 * Compile the model with appropriate optimizer and metrics
 */
export function compileImageModel(model: tf.LayersModel): void {
  model.compile({
    optimizer: tf.train.adam(IMAGE_CONFIG.learningRate),
    loss: "categoricalCrossentropy",
    metrics: ["accuracy"],
  });
}

/**
 * Load an image and preprocess it for the model
 */
export async function loadAndPreprocessImage(
  imagePath: string
): Promise<tf.Tensor3D> {
  const { inputWidth, inputHeight } = IMAGE_CONFIG;

  // Read image file
  const imageBuffer = fs.readFileSync(imagePath);
  let tensor = tf.node.decodeImage(imageBuffer, 3) as tf.Tensor3D;

  // Resize to model input dimensions
  tensor = tf.image.resizeBilinear(tensor, [inputHeight, inputWidth]);

  return tensor;
}

/**
 * Apply data augmentation to simulate real-world photos
 */
export function augmentImage(image: tf.Tensor3D): tf.Tensor3D {
  return tf.tidy(() => {
    let augmented = image;

    // Random brightness adjustment (-0.2 to +0.2)
    const brightness = (Math.random() - 0.5) * 0.4;
    augmented = tf.add(augmented, brightness * 255) as tf.Tensor3D;
    augmented = tf.clipByValue(augmented, 0, 255) as tf.Tensor3D;

    // Random contrast adjustment (0.8 to 1.2)
    const contrast = 0.8 + Math.random() * 0.4;
    const mean = tf.mean(augmented);
    augmented = tf.add(
      tf.mul(tf.sub(augmented, mean), contrast),
      mean
    ) as tf.Tensor3D;
    augmented = tf.clipByValue(augmented, 0, 255) as tf.Tensor3D;

    // Random horizontal flip (50% chance) - cards are symmetric
    if (Math.random() > 0.5) {
      augmented = tf.reverse(augmented, 1) as tf.Tensor3D;
    }

    // Random rotation (small angles: -5 to +5 degrees)
    // TensorFlow.js doesn't have a direct rotate, so we'll skip this for now
    // In a production system, you'd use tf.image.rotateWithOffset

    return augmented;
  });
}

/**
 * Create augmented versions of an image for training data expansion
 */
export async function createAugmentedSamples(
  imagePath: string,
  numAugmentations: number = 5
): Promise<tf.Tensor3D[]> {
  const original = await loadAndPreprocessImage(imagePath);
  const samples: tf.Tensor3D[] = [original];

  for (let i = 0; i < numAugmentations; i++) {
    const augmented = augmentImage(original);
    samples.push(augmented);
  }

  return samples;
}

/**
 * Load card labels from the image directory
 */
export function loadCardLabels(setFilter?: string): CardLabel[] {
  const { imageBaseDir } = IMAGE_CONFIG;
  const labels: CardLabel[] = [];
  let labelIndex = 0;

  const sets = fs.readdirSync(imageBaseDir).filter((f) => {
    const fullPath = path.join(imageBaseDir, f);
    return fs.statSync(fullPath).isDirectory() && !f.startsWith(".");
  });

  for (const setCode of sets) {
    if (setFilter && setCode !== setFilter) continue;

    const setDir = path.join(imageBaseDir, setCode);
    const images = fs.readdirSync(setDir).filter((f) => f.endsWith(".png"));

    for (const imageName of images) {
      const cardId = imageName.replace(".png", "");
      labels.push({
        cardId,
        setCode,
        imagePath: path.join(setDir, imageName),
        labelIndex: labelIndex++,
      });
    }
  }

  return labels;
}

/**
 * Save the trained model
 */
export async function saveImageModel(
  model: tf.LayersModel,
  labels: CardLabel[],
  metrics: ImageModelMetrics,
  version: string
): Promise<void> {
  const { modelDir } = IMAGE_CONFIG;

  // Create directory if it doesn't exist
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  // Save model
  await model.save(`file://${modelDir}`);

  // Save labels mapping
  const labelsPath = path.join(modelDir, "labels.json");
  fs.writeFileSync(
    labelsPath,
    JSON.stringify(
      {
        version,
        savedAt: new Date().toISOString(),
        numClasses: labels.length,
        labels: labels.map((l) => ({
          cardId: l.cardId,
          setCode: l.setCode,
          index: l.labelIndex,
        })),
      },
      null,
      2
    )
  );

  // Save metrics
  const metricsPath = path.join(modelDir, "metrics.json");
  fs.writeFileSync(
    metricsPath,
    JSON.stringify(
      {
        version,
        savedAt: new Date().toISOString(),
        ...metrics,
      },
      null,
      2
    )
  );

  console.log(`[ImageModel] Model saved to ${modelDir}`);
}

/**
 * Load a trained model
 */
export async function loadImageModel(): Promise<{
  model: tf.LayersModel;
  labels: CardLabel[];
  metrics: ImageModelMetrics;
} | null> {
  const { modelDir } = IMAGE_CONFIG;
  const modelPath = path.join(modelDir, "model.json");
  const labelsPath = path.join(modelDir, "labels.json");
  const metricsPath = path.join(modelDir, "metrics.json");

  if (!fs.existsSync(modelPath) || !fs.existsSync(labelsPath)) {
    return null;
  }

  const model = await tf.loadLayersModel(`file://${modelPath}`);
  const labelsData = JSON.parse(fs.readFileSync(labelsPath, "utf-8"));
  const metricsData = fs.existsSync(metricsPath)
    ? JSON.parse(fs.readFileSync(metricsPath, "utf-8"))
    : { accuracy: 0, loss: 0, topKAccuracy: 0 };

  const labels: CardLabel[] = labelsData.labels.map(
    (l: { cardId: string; setCode: string; index: number }) => ({
      cardId: l.cardId,
      setCode: l.setCode,
      imagePath: path.join(IMAGE_CONFIG.imageBaseDir, l.setCode, `${l.cardId}.png`),
      labelIndex: l.index,
    })
  );

  return { model, labels, metrics: metricsData };
}

/**
 * Predict the card from an image
 */
export async function predictCard(
  model: tf.LayersModel,
  imagePath: string,
  labels: CardLabel[],
  topK: number = 5
): Promise<
  Array<{
    cardId: string;
    setCode: string;
    confidence: number;
    rank: number;
  }>
> {
  const image = await loadAndPreprocessImage(imagePath);
  const batch = image.expandDims(0);

  const predictions = model.predict(batch) as tf.Tensor;
  const probabilities = await predictions.data();

  // Get top K predictions
  const indexed = Array.from(probabilities).map((prob, idx) => ({
    prob,
    idx,
  }));
  indexed.sort((a, b) => b.prob - a.prob);

  const topPredictions = indexed.slice(0, topK).map((p, rank) => {
    const label = labels.find((l) => l.labelIndex === p.idx);
    return {
      cardId: label?.cardId || "unknown",
      setCode: label?.setCode || "unknown",
      confidence: p.prob,
      rank: rank + 1,
    };
  });

  // Cleanup
  image.dispose();
  batch.dispose();
  predictions.dispose();

  return topPredictions;
}

/**
 * Get model summary for logging
 */
export function getModelSummary(model: tf.LayersModel): {
  totalParams: number;
  trainableParams: number;
  layers: Array<{ name: string; type: string; outputShape: string; params: number }>;
} {
  let totalParams = 0;
  let trainableParams = 0;
  const layers: Array<{ name: string; type: string; outputShape: string; params: number }> = [];

  for (const layer of model.layers) {
    const params = layer.countParams();
    totalParams += params;
    if (layer.trainable) {
      trainableParams += params;
    }
    layers.push({
      name: layer.name,
      type: layer.getClassName(),
      outputShape: JSON.stringify(layer.outputShape),
      params,
    });
  }

  return { totalParams, trainableParams, layers };
}
