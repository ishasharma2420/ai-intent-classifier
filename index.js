import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Simple rate limiter for LeadSquared API (25 calls per 5 seconds)
 */
const rateLimiter = {
  calls: [],
  maxCalls: 25,
  windowMs: 5000,

  async throttle() {
    const now = Date.now();
    // Remove calls outside the window
    this.calls = this.calls.filter(t => now - t < this.windowMs);

    if (this.calls.length >= this.maxCalls) {
      const oldestCall = this.calls[0];
      const waitTime = this.windowMs - (now - oldestCall);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.throttle();
    }

    this.calls.push(now);
  }
};

/**
 * LeadSquared Update Helper
 * 
 * LeadSquared Lead.Update API expects:
 * - leadId as a URL query parameter
 * - Body: Array of {"Attribute": "schemaName", "Value": "value"} objects
 * - Schema names for custom fields use mx_ prefix (e.g., mx_AI_Detected_Intent)
 */
async function updateLeadSquared(prospectId, fieldsToUpdate) {
  // Apply rate limiting
  await rateLimiter.throttle();

  // leadId must be passed as a query parameter, not in the body
  const url = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}&leadId=${prospectId}`;

  // LeadSquared expects an array of Attribute/Value pairs
  // Convert the fields object to the correct format
  const body = Object.entries(fieldsToUpdate).map(([attribute, value]) => ({
    Attribute: attribute,
    Value: String(value) // Ensure value is a string
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const text = await res.text();

  if (!res.ok) {
    // Parse LeadSquared error response for better debugging
    let errorDetails = text;
    try {
      const errorJson = JSON.parse(text);
      errorDetails = errorJson.ExceptionMessage || errorJson.Message || text;
    } catch (e) {
      // Keep raw text if not JSON
    }

    // Handle rate limit specifically
    if (res.status === 429) {
      throw new Error(`LeadSquared rate limit exceeded. Please retry later.`);
    }

    throw new Error(`LeadSquared update failed (${res.status}): ${errorDetails}`);
  }

  return text;
}

app.post("/intent-classifier", async (req, res) => {
  try {
    /**
     * ✅ FINAL, CORRECT PROSPECT ID RESOLUTION
     */
    const prospectId =
      req.query?.entityId ||
      req.body?.ProspectID ||
      req.body?.After?.ProspectID ||
      req.body?.Before?.ProspectID ||
      req.body?.Current?.ProspectID;

    if (!prospectId) {
      return res.status(400).json({
        error: "ProspectID not found",
        query: req.query,
        bodyKeys: Object.keys(req.body || {})
      });
    }

    /**
     * Extract Lead Data
     */
    const studentInquiry =
      req.body?.After?.mx_Student_Inquiry || "";

    const enrollmentTimeline =
      req.body?.After?.mx_Enrollment_Timeline || "";

    const engagementReadiness =
      req.body?.After?.mx_Engagement_Readiness || "";

    /**
     * OpenAI Classification
     */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are an intent classifier. Respond ONLY with valid JSON."
        },
        {
          role: "user",
          content: `
Classify the student intent.

student_inquiry: ${studentInquiry}
enrollment_timeline: ${enrollmentTimeline}
engagement_readiness: ${engagementReadiness}

Return JSON EXACTLY as:
{
  "intent": "ready | explore | nurture",
  "readiness_score": 0.0,
  "risk_category": "low | medium | high",
  "propensity_score": 0,
  "decision_summary": ""
}
`
        }
      ]
    });

    const result = JSON.parse(
      completion.choices[0].message.content.trim()
    );

    const readinessBucket =
      result.readiness_score >= 0.75 ? "HIGH" : "LOW";

    /**
     * Update LeadSquared
     * 
     * NOTE: Use schema names (mx_ prefix) for custom fields.
     * Update these field names to match your LeadSquared schema.
     * You can find schema names in LeadSquared under:
     * Settings > Leads > Lead Fields > Schema Name column
     */
    await updateLeadSquared(prospectId, {
      "mx_AI_Detected_Intent": result.intent,
      "mx_AI_Readiness_Score": result.readiness_score,
      "mx_Readiness_Bucket": readinessBucket,
      "mx_AI_Risk_Category": result.risk_category,
      "mx_AI_Propensity_Score": result.propensity_score,
      "mx_Last_AI_Decision": result.decision_summary
    });

    res.json({
      status: "success",
      prospectId,
      readinessBucket
    });
  } catch (err) {
    console.error("Intent classifier error:", err);
    res.status(500).json({
      error: "Intent classification failed",
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
