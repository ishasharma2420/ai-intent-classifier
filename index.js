import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();

/* ---------- SECURITY & MIDDLEWARE ---------- */
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "100kb" }));

/* ---------- AI LANGUAGE MODEL CONFIG ----------
   Uses OpenAI API for intent classification and reasoning generation.
   Set OPENAI_API_KEY in your environment variables.
   If the API call fails, the system falls back to deterministic regex.
-------------------------------------------------------------------*/
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL = "gpt-4o-mini"; // fast, cheap, accurate for classification
const AI_ENABLED = !!OPENAI_API_KEY;

if (!AI_ENABLED) {
  console.warn("⚠️  OPENAI_API_KEY not set — running in deterministic fallback mode (regex only).");
} else {
  console.log("✅  AI Language Model enabled for intent classification and reasoning.");
}

/* ---------- HEALTH CHECK ---------- */
app.get("/", (_, res) => {
  res.json({
    service: "Agent Flash – AI Lead Readiness Scoring",
    status: "ok",
    version: "4.0.0",
    ai_enabled: AI_ENABLED,
  });
});

/* ---------- NORMALIZATION ---------- */
const norm = v => (v || "").toLowerCase().replace(/\s+/g, " ").trim();

/* ---------- BASE SCORE MATRIX ----------
   Rows = mx_Engagement_Readiness  — exact CRM dropdown values (lowercased)
   Cols = mx_Enrollment_Timeline   — exact CRM dropdown values (lowercased)
   Keys must match the LeadSquared dropdown values EXACTLY after lowercasing.
-------------------------------------------------------------------*/
const BASE_SCORE = {
  "ready to apply": {
    "within 30 days":      90,
    "1-3 months":          82,
    "this academic cycle": 75,
    "next year":           60,
    "just researching":    45,
  },
  "need help with admission process": {
    "within 30 days":      78,
    "1-3 months":          70,
    "this academic cycle": 63,
    "next year":           50,
    "just researching":    38,
  },
  "needs financial aid support": {
    "within 30 days":      75,
    "1-3 months":          68,
    "this academic cycle": 60,
    "next year":           47,
    "just researching":    35,
  },
  "need counselling guidance": {
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

/* ---------- VALID VALUE SETS ---------- */
const VALID_READINESS = new Set(Object.keys(BASE_SCORE));
const VALID_TIMELINES = new Set(
  Object.values(BASE_SCORE).flatMap(obj => Object.keys(obj))
);

/* ---------- VALID INTENT CATEGORIES ---------- */
const VALID_INTENTS = [
  "Admissions Inquiry",
  "Fees & Financial Aid",
  "Eligibility Check",
  "Program Selection",
  "Career Outcomes",
  "Campus & Experience",
  "Counselling Request",
  "Early Research",
  "General Inquiry",
];

/* ---------- INQUIRY SCORE ADJUSTMENT ---------- */
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

/* ---------- REGEX FALLBACK CLASSIFIER ----------
   Used when AI Language Model is unavailable or fails.
   Deterministic, zero-hallucination fallback.
-------------------------------------------------------------------*/
function classifyInquiryRegex(text) {
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

/* ---------- AI LANGUAGE MODEL: INTENT CLASSIFICATION ----------
   Sends the student's free-text inquiry to the AI Language Model
   and receives a structured intent classification.
   Falls back to regex if the API call fails.
-------------------------------------------------------------------*/
async function classifyInquiryAI(text) {
  if (!text || text.length < 3) return "General Inquiry";
  if (!AI_ENABLED) return classifyInquiryRegex(text);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0.1,
        max_tokens: 50,
        messages: [
          {
            role: "system",
            content: `You are an enrollment intent classifier for a career education institution. Given a student's inquiry, classify it into exactly one of these categories:

1. Admissions Inquiry — wants to apply, asks about deadlines, enrollment steps, how to start
2. Fees & Financial Aid — asks about cost, tuition, scholarships, FAFSA, financial help, affordability
3. Eligibility Check — asks about requirements, qualifications, GPA, prerequisites, eligibility
4. Program Selection — comparing programs, asking which course is best, exploring options between programs
5. Career Outcomes — asks about jobs, salary, placement, career prospects, ROI, what happens after graduation
6. Campus & Experience — asks about campus location, facilities, housing, tours, campus life
7. Counselling Request — wants to speak with an advisor, asks for guidance, help deciding
8. Early Research — just browsing, exploring, no specific intent, gathering general information
9. General Inquiry — does not fit any category above

Respond with ONLY the category name, nothing else.`,
          },
          {
            role: "user",
            content: text,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(`AI classification API error: ${response.status}`);
      return classifyInquiryRegex(text);
    }

    const data = await response.json();
    const aiIntent = (data.choices?.[0]?.message?.content || "").trim();

    if (VALID_INTENTS.includes(aiIntent)) {
      return aiIntent;
    }

    const matched = VALID_INTENTS.find(v =>
      aiIntent.toLowerCase().includes(v.toLowerCase()) ||
      v.toLowerCase().includes(aiIntent.toLowerCase())
    );
    if (matched) return matched;

    console.warn(`AI returned unrecognised intent: "${aiIntent}" — falling back to regex.`);
    return classifyInquiryRegex(text);

  } catch (err) {
    console.error("AI classification failed, using regex fallback:", err.message);
    return classifyInquiryRegex(text);
  }
}

/* ---------- AI LANGUAGE MODEL: REASONING GENERATION ----------
   Generates a contextually rich, plain-English explanation.
   Falls back to template-based reasoning if the API call fails.
-------------------------------------------------------------------*/
async function generateReasoningAI({
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
  const templateReasoning = generateReasoningTemplate({
    rawReadiness, rawTimeline, baseScore, inquiryType,
    adjustment, finalScore, bucket, generalInquiry, programInterest,
  });

  if (!AI_ENABLED) return templateReasoning;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0.5,
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content: `You are Agent Flash, an AI enrollment readiness scoring engine. Write a concise reasoning summary in exactly 2 sentences. Sentence 1: why this lead received its score (reference their specific inquiry, readiness, and timeline). Sentence 2: the recommended next step — if High bucket say immediate counselor scheduling recommended, if Low bucket say routed to voice bot qualification. No markdown, no bullet points, no curly braces, no double quotes. Keep it under 250 characters total.`,
          },
          {
            role: "user",
            content: `Score: ${finalScore}/100 (${bucket}). Readiness: ${rawReadiness}. Timeline: ${rawTimeline}. Intent: ${inquiryType}. Inquiry: ${generalInquiry || "None"}. Program: ${programInterest || "Not specified"}. Adjustment: ${adjustment > 0 ? '+' + adjustment : adjustment} pts.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(`AI reasoning API error: ${response.status}`);
      return templateReasoning;
    }

    const data = await response.json();
    let aiReasoning = (data.choices?.[0]?.message?.content || "").trim();

    if (!aiReasoning || aiReasoning.length < 20) {
      return templateReasoning;
    }

    aiReasoning = aiReasoning.replace(/[{}"]/g, match => match === '"' ? "'" : "");

    if (aiReasoning.length > 300) {
      aiReasoning = aiReasoning.substring(0, 297) + "...";
    }

    return aiReasoning;

  } catch (err) {
    console.error("AI reasoning failed, using template fallback:", err.message);
    return templateReasoning;
  }
}

/* ---------- TEMPLATE REASONING (FALLBACK) ---------- */
function generateReasoningTemplate({
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
  const intentSentence = generalInquiry && generalInquiry.length > 3
    ? `Student inquiry classified as ${inquiryType.toLowerCase()} (${adjustment > 0 ? '+' + adjustment : adjustment} pts).`
    : ``;

  const parts = [
    `Lead scored ${finalScore}/100 (${bucket}) based on stated need: ${rawReadiness}, timeline: ${rawTimeline}.`,
    intentSentence,
    bucket === "High"
      ? `Immediate counselor scheduling recommended.`
      : `Routed to voice qualification first.`,
  ].filter(Boolean).join(" ");

  return parts.replace(/[{}"]/g, match => match === '"' ? "'" : "");
}

/* ---------- MAIN API ENDPOINT ---------- */
app.post("/intent-classifier", async (req, res) => {
  try {
    const raw = req.body || {};
    const body = raw.Current || raw;

    /* Normalize incoming values */
    const rawReadiness    = norm(body.mx_Engagement_Readiness || body.engagement_readiness);
    const rawTimeline     = norm(body.mx_Enrollment_Timeline  || body.enrollment_timeline);
    const generalInquiry  = (body.mx_Student_Inquiry          || body.student_inquiry  || "").trim();
    const programInterest = (body.mx_Program_Interest         || body.program_interest || "").trim();

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

    /* Classify intent — AI with regex fallback */
    const inquiryType = await classifyInquiryAI(generalInquiry);
    const adjustment  = INQUIRY_ADJUSTMENT[inquiryType] ?? 0;

    /* Final score clamped 0–100 */
    let finalScore = baseScore + adjustment;
    finalScore = Math.max(0, Math.min(100, finalScore));

    /* Binary bucket */
    const bucket = finalScore >= 70 ? "High" : "Low";

    /* Generate reasoning — AI with template fallback */
    const reasoning = await generateReasoningAI({
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

    /* Respond — same output shape as v3.1 */
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
  console.log(`Agent Flash v4.0.0 listening on port ${PORT}`);
  console.log(`AI Language Model: ${AI_ENABLED ? "ENABLED" : "DISABLED (regex fallback)"}`);
});
