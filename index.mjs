import fastify from "fastify";
import awsLambdaFastify from "@fastify/aws-lambda";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const app = fastify({ logger: true });

// CloudFront configuration from environment variables
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_COUNTRIES_DOMAIN;
const CLOUDFRONT_KEY_PAIR_ID = process.env.CLOUDFRONT_KEY_PAIR_ID;
const PRIVATE_KEY_PATH = "./cloudfront-private-key.pem";
const EXPIRES_IN_SECONDS = 60;

// Load private key for signing CloudFront URLs
let privateKey;
try {
  privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
} catch (error) {
  console.error(
    `Error: Could not read private key from ${PRIVATE_KEY_PATH}.`,
    error
  );
  if (process.env.NODE_ENV !== "production") process.exit(1);
}

// Environment variable validation
if (!CLOUDFRONT_DOMAIN || !CLOUDFRONT_KEY_PAIR_ID || !privateKey) {
  console.error("Missing CloudFront configuration environment variables.");
  process.exit(1);
}

/**
 * Generates a CloudFront Signed URL.
 */
const generateSignedCloudFrontUrl = (fileKey) => {
  const cleanFileKey = fileKey.startsWith("/") ? fileKey.substring(1) : fileKey;
  const resourceUrl = `${CLOUDFRONT_DOMAIN}/${cleanFileKey}`;
  const expirationDate = new Date(Date.now() + EXPIRES_IN_SECONDS * 1000);

  try {
    return getSignedUrl({
      url: resourceUrl,
      dateLessThan: expirationDate.toISOString(),
      keyPairId: CLOUDFRONT_KEY_PAIR_ID,
      privateKey: privateKey,
    });
  } catch (error) {
    app.log.error("Error generating CloudFront signed URL:", error);
    throw new Error("Failed to generate CloudFront signed URL.");
  }
};

// --- API Routes ---

// Health check
app.get("/health", async (_, reply) =>
  reply.status(200).send({ message: "API is Healthy", status: "ok" })
);

// Root endpoint with API info
app.get("/", async (request, reply) => {
  return {
    message: "Welcome to the VBytes Language Dataset and Country Codes API",
    version: "1.0.0",
    routes: [
      { method: "GET", path: "/health", description: "Health check" },
      {
        method: "GET",
        path: "/countries?file=file.json",
        description: "Get country data",
      },
    ],
  };
});

// Endpoint for country data
app.get("/countries", async (request, reply) => {
  const { file } = request.query;
  if (!file)
    return reply.status(400).send({ error: "Missing 'file' parameter" });

  try {
    const fileUrl = generateSignedCloudFrontUrl(file);
    return reply.redirect(fileUrl, 302);
  } catch (error) {
    request.log.error(
      `Error processing /countries request for file: ${file}`,
      error
    );
    return reply.status(500).send({
      error: `Failed to retrieve file URL for ${file}`,
      message: error.message,
    });
  }
});

// --- AWS Lambda Handler ---
export const handler = awsLambdaFastify(app);

// --- Local Development Server ---
if (process.env.NODE_ENV === "test") {
  app.listen({ port: 5000 }, (err) => {
    if (err) console.error(err);
    else console.log("Server listening on http://localhost:5000");
  });
}
