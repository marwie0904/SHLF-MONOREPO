/**
 * Preserve raw body for signature validation
 *
 * IMPORTANT: Must run BEFORE express.json() middleware
 * because signature validation requires the raw body string,
 * not the parsed JSON object.
 *
 * The signature from Clio is calculated on the exact bytes sent,
 * so we must preserve the original request body to verify it.
 */
export const preserveRawBody = (req, res, next) => {
  const chunks = [];

  req.on('data', chunk => {
    chunks.push(chunk);
  });

  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks).toString('utf8');
    next();
  });
};
