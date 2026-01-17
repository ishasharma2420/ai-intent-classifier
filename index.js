import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const LS_HOST = "https://api-us11.leadsquared.com";
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
      return res.status(400).json({ error: "ProspectID not found" });
    }

    const updatePayload = [
      {
        ProspectID: prospectId,
        mx_AI_Detected_Intent: "MBA",
        mx_AI_Readiness_Score: "High",
        mx_Engagement_Readiness: "Ready Now",
        mx_Last_AI_Decision:
          "High intent student with Fall 2026 enrollment timeline"
      }
    ];

    const url = `${LS_HOST}/v2/LeadManagement.svc/Lead.UpdateAsync?accessKey=${ACCESS_KEY}&secretKey=${SECRET_KEY}`;

    const lsRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatePayload)
    });

    const responseText = await lsRes.text();

    if (!lsRes.ok || responseText.includes("Error")) {
      throw new Error(responseText);
    }

    res.json({ success: true, prospectId });
  } catch (err) {
    console.error("Intent classifier error:", err.message);
    res.status(500).json({
      error: "Intent classification failed",
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`AI Intent Classifier running on port ${PORT}`)
);
