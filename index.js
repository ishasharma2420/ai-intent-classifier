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
 * LeadSquared ASYNC Update
 */
async function updateLeadSquaredAsync(prospectId, fields) {
  const url = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.UpdateAsync?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

  const payload = [
    {
      ProspectID: prospectId,
      ...fields
    }
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`LeadSquared update failed: ${text}`);
  }

  return text;
}

app.post("/intent-classifier", async (req, res) => {
  try {
    const prospectId =
      req.body?.Current?.ProspectID ||
      req.body?.After?.ProspectID ||
      req.body?.Before?.ProspectID;

    if (!prospectId) {
      return res.status(400).json({
        error: "ProspectID not found"
      });
    }

    const studentInquiry = req.body?.Current?.mx_Student_Inquiry || "";
    const enrollmentTimeline = req.body?.Current?.mx_Enrollment_Timeline || "";
    const engagementReadiness = req.body?.Current?.mx_Engagement_Readiness || "";

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      text: {
        format: {
          type: "json_object"
        }
      },
      input: [
        {
          role: "system",
          content: "You are an intent classification engine. Return valid JSON only."
        },
        {
          role: "user",
          content: "Classify student intent.\n\nInquiry: " +
            studentInquiry +
            "\nTimeline: " +
            enrollmentTimeline +
            "\nEngagement: " +
            engagementReadiness +
            "\n\nReturn exactly:\n{\n  \"intent\": \"schedule | explore | nurture\",\n  \"readiness_score\": 0.0,\n  \"risk_category\": \"low | medium | high\",\n  \"propensity_score\": 0,\n  \"decision_summary\": \"\"\n}"
        }
      ]
    });

    const outputText = response.output_text;

    if (!outputText) {
      throw new Error("Empty AI response");
    }

    const result = JSON.parse(outputText);

    const readinessBucket =
      result.readiness_score >= 0.75 ? "HIGH" : "LOW";

    await updateLeadSquaredAsync(prospectId, {
      mx_AI_Detected_Intent: result.intent,
      mx_AI_Readiness_Score: result.readiness_score,
      mx_Readiness_Bucket: readinessBucket,
      mx_AI_Risk_Category: result.risk_category,
      mx_AI_Propensity_Score: result.propensity_score,
      mx_Last_AI_Decision: result.decision_summary
    });

    res.json({
      status: "success",
      prospectId,
      ai_result: result
    });
  } catch (err) {
    console.error("Intent classifier failed:", err);

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
