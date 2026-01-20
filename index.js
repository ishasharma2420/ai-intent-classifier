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
 * Normalize helper
 * Handles casing, spacing, CRM quirks
 */
const normalize = (value) =>
  (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Engagement Readiness – EXACT chatbot values
 * Weight: 40
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
 * Enrollment Timeline – EXACT chatbot values
 * Weight: 40
 */
const TIMELINE_SCORE_MAP = {
  "within 30 days": 40,
  "1-3 months": 32,
  "this academic cycle": 28,
  "next year": 20,
  "just researching": 10
};

/**
 * Safe fuzzy matcher for dropdown text fields
 */
function getMappedScore(value, scoreMap) {
  for (const key of Object.keys(scoreMap)) {
    if (value.includes(key)) {
      return scoreMap[key];
    }
  }
  return 0;
}

/**
 * Inquiry intent + strength classification
 * Weight: 20
 */
function classifyInquiry(text) {
  if (!text) {
    return {
      intent_type: "General inquiry",
      intent_strength: "Weak"
    };
  }

  const strongSignals = [
    "apply",
    "application",
    "admission",
    "asap",
    "enroll",
    "deadline"
  ];

  const mediumSignals = [
    "fees",
    "fee",
    "finance",
    "scholarship",
    "course",
    "program"
  ];

  let strength = "Weak";

  if (strongSignals.some(k => text.includes(k))) {
    strength = "Strong";
  } else if (mediumSignals.some(k => text.includes(k))) {
    strength = "Medium";
  }

  let intent = "General inquiry";

  if (text.includes("mba") || text.includes("business")) {
    intent = "MBA admissions";
  } else if (
    text.includes("engineering") ||
    text.includes("btech") ||
    text.includes("tech")
  ) {
    intent = "Engineering admissions";
  } else if (
    text.includes("fee") ||
    text.includes("finance") ||
    text.includes("scholarship")
  ) {
    intent = "Financial aid";
  } else if (
    text.includes("counselling") ||
    text.includes("counseling")
  ) {
    intent = "Counselling";
  }

  return {
    intent_type: intent,
    intent_strength: strength
  };
}

/**
 * Intent strength → numeric score
 */
function intentStrengthScore(strength) {
  if (strength === "Strong") return 20;
  if (strength === "Medium") return 12;
  return 6;
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

    const inquiry = normalize(lead.mx_Student_Inquiry);
    const engagement = normalize(lead.mx_Engagement_Readiness);
    const timeline = normalize(lead.mx_Enrollment_Timeline);

    const engagementScore = getMappedScore(
      engagement,
      ENGAGEMENT_SCORE_MAP
    );

    const timelineScore = getMappedScore(
      timeline,
      TIMELINE_SCORE_MAP
    );

    const inquiryResult = classifyInquiry(inquiry);
    const inquiryScore = intentStrengthScore(
      inquiryResult.intent_strength
    );

    let readinessScore =
      engagementScore + timelineScore + inquiryScore;

    /**
     * HARD GUARANTEE:
     * Strong dropdowns can NEVER result in Low / 0
     */
    if (
      readinessScore < 40 &&
      (engagementScore >= 30 || timelineScore >= 30)
    ) {
      readinessScore = 60;
    }

    let readinessBucket = "Low";
    if (readinessScore >= 70) {
      readinessBucket = "High";
    }

    return res.status(200).json({
      success: true,
      scoring_version: "v1.2-chatbot-aligned",
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
  console.log(
    `AI Lead Readiness Scoring Service running on port ${PORT}`
  );
});
