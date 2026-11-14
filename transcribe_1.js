export async function onRequestPost(context) {
  try {
    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Server missing GEMINI_API_KEY environment variable." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const { audioBase64, mimeType } = await context.request.json();
    if (!audioBase64) {
      return new Response(
        JSON.stringify({ error: "No audio payload received." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Transcribe this Yorùbá audio accurately using standard Yorùbá orthography with full tonal marks (àmì ohùn) and sub-dots (ẹ, ọ, ṣ). Return only the Yorùbá transcription."
                },
                {
                  inline_data: {
                    mime_type: mimeType || "audio/mp3",
                    data: audioBase64
                  }
                }
              ]
            }
          ]
        })
      }
    );

    const data = await geminiResponse.json();
    if (!geminiResponse.ok) {
      return new Response(
        JSON.stringify({ error: data?.error?.message || "Gemini API error" }),
        { status: geminiResponse.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return new Response(
      JSON.stringify({ transcript: transcript.trim() }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Unexpected server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
