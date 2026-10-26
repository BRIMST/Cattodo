# Cattodo
catalogo

## Asistente de compras (IA gratuita)

`/api/asistente` interpreta el mensaje del cliente con una cadena de proveedores gratuitos.
Se prueban en orden y el que no tenga clave se salta. Configúralos en Vercel → Settings → Environment Variables:

| Orden | Proveedor  | Clave                | Modelo (opcional)    | Por defecto                              |
|-------|------------|----------------------|----------------------|------------------------------------------|
| 1     | Gemini     | `GEMINI_API_KEY`     | `GEMINI_MODEL`       | `gemini-3.1-flash-lite`                  |
| 2     | Groq       | `GROQ_API_KEY`       | `GROQ_MODEL`         | `llama-3.1-8b-instant`                   |
| 3     | OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL`   | `meta-llama/llama-3.3-70b-instruct:free` |
| 4     | Mistral    | `MISTRAL_API_KEY`    | `MISTRAL_MODEL`      | `mistral-small-latest`                   |

- Cada `*_MODEL` acepta varios modelos separados por coma (se prueban en orden).
- Los modelos gratuitos cambian: si uno deja de existir, actualiza la variable, sin tocar código.
- Si todos fallan, el navegador usa el asistente local (`js/asistente.js`) y el cliente no nota el error.
