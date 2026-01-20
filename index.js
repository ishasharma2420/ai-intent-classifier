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
 * Safely extract value from multiple possible LS keys
 */
function pickValue(lead, keys) {
  for (const key of keys) {
    if (lead[key] && lead[key].toString().trim() !== "") {
      return lead[key];
    }
  }
  return "";
}

/**
 * EXACT chatbot-aligned score maps
 */
const ENGAGEMENT_SCORE_MAP = {
  "ready to apply": 40,
  "questions on admission": 36,
  "need counselling": 30,
  "shortlisting colleges": 26,
  "need fa support": 24,
  "just exploring options": 16
};

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

  const strong = ["apply", "application", "admission", "asap", "enroll"];
  const medium = ["fees", "fee", "finance", "scholarship", "course", "program"];

  let strength = "Weak";
  if (strong.some(k => text.includes(k))) strength = "Strong";
  else if (medium.some(k => text.includes(k))) strength = "Medium";

  let intent = "General inquiry";
  if (text.includes("mba")) intent = "MBA admissions";
  else if (text.includes("msc") || text.includes("biology"))
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
    const lead =
      payload.After ||
      payload.Current ||
      payload.Before ||
      {};

    /**
     * 🔑 MULTI-KEY EXTRACTION (THIS IS THE REAL FIX)
     */
    const inquiryRaw = pickValue(lead, [
      "mx_Student_Inquiry",
      "Student Inquiry",
      "Student_Inquiry",
      "mx_StudentInquiry"
    ]);

    const engagementRaw = pickValue(lead, [
      "mx_Engagement_Readiness",
      "Engagement Readiness",
      "Engagement_Readiness",
      "mx_EngagementReadiness"
    ]);

    const timelineRaw = pickValue(lead, [
      "mx_Enrollment_Timeline",
      "Enrollment Timeline",
      "Enrollment_Timeline",
      "mx_EnrollmentTimeline"
    ]);

    const inquiry = normalize(inquiryRaw);
    const engagement = normalize(engagementRaw);
    const timeline = normalize(timelineRaw);

    const engagementScore = matchScore(engagement, ENGAGEMENT_SCORE_MAP);
    const timelineScore = matchScore(timeline, TIMELINE_SCORE_MAP);

    const inquiryResult = classifyInquiry(inquiry);
    const inquiryScore = intentScore(inquiryResult.intent_strength);

    let totalScore = engagementScore + timelineScore + inquiryScore;

    /**
     * HARD SAFETY FLOOR
     */
    if (
      totalScore === 0 &&
      (engagement.includes("ready") || timeline.includes("30"))
    ) {
      totalScore = 70;
    }

    let bucket = "Low";
    if (totalScore >= 70) bucket = "High";

    /**
     * 🔍 ECHO BACK WHAT RENDER ACTUALLY RECEIVED
     */
    return res.status(200).json({
      success: true,
      scoring_version: "v1.3-payload-proof",
      ai_output: {
        detected_intent: inquiryResult.intent_type,
        readiness_score: totalScore,
        readiness_bucket: bucket
      },
      debug_received_values: {
        inquiry_raw: inquiryRaw,
        engagement_raw: engagementRaw,
        timeline_raw: timelineRaw
      }
    });
  } catch (err) {
    console.error("Scoring error:", err);
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
