import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();

/* ---------- SECURITY & MIDDLEWARE ---------- */
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "100kb" }));

/* ---------- HEALTH CHECK ---------- */
app.get("/", (_, res) => {
  res.json({
    service: "Agent Flash – AI Lead Readiness Scoring",
    status: "ok",
    version: "3.0.0",
  });
});

/* ---------- NORMALIZATION ----------
   Lowercases and trims all incoming strings so casing never causes a mismatch.
-------------------------------------------------------------------*/
const norm = v => (v || "").toLowerCase().replace(/\s+/g, " ").trim();

/* ---------- BASE SCORE MATRIX ----------
   Rows = engagement_readiness  — exact chatbot dropdown values (lowercased)
   Cols = enrollment_timeline   — exact chatbot dropdown values (lowercased)
   No translation layer needed — chatbot sends these values directly.
-------------------------------------------------------------------*/
const BASE_SCORE = {
  "ready to apply": {
    "within 30 days":      90,
    "1-3 months":          82,
    "this academic cycle": 75,
    "next year":           60,
    "just researching":    45,
  },
  "questions on admission": {
    "within 30 days":      78,
    "1-3 months":          70,
    "this academic cycle": 63,
    "next year":           50,
    "just researching":    38,
  },
  "need fa support": {
    "within 30 days":      75,
    "1-3 months":          68,
    "this academic cycle": 60,
    "next year":           47,
    "just researching":    35,
  },
  "need counselling": {
    "within 30 days":      68,
    "1-3 months":          60,
    "this academic cycle": 53,
    "next year":           43,
    "just researching":    33,
  },
  "shortlisting colleges": {
    "within 30 days":      55,
    "1-3 months":          48,
    "this academic cycle": 42,
    "next year":           33,
    "just researching":    25,
  },
  "just exploring options": {
    "within 30 days":      40,
    "1-3 months":          34,
    "this academic cycle": 28,
    "next year":           22,
    "just researching":    15,
  },
};

/* ---------- VALID VALUE SETS (for error messages) ---------- */
const VALID_READINESS = new Set(Object.keys(BASE_SCORE));
const VALID_TIMELINES = new Set(
  Object.values(BASE_SCORE).flatMap(obj => Object.keys(obj))
);

/* ---------- INQUIRY CLASSIFICATION ----------
   Reads the student's free-text general inquiry and returns
   a human-readable intent label used in scoring and reasoning.
-------------------------------------------------------------------*/
function classifyInquiry(text) {
  if (!text || text.length < 3) return "General Inquiry";

  const t = text.toLowerCase();

  if (/(apply|application|admission|enroll|deadline|next step|how do i start|ready to apply|want to apply|asap)/.test(t))
    return "Admissions Inquiry";
  if (/(fee|fees|scholarship|financial|cost|tuition|funding|afford|fafsa|fa support)/.test(t))
    return "Fees & Financial Aid";
  if (/(eligible|eligibility|requirement|qualify|qualification|gpa|score|grades)/.test(t))
    return "Eligibility Check";
  if (/(which program|choose|compare|best course|options|difference between|what program)/.test(t))
    return "Program Selection";
  if (/(career|job|salary|placement|outcome|roi|after graduation|work)/.test(t))
    return "Career Outcomes";
  if (/(campus|location|accommodation|hostel|housing|visit|tour)/.test(t))
    return "Campus & Experience";
  if (/(counsellor|counseling|advisor|guidance|help me decide|talk to someone|speak)/.test(t))
    return "Counselling Request";
  if (/(research|explore|browsing|looking|just checking|information|tell me more|learn)/.test(t))
    return "Early Research";

  return "General Inquiry";
}

/* ---------- INQUIRY SCORE ADJUSTMENT ----------
   Nudges the base score slightly up or down based on free-text intent.
   Kept small so free text alone cannot flip a bucket.
-------------------------------------------------------------------*/
const INQUIRY_ADJUSTMENT = {
  "Admissions Inquiry":   8,
  "Fees & Financial Aid": 5,
  "Eligibility Check":    4,
  "Program Selection":    3,
  "Career Outcomes":      2,
  "Campus & Experience":  0,
  "Counselling Request":  1,
  "Early Research":      -5,
  "General Inquiry":      0,
};

/* ---------- REASONING GENERATOR ----------
   Produces a plain-English explanation of why this lead received
   its score and bucket. Written into the LS activity log as AI_Reasoning.
-------------------------------------------------------------------*/
function generateReasoning({
  rawReadiness,
  rawTimeline,
  baseScore,
  inquiryType,
  adjustment,
  finalScore,
  bucket,
  generalInquiry,
  programInterest,
}) {
  const urgencyLabel = {
    "within 30 days":      "very near-term (within 30 days)",
    "1-3 months":          "near-term (1–3 months)",
    "this academic cycle": "this academic cycle",
    "next year":           "next year",
    "just researching":    "no fixed timeline",
  }[rawTimeline] || rawTimeline;

  const intentSentence = generalInquiry && generalInquiry.length > 3
    ? `The student's own words — "${generalInquiry}" — indicate a ${inquiryType.toLowerCase()}, which ${adjustment > 0 ? `added ${adjustment} points` : adjustment < 0 ? `reduced the score by ${Math.abs(adjustment)} points` : "did not change the score"}.`
    : `No free-text inquiry was provided, so intent was inferred from structured inputs alone.`;

  const bucketExplanation = bucket === "High"
    ? `At ${finalScore}/100, this lead crosses the High readiness threshold (≥70). Agent Flash recommends immediate counselor scheduling.`
    : `At ${finalScore}/100, this lead is below the High readiness threshold (<70). Routed to voice qualification before counselor time is allocated.`;

  const programNote = programInterest
    ? `The student has expressed interest in ${programInterest}.`
    : "";

  return [
    `Agent Flash assessed this lead based on two structured signals: their stated need ("${rawReadiness}") and enrollment timeline ("${rawTimeline}").`,
    `This combination produced a base score of ${baseScore}/100 — reflecting a ${urgencyLabel} intent window for a student who selected "${rawReadiness}".`,
    intentSentence,
    programNote,
    bucketExplanation,
  ].filter(Boolean).join(" ");
}

/* ---------- MAIN API ENDPOINT ---------- */
app.post("/intent-classifier", (req, res) => {
  try {
    const body = req.body || {};

    /* Normalize incoming values */
    const rawReadiness    = norm(body.engagement_readiness);
    const rawTimeline     = norm(body.enrollment_timeline);
    const generalInquiry  = (body.student_inquiry  || "").trim();
    const programInterest = (body.program_interest || "").trim();

    /* Validate presence */
    if (!rawReadiness) {
      return res.status(400).json({
        success: false,
        error: "engagement_readiness is required. Expected one of: " + [...VALID_READINESS].join(", "),
      });
    }
    if (!rawTimeline) {
      return res.status(400).json({
        success: false,
        error: "enrollment_timeline is required. Expected one of: " + [...VALID_TIMELINES].join(", "),
      });
    }

    /* Validate values are recognised */
    if (!VALID_READINESS.has(rawReadiness)) {
      return res.status(400).json({
        success: false,
        error: `Unrecognised engagement_readiness value: "${rawReadiness}". Expected one of: ` + [...VALID_READINESS].join(", "),
      });
    }
    if (!VALID_TIMELINES.has(rawTimeline)) {
      return res.status(400).json({
        success: false,
        error: `Unrecognised enrollment_timeline value: "${rawTimeline}". Expected one of: ` + [...VALID_TIMELINES].join(", "),
      });
    }

    /* Look up base score */
    const baseScore = BASE_SCORE[rawReadiness][rawTimeline];

    /* Classify free-text and get adjustment */
    const inquiryType = classifyInquiry(generalInquiry);
    const adjustment  = INQUIRY_ADJUSTMENT[inquiryType] ?? 0;

    /* Final score clamped 0–100 */
    let finalScore = baseScore + adjustment;
    finalScore = Math.max(0, Math.min(100, finalScore));

    /* Binary bucket — matches LS automation exactly */
    const bucket = finalScore >= 70 ? "High" : "Low";

    /* Generate reasoning */
    const reasoning = generateReasoning({
      rawReadiness,
      rawTimeline,
      baseScore,
      inquiryType,
      adjustment,
      finalScore,
      bucket,
      generalInquiry,
      programInterest,
    });

    /* Respond */
    res.json({
      success: true,
      ai_output: {
        detected_intent:  inquiryType,
        readiness_score:  finalScore,
        readiness_bucket: bucket,
        reasoning:        reasoning,
      },
    });

  } catch (err) {
    console.error("Agent Flash error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/* ---------- START SERVER ---------- */
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, () => {
  console.log(`Agent Flash listening on port ${PORT}`);
});
