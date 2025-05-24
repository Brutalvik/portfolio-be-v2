import fastify from "fastify";
import awsLambdaFastify from "@fastify/aws-lambda";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import fs from "fs"; // Required to read the private key file
import dotenv from "dotenv";

// Load environment variables from .env file (for local development)
dotenv.config();

// Initialize Fastify application with logging enabled
const app = fastify({ logger: true });

// --- Environment Variables ---
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_LANGUAGES_DOMAIN;
const CLOUDFRONT_KEY_PAIR_ID = process.env.CLOUDFRONT_KEY_PAIR_ID;
const PRIVATE_KEY_PATH = "./cloudfront-private-key.pem";
// The expiration time for the signed URL in seconds
const EXPIRES_IN_SECONDS = 60; // 1 minute

// --- Load Private Key ---
let privateKey;

try {
  // Attempt to read the private key from the specified file
  privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
} catch (error) {
  console.error(
    `Error: Could not read private key from ${PRIVATE_KEY_PATH}. Ensure the file exists and is accessible.`,
    error
  );

  // If running locally and key file is missing, exit. Lambda will handle this differently.
  if (process.env.NODE_ENV !== "production") {
    process.exit(1);
  }
}

// --- Environment Variables Sanity Checks ---
if (!CLOUDFRONT_DOMAIN) {
  console.error(
    "Error: CLOUDFRONT_LANGUAGES_DOMAIN environment variable is not set. Please provide your CloudFront distribution domain."
  );
  process.exit(1);
}
if (!CLOUDFRONT_KEY_PAIR_ID) {
  console.error(
    "Error: CLOUDFRONT_KEY_PAIR_ID environment variable is not set. Required for CloudFront signed URLs."
  );
  process.exit(1);
}
if (!privateKey) {
  console.error(
    "Error: CloudFront private key is not loaded. Check PRIVATE_KEY_PATH or CLOUDFRONT_PRIVATE_KEY_CONTENT env var."
  );
  process.exit(1);
}

// --- API Routes ---

// Health check endpoint to verify API status
app.get("/health", async (_, reply) =>
  reply.status(200).send({ message: "API is Healthy", status: "ok" })
);

// Download endpoint to generate and redirect to a CloudFront Signed URL
app.get("/languages", async (req, reply) => {
  // Extract 'file' query parameter (e.g., ?file=document.pdf)
  const { file } = req.query;

  // Construct the base URL for the file on CloudFront
  const resourceUrl = `${CLOUDFRONT_DOMAIN}/${file}`;

  // Validate if the file parameter is provided
  if (!file) {
    req.log.warn("Missing 'file' query parameter in /languages request.");
    return reply.status(400).send({
      error: "Missing file",
      message:
        "Provide the ?file=filename.json query param to download a file.",
    });
  }

  try {
    // Generate the expiration date for the signed URL - 10 minutes
    const expirationDate = new Date(Date.now() + EXPIRES_IN_SECONDS * 10);

    // Generate the CloudFront signed URL
    const signedUrl = getSignedUrl({
      url: resourceUrl,
      // The dateLessThan parameter specifies when the URL will expire
      dateLessThan: expirationDate.toISOString(),
      keyPairId: CLOUDFRONT_KEY_PAIR_ID,
      privateKey: privateKey, // Use the loaded private key content
    });

    // Redirect the client to the newly generated CloudFront signed URL
    // The client will then use this URL to access the file from CloudFront.
    // CloudFront will validate the signature and expiration before serving the file.
    return reply.redirect(signedUrl, 302);
  } catch (err) {
    // Log any errors that occur during signed URL generation
    req.log.error("Error creating signed CloudFront URL:", err);
    return reply.status(500).send({
      error: "Signed URL generation failed",
      message: err.message,
    });
  }
});

// --- AWS Lambda Handler ---
// This exports the Fastify app wrapped for AWS Lambda execution.
// When deployed, AWS Lambda will call this 'handler' function.
export const handler = awsLambdaFastify(app);

// --- Local Development Server ---
// This block allows you to run the API locally for testing.
// It will only execute if NODE_ENV is set to 'test'.
if (process.env.NODE_ENV === "test") {
  app.listen({ port: 5000 }, (err) => {
    if (err) {
      console.error("Error starting local server:", err);
      process.exit(1); // Exit if server fails to start
    } else {
      console.log("Server listening on http://localhost:5000");
      console.log(
        `Test with: http://localhost:5000/download?file=your-document.pdf`
      );
      console.log(
        `Ensure your .env has CLOUDFRONT_PDF_DOMAIN and CLOUDFRONT_KEY_PAIR_ID, and ${PRIVATE_KEY_PATH} exists.`
      );
    }
  });
}
