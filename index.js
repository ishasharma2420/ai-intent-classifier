import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("AI Lead Readiness Scoring Service is running");
});

/**
 * Normalize helper
 */
const normalize = (value) =>
  (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Engagement Readiness scoring (chatbot-aligned)
 */
const ENGAGEMENT_SCORE_MAP = {
  "ready to apply": 40,
  "questions on admission": 36,
  "need counselling": 30,
  "shortlisting colleges": 26,
  "need fa support": 24,
  "just exploring options": 16
};

/**
 * Enrollment Timeline scoring (chatbot-aligned)
 */
const TIMELINE_SCORE_MAP = {
  "within 30 days": 40,
  "1-3 months": 32,
  "this academic cycle": 28,
  "next year": 20,
  "just researching": 10
};

function matchScore(value, map) {
  for (const key of Object.keys(map)) {
    if (value.includes(key)) return map[key];
  }
  return 0;
}

/**
 * Inquiry classification
 */
function classifyInquiry(text) {
  if (!text) {
    return { intent_type: "General inquiry", intent_strength: "Weak" };
  }

  const strong = ["apply", "application", "admission", "asap", "urgent", "enroll"];
  const medium = ["fees", "fee", "finance", "scholarship", "course", "program"];

  let strength = "Weak";
  if (strong.some(k => text.includes(k))) strength = "Strong";
  else if (medium.some(k => text.includes(k))) strength = "Medium";

  let intent = "General inquiry";
  if (text.includes("mba")) intent = "MBA admissions";
  else if (text.includes("msc") || text.includes("psychology"))
    intent = "Postgraduate admissions";
  else if (text.includes("engineering") || text.includes("btech"))
    intent = "Engineering admissions";
  else if (text.includes("fee") || text.includes("finance"))
    intent = "Financial aid";

  return { intent_type: intent, intent_strength: strength };
}

function intentScore(strength) {
  if (strength === "Strong") return 20;
  if (strength === "Medium") return 12;
  return 6;
}

/**
 * Webhook
 */
app.post("/intent-classifier", async (req, res) => {
  try {
    const payload = req.body || {};

    /**
     * 🔑 SUPPORT BOTH UDS (flat) AND LS Automation (nested)
     */
    const lead =
      payload.student_inquiry
        ? payload
        : payload.After || payload.Current || payload.Before || {};

    const inquiry = normalize(
      lead.student_inquiry || lead.mx_Student_Inquiry
    );

    const engagement = normalize(
      lead.engagement_readiness || lead.mx_Engagement_Readiness
    );

    const timeline = normalize(
      lead.enrollment_timeline || lead.mx_Enrollment_Timeline
    );

    const engagementScore = matchScore(engagement, ENGAGEMENT_SCORE_MAP);
    const timelineScore = matchScore(timeline, TIMELINE_SCORE_MAP);

    const inquiryResult = classifyInquiry(inquiry);
    const inquiryScore = intentScore(inquiryResult.intent_strength);

    let readinessScore =
      engagementScore + timelineScore + inquiryScore;

    /**
     * Safety floor: strong signals cannot be Low
     */
    if (
      readinessScore < 40 &&
      (engagementScore >= 30 || timelineScore >= 30)
    ) {
      readinessScore = 70;
    }

    let readinessBucket = "Low";
    if (readinessScore >= 70) readinessBucket = "High";

    return res.status(200).json({
      success: true,
      scoring_version: "v1.4-uds-payload-aware",
      ai_output: {
        detected_intent: inquiryResult.intent_type,
        readiness_score: readinessScore,
        readiness_bucket: readinessBucket
      }
    });
  } catch (err) {
    console.error("Lead readiness scoring error:", err);
    return res.status(500).json({
      success: false,
      error: "Lead readiness scoring failed"
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Lead Readiness Scoring Service running on port ${PORT}`);
});
