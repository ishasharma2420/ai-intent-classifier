import express from "express";

const app = express();
app.use(express.json());

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.status(200).send("AI Intent Classifier is running");
});

/**
 * LeadSquared webhook endpoint
 */
app.post("/intent-classifier", async (req, res) => {
  try {
    const payload = req.body || {};

    // LeadSquared sends data inside Before / After / Current
    const lead =
      payload.After ||
      payload.Current ||
      payload.Before ||
      {};

    const studentInquiry =
      (lead.mx_Student_Inquiry || "").toLowerCase();

    const readiness =
      (lead.mx_Engagement_Readiness || "").toLowerCase();

    // ---------- SIMPLE DETERMINISTIC CLASSIFICATION ----------
    let detectedIntent = "Unknown";
    let readinessBucket = "Low";

    if (
      studentInquiry.includes("mba") ||
      studentInquiry.includes("business")
    ) {
      detectedIntent = "MBA";
    } else if (
      studentInquiry.includes("engineering") ||
      studentInquiry.includes("tech")
    ) {
      detectedIntent = "Engineering";
    }

    if (readiness === "ready now") {
      readinessBucket = "High";
    } else if (readiness === "just exploring") {
      readinessBucket = "Medium";
    }

    // ---------- RESPONSE BACK TO LEADSQUARED ----------
    // ⚠️ IMPORTANT:
    // LeadSquared Automation will read this response
    // and perform the update internally
    return res.status(200).json({
      success: true,
      ai_output: {
        detected_intent: detectedIntent,
        readiness_bucket: readinessBucket,
        confidence: 0.85
      }
    });
  } catch (err) {
    console.error("Intent classifier error:", err);
    return res.status(500).json({
      success: false,
      error: "Intent classification failed"
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
