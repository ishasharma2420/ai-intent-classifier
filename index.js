import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const LS_HOST = "https://api-us11.leadsquared.com"; // us11 cluster
const ACCESS_KEY = process.env.LS_ACCESS_KEY;
const SECRET_KEY = process.env.LS_SECRET_KEY;

app.post("/intent-classifier", async (req, res) => {
  try {
    const data = req.body;
    const prospectId =
      data?.Current?.ProspectID ||
      data?.After?.ProspectID ||
      data?.Before?.ProspectID;

    if (!prospectId) {
      return res.status(400).json({ error: "ProspectID not found in webhook" });
    }

    // ---- MOCK / STATIC AI OUTPUT (replace later) ----
    const aiResult = {
      readinessBucket: "HIGH",
      readinessScore: 0.8,
      detectedIntent: "MBA",
      riskCategory: "medium",
      propensityScore: 75,
      decisionSummary:
        "High intent student with Fall 2026 timeline and strong engagement."
    };

    const updatePayload = [
      {
        ProspectID: prospectId,
        mx_Readiness_Bucket: aiResult.readinessBucket,
        mx_AI_Readiness_Score: aiResult.readinessScore,
        mx_AI_Detected_Intent: aiResult.detectedIntent,
        mx_AI_Risk_Category: aiResult.riskCategory,
        mx_AI_Propensity_Score: aiResult.propensityScore,
        mx_Last_AI_Decision: aiResult.decisionSummary
      }
    ];

    const url = `${LS_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${ACCESS_KEY}&secretKey=${SECRET_KEY}`;

    const lsResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatePayload)
    });

    const resultText = await lsResponse.text();

    if (!lsResponse.ok) {
      throw new Error(`LeadSquared update failed: ${resultText}`);
    }

    res.json({
      success: true,
      prospectId,
      leadSquaredResponse: resultText
    });
  } catch (err) {
    console.error("Intent classifier error:", err.message);
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
