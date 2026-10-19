// Deterministic external YouTube boundary for the isolated browser test server.
// This preload is never imported by the app or a production launcher.
if (process.env.NODE_ENV !== "test" || process.env.YOUTUBE_API_KEY !== "e2e_fixture_key") {
  throw new Error("YouTube E2E fixture can only run on the isolated test server.");
}
const nativeFetch = globalThis.fetch;
const ids = new Set(["dQw4w9WgXcQ", "9bZkp7q19f0", "E2EADM00001", "E2EPRE00001", "E2EQUE00001", "E2ECON00001",
  ...Array.from({ length: 8 }, (_, index) => "E2Evideo"+String(index + 3).padStart(3, "0"))]);
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "www.googleapis.com" && url.pathname === "/youtube/v3/videos"
      && url.searchParams.get("key") === "e2e_fixture_key") {
    const id = url.searchParams.get("id");
    return Response.json({ items: ids.has(id) ? [{ id,
      status: { embeddable: true, privacyStatus: "public", uploadStatus: "processed" },
      contentDetails: { duration: "PT2M" },
      snippet: { title: "Vídeo de teste "+id, channelTitle: "Canal de teste" }
    }] : [] });
  }
  return nativeFetch(input, options);
};
