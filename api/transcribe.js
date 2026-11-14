export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server missing GEMINI_API_KEY in Vercel Environment Variables." });
    }

    const { audioBase64, mimeType } = req.body || {};
    if (!audioBase64) {
      return res.status(400).json({ error: "No audio data received by server." });
    }

    // iPhone Voice Memos (.m4a) often send audio/x-m4a or empty type
    let cleanMime = mimeType || "audio/mp4";
    if (cleanMime.includes("m4a") || cleanMime === "") {
      cleanMime = "audio/mp4";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    let geminiResponse;
    try {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: "Transcribe this Yorùbá audio accurately using standard Yorùbá orthography with full tonal marks (àmì ohùn) and sub-dots (ẹ, ọ, ṣ). Return only the Yorùbá transcription."
                  },
                  {
                    inline_data: {
                      mime_type: cleanMime,
                      data: audioBase64
                    }
                  }
                ]
              }
            ]
          })
        }
      );
    } finally {
      clearTimeout(timer);
    }

    const rawText = await geminiResponse.text();
    let data = {};
    try {
      data = JSON.parse(rawText);
    } catch {
      return res.status(502).json({ error: `Non-JSON response (${geminiResponse.status}): ${rawText.slice(0, 150)}` });
    }

    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json({ error: data?.error?.message || `Gemini HTTP ${geminiResponse.status}` });
    }

    const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!transcript.trim()) {
      return res.status(200).json({ error: "Gemini returned empty text (no speech detected)." });
    }

    return res.status(200).json({ transcript: transcript.trim() });
  } catch (err) {
    const msg = err.name === "AbortError" ? "Gemini timed out after 25s." : (err.message || "Unknown server error");
    return res.status(500).json({ error: msg });
  }
}
