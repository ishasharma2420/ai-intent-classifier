import express from "express";

const app = express();
app.use(express.json());

/* -------------------- HEALTH -------------------- */
app.get("/", (_, res) => {
  res.status(200).send("AI Lead Readiness Scoring – FINAL");
});

/* -------------------- HELPERS -------------------- */
const normalize = (v) =>
  (v ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

function deepFind(obj, possibleKeys) {
  if (!obj || typeof obj !== "object") return "";

  for (const key of Object.keys(obj)) {
    if (possibleKeys.includes(key.toLowerCase())) {
      const val = obj[key];
      if (val && val.toString().trim() !== "") return val;
    }
    if (typeof obj[key] === "object") {
      const found = deepFind(obj[key], possibleKeys);
      if (found) return found;
    }
  }
  return "";
}

/* -------------------- SCORE MAPS -------------------- */
const ENGAGEMENT_MAP = {
  "ready to apply": 40,
  "need fa support": 24,
  "need financial aid support": 24,
  "questions on admission": 36,
  "need counselling": 30,
  "shortlisting colleges": 26,
  "just exploring options": 16
};

const TIMELINE_MAP = {
  "within 30 days": 40,
  "1-3 months": 32,
  "this academic cycle": 28,
  "next year": 20,
  "just researching": 10
};

function scoreFromMap(value, map) {
  for (const k of Object.keys(map)) {
    if (value.includes(k)) return map[k];
  }
  return 0;
}

/* -------------------- INQUIRY CLASSIFIER -------------------- */
function classifyInquiry(text) {
  if (!text) {
    return { intent: "General inquiry", strength: "Weak" };
  }

  const strong = ["apply", "application", "asap", "urgent", "enroll"];
  const medium = ["fee", "fees", "finance", "scholarship", "course", "program"];

  let strength = "Weak";
  if (strong.some((k) => text.includes(k))) strength = "Strong";
  else if (medium.some((k) => text.includes(k))) strength = "Medium";

  let intent = "General inquiry";
  if (text.includes("mba")) intent = "MBA admissions";
  else if (text.includes("msc") || text.includes("psychology"))
    intent = "Postgraduate admissions";
  else if (text.includes("engineering") || text.includes("btech"))
    intent = "Engineering admissions";
  else if (text.includes("fee") || text.includes("finance"))
    intent = "Financial aid";

  return { intent, strength };
}

function intentScore(strength) {
  if (strength === "Strong") return 20;
  if (strength === "Medium") return 12;
  return 6;
}

/* -------------------- WEBHOOK -------------------- */
app.post("/intent-classifier", (req, res) => {
  try {
    const payload = req.body || {};

    /* 🔥 DEEP EXTRACTION – NO ASSUMPTIONS */
    const inquiry = normalize(
      deepFind(payload, ["student_inquiry", "mx_student_inquiry"])
    );

    const engagement = normalize(
      deepFind(payload, ["engagement_readiness", "mx_engagement_readiness"])
    );

    const timeline = normalize(
      deepFind(payload, ["enrollment_timeline", "mx_enrollment_timeline"])
    );

    /* -------------------- SCORING -------------------- */
    const engagementScore = scoreFromMap(engagement, ENGAGEMENT_MAP);
    const timelineScore = scoreFromMap(timeline, TIMELINE_MAP);

    const inquiryResult = classifyInquiry(inquiry);
    const inquiryScore = intentScore(inquiryResult.strength);

    let totalScore =
      engagementScore + timelineScore + inquiryScore;

    /* 🔒 BUSINESS OVERRIDE – NON-NEGOTIABLE */
    if (
      totalScore < 40 &&
      (engagement.includes("fa") ||
        engagement.includes("ready") ||
        timeline.includes("30"))
    ) {
      totalScore = 75;
    }

    const bucket = totalScore >= 70 ? "High" : "Low";

    return res.status(200).json({
      success: true,
      scoring_version: "vFINAL-no-more-guessing",
      ai_output: {
        detected_intent: inquiryResult.intent,
        readiness_score: totalScore,
        readiness_bucket: bucket
      },
      debug_final_inputs: {
        inquiry,
        engagement,
        timeline
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false });
  }
});

/* -------------------- START -------------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`AI Lead Readiness Scoring running on ${PORT}`)
);
