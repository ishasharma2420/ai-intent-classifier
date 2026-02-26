import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();

/* ---------- SECURITY & MIDDLEWARE ----------
   helmet  → sets safe HTTP response headers (protects against common attacks)
   cors    → allows LeadSquared and other services to call this endpoint
   json    → parses incoming JSON, capped at 100kb to prevent oversized payloads
-------------------------------------------------------------------*/
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "100kb" }));

/* ---------- HEALTH CHECK ----------
   Render and monitoring tools ping GET / to confirm the service is alive.
-------------------------------------------------------------------*/
app.get("/", (_, res) => {
  res.json({
    service: "Agent Flash – AI Lead Readiness Scoring",
    status: "ok",
    version: "2.0.0",
  });
});

/* ---------- NORMALIZATION ----------
   Lowercases and trims all incoming strings so
   "Fall 2025" and "fall 2025" are treated identically.
-------------------------------------------------------------------*/
const norm = v => (v || "").toLowerCase().replace(/\s+/g, " ").trim();

/* ---------- MAP ACTUAL LS FIELD VALUES → SCORING KEYS ----------
   LeadSquared sends raw dropdown values exactly as configured.
   These maps translate them into the keys the scoring matrix expects.
   If you ever add a new dropdown option in LS, add it here too.
-------------------------------------------------------------------*/
const READINESS_MAP = {
  // Low_Readiness_Concern field values
  "program details":         "questions on admission",
  "fees & scholarships":     "financial assistance",
  "career outcomes / roi":   "career outcomes",
  "admission requirements":  "questions on admission",
  "speak to an advisor":     "need counselling",
  "just browsing":           "just exploring options",
};

const TIMELINE_MAP = {
  // Reconnect_Timeline field values
  "within 3 months":                    "within 30 days",
  "fall 2025":                          "1-3 months",
  "spring 2026":                        "this academic cycle",
  "fall 2026":                          "next year",
  "just exploring (no fixed timeline)": "just researching",
};

/* ---------- BASE SCORE MATRIX ----------
   Rows = engagement_readiness (mapped from LS Low_Readiness_Concern)
   Cols = enrollment_timeline  (mapped from LS Reconnect_Timeline)
   These numbers represent baseline readiness before free-text adjustment.
-------------------------------------------------------------------*/
const BASE_SCORE = {
  "questions on admission": {
    "within 30 days":      80,
    "1-3 months":          72,
    "this academic cycle": 65,
    "next year":           50,
    "just researching":    38,
  },
  "financial assistance": {
    "within 30 days":      78,
    "1-3 months":          70,
    "this academic cycle": 62,
    "next year":           48,
    "just researching":    36,
  },
  "career outcomes": {
    "within 30 days":      72,
    "1-3 months":          65,
    "this academic cycle": 58,
    "next year":           45,
    "just researching":    33,
  },
  "need counselling": {
    "within 30 days":      68,
    "1-3 months":          60,
    "this academic cycle": 53,
    "next year":           43,
    "just researching":    35,
  },
  "just exploring options": {
    "within 30 days":      40,
    "1-3 months":          34,
    "this academic cycle": 28,
    "next year":           22,
    "just researching":    15,
  },
};

/* ---------- INQUIRY CLASSIFICATION ----------
   Reads the student's free-text general inquiry and returns
   a human-readable intent label used in scoring and reasoning.
-------------------------------------------------------------------*/
function classifyInquiry(text) {
  if (!text || text.length < 3) return "General Inquiry";

  const t = text.toLowerCase();

  if (/(apply|application|admission|enroll|deadline|next step|how do i start|ready to apply|want to apply|asap)/.test(t))
    return "Admissions Inquiry";
  if (/(fee|fees|scholarship|financial|cost|tuition|funding|afford)/.test(t))
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
   Intentionally small so free text cannot flip a bucket on its own.
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
function generateReasoning(params) {
  const {
    rawReadiness,
    rawTimeline,
    mappedReadiness,
    mappedTimeline,
    baseScore,
    inquiryType,
    adjustment,
    finalScore,
    bucket,
    generalInquiry,
    programInterest,
  } = params;

  const urgencyLabel = {
    "within 30 days":      "very near-term (within 30 days)",
    "1-3 months":          "near-term (1–3 months)",
    "this academic cycle": "this academic cycle",
    "next year":           "next year",
    "just researching":    "no fixed timeline",
  }[mappedTimeline] || mappedTimeline;

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
    `This combination produced a base score of ${baseScore}/100 — reflecting a ${urgencyLabel} intent window with a focus on ${mappedReadiness}.`,
    intentSentence,
    programNote,
    bucketExplanation,
  ].filter(Boolean).join(" ");
}

/* ---------- MAIN API ENDPOINT ---------- */
app.post("/intent-classifier", (req, res) => {
  try {
    const body = req.body || {};

    /* Raw values arriving from LeadSquared webhook */
    const rawReadiness    = norm(body.engagement_readiness); // Low_Readiness_Concern
    const rawTimeline     = norm(body.enrollment_timeline);  // Reconnect_Timeline
    const generalInquiry  = (body.student_inquiry   || "").trim();
    const programInterest = (body.program_interest  || "").trim();

    /* Validate that required fields are present */
    if (!rawReadiness) {
      return res.status(400).json({
        success: false,
        error: "engagement_readiness is required. Expected one of: " + Object.keys(READINESS_MAP).join(", "),
      });
    }
    if (!rawTimeline) {
      return res.status(400).json({
        success: false,
        error: "enrollment_timeline is required. Expected one of: " + Object.keys(TIMELINE_MAP).join(", "),
      });
    }

    /* Translate LS dropdown values into scoring matrix keys */
    const mappedReadiness = READINESS_MAP[rawReadiness];
    const mappedTimeline  = TIMELINE_MAP[rawTimeline];

    /* Validate that the values were recognised */
    if (!mappedReadiness) {
      return res.status(400).json({
        success: false,
        error: `Unrecognised engagement_readiness value: "${rawReadiness}". Expected one of: ` + Object.keys(READINESS_MAP).join(", "),
      });
    }
    if (!mappedTimeline) {
      return res.status(400).json({
        success: false,
        error: `Unrecognised enrollment_timeline value: "${rawTimeline}". Expected one of: ` + Object.keys(TIMELINE_MAP).join(", "),
      });
    }

    /* Look up base score from matrix */
    const baseScore = BASE_SCORE[mappedReadiness]?.[mappedTimeline] ?? 30;

    /* Classify free-text inquiry and get score adjustment */
    const inquiryType = classifyInquiry(generalInquiry);
    const adjustment  = INQUIRY_ADJUSTMENT[inquiryType] ?? 0;

    /* Calculate final score, clamped between 0 and 100 */
    let finalScore = baseScore + adjustment;
    finalScore = Math.max(0, Math.min(100, finalScore));

    /* Binary bucket — matches LS automation trigger conditions exactly */
    const bucket = finalScore >= 70 ? "High" : "Low";

    /* Generate plain-English reasoning for the LS activity log */
    const reasoning = generateReasoning({
      rawReadiness,
      rawTimeline,
      mappedReadiness,
      mappedTimeline,
      baseScore,
      inquiryType,
      adjustment,
      finalScore,
      bucket,
      generalInquiry,
      programInterest,
    });

    /* Send response back to LeadSquared */
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
