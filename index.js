import express from "express";

const app = express();
app.use(express.json());

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.status(200).send("AI Lead Readiness Scoring Service is running");
});

/**
 * Utility: normalize string safely
 */
const normalize = (value) =>
  (value || "").toString().trim().toLowerCase();

/**
 * Deterministic score maps
 */
const ENGAGEMENT_SCORE_MAP = {
  "ready to apply": 40,
  "need help with admissions process": 36,
  "shortlisting colleges": 30,
  "needs counselling guidance": 26,
  "needs financial aid support": 24,
  "just exploring options": 16
};

const TIMELINE_SCORE_MAP = {
  "within 30 days": 40,
  "ready to apply": 40,
  "within 1-3 months": 32,
  "this academic cycle": 28,
  "next year": 20,
  "just researching": 10
};

/**
 * Keyword-based intent + strength detection
 */
function classifyInquiry(text) {
  if (!text) {
    return {
      intent_type: "General Inquiry",
      intent_strength: "Unknown"
    };
  }

  const strongKeywords = [
    "apply",
    "application",
    "admission",
    "enroll",
    "enrollment",
    "deadline",
    "asap",
    "counselling"
  ];

  const mediumKeywords = [
    "eligibility",
    "fees",
    "finance",
    "scholarship",
    "colleges",
    "program",
    "course"
  ];

  let intentStrength = "Weak";

  if (strongKeywords.some((k) => text.includes(k))) {
    intentStrength = "Strong";
  } else if (mediumKeywords.some((k) => text.includes(k))) {
    intentStrength = "Medium";
  }

  let intentType = "General Inquiry";

  if (text.includes("mba") || text.includes("business")) {
    intentType = "MBA Admissions";
  } else if (
    text.includes("engineering") ||
    text.includes("btech") ||
    text.includes("tech")
  ) {
    intentType = "Engineering Admissions";
  } else if (
    text.includes("fee") ||
    text.includes("finance") ||
    text.includes("scholarship")
  ) {
    intentType = "Financial Aid";
  } else if (
    text.includes("counselling") ||
    text.includes("guidance")
  ) {
    intentType = "Counselling";
  }

  return {
    intent_type: intentType,
    intent_strength: intentStrength
  };
}

/**
 * Map intent strength to score
 */
function mapIntentStrengthToScore(strength) {
  switch (strength) {
    case "Strong":
      return 20;
    case "Medium":
      return 12;
    case "Weak":
      return 6;
    default:
      return 0;
  }
}

/**
 * LeadSquared webhook endpoint
 */
app.post("/intent-classifier", async (req, res) => {
  try {
    const payload = req.body || {};

    const lead =
      payload.After ||
      payload.Current ||
      payload.Before ||
      {};

    const studentInquiry = normalize(lead.mx_Student_Inquiry);
    const engagementReadiness = normalize(
      lead.mx_Engagement_Readiness
    );
    const enrollmentTimeline = normalize(
      lead.mx_Enrollment_Timeline
    );

    // ---------- SCORING ----------
    const engagementScore =
      ENGAGEMENT_SCORE_MAP[engagementReadiness] || 0;

    const timelineScore =
      TIMELINE_SCORE_MAP[enrollmentTimeline] || 0;

    const inquiryClassification =
      classifyInquiry(studentInquiry);

    const inquiryScore =
      mapIntentStrengthToScore(
        inquiryClassification.intent_strength
      );

    const readinessScore =
      engagementScore + timelineScore + inquiryScore;

    // ---------- BUCKETING ----------
    let readinessBucket = "Low";

    if (readinessScore >= 70) {
      readinessBucket = "High";
    } else if (readinessScore >= 40) {
      readinessBucket = "Medium";
    }

    // ---------- RESPONSE ----------
    return res.status(200).json({
      success: true,
      scoring_version: "v1.0-hybrid-deterministic",
      ai_output: {
        detected_intent: inquiryClassification.intent_type,
        readiness_score: readinessScore,
        readiness_bucket: readinessBucket,
        scoring_breakdown: {
          engagement_score: engagementScore,
          timeline_score: timelineScore,
          inquiry_score: inquiryScore
        }
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
  console.log(
    `AI Lead Readiness Scoring Service running on port ${PORT}`
  );
});
