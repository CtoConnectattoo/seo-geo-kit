// Llamadas a Apify por REST con tope de gasto por ejecución (maxTotalChargeUsd).
// Precios de Apify (tier BRONZE, nov 2026): solo para estimar y poner topes.
export const PRICE = {
  serpPage: 0.0025,
  aiOverview: 0.002,
  aiMode: 0.005,
  chatGpt: 0.005,
  perplexity: 0.013,
  kwRequest: 0.25,
  kwRow: 0.0036,
};

// Opciones de apify/google-search-scraper para cada motor GEO.
export const ENGINE_INPUT = {
  aiOverview: { aiOverview: { scrapeFullAiOverview: true } },
  aiMode: { aiModeSearch: { enableAiMode: true } },
  chatGpt: { chatGptSearch: { enableChatGpt: true } },
  perplexity: { perplexitySearch: { enablePerplexity: true, returnImages: false, returnRelatedQuestions: false } },
};

export async function runActor(actor, input, maxUsd, token = process.env.APIFY_TOKEN) {
  const url = `https://api.apify.com/v2/acts/${actor.replace('/', '~')}/run-sync-get-dataset-items?timeout=600&maxTotalChargeUsd=${maxUsd}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`${actor}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
