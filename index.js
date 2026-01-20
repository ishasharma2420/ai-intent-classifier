import express from "express";

const app = express();
app.use(express.json());

/* -------------------- HEALTH CHECK -------------------- */
app.get("/", (req, res) => {
  res.status(200).send("AI Lead Readiness Scoring Service running");
});

/* -------------------- HELPERS -------------------- */
function normalize(value) {
  return (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/* -------------------- SCORE MAPS -------------------- */
const ENGAGEMENT_SCORE_MAP = {
  "ready to apply": 40,
  "need fa support": 24,
  "need financial aid support": 24,
  "questions on admission": 36,
  "need counselling": 30,
  "shortlisting colleges": 26,
  "just exploring options": 16
};

const TIMELINE_SCORE_MAP = {
  "within 30 days": 40,
  "1-3 months": 32,
  "this academic cycle": 28,
  "next year": 20,
  "just researching": 10
};

function mapScore(value, map) {
  for (const key in map) {
    if (value.includes(key)) return map[key];
  }
  return 0;
}

/* -------------------- INQUIRY CLASSIFIER -------------------- */
function classifyInquiry(text) {
  let intent = "General inquiry";
  let strength = "Weak";

  if (!text) {
    return { intent, strength };
  }

  const strongSignals = ["apply", "application", "urgent", "asap", "enroll"];
  const mediumSignals = ["fee", "fees", "finance", "scholarship", "course", "program"];

  if (strongSignals.some(k => text.includes(k))) {
    strength = "Strong";
  } else if (mediumSignals.some(k => text.includes(k))) {
    strength = "Medium";
  }

  if (text.includes("mba")) {
    intent = "MBA admissions";
  } else if (text.includes("msc") || text.includes("psychology")) {
    intent = "Postgraduate admissions";
  } else if (text.includes("engineering") || text.includes("btech")) {
    intent = "Engineering admissions";
  } else if (text.includes("fee") || text.includes("finance")) {
    intent = "Financial aid";
  }

  return { intent, strength };
}

function intentStrengthScore(strength) {
  if (strength === "Strong") return 20;
  if (strength === "Medium") return 12;
  return 6;
}

/* -------------------- WEBHOOK -------------------- */
app.post("/intent-classifier", (req, res) => {
  try {
    const payload = req.body || {};

    // UDS flat payload (confirmed from your logs)
    const inquiry = normalize(payload.student_inquiry);
    const engagement = normalize(payload.engagement_readiness);
    const timeline = normalize(payload.enrollment_timeline);

    const engagementScore = mapScore(engagement, ENGAGEMENT_SCORE_MAP);
    const timelineScore = mapScore(timeline, TIMELINE_SCORE_MAP);

    const inquiryResult = classifyInquiry(inquiry);
    const inquiryScore = intentStrengthScore(inquiryResult.strength);

    let readinessScore = engagementScore + timelineScore + inquiryScore;

    // Hard business rule: strong signals must not be Low / 0
    if (
      readinessScore < 40 &&
      (timeline.includes("30") || engagement.includes("fa") || engagement.includes("ready"))
    ) {
      readinessScore = 75;
    }

    const readinessBucket = readinessScore >= 70 ? "High" : "Low";

    return res.status(200).json({
      success: true,
      ai_output: {
        detected_intent: inquiryResult.intent,
        readiness_score: readinessScore,
        readiness_bucket: readinessBucket
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

/* -------------------- START SERVER -------------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
